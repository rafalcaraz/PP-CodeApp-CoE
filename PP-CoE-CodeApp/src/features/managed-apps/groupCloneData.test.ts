import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Policy, RuleSetDto } from "../../generated/models/PowerPlatformforAdminsV2Model";
const { execute, evidence, readPolicy, emptyMembership } = vi.hoisted(() => ({
  execute: vi.fn(), evidence: vi.fn(), readPolicy: vi.fn(), emptyMembership: vi.fn(),
}));
vi.mock("@microsoft/power-apps/data", () => ({ getClient: () => ({ executeAsync: execute }) }));
vi.mock("./governance", async () => ({
  ...await vi.importActual<typeof import("./governance")>("./governance"), loadGroupEvidenceBatch: evidence,
}));
vi.mock("./data", async () => ({
  ...await vi.importActual<typeof import("./data")>("./data"), loadPolicy: readPolicy, loadEmptyGroupMembership: emptyMembership,
}));
import { groupCloneBackend, groupCloneStore, loadCloneOperations, prepareGroupClone } from "./groupCloneData";
import { executeGroupClone, newCloneOperation } from "./groupClone";

const group = { id: "source-group-id", displayName: "Source", description: "Synthetic" };
const rule: RuleSetDto = {
  id: "source-rule-id", environmentFilter: { type: "Include", values: [{ id: group.id, type: "EnvironmentGroup" }] },
  parameters: [{ type: "Sharing", resourceType: "UsersBot", value: [{ id: "MaximumShareLimit", value: "99" }] }],
};
const policy: Policy = { id: "source-policy-id", name: "ACP", ruleSets: [{ id: "ConnectorManagement", version: "1.0", inputs: { AllowedConnectorList: [] } }] };
const assignment = { policyId: policy.id, resourceId: group.id, resourceType: "EnvironmentGroup" };
beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
  vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto); localStorage.clear();
  execute.mockImplementation(async ({ connectorOperation: operation }) => ({
    success: true,
    data: operation.operationName === "GetEnvironmentGroup" ? group
      : operation.operationName === "GetRuleSet" ? { value: [rule] } : { value: [assignment] },
  }));
  evidence.mockResolvedValue([{
    groupId: group.id, capturedAt: Date.now(), details: { ok: true, data: group },
    rulesets: { ok: true, data: { matching: [rule], unresolved: [] } }, policies: { ok: true, data: [policy] },
  }]);
  readPolicy.mockResolvedValue({ ok: true, data: policy });
  emptyMembership.mockResolvedValue({ ok: true, data: true });
});

