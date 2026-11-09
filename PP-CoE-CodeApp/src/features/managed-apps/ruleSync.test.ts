import { beforeEach, describe, expect, it, vi } from "vitest";
import { toEnvironmentRow } from "../../data/inventory";
import type { RuleAssignment } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { applyRuleSync, planRuleSync, reconcileRuleSync, ruleSyncCatalog, type SyncBackend, type SyncRecord, type SyncSnapshot, type SyncStore } from "./ruleSync";

function snapshot(id: string, limit = "5", blocked = true): SyncSnapshot {
  const assignment: RuleAssignment = { policyId: `policy-${id}`, resourceId: id, resourceType: "EnvironmentGroup" };
  return {
    group: { id, displayName: `Group ${id}`, description: `Keep description ${id}` },
    rules: [{ id: `rules-${id}`, environmentFilter: { type: "Include", values: [{ type: "EnvironmentGroup", id }] },
      parameters: [
        { type: "Sharing", resourceType: "UsersBot", value: [{ id: "MaximumShareLimit", value: limit }, { id: "CanShareWithSecurityGroups", value: "excludeSharingToSecurityGroups" }] },
        { type: "Lifecycle", resourceType: "NotSpecified", value: [{ id: "RetentionPeriod", value: "30.00:00:00" }] },
      ] }],
    policy: { id: `policy-${id}`, name: `Keep policy name ${id}`, ruleSets: [
      { id: "ConnectorManagement", version: "1.0", inputs: { AllowedConnectorList: [] } },
      { id: "CopilotTranscripts", version: "1.0", inputs: { BlockAccessToSessionTranscriptsForCopilotStudio: blocked, BlockTranscriptRecordingForCopilotStudio: blocked } },
      { id: "FutureUntouchedModule", version: "9", inputs: { arbitrary: ["keep", 42, false] } },
    ] },
    assignments: [assignment], policyScope: [assignment],
    environments: [toEnvironmentRow({ name: `env-${id}`, properties: { displayName: `Environment ${id}`, environmentGroupId: id, environmentType: "Production", isManaged: true } })],
    publication: "applied", publicationEvidence: "Synthetic applied API fixture", blockers: [],
  };
}
async function harness() {
  const source = snapshot("source", "10", false);
  const first = snapshot("first");
  const second = snapshot("second");
  const state = new Map([source, first, second].map((entry) => [entry.group.id!, structuredClone(entry)]));
  const backend: SyncBackend = {
    read: vi.fn<SyncBackend["read"]>(async (id) => {
      const entry = state.get(id);
      return entry ? { ok: true, data: structuredClone(entry) } : { ok: false, error: "Group unavailable" };
    }),
    updateRule: vi.fn<SyncBackend["updateRule"]>(async (id, body) => {
      const target = [...state.values()].find((entry) => entry.rules[0].id === id)!;
      target.rules[0] = { ...structuredClone(body), lastModified: "2026-11-06T00:00:00Z" };
      return { ok: true, data: undefined };
    }),
    patchPolicy: vi.fn<SyncBackend["patchPolicy"]>(async (id, body) => {
      const target = [...state.values()].find((entry) => entry.policy.id === id)!;
      for (const module of body.ruleSets ?? []) {
        const index = target.policy.ruleSets!.findIndex((entry) => entry.id === module.id);
        if (index >= 0) target.policy.ruleSets![index] = structuredClone(module);
        else target.policy.ruleSets!.push(structuredClone(module));
      }
      return { ok: true, data: { status: "accepted" } };
    }),
  };
  const records = new Map<string, SyncRecord>();
  const store: SyncStore = {
    all: () => [...records.values()].map((record) => structuredClone(record)),
    save: vi.fn((record: SyncRecord) => { records.set(record.id, structuredClone(record)); }),
  };
  const catalog = await ruleSyncCatalog(source);
  const setting = catalog.rules.find((rule) => rule.kind === "setting" && rule.setting.id === "MaximumShareLimit")!.key;
  const policy = catalog.rules.find((rule) => rule.kind === "policy" && rule.module.id === "CopilotTranscripts")!.key;
  const plan = await planRuleSync(source, [setting, policy], [first, second]);
  return { source, first, second, state, backend, store, records, setting, policy, plan };
}
beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
  vi.stubGlobal("crypto", webcrypto);
});

