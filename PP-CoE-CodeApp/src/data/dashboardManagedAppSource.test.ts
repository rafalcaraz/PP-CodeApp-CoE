import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceItem } from "../generated/models/PowerPlatformforAdminsV2Model";
import { ResourceType, type DataResult } from "./inventory";
import {
  assessManagedAppAssignment, createManagedAppsEstateSource, managedAppConnectorIds,
  readManagedAppsEstate, type ManagedAppsEstateSnapshot,
} from "./dashboardManagedAppSource";

const { query, assignments } = vi.hoisted(() => ({ query: vi.fn(), assignments: vi.fn() }));
vi.mock("./inventory", async () => ({ ...await vi.importActual<typeof import("./inventory")>("./inventory"), runRawQuery: query }));
vi.mock("../generated", () => ({ PowerPlatformforAdminsV2Service: { ListRuleAssignmentsByEnvironmentGroupId: assignments } }));
const raw = (type: string, name: string, properties: Record<string, unknown> = {}): ResourceItem => ({ type, name, properties });
const app = (name: string, env: string, properties: Record<string, unknown> = {}) => raw(ResourceType.AppBuilderApp, name, {
  subType: "microsoftApp", environmentId: env, displayName: `App ${name}`, createdBy: "creator", ownerId: "different-owner", ...properties,
});
const page = (items: ResourceItem[], skipToken = "", resultTruncated = "1") => ({
  ok: true, data: { items, rawItems: items, skipToken, resultTruncated },
});
const typeOf = (clauses: unknown[]) => JSON.stringify(clauses).match(/microsoft\.[a-z.]+\/[a-z]+/i)?.[0];
const snapshot: ManagedAppsEstateSnapshot = { apps: [], capturedAt: "2026-03-01T12:00:00Z" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  assignments.mockResolvedValue({ success: true, data: { value: [] } });
  query.mockImplementation(() => page([]));
});

