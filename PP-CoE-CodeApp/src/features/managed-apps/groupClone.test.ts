import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Policy, RuleAssignment, RuleSetDto } from "../../generated/models/PowerPlatformforAdminsV2Model";
import {
  CLONE_REQUEST_TIMEOUT_MS, executeGroupClone, newCloneOperation, planGroupClone, reconcileGroupClone, ruleCreateBody,
  type CloneBackend, type CloneOperation, type ClonePlan, type CloneSnapshot, type CloneStore,
} from "./groupClone";

beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.useRealTimers());

const source = (): CloneSnapshot => ({
  group: { id: "source-group-id", displayName: "Source", description: "Test configuration", lastModifiedTime: "original" },
  rules: [{
    id: "source-rule-id", lastModified: "original",
    environmentFilter: { type: "Include", values: [{ id: "source-group-id", type: "EnvironmentGroup" }, { id: "other-group-id", type: "EnvironmentGroup" }] },
    parameters: [{ type: "Sharing", resourceType: "UsersBot", value: [{ id: "MaximumShareLimit", value: "99" }, { id: "CanShareWithSecurityGroups", value: "false" }] }],
  }],
  assignments: [{ resourceId: "source-group-id", resourceType: "EnvironmentGroup", policyId: "source-policy-id", ruleSetCount: 3 }],
  policy: {
    id: "source-policy-id", name: "Source policy", ruleSetCount: 3, ruleSets: [
      { id: "ConnectorManagement", version: "1.0", inputs: { AllowedConnectorList: [{
        AllowedConnector: "/providers/Microsoft.PowerApps/apis/shared_sql", AllowedActionsMode: "SomeAllowed",
        AllowedActions: ["GetItems_V2"], AllowedConnectionTypesMode: "SomeAllowed", AllowedConnectionTypes: ["SqlAuthentication"],
      }] } },
      { id: "AdvancedConnectorPoliciesOnly", version: "1.0", inputs: { EnableAdvancedConnectorPoliciesOnly: false } },
      { id: "FutureReadableModule", version: "2.1", inputs: { UnknownKey: { values: [false, "", null, []] } } },
    ],
  },
  // Synthetic contract evidence, NOT evidence of tenant publication or deployability.
  publication: "published", publicationEvidence: "synthetic verified state contract", blockers: [],
});

async function harness() {
  let snapshot = source();
  const plan = await planGroupClone(snapshot, "Independent test group");
  const records = new Map<string, CloneOperation>();
  const store: CloneStore = { read: (id) => records.get(id), save: (record) => records.set(record.id, structuredClone(record)) };
  const state = { group: { id: "new-group-id", ...plan.group }, rules: [] as RuleSetDto[], policy: undefined as Policy | undefined, assignments: [] as RuleAssignment[] };
  const backend: CloneBackend = {
    readSource: vi.fn<CloneBackend["readSource"]>(async () => ({ ok: true, data: structuredClone(snapshot) })),
    executionBlockers: () => [],
    createGroup: vi.fn<CloneBackend["createGroup"]>(async () => ({ ok: true, data: state.group })),
    createRule: vi.fn<CloneBackend["createRule"]>(async (_groupId, body) => {
      const rule = { ...structuredClone(body), id: `new-rule-id-${state.rules.length}` };
      state.rules.push(rule); return { ok: true, data: rule };
    }),
    createPolicy: vi.fn<CloneBackend["createPolicy"]>(async (body) => {
      state.policy = { ...structuredClone(body), id: "new-policy-id" };
      return { ok: true, data: state.policy };
    }),
    patchPolicy: vi.fn<CloneBackend["patchPolicy"]>(async (_id, body) => {
      state.policy = { ...structuredClone(body), id: "new-policy-id" }; return { ok: true, data: state.policy };
    }),
    assign: vi.fn<CloneBackend["assign"]>(async (policyId, groupId) => {
      state.assignments = [{ policyId, resourceId: groupId, resourceType: "EnvironmentGroup" }];
      return { ok: true, data: state.assignments[0] };
    }),
    readGroup: vi.fn<CloneBackend["readGroup"]>(async () => ({ ok: true, data: state.group })),
    readRules: vi.fn<CloneBackend["readRules"]>(async () => ({ ok: true, data: state.rules })),
    readPolicy: vi.fn<CloneBackend["readPolicy"]>(async () => state.policy ? { ok: true, data: state.policy } : { ok: false, error: "Missing policy" }),
    readAssignments: vi.fn<CloneBackend["readAssignments"]>(async () => ({ ok: true, data: state.assignments })),
    readPolicyAssignments: vi.fn<CloneBackend["readPolicyAssignments"]>(async () => ({ ok: true, data: state.assignments })),
    readEmptyMembership: vi.fn<CloneBackend["readEmptyMembership"]>(async () => ({ ok: true, data: true })),
    readPublication: vi.fn<CloneBackend["readPublication"]>(async () => ({ ok: true, data: "published" })),
  };
  const operation = await newCloneOperation(plan);
  const run = () => executeGroupClone(plan, operation, backend, store, true);
  return { plan, store, records, state, backend, operation, run, changeSource: (next: CloneSnapshot) => { snapshot = next; } };
}

