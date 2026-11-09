import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloneSnapshot } from "./groupClone";
const { source, environments, scope, update, patch } = vi.hoisted(() => ({
  source: vi.fn(), environments: vi.fn(), scope: vi.fn(), update: vi.fn(), patch: vi.fn(),
}));
vi.mock("./groupCloneData", () => ({
  groupCloneBackend: { readSource: source, readPolicyAssignments: scope, patchPolicy: patch }, updateGroupRule: update,
}));
vi.mock("./data", async () => ({
  ...await vi.importActual<typeof import("./data")>("./data"), loadRuleSyncEnvironments: environments,
}));
import { readRuleSyncSource, reconcileRuleSyncRecord, ruleSyncBackend, ruleSyncStore, ruleSyncRuntimeBlocker } from "./ruleSyncData";
import type { SyncRecord } from "./ruleSync";
const snapshot: CloneSnapshot = {
  group: { id: "group" }, rules: [], policy: { id: "policy" }, assignments: [],
  publication: "applied", publicationEvidence: "Synthetic", blockers: [],
};
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  source.mockResolvedValue({ ok: true, data: snapshot });
  environments.mockResolvedValue({ ok: true, data: [] });
  scope.mockResolvedValue({ ok: true, data: [{ policyId: "policy", resourceId: "group", resourceType: "EnvironmentGroup" }] });
});
describe("rule sync adapter and ID-only journal", () => {
  it("reads full policy assignment scope even for empty groups, never writing during inspection", async () => {
    const result = await readRuleSyncSource("group");
    expect(result).toEqual({ ok: true, data: { ...snapshot, environments: [], policyScope: [{ policyId: "policy", resourceId: "group", resourceType: "EnvironmentGroup" }] } });
    expect(scope).toHaveBeenCalledExactlyOnceWith("policy");
    expect(update).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });
  it.each(["scope", "membership", "source"])("does not turn unavailable %s into empty evidence", async (kind) => {
    (kind === "scope" ? scope : kind === "membership" ? environments : source).mockResolvedValue({ ok: false, error: "403 MissingReadPermission" });
    expect(await ruleSyncBackend.read("group")).toEqual({ ok: false, error: "403 MissingReadPermission" });
  });
  it("discards stale source reads and requires a real browser concurrency lock", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await readRuleSyncSource("group", controller.signal)).ok).toBe(false);
    expect(ruleSyncRuntimeBlocker()).toContain("Web Locks");
  });
  it("blocks contradictory full assignment scope instead of treating it as an unassigned policy", async () => {
    scope.mockResolvedValue({ ok: true, data: [] });
    expect(await ruleSyncBackend.read("group")).toEqual({ ok: false,
      error: "Full policy assignment scope contradicts the group's applied assignment. Safe applicability cannot be verified." });
    expect(update).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
  });
  it("rejects a different returned group rather than syncing to an unchecked identity", async () => {
    source.mockResolvedValue({ ok: true, data: { ...snapshot, group: { id: "other-group" } } });
    expect(await ruleSyncBackend.read("group")).toEqual({ ok: false,
      error: "Returned group identity differs from the checked group. No sync can be prepared." });
    expect(scope).not.toHaveBeenCalled();
  });
  it("round-trips only recovery IDs and hashes, rejecting additional payloads and corrupt stored state", () => {
    const record: SyncRecord = {
      version: 1, id: "operation", sourceId: "source", sourceFingerprint: "hash", planFingerprint: "hash", updatedAt: 123, phase: "indeterminate",
      targets: [{ id: "target", policyId: "policy", expected: "hash", phase: "indeterminate",
        steps: [{ kind: "settings", resourceId: "rule-id", expected: "hash", phase: "started" }] }],
    };
    ruleSyncStore.save(record);
    expect(ruleSyncStore.all()).toEqual([record]);
    expect(() => ruleSyncStore.save({ ...record, ...{ payload: { secret: "not stored" } } })).toThrow("Unsafe sync journal");
    localStorage.setItem("ppcoe:managed-apps:rule-sync:v1:bad", JSON.stringify({ ...record, id: "bad", payload: {} }));
    expect(() => ruleSyncStore.all()).toThrow("invalid");
  });
  it("does not overwrite an active operation's journal through cross-tab read-only reconciliation", async () => {
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) => callback(null));
    vi.stubGlobal("navigator", { locks: { request } });
    const record: SyncRecord = { version: 1, id: "operation", sourceId: "source", sourceFingerprint: "hash", planFingerprint: "hash",
      updatedAt: 123, phase: "running", targets: [] };
    await expect(reconcileRuleSyncRecord(record)).rejects.toThrow("Another sync is running");
    expect(request).toHaveBeenCalledWith("ppcoe:managed-apps:rule-sync", { mode: "exclusive", ifAvailable: true }, expect.any(Function));
    expect(source).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