describe("registered clone SDK adapter", () => {
  it("prepares applied settings through independent fresh reads, without tenant writes or an invented Publish call", async () => {
    const result = await prepareGroupClone(group.id, "New");
    expect(result.ok).toBe(true);
    expect(execute.mock.calls.map(([input]) => input.connectorOperation.operationName).sort()).toEqual(["GetEnvironmentGroup", "GetRuleSet", "ListRuleAssignmentsByEnvironmentGroupId"]);
    const request = execute.mock.calls.find(([input]) => input.connectorOperation.operationName === "GetRuleSet")?.[0];
    expect(request.connectorOperation.parameters).toEqual({ groupId: group.id, "api-version": "2024-10-01" });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.copied.some((item) => item.path === "ModelA.Sharing/UsersBot/MaximumShareLimit")).toBe(true);
    expect(result.data.blockers).toEqual([]);
    expect(result.data.publication).toBe("applied");
    expect(await groupCloneBackend.readPublication(group.id)).toEqual({ ok: true, data: "applied" });
    expect(execute.mock.calls.every(([input]) => !/Create|Patch|Publish/.test(input.connectorOperation.operationName))).toBe(true);
  });
  it("only gates actual unresolved contracts, not all group-only creation or body-less responses", async () => {
    const result = await prepareGroupClone(group.id, "New");
    if (!result.ok) throw new Error(result.error);
    expect(groupCloneBackend.executionBlockers(result.data)).toEqual([]);
    expect(groupCloneBackend.executionBlockers({ ...result.data, publication: "draft" }))
      .toContain("Only applied API configuration has a verified copy contract; pending drafts cannot be copied.");
    expect(groupCloneBackend.executionBlockers({ ...result.data, rules: [...result.data.rules, ...result.data.rules] }))
      .toContain("This source has multiple group rule resources. The API doesn't establish whether repeated creation preserves them separately.");
  });
  it("uses documented named write schemas (mocked SDK only), including fresh Model A scope and whole-group assignment", async () => {
    await groupCloneBackend.createGroup({ displayName: "New", description: "Synthetic" });
    await groupCloneBackend.createRule("new-group-id", { parameters: rule.parameters, environmentFilter: { type: "Include", values: [{ id: "new-group-id", type: "EnvironmentGroup" }] } });
    await groupCloneBackend.createPolicy({ name: "Independent", ruleSets: policy.ruleSets });
    await groupCloneBackend.patchPolicy("new-policy-id", { ruleSets: policy.ruleSets });
    await groupCloneBackend.assign("new-policy-id", "new-group-id");
    const calls = execute.mock.calls.map(([request]) => request.connectorOperation);
    expect(calls.map((request) => request.operationName)).toEqual(["CreateEnvironmentGroup", "CreateRuleSet", "CreateRuleBasedPolicy", "PatchRuleBasedPolicy", "CreateEnviornmentGroupRuleBasedAssignment"]);
    expect(calls[1].parameters).not.toHaveProperty("environmentId");
    expect(calls[1].parameters.body).not.toHaveProperty("id");
    expect(calls[4].parameters).toEqual({ "api-version": "2024-10-01", groupId: "new-group-id", policyId: "new-policy-id", body: {} });
  });
  it.each([{ "@odata.nextLink": "https://synthetic.invalid/next", value: [rule] }, {}, undefined])("fails closed on incomplete or body-less Model A response %j", async (data) => {
    execute.mockImplementation(async ({ connectorOperation }) => ({
      success: true, data: connectorOperation.operationName === "GetRuleSet" ? data
        : connectorOperation.operationName === "GetEnvironmentGroup" ? group : { value: [assignment] },
    }));
    expect((await prepareGroupClone(group.id, "New")).ok).toBe(false);
  });
  it("accepts the observed empty-group 204 shape only with independent complete empty tenant evidence", async () => {
    execute.mockResolvedValue({ success: true, data: undefined });
    evidence.mockResolvedValue([{ rulesets: { ok: true, data: { matching: [], unresolved: [] } } }]);
    expect(await groupCloneBackend.readRules("new-group-id")).toEqual({ ok: true, data: [] });
    evidence.mockResolvedValue([{ rulesets: { ok: true, data: { matching: [], unresolved: [rule] } } }]);
    expect((await groupCloneBackend.readRules("new-group-id")).ok).toBe(false);
    evidence.mockResolvedValue([{ rulesets: { ok: false, error: "403 TenantRulesDenied" } }]);
    expect(await groupCloneBackend.readRules("new-group-id")).toEqual({ ok: false, error: "403 TenantRulesDenied" });
  });
  it("requires both live filtered membership and complete fresh inventory to establish empty membership", async () => {
    execute.mockResolvedValue({ success: true, data: { value: [] } });
    expect(await groupCloneBackend.readEmptyMembership("new-group-id")).toEqual({ ok: true, data: true });
    expect(execute.mock.calls[0][0].connectorOperation).toMatchObject({
      operationName: "ListEnvironmentsForUser",
      parameters: { "$filter": "environmentGroupId eq 'new-group-id'", "$select": "id,environmentGroupId", "$top": 1 },
    });
    emptyMembership.mockResolvedValue({ ok: true, data: false });
    expect(await groupCloneBackend.readEmptyMembership("new-group-id")).toEqual({ ok: true, data: false });
    emptyMembership.mockResolvedValue({ ok: true, data: true });
    execute.mockResolvedValue({ success: true, data: { value: [{ id: "sandbox-id", environmentGroupId: "new-group-id" }] } });
    expect(await groupCloneBackend.readEmptyMembership("new-group-id")).toEqual({ ok: true, data: false });
    for (const data of [
      undefined, { value: [], "@odata.nextlink": "https://synthetic.invalid/next" },
      { value: [], "@odata.count": 1 }, { value: [{ id: "foreign-id", environmentGroupId: "another-group-id" }] },
    ]) {
      execute.mockResolvedValue({ success: true, data });
      expect((await groupCloneBackend.readEmptyMembership("new-group-id")).ok).toBe(false);
    }
    execute.mockResolvedValue({ success: false, error: { code: "AuthorizationFailed", status: 403 } });
    const denied = await groupCloneBackend.readEmptyMembership("new-group-id");
    expect(!denied.ok && denied.error).toContain("AuthorizationFailed");
  });
  it("runs the production adapter end-to-end using mocked SDK responses with observed server metadata and empty-group shapes", async () => {
    const timestamp = "2026-01-01T10:00:00Z";
    const sourceRule = structuredClone(rule), sourcePolicy = structuredClone(policy);
    Object.assign(sourceRule.parameters![0], { lastModifiedDate: timestamp });
    Object.assign(sourcePolicy.ruleSets![0], { lastModifiedDate: timestamp });
    const destination = { ...group, id: "new-group-id", displayName: "New" };
    const state = { rules: [] as RuleSetDto[], policy: undefined as Policy | undefined, assignments: [] as typeof assignment[] };
    evidence.mockImplementation(async ([id]) => [{
      groupId: id, details: { ok: true, data: id === group.id ? group : destination },
      rulesets: { ok: true, data: { matching: id === group.id ? [sourceRule] : state.rules, unresolved: [] } },
      policies: { ok: true, data: id === group.id ? [sourcePolicy] : state.policy ? [state.policy] : [] },
    }]);
    readPolicy.mockImplementation(async (id) => ({ ok: true, data: id === policy.id ? sourcePolicy : state.policy }));
    execute.mockImplementation(async ({ connectorOperation: operation }) => {
      const p = operation.parameters;
      switch (operation.operationName) {
        case "GetEnvironmentGroup": return { success: true, data: p.groupId === group.id ? group : destination };
        case "GetRuleSet": return { success: true, data: p.groupId === group.id ? { value: [sourceRule] } : state.rules.length ? { value: state.rules } : undefined };
        case "ListRuleAssignmentsByEnvironmentGroupId": return { success: true, data: { value: p.environmentGroupId === group.id ? [assignment] : state.assignments } };
        case "ListRuleAssignmentsByPolicyId": return { success: true, data: { value: state.assignments } };
        case "ListEnvironmentsForUser": return { success: true, data: { value: [] } };
        case "CreateEnvironmentGroup": return { success: true, data: destination };
        case "CreateRuleSet": {
          const created: RuleSetDto = { ...structuredClone(p.body), id: "new-rule-id" };
          created.parameters?.forEach((bucket) => Object.assign(bucket, { lastModifiedDate: timestamp }));
          state.rules.push(created);
          return { success: true, data: created };
        }
        case "CreateRuleBasedPolicy":
          state.policy = { ...structuredClone(p.body), id: "new-policy-id" };
          state.policy!.ruleSets?.forEach((module) => Object.assign(module, { lastModifiedDate: timestamp }));
          return { success: true, data: state.policy };
        case "CreateEnviornmentGroupRuleBasedAssignment":
          state.assignments = [{ policyId: p.policyId, resourceId: p.groupId, resourceType: "EnvironmentGroup" }];
          return { success: true, data: state.assignments[0] };
        default: throw new Error(`Unexpected operation ${operation.operationName}`);
      }
    });
    const plan = await prepareGroupClone(group.id, "New");
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.data.blockers).toEqual([]);
    const outcome = await executeGroupClone(plan.data, await newCloneOperation(plan.data), groupCloneBackend, groupCloneStore, true);
    expect(outcome.operation.phase).toBe("verified");
    expect(outcome.destinationUrl).toContain("new-group-id");
    const writes = execute.mock.calls.map(([input]) => input.connectorOperation).filter((request) => /Create|Patch|Publish/.test(request.operationName));
    expect(writes.map((request) => request.operationName)).toEqual([
      "CreateEnvironmentGroup", "CreateRuleSet", "CreateRuleBasedPolicy", "CreateEnviornmentGroupRuleBasedAssignment",
    ]);
    expect(JSON.stringify(writes)).not.toContain("source-group-id");
    expect(JSON.stringify(writes)).not.toContain("source-policy-id");
    expect(JSON.stringify(writes)).not.toContain("lastModifiedDate");
    expect(outcome.operation.steps.every((step) => step.outcome === "verified")).toBe(true);
  });
  it("preserves raw overrides and unknown group settings as concrete blockers", async () => {
    const changedGroup = { ...group, UnknownRuleSetting: true };
    execute.mockImplementation(async ({ connectorOperation }) => ({
      success: true, data: connectorOperation.operationName === "GetRuleSet" ? { value: [rule] }
        : connectorOperation.operationName === "GetEnvironmentGroup" ? changedGroup
          : { value: [{ ...assignment, assignmentOverrides: [{ behaviorType: "Exclude" }] }] },
    }));
    evidence.mockResolvedValue([{
      groupId: group.id, details: { ok: true, data: changedGroup }, rulesets: { ok: true, data: { matching: [rule], unresolved: [] } },
      policies: { ok: true, data: [policy] },
    }]);
    const result = await prepareGroupClone(group.id, "New");
    expect(result.ok && result.data.blockers.join(" ")).toContain("Group.UnknownRuleSetting");
    expect(result.ok && result.data.blockers.join(" ")).toContain("overrides");
  });
  it("rejects group/tenant Model A disagreement, stale properties and multiple source policies", async () => {
    for (const changed of [
      { matching: [{ ...rule, parameters: [] }], details: group, policies: [policy] },
      { matching: [rule], details: { ...group, description: "Changed" }, policies: [policy] },
      { matching: [rule], details: group, policies: [policy, { ...policy, id: "foreign-policy-id" }] },
    ]) {
      evidence.mockResolvedValue([{
        groupId: group.id, details: { ok: true, data: changed.details },
        rulesets: { ok: true, data: { matching: changed.matching, unresolved: [] } }, policies: { ok: true, data: changed.policies },
      }]);
      expect((await prepareGroupClone(group.id, "New")).ok).toBe(false);
    }
  });
  it("surfaces original authorization errors and cancels preflight without writes", async () => {
    execute.mockResolvedValue({ success: false, error: { code: "AuthorizationFailed", status: 403 } });
    const result = await prepareGroupClone(group.id, "New");
    expect(!result.ok && result.error).toContain("AuthorizationFailed");
    vi.clearAllMocks();
    const controller = new AbortController(); controller.abort();
    expect((await prepareGroupClone(group.id, "New", controller.signal)).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("private durable copy records", () => {
  it("persists only identities, payload fingerprints and outcomes, and reloads by source", async () => {
    const plan = await prepareGroupClone(group.id, "New");
    if (!plan.ok) throw new Error(plan.error);
    const operation = await newCloneOperation(plan.data);
    operation.phase = "indeterminate"; operation.destinationId = "actual-new-group-id";
    operation.steps.push({ key: "create-policy", outcome: "started" });
    groupCloneStore.save(operation);
    expect(loadCloneOperations(group.id)).toEqual([operation]);
    const stored = localStorage.getItem(localStorage.key(0)!)!;
    expect(stored).not.toContain("AllowedConnectorList");
    expect(stored).not.toContain("Synthetic");
    expect(stored).not.toContain("parameters");
    expect(loadCloneOperations("other-source-id")).toEqual([]);
  });
  it("rejects malformed records or extra credential/payload fields instead of silently resetting recovery", async () => {
    const result = await prepareGroupClone(group.id, "New");
    if (!result.ok) throw new Error(result.error);
    const operation = await newCloneOperation(result.data);
    Object.assign(operation, { token: "synthetic-not-a-credential" });
    expect(() => groupCloneStore.save(operation)).toThrow("Unsafe");
    localStorage.setItem("ppcoe:managed-apps:group-clone:v1:invalid", "{");
    expect(() => loadCloneOperations(group.id)).toThrow();
  });
});
