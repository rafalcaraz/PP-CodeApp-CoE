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
  it("reads fresh direct group-only Model A metadata and retains the actual publication gate, without tenant writes", async () => {
    const result = await prepareGroupClone(group.id, "New");
    expect(result.ok).toBe(true);
    expect(execute.mock.calls.map(([input]) => input.connectorOperation.operationName).sort()).toEqual(["GetEnvironmentGroup", "GetRuleSet", "ListRuleAssignmentsByEnvironmentGroupId"]);
    const request = execute.mock.calls.find(([input]) => input.connectorOperation.operationName === "GetRuleSet")?.[0];
    expect(request.connectorOperation.parameters).toEqual({ groupId: group.id, "api-version": "2024-10-01" });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.copied.some((item) => item.path === "ModelA.Sharing/UsersBot/MaximumShareLimit")).toBe(true);
    expect(result.data.blockers.join(" ")).toContain("draft versus published");
    expect(result.data.blockers.join(" ")).toContain("Fresh ruleset ID generation");
    const operation = await newCloneOperation(result.data);
    const outcome = await executeGroupClone(result.data, operation, groupCloneBackend, groupCloneStore, true);
    expect(outcome.operation.phase).toBe("blocked");
    expect(execute).toHaveBeenCalledTimes(3);
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