describe("selective one-time rule sync (synthetic only)", () => {
  it("requires individual rules and destinations, with no implicit all selection", async () => {
    const h = await harness();
    expect((await planRuleSync(h.source, [], [h.first])).blockers).not.toEqual([]);
    expect((await planRuleSync(h.source, [h.setting], [])).blockers).not.toEqual([]);
    expect((await planRuleSync(h.source, [h.setting], [h.source])).blockers.join()).toContain("source group");
    const result = await applyRuleSync(h.plan, h.backend, h.store, false);
    expect(result.record.phase).toBe("blocked");
    expect(h.backend.updateRule).not.toHaveBeenCalled();
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("previews add, replacement and no change for only the checked rule × checked group pairs", async () => {
    const h = await harness();
    h.first.rules[0].parameters![0].value!.shift();
    h.second.rules[0].parameters![0].value![0].value = "10";
    const plan = await planRuleSync(h.source, [h.setting], [h.first, h.second]);
    expect(plan.blockers).toEqual([]);
    expect(plan.targets.map((target) => target.changes.map((change) => change.action))).toEqual([["add"], ["no-change"]]);
    expect(plan.targets[0].steps[0].body).toMatchObject({ id: "rules-first", parameters: [
      { type: "Sharing", value: [{ id: "CanShareWithSecurityGroups", value: "excludeSharingToSecurityGroups" }, { id: "MaximumShareLimit", value: "10" }] },
      { type: "Lifecycle", value: [{ id: "RetentionPeriod", value: "30.00:00:00" }] },
    ] });
    expect(plan.targets[1].steps).toEqual([]);
    expect(plan.targets[0].before.environments[0].displayName).toBe("Environment first");
    expect(plan.targets[0].after.policy).toEqual(h.first.policy);
  });
  it("updates checked settings losslessly and PATCHes only checked modules, never the source or unselected targets", async () => {
    const h = await harness();
    const unselected = snapshot("unselected"); h.state.set("unselected", structuredClone(unselected));
    const result = await applyRuleSync(h.plan, h.backend, h.store, true);
    expect(result.record.phase).toBe("verified");
    expect(result.record.targets.map((target) => target.phase)).toEqual(["verified", "verified"]);
    expect(h.backend.updateRule).toHaveBeenCalledTimes(2);
    expect(h.backend.patchPolicy).toHaveBeenCalledTimes(2);
    for (const id of ["first", "second"]) {
      expect(h.backend.patchPolicy).toHaveBeenCalledWith(`policy-${id}`, { ruleSets: [h.source.policy.ruleSets![1]] });
      expect(h.state.get(id)!.group).toEqual(snapshot(id).group);
      expect(h.state.get(id)!.environments).toEqual(snapshot(id).environments);
      expect(h.state.get(id)!.policy.ruleSets![2]).toEqual(snapshot(id).policy.ruleSets![2]);
      expect(h.state.get(id)!.rules[0].parameters![1]).toEqual(snapshot(id).rules[0].parameters![1]);
    }
    expect(h.state.get("source")).toEqual(h.source);
    expect(h.state.get("unselected")).toEqual(unselected);
  });
  it("preserves target-owned references in unselected rules rather than applying clone remapping assumptions", async () => {
    const h = await harness();
    h.first.policy.ruleSets![2].inputs = { ownedReference: "policy-first" };
    h.state.set("first", structuredClone(h.first));
    const plan = await planRuleSync(h.source, [h.setting], [h.first]);
    expect(plan.blockers).toEqual([]);
    expect((await applyRuleSync(plan, h.backend, h.store, true)).record.phase).toBe("verified");
    expect(h.state.get("first")!.policy.ruleSets![2].inputs).toEqual({ ownedReference: "policy-first" });
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("blocks shared ACP mutation without forking/reassigning, while allowing unrelated exclusive group-setting updates", async () => {
    const h = await harness();
    h.first.policyScope.push({ policyId: "policy-first", resourceType: "EnvironmentGroup", resourceId: "unselected" });
    expect((await planRuleSync(h.source, [h.policy], [h.first])).blockers.join()).toContain("shared");
    expect((await planRuleSync(h.source, [h.setting], [h.first])).blockers).toEqual([]);
  });
  it.each(["settings", "policy"])("never writes a reused source-owned %s identity, even with contradictory target scope", async (kind) => {
    const h = await harness();
    if (kind === "settings") h.first.rules[0].id = h.source.rules[0].id;
    else {
      h.first.policy.id = h.source.policy.id;
      h.first.assignments[0].policyId = h.source.policy.id;
      h.first.policyScope[0].policyId = h.source.policy.id;
    }
    const plan = await planRuleSync(h.source, [kind === "settings" ? h.setting : h.policy], [h.first]);
    expect(plan.blockers.join()).toContain(kind === "settings" ? "source-owned rule" : "source ACP identity");
    expect((await applyRuleSync(plan, h.backend, h.store, true)).record.phase).toBe("blocked");
    expect(h.backend.updateRule).not.toHaveBeenCalled(); expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("blocks unsupported resource granularity, scope and incomplete or security-critical evidence", async () => {
    const h = await harness();
    h.first.rules[0].environmentFilter!.values!.push({ id: "other", type: "EnvironmentGroup" });
    expect((await planRuleSync(h.source, [h.setting], [h.first])).blockers.join()).toContain("scoped only");
    h.first.rules = [];
    expect((await planRuleSync(h.source, [h.setting], [h.first])).blockers.join()).toContain("Missing");
    h.first.blockers = ["Incomplete tenant applicability"];
    expect((await planRuleSync(h.source, [h.policy], [h.first])).blockers.join()).toContain("Incomplete");
    h.source.policy.ruleSets![0].inputs = { AllowedConnectorList: "malformed" };
    expect((await ruleSyncCatalog(h.source)).blockers.join()).toContain("connector collection");
  });
  it.each(["ownership-envelope", "unknown-input", "unknown-version"])("blocks replacing a checked target rule with %s", async (kind) => {
    const h = await harness();
    const module = h.first.policy.ruleSets![1];
    if (kind === "ownership-envelope") Object.assign(module, { managedBy: "ownership not established" });
    if (kind === "unknown-input") module.inputs!.unreviewedBehavior = true;
    if (kind === "unknown-version") module.version = "2.0";
    const plan = await planRuleSync(h.source, [h.policy], [h.first]);
    expect(plan.blockers.join()).toContain("cannot be updated losslessly");
    expect(plan.targets[0].changes).toHaveLength(1);
    expect((await applyRuleSync(plan, h.backend, h.store, true)).record.phase).toBe("blocked");
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("rechecks earlier targets at batch completion rather than claiming stale all-target success", async () => {
    const h = await harness();
    const patch = h.backend.patchPolicy;
    h.backend.patchPolicy = async (id, body) => {
      const result = await patch(id, body);
      if (id === "policy-second") h.state.get("first")!.group.description = "External later edit";
      return result;
    };
    const result = await applyRuleSync(h.plan, h.backend, h.store, true);
    expect(result.record.phase).toBe("indeterminate");
    expect(result.record.targets[0].phase).toBe("indeterminate");
    expect(result.message).toContain("All-target completion cannot be claimed");
  });
  it("accepts inventory response metadata changes but rejects malformed rule timestamps after a write", async () => {
    const h = await harness();
    const update = h.backend.updateRule;
    h.backend.updateRule = async (id, body) => {
      const result = await update(id, body);
      const target = [...h.state.values()].find((entry) => entry.rules[0].id === id)!;
      target.environments[0].lastModifiedAt = "2026-11-06T01:00:00Z";
      return result;
    };
    expect((await applyRuleSync(h.plan, h.backend, h.store, true)).record.phase).toBe("verified");
    const another = await harness();
    const write = another.backend.updateRule;
    another.backend.updateRule = async (id, body) => {
      const result = await write(id, body);
      another.state.get("first")!.rules[0].lastModified = "invalid-timestamp";
      return result;
    };
    const result = await applyRuleSync(another.plan, another.backend, another.store, true);
    expect(result.record.phase).toBe("indeterminate");
    expect(result.message).toContain("Invalid response timestamp");
  });
  it("excludes unknown rules, ownership envelopes, pointer settings and unknown nested inputs instead of stripping them", async () => {
    const h = await harness();
    h.source.policy.ruleSets!.push({
      id: "MicrosoftAppsContentSecurityPolicy", version: "1.0", inputs: { managedBy: "real input", nested: { managedBy: true } },
      ...{ managedBy: "envelope" },
    });
    h.source.rules[0].parameters!.push({ type: "MakerOnboarding", resourceType: "NotSpecified", value: [{ id: "MakerContentRuleBasedPolicy", value: "some-external-policy" }] });
    h.source.policy.ruleSets![1].inputs!.managedBy = "unknown real input";
    const catalog = await ruleSyncCatalog(h.source);
    expect(catalog.rules.some((rule) => rule.kind === "policy" && ["CopilotTranscripts", "MicrosoftAppsContentSecurityPolicy"].includes(rule.module.id!))).toBe(false);
    expect(catalog.rules.some((rule) => rule.kind === "setting" && rule.setting.id === "MakerContentRuleBasedPolicy")).toBe(false);
    expect(catalog.exclusions.map((entry) => entry.label).join()).toContain("MicrosoftAppsContentSecurityPolicy");
    expect(h.source.policy.ruleSets![3].inputs!.nested).toEqual({ managedBy: true });
  });
  it.each(["source", "target-setting", "membership", "policy-scope", "plan-tampering"])("invalidates stale %s before any write", async (kind) => {
    const h = await harness();
    if (kind === "source") h.state.get("source")!.group.description = "External source edit";
    if (kind === "target-setting") h.state.get("first")!.rules[0].parameters![1].value![0].value = "90.00:00:00";
    if (kind === "membership") h.state.get("first")!.environments = [];
    if (kind === "policy-scope") h.state.get("first")!.policyScope.push({ policyId: "policy-first", resourceType: "EnvironmentGroup", resourceId: "foreign" });
    if (kind === "plan-tampering") h.plan.targets[0].steps[0].resourceId = "rules-source";
    const result = await applyRuleSync(h.plan, h.backend, h.store, true);
    expect(result.record.phase).toBe("blocked");
    expect(result.message).toContain("changed");
    expect(h.backend.updateRule).not.toHaveBeenCalled();
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("stops a sequential batch if a later target changes, without claiming all-target success", async () => {
    const h = await harness();
    const patch = h.backend.patchPolicy;
    h.backend.patchPolicy = async (id, body) => {
      const result = await patch(id, body);
      h.state.get("second")!.group.description = "Concurrent edit";
      return result;
    };
    const result = await applyRuleSync(h.plan, h.backend, h.store, true);
    expect(result.record.phase).toBe("partial");
    expect(result.record.targets[0].phase).toBe("verified");
    expect(result.record.targets[1].phase).toBe("pending");
    expect(h.backend.updateRule).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
  });
  it.each(["403 AuthorizationFailed", "asynchronous acceptance", "verification mismatch"])("retains uncertain %s and reconciles read-only without retrying", async (kind) => {
    const h = await harness();
    h.backend.patchPolicy = vi.fn(async () => kind === "403 AuthorizationFailed"
      ? { ok: false as const, error: kind } : { ok: true as const, data: { status: "Running" } });
    if (kind === "verification mismatch") {
      h.backend.patchPolicy = vi.fn(async () => {
        h.state.get("first")!.policy.ruleSets![2].inputs = { arbitrary: "unrelated loss" };
        return { ok: true as const, data: {} };
      });
    }
    const result = await applyRuleSync(h.plan, h.backend, h.store, true);
    expect(result.record.phase).toBe("indeterminate");
    expect(result.record.targets[0].steps[1].phase).toBe("started");
    if (kind.startsWith("403")) expect(result.message).toContain("403 AuthorizationFailed");
    expect((await applyRuleSync(h.plan, h.backend, h.store, true)).message).toContain("previous overlapping");
    const writes = vi.mocked(h.backend.updateRule).mock.calls.length + vi.mocked(h.backend.patchPolicy).mock.calls.length;
    const stillUncertain = await reconcileRuleSync(result.record, h.backend, h.store);
    expect(stillUncertain.record.phase).not.toBe("verified");
    h.state.set("first", structuredClone(h.plan.targets[0].after));
    h.state.set("second", structuredClone(h.plan.targets[1].after));
    expect((await reconcileRuleSync(result.record, h.backend, h.store)).record.phase).toBe("verified");
    expect(vi.mocked(h.backend.updateRule).mock.calls.length + vi.mocked(h.backend.patchPolicy).mock.calls.length).toBe(writes);
  });
  it("fails closed on journal storage failure and never starts a write", async () => {
    const h = await harness();
    h.store.save = () => { throw new Error("Quota exceeded"); };
    const result = await applyRuleSync(h.plan, h.backend, h.store, true);
    expect(result.message).toContain("Recovery storage failed");
    expect(h.backend.updateRule).not.toHaveBeenCalled();
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("closing/cancelling stops remaining steps, not an already completed write", async () => {
    const h = await harness();
    const controller = new AbortController();
    const update = h.backend.updateRule;
    h.backend.updateRule = async (id, body) => { const result = await update(id, body); controller.abort(); return result; };
    const result = await applyRuleSync(h.plan, h.backend, h.store, true, controller.signal);
    expect(result.record.phase).toBe("partial");
    expect(result.message).toContain("No further writes");
    expect(update).toHaveBeenCalledTimes(1);
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
});