describe("lossless independent group-copy planning", () => {
  it("preserves both wire models, setting/module identities, raw values and every input without sharing resources", async () => {
    const snapshot = source();
    const plan = await planGroupClone(snapshot, " New empty group ");
    expect(plan.blockers).toEqual([]);
    expect(plan.rules[0].parameters).toEqual(snapshot.rules[0].parameters);
    expect(plan.rules[0].parameters).not.toBe(snapshot.rules[0].parameters);
    expect(plan.policy.ruleSets).toEqual(snapshot.policy.ruleSets);
    expect(plan.policy).not.toHaveProperty("id");
    expect(plan.group).not.toHaveProperty("parentGroupId");
    const body = ruleCreateBody(plan.rules[0], "new-group-id");
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("lastModified");
    expect(body.environmentFilter?.values).toEqual([{ id: "new-group-id", type: "EnvironmentGroup" }]);
    expect(plan.copied.map((setting) => setting.path)).toContain("ModelA.Sharing/UsersBot/MaximumShareLimit");
    expect(snapshot.rules[0].environmentFilter?.values).toHaveLength(2);
  });
  it.each(["applied", "draft", "published"] as const)("keeps explicit source %s state, without treating returned settings as published", async (publication) => {
    expect((await planGroupClone({ ...source(), publication }, "New")).publication).toBe(publication);
    const plan = await planGroupClone({ ...source(), publication: "unknown", publicationEvidence: "" }, "New");
    expect(plan.blockers.join(" ")).toContain("unpublished draft");
  });
  it("recognizes observed policy timestamps as response metadata, without sending or comparing them as settings", async () => {
    const snapshot = source();
    Object.assign(snapshot.policy, { lastModifiedOffset: "2026-11-04T10:00:00+00:00" });
    const plan = await planGroupClone(snapshot, "New");
    expect(plan.blockers).toEqual([]);
    expect(plan.policy).not.toHaveProperty("lastModifiedOffset");
    expect(plan.policy.ruleSets).toEqual(snapshot.policy.ruleSets);
    const h = await harness();
    const read = h.backend.readPolicy;
    h.backend.readPolicy = vi.fn(async (id) => {
      const result = await read(id);
      if (result.ok) Object.assign(result.data, { lastModifiedOffset: "2026-11-04T11:00:00+00:00" });
      return result;
    });
    expect((await h.run()).operation.phase).toBe("verified");
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("omits only verified bucket/module response timestamps, preserving complete inputs and identities", async () => {
    const snapshot = source();
    Object.assign(snapshot.rules[0].parameters![0], { lastModifiedDate: "2026-01-01T10:00:00Z" });
    Object.assign(snapshot.policy.ruleSets![0], { lastModifiedDate: "2026-01-01T10:00:00Z" });
    snapshot.policy.ruleSets![2].inputs!.lastModifiedDate = "This is an actual input, not response metadata";
    const plan = await planGroupClone(snapshot, "New");
    expect(plan.blockers).toEqual([]);
    expect(plan.rules[0].parameters![0]).not.toHaveProperty("lastModifiedDate");
    expect(plan.policy.ruleSets![0]).not.toHaveProperty("lastModifiedDate");
    expect(plan.policy.ruleSets![2].inputs!.lastModifiedDate).toBe("This is an actual input, not response metadata");
    expect(snapshot.rules[0].parameters![0]).toHaveProperty("lastModifiedDate");
    const h = await harness();
    const readRules = h.backend.readRules, readPolicy = h.backend.readPolicy;
    h.backend.readRules = vi.fn(async (id) => {
      const result = await readRules(id);
      if (result.ok) result.data.forEach((rule) => rule.parameters?.forEach((bucket) => Object.assign(bucket, { lastModifiedDate: "2026-01-02T10:00:00Z" })));
      return result;
    });
    h.backend.readPolicy = vi.fn(async (id) => {
      const result = await readPolicy(id);
      if (result.ok) result.data.ruleSets?.forEach((module) => Object.assign(module, { lastModifiedDate: "2026-01-02T10:00:00Z" }));
      return result;
    });
    expect((await h.run()).operation.phase).toBe("verified");
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
  });
  it("blocks malformed response timestamps and client-side staged state instead of ignoring unknown fields", async () => {
    const snapshot = source();
    Object.assign(snapshot.rules[0].parameters![0], { lastModifiedDate: false, hasStagedChanges: true });
    Object.assign(snapshot.policy.ruleSets![0], { lastModifiedDate: "invalid" });
    const plan = await planGroupClone(snapshot, "New");
    expect(plan.blockers.join(" ")).toContain("hasStagedChanges");
    expect(plan.blockers.filter((reason) => reason.includes("not a valid response timestamp"))).toHaveLength(2);
    expect(plan.unsupported).toContainEqual({ path: "GroupRules.source-rule-id/Sharing/UsersBot.hasStagedChanges", value: true });
  });
  it("retains exact unknown container fields and distinguishes them from malformed inputs", async () => {
    const snapshot = source();
    Object.assign(snapshot.rules[0].parameters![0], { futureBucketMode: { enabled: false } });
    Object.assign(snapshot.policy.ruleSets![0], { futureRuleState: null });
    const plan = await planGroupClone(snapshot, "New");
    expect(plan.unsupported).toEqual([
      { path: "GroupRules.source-rule-id/Sharing/UsersBot.futureBucketMode", value: { enabled: false } },
      { path: "PolicyRules.ConnectorManagement.futureRuleState", value: null },
    ]);
    expect(plan.blockers.join(" ")).toContain("futureBucketMode");
    expect(plan.blockers.join(" ")).toContain("futureRuleState");
    expect(plan.blockers.join(" ")).not.toContain("missing/duplicate");
    expect(plan.policy.ruleSets![0].inputs).toEqual(snapshot.policy.ruleSets![0].inputs);
  });
  it("blocks multiple assignments, stale counts, malformed ACP and source-owned references", async () => {
    const snapshot = source();
    snapshot.assignments.push({ policyId: "foreign-policy-id", resourceId: snapshot.group.id, resourceType: "EnvironmentGroup" });
    snapshot.policy.ruleSets![0].inputs!.AllowedConnectorList = [{ AllowedConnector: "sql", AllowedActionsMode: "FutureMode" }];
    snapshot.policy.ruleSets![2].inputs!.OwnedResource = "https://example.invalid/groups/source-group-id";
    const plan = await planGroupClone(snapshot, "");
    expect(plan.blockers.join(" ")).toMatch(/new group name/);
    expect(plan.blockers.join(" ")).toMatch(/Exactly one/);
    expect(plan.blockers.join(" ")).toMatch(/ambiguous action/);
    expect(plan.blockers.join(" ")).toMatch(/remapping contract/);
  });
  it("retains concrete unsupported settings instead of silently dropping them", async () => {
    const snapshot = source();
    Object.assign(snapshot.group, { UnknownGovernanceSetting: true });
    Object.assign(snapshot.rules[0].parameters![0].value![0], { extraSetting: true });
    Object.assign(snapshot.assignments[0], { assignmentOverrides: [{ behaviorType: "Exclude" }] });
    const plan = await planGroupClone(snapshot, "New");
    expect(plan.blockers.join(" ")).toContain("Group.UnknownGovernanceSetting");
    expect(plan.blockers.join(" ")).toContain("ModelA.Sharing/UsersBot/MaximumShareLimit");
    expect(plan.blockers.join(" ")).toContain("overrides");
    expect(plan.copied.find((item) => item.path.includes("MaximumShareLimit"))?.value).toBe("99");
  });
  it("blocks source hierarchy rather than omitting inherited scope from a complete-copy claim", async () => {
    const snapshot = source();
    snapshot.group.parentGroupId = "parent-group";
    expect((await planGroupClone(snapshot, "New")).blockers.join(" ")).toContain("inherited rule fidelity");
  });
  it("blocks duplicate rule/resource identities and missing SomeAllowed connection lists", async () => {
    const snapshot = source();
    snapshot.rules.push(structuredClone(snapshot.rules[0]));
    snapshot.policy.ruleSets!.push(structuredClone(snapshot.policy.ruleSets![1]));
    const connectors = snapshot.policy.ruleSets![0].inputs!.AllowedConnectorList as Record<string, unknown>[];
    delete connectors[0].AllowedConnectionTypes;
    const plan = await planGroupClone(snapshot, "New");
    expect(plan.blockers.join(" ")).toContain("Duplicate Model A");
    expect(plan.blockers.join(" ")).toContain("missing/duplicate identity");
    expect(plan.blockers.join(" ")).toContain("connection-type");
  });
});

describe("guarded creation orchestration (synthetic backend contracts)", () => {
  it("identifies a no-content rule creation only through exact new-group read-back, including group-keyed identities", async () => {
    const h = await harness();
    h.backend.createRule = vi.fn<CloneBackend["createRule"]>(async (_groupId, body) => {
      h.state.rules = [{ ...structuredClone(body), id: h.state.group.id }];
      return { ok: true, data: undefined };
    });
    const result = await h.run();
    expect(result.operation.phase).toBe("verified");
    expect(result.operation.rules).toEqual([{ sourceId: "source-rule-id", destinationId: "new-group-id" }]);
    expect(h.backend.createRule).toHaveBeenCalledTimes(1);
  });
  it("never advances after a no-content rule write without unique exact read-back, or retries the POST", async () => {
    const h = await harness();
    h.backend.createRule = vi.fn<CloneBackend["createRule"]>(async () => ({ ok: true, data: undefined }));
    const result = await h.run();
    expect(result.message).toContain("no unique destination-scoped");
    expect(result.operation.phase).toBe("indeterminate");
    expect(result.operation.steps.at(-1)?.outcome).toBe("indeterminate");
    expect(result.operation.destinationId).toBe("new-group-id");
    expect(h.backend.createPolicy).not.toHaveBeenCalled();
    await h.run();
    expect(h.backend.createRule).toHaveBeenCalledTimes(1);
  });
  it("retains uncertainty when the read after a no-content rule write is unavailable", async () => {
    const h = await harness();
    h.backend.createRule = vi.fn<CloneBackend["createRule"]>(async () => ({ ok: true, data: undefined }));
    vi.mocked(h.backend.readRules).mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: false, error: "403 ReadBackDenied" });
    const result = await h.run();
    expect(result.message).toContain("403 ReadBackDenied");
    expect(result.operation.phase).toBe("indeterminate");
    expect(result.operation.destinationId).toBe("new-group-id");
    expect(h.backend.createPolicy).not.toHaveBeenCalled();
  });
  it("creates an independent empty copy and verifies both complete models, assignment exclusivity, publication and unchanged source", async () => {
    const h = await harness();
    const result = await h.run();
    expect(result.operation.phase).toBe("verified");
    expect(result.destinationUrl).toContain("/manage/envgroups/new-group-id/details");
    expect(h.backend.createRule).toHaveBeenCalledWith("new-group-id", ruleCreateBody(h.plan.rules[0], "new-group-id"));
    expect(h.backend.assign).toHaveBeenCalledWith("new-policy-id", "new-group-id");
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
    expect(result.operation.steps.every((step) => step.outcome === "verified")).toBe(true);
    const serializedWrites = JSON.stringify([vi.mocked(h.backend.createGroup).mock.calls, vi.mocked(h.backend.createRule).mock.calls, vi.mocked(h.backend.createPolicy).mock.calls, vi.mocked(h.backend.assign).mock.calls]);
    expect(serializedWrites).not.toContain("source-group-id");
    expect(serializedWrites).not.toContain("source-policy-id");
    expect(serializedWrites).not.toContain("source-rule-id");
    expect(Object.keys(h.backend)).not.toContain("addEnvironment");
    expect(h.records.get(h.operation.id)).toEqual(result.operation);
  });
  it("stops before any write when confirmation, capability or source freshness is missing", async () => {
    const h = await harness();
    expect((await executeGroupClone(h.plan, h.operation, h.backend, h.store, false)).operation.phase).toBe("failed");
    expect(h.backend.createGroup).not.toHaveBeenCalled();
    const blocked = await harness();
    blocked.backend.executionBlockers = () => ["Publication contract unverified"];
    expect((await blocked.run()).operation.phase).toBe("blocked");
    expect(blocked.backend.createGroup).not.toHaveBeenCalled();
    const stale = await harness();
    stale.changeSource({ ...source(), publication: "draft" });
    expect((await stale.run()).message).toContain("Source changed");
    expect(stale.backend.createGroup).not.toHaveBeenCalled();
  });
  it("rechecks source before later writes and stops on mid-copy changes", async () => {
    const h = await harness();
    vi.mocked(h.backend.readSource).mockResolvedValueOnce({ ok: true, data: source() })
      .mockResolvedValue({ ok: true, data: { ...source(), group: { ...source().group, lastModifiedTime: "changed" } } });
    const result = await h.run();
    expect(result.operation.destinationId).toBe("new-group-id");
    expect(result.operation.phase).toBe("failed");
    expect(h.backend.createRule).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { operationId: "actual-operation-id", status: "Running" }])("does not retry an ambiguous/async group response %j", async (data) => {
    const h = await harness();
    vi.mocked(h.backend.createGroup).mockResolvedValue({ ok: true, data });
    const result = await h.run();
    expect(result.operation.phase).toBe("indeterminate");
    if (data && "operationId" in data) expect(result.operation.steps[0].operationId).toBe("actual-operation-id");
    expect(result.destinationUrl).toBeUndefined();
    await h.run();
    expect(h.backend.createGroup).toHaveBeenCalledTimes(1);
    expect(h.backend.createRule).not.toHaveBeenCalled();
  });
  it("surfaces authorization errors and does not continue or clean up", async () => {
    const h = await harness();
    vi.mocked(h.backend.createRule).mockResolvedValue({ ok: false, error: "403 AuthorizationFailed: caller cannot create rules" });
    const result = await h.run();
    expect(result.message).toContain("403 AuthorizationFailed");
    expect(result.operation.destinationId).toBe("new-group-id");
    expect(result.operation.phase).not.toBe("verified");
    expect(h.backend.createPolicy).not.toHaveBeenCalled();
    expect(result.message).toContain("No rollback");
  });
  it("bounds an unresponsive write, preserves uncertainty and ignores late completion without subsequent writes", async () => {
    const h = await harness();
    let finish!: (result: Awaited<ReturnType<CloneBackend["createGroup"]>>) => void;
    vi.mocked(h.backend.createGroup).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.useFakeTimers();
    const running = h.run();
    await vi.waitFor(() => expect(h.backend.createGroup).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(CLONE_REQUEST_TIMEOUT_MS);
    const result = await running;
    expect(result.operation.phase).toBe("indeterminate");
    expect(result.message).toContain("timed out");
    finish({ ok: true, data: h.state.group });
    await Promise.resolve();
    expect(h.backend.createRule).not.toHaveBeenCalled();
    await h.run();
    expect(h.backend.createGroup).toHaveBeenCalledTimes(1);
  });
  it("rejects source ID reuse before patch, assignment or any source write", async () => {
    const h = await harness();
    vi.mocked(h.backend.createPolicy).mockResolvedValue({ ok: true, data: { id: "source-policy-id" } });
    const result = await h.run();
    expect(result.operation.steps.find((step) => step.key === "create-policy")?.returnedId).toBe("source-policy-id");
    expect(result.message).toContain("source ID");
    expect(h.backend.patchPolicy).not.toHaveBeenCalled();
    expect(h.backend.assign).not.toHaveBeenCalled();
  });
  it("repairs raw stored modules only on the new exclusive policy and verifies again", async () => {
    const h = await harness();
    const realCreate = h.backend.createPolicy;
    h.backend.createPolicy = vi.fn(async (body) => {
      const result = await realCreate(body);
      h.state.policy!.ruleSets![0].inputs!.AllowedConnectorList = [];
      return result;
    });
    expect((await h.run()).operation.phase).toBe("verified");
    expect(h.backend.patchPolicy).toHaveBeenCalledWith("new-policy-id", h.plan.policy);
  });
  it("does not assign a policy after failed repair or patch an already shared new policy", async () => {
    const h = await harness();
    vi.mocked(h.backend.readPolicy).mockResolvedValue({ ok: true, data: { id: "new-policy-id", ruleSets: [] } });
    expect((await h.run()).message).toContain("PATCH failed");
    expect(h.backend.assign).not.toHaveBeenCalled();
    const shared = await harness();
    vi.mocked(shared.backend.readPolicyAssignments).mockResolvedValue({ ok: true, data: [{ policyId: "new-policy-id", resourceId: "foreign", resourceType: "Environment" }] });
    expect((await shared.run()).message).toContain("existing assignments");
    expect(shared.backend.patchPolicy).not.toHaveBeenCalled();
    expect(shared.backend.assign).not.toHaveBeenCalled();
  });
  it("stops on rule mismatch and records orphan group/rule identities for manual recovery", async () => {
    const h = await harness();
    const realCreate = h.backend.createRule;
    h.backend.createRule = vi.fn(async (id, body) => {
      const result = await realCreate(id, body);
      h.state.rules[0].parameters![0].value![0].value = "false";
      return result;
    });
    const result = await h.run();
    expect(result.operation.rules).toHaveLength(1);
    expect(result.message).toContain("Model A rules");
    expect(h.backend.createPolicy).not.toHaveBeenCalled();
    expect(result.destinationUrl).toBeUndefined();
  });
  it("does not call publication-pending or mixed publication a completed copy", async () => {
    const h = await harness();
    vi.mocked(h.backend.readPublication).mockResolvedValue({ ok: true, data: "draft" });
    const result = await h.run();
    expect(result.operation.phase).toBe("publication-pending");
    expect(result.destinationUrl).toBeUndefined();
    expect(result.message).toContain("not a completed group clone");
  });
  it("reconciles a lost assignment response by known IDs with no POST retry", async () => {
    const h = await harness();
    const assign = h.backend.assign;
    h.backend.assign = vi.fn(async (policyId, groupId) => {
      await assign(policyId, groupId);
      throw new Error("Network response lost");
    });
    const result = await h.run();
    expect(result.operation.phase).toBe("indeterminate");
    const reconciled = await reconcileGroupClone(h.plan, result.operation, h.backend, h.store);
    expect(reconciled.operation.phase).toBe("verified");
    expect(h.backend.assign).toHaveBeenCalledTimes(1);
    expect(h.backend.createGroup).toHaveBeenCalledTimes(1);
    const renewedPlan: ClonePlan = { ...h.plan, preparedAt: Date.now() + 1000 };
    expect((await reconcileGroupClone(renewedPlan, result.operation, h.backend, h.store)).operation.phase).toBe("verified");
  });
  it("reports a partial copy on failed assignment without claiming atomic rollback", async () => {
    const h = await harness();
    vi.mocked(h.backend.assign).mockResolvedValue({ ok: false, error: "Assignment failed" });
    const result = await h.run();
    expect(result.operation.policyId).toBe("new-policy-id");
    expect(result.operation.destinationId).toBe("new-group-id");
    const reconciled = await reconcileGroupClone(h.plan, result.operation, h.backend, h.store);
    expect(reconciled.message).toContain("Admin recovery");
    expect(reconciled.destinationUrl).toBeUndefined();
  });
  it("fails closed when membership, exclusive assignment or full policy verification changes", async () => {
    for (const kind of ["membership", "foreign-assignment", "input", "assignment-count", "policy-state"] as const) {
      const h = await harness();
      const assign = h.backend.assign;
      h.backend.assign = vi.fn(async (policyId, groupId) => {
        const result = await assign(policyId, groupId);
        if (kind === "membership") vi.mocked(h.backend.readEmptyMembership).mockResolvedValue({ ok: true, data: false });
        if (kind === "foreign-assignment") h.state.assignments.push({ policyId, resourceId: "foreign", resourceType: "Environment" });
        if (kind === "input") h.state.policy!.ruleSets![2].inputs!.UnknownKey = "changed";
        if (kind === "assignment-count") h.state.assignments[0].ruleSetCount = 999;
        if (kind === "policy-state") Object.assign(h.state.policy!, { UnsupportedState: true });
        return result;
      });
      const result = await h.run();
      expect(result.operation.phase).toBe("failed");
      expect(result.destinationUrl).toBeUndefined();
    }
  });
  it("bounds stalled membership read-back after creation without issuing any later writes", async () => {
    const h = await harness();
    vi.useFakeTimers();
    vi.mocked(h.backend.readEmptyMembership).mockImplementationOnce(() => new Promise(() => {}));
    const result = h.run();
    await vi.waitFor(() => expect(h.backend.readEmptyMembership).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(CLONE_REQUEST_TIMEOUT_MS);
    const stopped = await result;
    expect(stopped.operation.destinationId).toBe("new-group-id");
    expect(stopped.operation.phase).toBe("failed");
    expect(stopped.message).toContain("timed out");
    expect(h.backend.createRule).not.toHaveBeenCalled();
    expect(h.backend.createPolicy).not.toHaveBeenCalled();
  });
  it("does not reconcile source-owned resource identities into an independent success", async () => {
    const h = await harness();
    const success = await h.run();
    const unsafe = { ...success.operation, destinationId: h.plan.sourceId };
    h.store.save(unsafe);
    const result = await reconcileGroupClone(h.plan, unsafe, h.backend, h.store);
    expect(result.message).toContain("reuse source-owned resources");
    expect(result.operation.phase).not.toBe("verified");
    expect(result.destinationUrl).toBeUndefined();
    expect(h.backend.createGroup).toHaveBeenCalledTimes(1);
  });
  it("does not retry recorded write intent even if its phase is incorrectly labeled planned", async () => {
    const h = await harness();
    h.store.save({ ...h.operation, steps: [{ key: "create-group", outcome: "started" }] });
    expect((await h.run()).message).toContain("Creation is never retried");
    expect(h.backend.createGroup).not.toHaveBeenCalled();
  });
  it("persists started intent before a write and blocks creation if storage fails", async () => {
    const h = await harness();
    vi.mocked(h.backend.createGroup).mockImplementation(async () => {
      expect(h.records.get(h.operation.id)?.steps[0].outcome).toBe("started");
      return { ok: true, data: h.state.group };
    });
    expect((await h.run()).operation.phase).toBe("verified");
    const unavailable = await harness();
    unavailable.store.save = () => { throw new Error("Storage quota exceeded"); };
    expect((await unavailable.run()).message).toContain("Recovery record could not be saved");
    expect(unavailable.backend.createGroup).not.toHaveBeenCalled();
  });
  it("prevents duplicate in-flight submission even before the journal is updated", async () => {
    const h = await harness();
    let finish!: (value: Awaited<ReturnType<CloneBackend["readSource"]>>) => void;
    vi.mocked(h.backend.readSource).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = h.run();
    // Allow asynchronous fingerprint validation to reach the source read.
    await vi.waitFor(() => expect(h.backend.readSource).toHaveBeenCalled());
    expect((await h.run()).message).toContain("already running");
    finish({ ok: true, data: source() });
    expect((await first).operation.phase).toBe("verified");
    expect(h.backend.createGroup).toHaveBeenCalledTimes(1);
  });
});
