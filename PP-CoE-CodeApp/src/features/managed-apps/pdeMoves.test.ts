import { beforeEach, describe, expect, it, vi } from "vitest";
import { executePdeMoves, moveBlockers, moveCanResume, moveEntryUnresolved, moveNeedsCheck, moveOutcomeLabel, moveWriteStatus, reconcilePdeMove, type MoveBackend, type MoveRecord, type MoveStore } from "./pdeMoves";
import { readManagedApp, type EnvironmentRow } from "./data";
import type { GroupEvidence, MovePreview } from "./governance";

const group = (id: string) => ({ id, displayName: id, description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" });
const evidence = (id: string): GroupEvidence => ({
  groupId: id, capturedAt: Date.now(), details: { ok: true, data: { id } },
  policies: { ok: true, data: [] }, rulesets: { ok: true, data: { matching: [], unresolved: [] } },
});
const env = (id: string, source = "source"): EnvironmentRow => ({
  id, displayName: id, environmentType: "Developer", isManaged: true, environmentGroupId: source,
  environmentGroup: source, region: "", createdAt: "", createdBy: "", lastModifiedAt: "", tenantId: "",
});
const app = (id: string, environmentId: string) => readManagedApp({
  name: id, type: "microsoft.powerapps/apps", properties: { environmentId, displayName: id },
});
function plan(id = "synthetic-pde", source = "source"): MovePreview {
  const apps = [app("selected", id), app("hidden-sibling", id)];
  return {
    preparedAt: Date.now(), destination: group("destination"), pdes: [{
      environmentId: id, environment: env(id, source), status: source === "destination" ? "already-member" : "prepared",
      apps, resources: apps, resourceCount: apps.length, connectors: [],
      sourceEvidence: source ? evidence(source) : undefined, destinationEvidence: evidence("destination"),
    }],
  };
}
function fixture(preview = plan()) {
  const memberships = new Map(preview.pdes.map((pde) => [pde.environmentId, pde.environment!.environmentGroupId]));
  const records: MoveRecord[] = [];
  const save = vi.fn((record: MoveRecord) => {
    const index = records.findIndex((entry) => entry.id === record.id);
    if (index === -1) records.push(structuredClone(record));
    else records[index] = structuredClone(record);
  });
  const store: MoveStore = { list: () => structuredClone(records), save };
  const backend: MoveBackend = {
    prepare: vi.fn<MoveBackend["prepare"]>(async (selection) => {
      const current = plan(selection[0].environmentId, memberships.get(selection[0].environmentId));
      return { ok: true, data: current };
    }),
    read: vi.fn<MoveBackend["read"]>(async (id) => ({ ok: true, data: { environmentId: id, groupId: memberships.get(id)!, hasDataverse: true } })),
    remove: vi.fn<MoveBackend["remove"]>(async (source, id) => {
      expect(records.at(-1)!.pdes.find((pde) => pde.environmentId === id)?.phase).toBe("removing");
      expect(source).toBe(memberships.get(id)); memberships.set(id, "");
      return { ok: true, data: undefined };
    }),
    add: vi.fn<MoveBackend["add"]>(async (destination, id) => {
      expect(records.at(-1)!.pdes.find((pde) => pde.environmentId === id)?.phase).toBe("adding");
      expect(memberships.get(id)).toBe(""); memberships.set(id, destination);
      return { ok: true, data: undefined };
    }),
    pause: vi.fn(async () => undefined),
  };
  return { backend, store, memberships, records, preview, save };
}
beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
  vi.stubGlobal("crypto", webcrypto);
});
describe("supported PDE membership orchestration", () => {
  it.each(["none", "denied"] as const)("requires new confirmation for detached add-only recovery (previous add %s), links history and never repeats removal", async (add) => {
    const f = fixture(plan("synthetic-pde", ""));
    const previous: MoveRecord = {
      version: 1, id: "synthetic-detached", destinationId: "old-destination", previewHash: "old", updatedAt: 123,
      pdes: [{ environmentId: "synthetic-pde", sourceId: "original-source", phase: "detached", remove: "accepted", add, observedGroupId: "" }],
    };
    f.store.save(previous);
    await expect(executePdeMoves(f.preview, f.backend, f.store, false, [previous.id])).rejects.toThrow(/confirmation/);
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/previous move/i);
    expect(f.backend.add).not.toHaveBeenCalled();
    const result = await executePdeMoves(f.preview, f.backend, f.store, true, [previous.id]);
    expect(result.record.pdes[0]).toMatchObject({ phase: "verified", remove: "none", add: "accepted", recoveryOf: [previous.id], sourceId: "" });
    expect(f.backend.remove).not.toHaveBeenCalled(); expect(f.backend.add).toHaveBeenCalledExactlyOnceWith("destination", "synthetic-pde");
    expect(f.store.list()[0]).toEqual(previous);
    expect(moveEntryUnresolved(previous, previous.pdes[0], f.store.list())).toBe(false);
    const reads = vi.mocked(f.backend.read).mock.calls.length;
    await reconcilePdeMove(previous, f.backend, f.store);
    expect(f.backend.read).toHaveBeenCalledTimes(reads);
    expect((await executePdeMoves(plan("synthetic-pde", "destination"), f.backend, f.store, true)).record.pdes[0].phase).toBe("already-member");
  });
  it.each(["started", "accepted", "uncertain"] as const)("blocks recovery of a possibly active add (%s), even when current membership is ungrouped", async (add) => {
    const f = fixture(plan("synthetic-pde", ""));
    const previous: MoveRecord = {
      version: 1, id: "synthetic-ambiguous", destinationId: "destination", previewHash: "old", updatedAt: 123,
      pdes: [{ environmentId: "synthetic-pde", sourceId: "original-source", phase: "detached", remove: "accepted", add, observedGroupId: "" }],
    };
    f.store.save(previous);
    expect(moveCanResume(previous.pdes[0])).toBe(false);
    await expect(executePdeMoves(f.preview, f.backend, f.store, true, [previous.id])).rejects.toThrow(/previous move/i);
    expect(f.backend.add).not.toHaveBeenCalled(); expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("does not consume recovery permission when live membership changed, and an ambiguous recovery remains blocking", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    const previous: MoveRecord = {
      version: 1, id: "synthetic-detached", destinationId: "destination", previewHash: "old", updatedAt: 123,
      pdes: [{ environmentId: "synthetic-pde", sourceId: "source", phase: "detached", remove: "accepted", add: "none", observedGroupId: "" }],
    };
    f.store.save(previous);
    vi.mocked(f.backend.read).mockResolvedValueOnce({ ok: true, data: { environmentId: "synthetic-pde", groupId: "competing-group", hasDataverse: true } });
    const stopped = await executePdeMoves(f.preview, f.backend, f.store, true, [previous.id]);
    expect(stopped.record.pdes[0]).toMatchObject({ phase: "failed", add: "none", remove: "none" });
    expect(moveEntryUnresolved(previous, previous.pdes[0], f.store.list())).toBe(true);
    expect(f.backend.add).not.toHaveBeenCalled(); expect(f.backend.remove).not.toHaveBeenCalled();
    vi.mocked(f.backend.add).mockRejectedValue(new Error("Synthetic transport uncertainty"));
    const uncertain = await executePdeMoves(f.preview, f.backend, f.store, true, [previous.id]);
    expect(uncertain.record.pdes[0]).toMatchObject({ phase: "indeterminate", add: "uncertain", remove: "none" });
    await expect(executePdeMoves(f.preview, f.backend, f.store, true, [previous.id])).rejects.toThrow(/previous move/i);
    expect(f.backend.add).toHaveBeenCalledTimes(1);
  });
  it("scopes read-only checking within a mixed record to selected PDE identities", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    const previous: MoveRecord = {
      version: 1, id: "synthetic-mixed", destinationId: "destination", previewHash: "old", updatedAt: 123,
      pdes: [
        { environmentId: "different-pde", sourceId: "source", phase: "indeterminate", remove: "uncertain", add: "none" },
        { environmentId: "synthetic-pde", sourceId: "source", phase: "removed", remove: "accepted", add: "none" },
      ],
    };
    f.store.save(previous);
    const result = await reconcilePdeMove(previous, f.backend, f.store, undefined, ["SYNTHETIC-PDE"]);
    expect(f.backend.read).toHaveBeenCalledExactlyOnceWith("synthetic-pde");
    expect(result.record.pdes[0]).toEqual(previous.pdes[0]);
    expect(result.record.pdes[1].phase).toBe("detached");
    expect(result.messages.join(" ")).not.toContain("different-pde");
    expect(f.backend.add).not.toHaveBeenCalled(); expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("reports failed direct preflight as no writes, including the add-only ungrouped path", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    vi.mocked(f.backend.read).mockResolvedValue({ ok: false, error: "Cannot verify membership. [deletedDateTime: invalid value]" });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.record.pdes[0]).toMatchObject({ phase: "failed", remove: "none", add: "none" });
    expect(result.messages.join(" ")).toContain("No membership writes were attempted by this operation.");
    expect(result.messages.join(" ")).toContain("Phase: direct membership preflight (before any write)");
    expect(f.backend.remove).not.toHaveBeenCalled(); expect(f.backend.add).not.toHaveBeenCalled();
    expect(moveWriteStatus({ ...result.record.pdes[0], add: "uncertain", phase: "indeterminate" })).toContain("completion is uncertain");
  });
  it("records intent, removes/verifies/adds/verifies and preserves all sibling impact", async () => {
    const f = fixture();
    const progress = vi.fn();
    const result = await executePdeMoves(f.preview, f.backend, f.store, true, [], progress);
    expect(result.record.pdes[0].phase).toBe("verified");
    expect(f.backend.remove).toHaveBeenCalledExactlyOnceWith("source", "synthetic-pde");
    expect(f.backend.add).toHaveBeenCalledExactlyOnceWith("destination", "synthetic-pde");
    expect(f.backend.prepare).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      { environmentId: "synthetic-pde", phase: "preparing" },
      { environmentId: "synthetic-pde", phase: "removing" },
      { environmentId: "synthetic-pde", phase: "verifying" },
      { environmentId: "synthetic-pde", phase: "preparing" },
      { environmentId: "synthetic-pde", phase: "adding" },
      { environmentId: "synthetic-pde", phase: "verifying" },
      { environmentId: "synthetic-pde", phase: "moved" },
    ]);
    const journal = JSON.stringify(f.records);
    expect(journal).not.toContain("hidden-sibling");
    expect(journal).not.toContain("policies");
  });
  it("performs add only for confirmed ungrouped membership", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    expect((await executePdeMoves(f.preview, f.backend, f.store, true)).record.pdes[0].phase).toBe("verified");
    expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("freshly skips already-member without writes", async () => {
    const f = fixture(plan("synthetic-pde", "destination"));
    expect((await executePdeMoves(f.preview, f.backend, f.store, true)).record.pdes[0].phase).toBe("already-member");
    expect(f.backend.remove).not.toHaveBeenCalled();
    expect(f.backend.add).not.toHaveBeenCalled();
  });
  it("does not write on preview, unconfirmed, expired or incomplete plans", async () => {
    const f = fixture();
    expect(moveBlockers(f.preview)).toEqual([]);
    await expect(executePdeMoves(f.preview, f.backend, f.store, false)).rejects.toThrow(/confirmation/);
    f.preview.preparedAt = Date.now() - 310_000;
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/expired/);
    f.preview.preparedAt = Date.now(); f.preview.pdes[0].destinationEvidence = undefined;
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/incomplete/);
    expect(f.backend.remove).not.toHaveBeenCalled(); expect(f.backend.add).not.toHaveBeenCalled();
  });
  it("rejects duplicate PDE identities rather than issuing duplicate mutations", async () => {
    const f = fixture(); f.preview.pdes.push(structuredClone(f.preview.pdes[0]));
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/Duplicate/);
    expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("blocks execution when only counts/apps are supplied without full resource identities", async () => {
    const f = fixture(); f.preview.pdes[0].resources = undefined;
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/full resource identities/);
    expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it.each(["membership", "siblings", "governance"])("rejects fresh %s changes before removal", async (change) => {
    const f = fixture();
    vi.mocked(f.backend.prepare).mockImplementation(async () => {
      const current = plan();
      if (change === "membership") current.pdes[0].environment!.environmentGroupId = "different";
      if (change === "siblings") current.pdes[0].resources = [app("replacement", "synthetic-pde"), current.pdes[0].apps[0]];
      if (change === "governance") current.pdes[0].destinationEvidence!.details = { ok: true, data: { id: "destination", description: "changed" } };
      return { ok: true, data: current };
    });
    expect((await executePdeMoves(f.preview, f.backend, f.store, true)).record.pdes[0].phase).toBe("failed");
    expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("requires direct Dataverse evidence before destructive removal", async () => {
    const f = fixture();
    vi.mocked(f.backend.read).mockResolvedValue({ ok: true, data: { environmentId: "synthetic-pde", groupId: "source", hasDataverse: false } });
    expect((await executePdeMoves(f.preview, f.backend, f.store, true)).record.pdes[0].phase).toBe("failed");
    expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("reports explicit permission denial without add or invented rollback", async () => {
    const f = fixture(); vi.mocked(f.backend.remove).mockResolvedValue({ ok: false, error: "403 Forbidden" });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.record.pdes[0]).toMatchObject({ phase: "failed", remove: "denied", add: "none" });
    expect(result.messages.join(" ")).toContain("403 Forbidden"); expect(f.backend.add).not.toHaveBeenCalled();
  });
  it("waits for asynchronous membership rather than treating a void acknowledgement as completion", async () => {
    const f = fixture();
    let reads = 0;
    vi.mocked(f.backend.read).mockImplementation(async (id) => {
      reads++;
      const groupId = reads === 2 ? "source" : f.memberships.get(id)!;
      return { ok: true, data: { environmentId: id, groupId, hasDataverse: true } };
    });
    expect((await executePdeMoves(f.preview, f.backend, f.store, true)).record.pdes[0].phase).toBe("verified");
    expect(f.backend.pause).toHaveBeenCalledTimes(1);
  });
  it("continues post-write read-only polling through transient response errors and propagation disagreement", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    let completionReads = 0;
    vi.mocked(f.backend.read).mockImplementation(async (id) => {
      if (f.memberships.get(id) === "destination") {
        completionReads++;
        if (completionReads === 1) return { ok: false, error: "Direct environment and fresh complete inventory disagree." };
        if (completionReads === 2) throw new Error("Transient membership read unavailable");
      }
      return { ok: true, data: { environmentId: id, groupId: f.memberships.get(id)!, hasDataverse: true } };
    });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.record.pdes[0].phase).toBe("verified");
    expect(f.backend.pause).toHaveBeenCalledTimes(2);
    expect(f.backend.add).toHaveBeenCalledTimes(1); expect(f.backend.remove).not.toHaveBeenCalled();
    expect(result.verificationIssues).toEqual([]);
  });
  it("verifies fresh direct destination membership while honestly signaling measured inventory lag", async () => {
      const f = fixture();
      vi.mocked(f.backend.read).mockImplementation(async (id) => ({ ok: true, data: {
        environmentId: id, groupId: f.memberships.get(id)!, hasDataverse: true,
        evidence: { source: "GetEnvironmentByIdForUser", readAt: Date.now(), inventoryReadAt: Date.now(), inventoryGroupId: "source" },
      } }));
      const result = await executePdeMoves(f.preview, f.backend, f.store, true);
      expect(result.record.pdes[0].phase).toBe("verified");
      expect(moveOutcomeLabel(result, result.record.pdes[0])).toBe("Moved; inventory is updating");
      expect(f.backend.remove).toHaveBeenCalledTimes(1); expect(f.backend.add).toHaveBeenCalledTimes(1);
      const matched = { ...result, verifiedMemberships: result.verifiedMemberships?.map((read) => ({ ...read, evidence: { ...read.evidence!, inventoryGroupId: "destination" } })) };
      expect(moveOutcomeLabel(matched, matched.record.pdes[0])).toBe("Moved");
    });
    it.each([-60_001, 60_001])("rejects stale/future direct evidence before writes (offset %s)", async (offset) => {
      const f = fixture();
      vi.mocked(f.backend.read).mockResolvedValue({ ok: true, data: {
        environmentId: "synthetic-pde", groupId: "source", hasDataverse: true,
        evidence: { source: "GetEnvironmentByIdForUser", readAt: Date.now() + offset, inventoryReadAt: Date.now(), inventoryGroupId: "source" },
      } });
      const result = await executePdeMoves(f.preview, f.backend, f.store, true);
      expect(result.record.pdes[0]).toMatchObject({ phase: "failed", add: "none", remove: "none" });
      expect(result.messages.join(" ")).toContain("invalid timestamp");
      expect(f.backend.remove).not.toHaveBeenCalled(); expect(f.backend.add).not.toHaveBeenCalled();
    });
  it("retains a precise read-failure reason after bounded unsuccessful completion checks", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    vi.mocked(f.backend.read).mockImplementation(async (id) => f.memberships.get(id) === "destination"
      ? { ok: false, error: "Synthetic fresh inventory unavailable" }
      : { ok: true, data: { environmentId: id, groupId: "", hasDataverse: true } });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.record.pdes[0]).toMatchObject({ phase: "indeterminate", add: "accepted" });
    expect(result.verificationIssues).toEqual([{ environmentId: "synthetic-pde", reason: "read-failed" }]);
    expect(result.messages.join(" ")).toContain("Synthetic fresh inventory unavailable");
    expect(result.messages.join(" ")).toContain("destination-add completion read");
    expect(f.backend.pause).toHaveBeenCalledTimes(12);
    expect(f.backend.add).toHaveBeenCalledTimes(1);
  });
  it("distinguishes an unexpected third-group read from waiting for the expected membership update", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    vi.mocked(f.backend.add).mockImplementation(async (_, id) => {
      f.memberships.set(id, "synthetic-other-group"); return { ok: true, data: undefined };
    });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.verificationIssues).toEqual([{ environmentId: "synthetic-pde", reason: "conflict" }]);
    expect(result.record.pdes[0]).toMatchObject({ phase: "indeterminate", observedGroupId: "synthetic-other-group" });
    expect(f.backend.add).toHaveBeenCalledTimes(1);
  });
  it("stops after unverified removal without adding, retrying or falsely claiming success", async () => {
    const f = fixture(); vi.mocked(f.backend.remove).mockResolvedValue({ ok: true, data: undefined });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.record.pdes[0].phase).toBe("indeterminate");
    expect(f.backend.pause).toHaveBeenCalledTimes(12); expect(f.backend.add).not.toHaveBeenCalled();
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/Check previous move/);
  });
  it("records transport uncertainty, reconciles reads only, and never retries a remove", async () => {
    const f = fixture(); vi.mocked(f.backend.remove).mockRejectedValue(new Error("Transport interrupted"));
    const first = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(first.record.pdes[0]).toMatchObject({ phase: "indeterminate", remove: "uncertain" });
    f.memberships.set("synthetic-pde", "");
    const next = await reconcilePdeMove(first.record, f.backend, f.store);
    expect(next.record.pdes[0].phase).toBe("indeterminate");
    expect(f.backend.remove).toHaveBeenCalledTimes(1); expect(f.backend.add).not.toHaveBeenCalled();
  });
  it("reports detached PDE after add denial and stops remaining bulk PDEs", async () => {
    const preview = plan(); preview.pdes.push(plan("synthetic-pde-two").pdes[0]);
    const f = fixture(preview); vi.mocked(f.backend.add).mockResolvedValue({ ok: false, error: "403 Forbidden" });
    const progress = vi.fn();
    const result = await executePdeMoves(f.preview, f.backend, f.store, true, [], progress);
    expect(progress.mock.calls.slice(-2).map(([event]) => event)).toEqual([
      { environmentId: "synthetic-pde", phase: "needs-attention" },
      { environmentId: "synthetic-pde-two", phase: "stopped" },
    ]);
    expect(result.record.pdes.map((pde) => pde.phase)).toEqual(["detached", "stopped"]);
    expect(f.backend.remove).toHaveBeenCalledTimes(1); expect(f.backend.add).toHaveBeenCalledTimes(1);
    await reconcilePdeMove(result.record, f.backend, f.store);
    expect(f.backend.add).toHaveBeenCalledTimes(1);
  });
  it("stops before add when hidden sibling impact changes after removal", async () => {
    const f = fixture(); vi.mocked(f.backend.prepare).mockResolvedValueOnce({ ok: true, data: plan() })
      .mockResolvedValueOnce({ ok: true, data: { ...plan("synthetic-pde", ""), pdes: [{ ...plan("synthetic-pde", "").pdes[0], resourceCount: 99 }] } });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.messages.join(" ")).toContain("Phase: post-removal impact preflight.");
    expect(result.record.pdes[0].observedGroupId).toBe(""); expect(result.record.pdes[0].phase).not.toBe("verified");
    expect(f.backend.add).not.toHaveBeenCalled();
  });
  it("verifies a late asynchronous add on reconciliation without reissuing it", async () => {
    const f = fixture();
    vi.mocked(f.backend.add).mockRejectedValue(new Error("Ambiguous add response"));
    const first = await executePdeMoves(f.preview, f.backend, f.store, true);
    f.memberships.set("synthetic-pde", "destination");
    const next = await reconcilePdeMove(first.record, f.backend, f.store);
    expect(next.record.pdes[0].phase).toBe("verified"); expect(f.backend.add).toHaveBeenCalledTimes(1);
  });
  it("fails before mutations when journal storage fails", async () => {
    const f = fixture(); f.store.save = () => { throw new Error("Storage denied"); };
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/Storage denied/);
    expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("bounds a stalled write at 30 seconds without pretending to cancel or retry it", async () => {
    const f = fixture();
    let reached!: () => void;
    const writing = new Promise<void>((resolve) => { reached = resolve; });
    vi.mocked(f.backend.remove).mockImplementation(() => { reached(); return new Promise(() => undefined); });
    vi.useFakeTimers();
    try {
      const running = executePdeMoves(f.preview, f.backend, f.store, true);
      await writing;
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await running;
      expect(result.record.pdes[0]).toMatchObject({ phase: "indeterminate", remove: "uncertain", add: "none" });
      expect(result.messages.join(" ")).toContain("timed out");
      expect(f.backend.remove).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("never claims success when an acknowledged add has no matching destination read-back", async () => {
    const f = fixture(); vi.mocked(f.backend.add).mockResolvedValue({ ok: true, data: undefined });
    const result = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(result.record.pdes[0]).toMatchObject({ phase: "indeterminate", observedGroupId: "", add: "accepted" });
    expect(f.backend.add).toHaveBeenCalledTimes(1);
    expect(f.backend.pause).toHaveBeenCalledTimes(12);
    expect(result.verificationIssues).toEqual([{ environmentId: "synthetic-pde", reason: "pending" }]);
  });
  it("bounds stalled post-write polling by its time budget and never repeats the membership write", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    let started!: () => void;
    const polling = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(f.backend.read).mockImplementation(async (id) => {
      if (f.memberships.get(id) === "destination") {
        started(); return new Promise(() => undefined);
      }
      return { ok: true, data: { environmentId: id, groupId: "", hasDataverse: true } };
    });
    vi.useFakeTimers();
    try {
      const running = executePdeMoves(f.preview, f.backend, f.store, true);
      await polling;
      // The 60-second polling budget is followed by the existing one bounded
      // recovery read, not another polling cycle or membership request.
      await vi.advanceTimersByTimeAsync(90_000);
      const result = await running;
      expect(result.verificationIssues).toEqual([{ environmentId: "synthetic-pde", reason: "read-failed" }]);
      expect(f.backend.read).toHaveBeenCalledTimes(5);
      expect(f.backend.add).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("automatically reconciles a late add through transient read failures without replaying writes", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    const record: MoveRecord = {
      version: 1, id: "synthetic-late", destinationId: "destination", previewHash: "hash", updatedAt: Date.now(),
      pdes: [{ environmentId: "synthetic-pde", sourceId: "", phase: "indeterminate", remove: "none", add: "accepted" }],
    };
    f.store.save(record);
    vi.mocked(f.backend.read).mockResolvedValueOnce({ ok: false, error: "Synthetic disagreement" })
      .mockResolvedValueOnce({ ok: true, data: { environmentId: "synthetic-pde", groupId: "", hasDataverse: true } })
      .mockResolvedValueOnce({ ok: true, data: { environmentId: "synthetic-pde", groupId: "destination", hasDataverse: true } });
    const result = await reconcilePdeMove(record, f.backend, f.store);
    expect(result.record.pdes[0].phase).toBe("verified");
    expect(f.backend.pause).toHaveBeenCalledTimes(2);
    expect(f.backend.add).not.toHaveBeenCalled(); expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("cancels further read-only reconciliation polls without changing history or issuing writes", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    const record: MoveRecord = {
      version: 1, id: "synthetic-cancel", destinationId: "destination", previewHash: "hash", updatedAt: Date.now(),
      pdes: [{ environmentId: "synthetic-pde", sourceId: "", phase: "indeterminate", remove: "none", add: "accepted" }],
    };
    f.store.save(record);
    const controller = new AbortController();
    vi.mocked(f.backend.pause).mockImplementation(async () => { controller.abort(); });
    await expect(reconcilePdeMove(record, f.backend, f.store, controller.signal)).rejects.toThrow();
    expect(f.backend.read).toHaveBeenCalledTimes(1);
    expect(f.store.list()).toEqual([record]);
    expect(f.backend.add).not.toHaveBeenCalled(); expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("returns separate verified outcomes for a complete serial bulk transfer", async () => {
    const preview = plan(); preview.pdes.push(plan("synthetic-pde-two").pdes[0]);
    const f = fixture(preview);
    expect((await executePdeMoves(f.preview, f.backend, f.store, true)).record.pdes.map((pde) => pde.phase)).toEqual(["verified", "verified"]);
    expect(f.backend.remove).toHaveBeenCalledTimes(2); expect(f.backend.add).toHaveBeenCalledTimes(2);
  });
  it("reconciles delayed add completion then permits a freshly confirmed later transfer, retaining history", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    const add = f.backend.add;
    vi.mocked(f.backend.add).mockRejectedValueOnce(new Error("Lost response"));
    const first = await executePdeMoves(f.preview, f.backend, f.store, true);
    f.memberships.set("synthetic-pde", "destination");
    const reconciled = await reconcilePdeMove(first.record, f.backend, f.store);
    expect(reconciled.record.pdes[0].phase).toBe("verified");
    const next = plan("synthetic-pde", "destination");
    next.destination = group("next-destination");
    next.pdes[0].status = "prepared"; next.pdes[0].destinationEvidence = evidence("next-destination");
    vi.mocked(f.backend.prepare).mockImplementation(async () => {
      const current = structuredClone(next);
      current.pdes[0].environment = env("synthetic-pde", f.memberships.get("synthetic-pde"));
      current.pdes[0].sourceEvidence = f.memberships.get("synthetic-pde") ? evidence(f.memberships.get("synthetic-pde")!) : undefined;
      return { ok: true, data: current };
    });
    vi.mocked(add).mockImplementation(async (destination, id) => { f.memberships.set(id, destination); return { ok: true, data: undefined }; });
    const second = await executePdeMoves(next, f.backend, f.store, true);
    expect(second.record.pdes[0].phase).toBe("verified");
    expect(f.records).toHaveLength(2);
    const historical = await reconcilePdeMove(first.record, f.backend, f.store);
    expect(historical.record.pdes[0].phase).toBe("verified");
    expect(historical.record.pdes[0].observedGroupId).toBe("destination");
  });
  it("does not block a PDE because another PDE in an old batch has unfinished writes", async () => {
    const f = fixture();
    f.records.push({ version: 1, id: "historical", destinationId: "old-destination", previewHash: "hash", updatedAt: Date.now(),
      pdes: [
        { environmentId: "synthetic-pde", sourceId: "source", phase: "failed", remove: "none", add: "none" },
        { environmentId: "unrelated-pde", sourceId: "source", phase: "indeterminate", remove: "uncertain", add: "none" },
      ] });
    expect((await executePdeMoves(f.preview, f.backend, f.store, true)).record.pdes[0].phase).toBe("verified");
    expect(f.records[0].pdes[1].phase).toBe("indeterminate");
  });
  it("keeps all conflicting historical writes blocked independently, even when one add is proven complete", async () => {
    const f = fixture();
    const record = (id: string, destinationId: string): MoveRecord => ({ version: 1, id, destinationId, previewHash: "hash", updatedAt: Date.now(),
      pdes: [{ environmentId: "synthetic-pde", sourceId: "", phase: "indeterminate", remove: "none", add: "uncertain" }] });
    f.records.push(record("first", "destination"), record("second", "different"));
    f.memberships.set("synthetic-pde", "destination");
    expect((await reconcilePdeMove(f.records[0], f.backend, f.store)).record.pdes[0].phase).toBe("verified");
    expect((await reconcilePdeMove(f.records[1], f.backend, f.store)).record.pdes[0].phase).toBe("indeterminate");
    await expect(executePdeMoves(f.preview, f.backend, f.store, true)).rejects.toThrow(/Check previous move/);
    expect(f.backend.add).not.toHaveBeenCalled(); expect(f.backend.remove).not.toHaveBeenCalled();
  });
  it("requires checking started/accepted writes regardless of a misleading failed/stopped phase", () => {
    expect(moveNeedsCheck({ environmentId: "pde", sourceId: "", phase: "failed", remove: "none", add: "started" })).toBe(true);
    expect(moveNeedsCheck({ environmentId: "pde", sourceId: "", phase: "indeterminate", remove: "none", add: "none" })).toBe(false);
  });
  it("uses a successful recovery read after an add/readback error instead of leaving proven completion unresolved", async () => {
    const f = fixture(plan("synthetic-pde", ""));
    const original = f.backend.read;
    let failed = false;
    vi.mocked(f.backend.read).mockImplementation(async (id) => {
      if (f.memberships.get(id) === "destination" && !failed) {
        failed = true; return { ok: false, error: "Transient direct/inventory disagreement" };
      }
      return { ok: true, data: { environmentId: id, groupId: f.memberships.get(id)!, hasDataverse: true } };
    });
    const outcome = await executePdeMoves(f.preview, f.backend, f.store, true);
    expect(outcome.record.pdes[0]).toMatchObject({ phase: "verified", add: "accepted", observedGroupId: "destination" });
    expect(moveNeedsCheck(outcome.record.pdes[0])).toBe(false);
    expect(original).toHaveBeenCalled(); expect(f.backend.add).toHaveBeenCalledTimes(1);
  });
});
