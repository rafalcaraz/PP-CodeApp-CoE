import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SPEC, draftKey, getPath, parseClausesPayload, readWorkspace, resourceIdentity, resultColumns, resultViewKey, writeWorkspace } from "./workspace";
import type { Clause } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { ResourceType } from "../../data/inventory";
beforeEach(() => sessionStorage.clear());
describe("Queries workspace", () => {
  it("restores drafts, loaded identity, mode and view settings, but not tenant results", () => {
    const { draft } = readWorkspace();
    const next = { ...draft, mode: "advanced" as const, advancedText: "invalid draft retained", loadedId: "q_1",
      columns: ["name"], search: "needle", favoritesOnly: true, libraryOpen: true };
    writeWorkspace(next);
    expect(readWorkspace().draft).toEqual(next);
    expect(sessionStorage.getItem("ppcoe.queries.workspace.v1")).not.toContain("rows");
  });
  it.each(["{bad", '{"version":0}', '{"version":1,"spec":null}', '{"version":1,"spec":{},"search":17}'])("safely rejects corrupt/older drafts: %s", (raw) => {
    sessionStorage.setItem("ppcoe.queries.workspace.v1", raw);
    expect(readWorkspace().draft.spec).toEqual(DEFAULT_SPEC);
    expect(readWorkspace().warning).toBeTruthy();
  });
  it("gives draft changes a different execution ownership key", () => {
    expect(draftKey(DEFAULT_SPEC, "basic", "")).not.toBe(draftKey({ ...DEFAULT_SPEC, limit: 200 }, "basic", ""));
    expect(draftKey(DEFAULT_SPEC, "advanced", "invalid")).not.toBe(draftKey(DEFAULT_SPEC, "advanced", "[]"));
  });
  it("rejects malformed optional pairing data before it can reach controls", () => {
    const { draft } = readWorkspace();
    sessionStorage.setItem("ppcoe.queries.workspace.v1", JSON.stringify({
      ...draft, spec: { ...draft.spec, filters: [{ field: "__operation", op: "==", value: "GetItems", connectorId: 42 }] },
    }));
    expect(readWorkspace().warning).toBeTruthy();
    expect(readWorkspace().draft.spec.filters).toEqual([]);
  });
  it("keeps raw clauses and envelopes compatible", () => {
    expect(parseClausesPayload('[{"$type":"count"}]').ok).toBe(true);
    expect(parseClausesPayload('{"clauses":[{"$type":"count"}]}').ok).toBe(true);
    expect(parseClausesPayload('[{"$type":"unsafe"}]').ok).toBe(false);
    expect(parseClausesPayload("[]").ok).toBe(false);
  });
  it("renders shape-aware aggregate/project columns without inventing identities", () => {
    expect(resultColumns([{ Count: 3 }, { Total: 4 }], [{ $type: "summarize" } as Clause])).toEqual(["Count", "Total"]);
    expect(resultColumns([{ name: "x", Score: 3 }], [{ $type: "project" } as Clause], ["type"])).toEqual(["name", "Score"]);
    expect(resourceIdentity({ Count: 3 })).toBeNull();
    expect(resourceIdentity({ name: 7, type: {} })).toBeNull();
    expect(resourceIdentity({ name: "shared-bot-id", type: ResourceType.CopilotStudioAgent })).toBeNull();
    expect(getPath({ properties: null }, "properties.ownerId")).toBeUndefined();
    expect(getPath({ "properties.displayName": "Projected name" }, "properties.displayName")).toBe("Projected name");
  });
  it("isolates result schemas without storing rows or changing keys for incoming data", () => {
    const clauses = [{ $type: "project" } as Clause];
    expect(resultViewKey([{ Score: 1, "properties.displayName": "One" }], clauses))
      .toBe(resultViewKey([{ "properties.displayName": "Two", Score: 99 }], clauses));
    expect(resultViewKey([{ Score: 1 }], clauses)).not.toBe(resultViewKey([{ Total: 1 }], clauses));
    expect(resultViewKey([1, 2], clauses)).toBe(resultViewKey([3], clauses));
    expect(resultViewKey([1], clauses)).not.toContain("rows");
  });
});