describe("Managed Apps Estate complete source", () => {
  it("includes all eight managed apps across environment types, keeps creator distinct and reads each relevant group's assignments once", async () => {
    const apps = [
      app("a", "developer", { origin: "CopilotStudio", powerPlatformConnectors: [{ connectorId: "shared_sql" }, { connectorId: "/apis/SHARED_SQL" }] }),
      app("b", "developer"), app("c", "sandbox", { powerPlatformConnectors: [] }),
      app("d", "production", { createdBy: { id: "another-creator", displayName: "Synthetic creator" } }),
      app("e", "ungrouped"), app("f", "missing"), app("g", ""), app("a", "sandbox", { powerPlatformConnectors: "invalid" }),
      app("not-managed", "developer", { subType: "appBuilderApp" }),
    ];
    const envs = [
      raw(ResourceType.Environment, "developer", { environmentType: "Developer", isManaged: true, environmentGroupId: "with" }),
      raw(ResourceType.Environment, "sandbox", { environmentType: "Sandbox", isManaged: false, environmentGroupId: "without" }),
      raw(ResourceType.Environment, "production", { environmentType: "Production", environmentGroupId: "failed" }),
      raw(ResourceType.Environment, "ungrouped", { environmentType: "Trial", environmentGroupId: null }),
    ];
    query.mockImplementation((clauses: unknown[]) => page(typeOf(clauses) === ResourceType.AppBuilderApp ? apps
      : typeOf(clauses) === ResourceType.Environment ? envs
      : ["with", "without", "failed", "empty-group"].map((name) => raw(ResourceType.EnvironmentGroup, name, { displayName: name }))));
    assignments.mockImplementation((group: string) => group === "failed" ? { success: false, error: "Forbidden" }
      : { success: true, data: { value: group === "with" ? [{ policyId: "empty-policy", resourceId: group, resourceType: "EnvironmentGroup", ruleSetCount: 0 }] : [] } });
    const result = await readManagedAppsEstate(new AbortController().signal);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.apps).toHaveLength(8);
    expect(result.data.apps.filter((row) => row.id === "a")).toHaveLength(2);
    expect(result.data.apps[0]).toMatchObject({ createdBy: "creator", ownerId: "different-owner", connectorIds: ["sql"], acp: "With ACP" });
    expect(result.data.apps[1].connectorIds).toEqual([]);
    expect(result.data.apps.at(-1)?.connectorIds).toBeNull();
    expect(result.data.apps.find((row) => row.id === "d")).toMatchObject({ creatorName: "Synthetic creator", acp: "Unable to assess", environmentManaged: null });
    expect(result.data.apps.find((row) => row.id === "e")?.acp).toBe("Ungrouped");
    expect(result.data.apps.find((row) => row.id === "f")?.acp).toBe("Unable to assess");
    expect(result.data.apps.find((row) => row.id === "g")?.environmentMapped).toBe(false);
    expect(assignments.mock.calls.map(([group]) => group).sort()).toEqual(["failed", "with", "without"]);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it("starts independent inventories together, follows all pages with cumulative Skip and never caps successful totals", async () => {
    const first = deferred<ReturnType<typeof page>>();
    query.mockImplementation((clauses: unknown[], options: { SkipToken: string }) => {
      if (typeOf(clauses) !== ResourceType.AppBuilderApp) return Promise.resolve(page([]));
      return options.SkipToken ? page([app("b", "env")]) : first.promise;
    });
    const pending = readManagedAppsEstate(new AbortController().signal, true);
    expect(query).toHaveBeenCalledTimes(3);
    first.resolve(page([app("a", "env")], "next"));
    const result = await pending;
    expect(result.ok && result.data.apps).toHaveLength(2);
    expect(query.mock.calls[3][1]).toEqual({ Top: 500, Skip: 1, SkipToken: "next" });
    expect(query.mock.calls.every((call) => call[2].forceFresh)).toBe(true);
  });
  it.each(["repeat", "truncated", "conflict", "omitted", "failure", "identity", "subtype"])("rejects incomplete inventory: %s", async (mode) => {
    query.mockImplementation((clauses: unknown[], options: { SkipToken: string }) => {
      if (typeOf(clauses) !== ResourceType.AppBuilderApp) return page([]);
      if (mode === "failure") return { ok: false, error: "Forbidden inventory" };
      if (mode === "identity") return page([raw(ResourceType.AppBuilderApp, "", {})]);
      if (mode === "subtype") return page([raw(ResourceType.AppBuilderApp, "app", { environmentId: "env" })]);
      if (mode === "omitted") return { ok: true, data: {} };
      if (mode === "truncated") return page([app("a", "env")], "", "0");
      if (options.SkipToken) return page([app("a", "env", mode === "conflict" ? { origin: "changed" } : {})], "next");
      return page([app("a", "env")], "next");
    });
    expect((await readManagedAppsEstate(new AbortController().signal)).ok).toBe(false);
    expect(assignments).not.toHaveBeenCalled();
  });
  it("stops future assignment work on cancellation and bounds concurrency to three", async () => {
    query.mockImplementation((clauses: unknown[]) => page(Array.from({ length: 5 }, (_, i) =>
      typeOf(clauses) === ResourceType.AppBuilderApp ? app(`a${i}`, `e${i}`)
        : typeOf(clauses) === ResourceType.Environment ? raw(ResourceType.Environment, `e${i}`, { environmentGroupId: `g${i}` })
        : raw(ResourceType.EnvironmentGroup, `g${i}`))));
    const gates = Array.from({ length: 3 }, () => deferred<{ success: boolean; data: { value: never[] } }>());
    assignments.mockImplementation(() => gates[assignments.mock.calls.length - 1].promise);
    const controller = new AbortController();
    const pending = readManagedAppsEstate(controller.signal);
    await vi.waitFor(() => expect(assignments).toHaveBeenCalledTimes(3));
    controller.abort();
    gates.forEach((gate) => gate.resolve({ success: true, data: { value: [] } }));
    expect((await pending).ok).toBe(false);
    expect(assignments).toHaveBeenCalledTimes(3);
  });
  it("keeps conflicting or missing group mappings unable to assess, not ungrouped", async () => {
    query.mockImplementation((clauses: unknown[]) => page(typeOf(clauses) === ResourceType.AppBuilderApp ? [app("a", "e"), app("b", "f")]
      : typeOf(clauses) === ResourceType.Environment ? [
        raw(ResourceType.Environment, "e", { environmentGroup: "orphan label" }),
        raw(ResourceType.Environment, "f", { environmentGroupId: "missing-group" }),
      ] : []));
    const result = await readManagedAppsEstate(new AbortController().signal);
    expect(result.ok && result.data.apps.map((row) => row.acp)).toEqual(["Unable to assess", "Unable to assess"]);
    expect(assignments).not.toHaveBeenCalled();
  });
});
describe("Managed-app usage and authoritative assignments", () => {
  it("treats absent/empty usage as none, but malformed entries as unknown", () => {
    expect(managedAppConnectorIds({})).toEqual([]);
    expect(managedAppConnectorIds({ powerPlatformConnectors: [] })).toEqual([]);
    for (const value of [null, {}, "sql", [{}], [{ connectorId: "/apis/" }]]) {
      expect(managedAppConnectorIds({ powerPlatformConnectors: value })).toBeNull();
    }
  });
  it("counts returned policy identity even with zero explicit rules and never infers ACP from Model A generic rules", () => {
    expect(assessManagedAppAssignment({ value: [{ policyId: "policy", resourceId: "group", resourceType: "EnvironmentGroup", ruleSetCount: 0 }] }, "group").acp).toBe("With ACP");
    expect(assessManagedAppAssignment({ value: [] }, "group").acp).toBe("Without ACP");
    for (const data of [{}, { value: [], nextLink: "more" }, { value: [{ id: "generic-model-a-rule" }] },
      { value: [{ policyId: "policy", resourceId: "other", resourceType: "EnvironmentGroup" }] }]) {
      expect(assessManagedAppAssignment(data, "group").acp).toBe("Unable to assess");
    }
  });
});
describe("Dashboard-owned snapshot source", () => {
  it("publishes freshness without additional reads and exposes failures without claiming a fresh snapshot", async () => {
    const gate = deferred<DataResult<ManagedAppsEstateSnapshot>>();
    const read = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValueOnce({ ok: false, error: "Failure" });
    const source = createManagedAppsEstateSource(read);
    const notify = vi.fn();
    const unsubscribe = source.subscribe(notify);
    expect(source.getStatus()).toEqual({ phase: "idle" });
    expect(read).not.toHaveBeenCalled();
    const pending = source.load();
    expect(source.getStatus().phase).toBe("loading");
    gate.resolve({ ok: true, data: snapshot });
    await pending;
    expect(source.getStatus()).toEqual({ phase: "ready", capturedAt: snapshot.capturedAt });
    await source.load(1);
    expect(source.getStatus().phase).toBe("error");
    expect(read).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(4);
    unsubscribe();
  });
  it("deduplicates all tiles/tabs, retains one generation and forces one shared explicit refresh", async () => {
    const gate = deferred<DataResult<ManagedAppsEstateSnapshot>>();
    const read = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue({ ok: true, data: snapshot });
    const source = createManagedAppsEstateSource(read);
    const tiles = Array.from({ length: 12 }, () => source.load(0));
    expect(read).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true, data: snapshot });
    await Promise.all(tiles);
    await source.load(0);
    expect(read).toHaveBeenCalledTimes(1);
    await Promise.all([source.load(1), source.load(1)]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.map((call) => call[1])).toEqual([false, true]);
    await createManagedAppsEstateSource(read).load(0);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("isolates subscriber cancellation, permits StrictMode reattachment, and stops abandoned work", async () => {
    const gate = deferred<DataResult<ManagedAppsEstateSnapshot>>();
    const read = vi.fn().mockReturnValue(gate.promise);
    const source = createManagedAppsEstateSource(read);
    const a = new AbortController();
    const b = new AbortController();
    const first = source.load(0, a.signal);
    a.abort();
    const second = source.load(0, b.signal);
    await Promise.resolve();
    expect(read.mock.calls[0][0].aborted).toBe(false);
    expect((await first).ok).toBe(false);
    b.abort();
    expect((await second).ok).toBe(false);
    await Promise.resolve();
    expect(read.mock.calls[0][0].aborted).toBe(true);
    gate.resolve({ ok: true, data: snapshot });
  });
  it("does not cache failed or rejected reads and never lets stale refresh completion replace current snapshot", async () => {
    const old = deferred<DataResult<ManagedAppsEstateSnapshot>>();
    const read = vi.fn().mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ok: true, data: { ...snapshot, capturedAt: "new" } });
    const source = createManagedAppsEstateSource(read);
    const stale = source.load(0);
    await source.load(1);
    old.resolve({ ok: true, data: snapshot });
    await stale;
    const fresh = await source.load(1);
    expect(fresh.ok && fresh.data.capturedAt).toBe("new");
    expect(read).toHaveBeenCalledTimes(2);
    const retryRead = vi.fn().mockResolvedValueOnce({ ok: false, error: "Failed" })
      .mockRejectedValueOnce(new Error("Rejected")).mockResolvedValue({ ok: true, data: snapshot });
    const retry = createManagedAppsEstateSource(retryRead);
    expect((await retry.load()).ok).toBe(false);
    await expect(retry.load()).rejects.toThrow("Rejected");
    expect((await retry.load()).ok).toBe(true);
    const abort = new AbortController();
    abort.abort();
    expect((await retry.load(2, abort.signal)).ok).toBe(false);
    expect(retryRead).toHaveBeenCalledTimes(3);
  });
});
