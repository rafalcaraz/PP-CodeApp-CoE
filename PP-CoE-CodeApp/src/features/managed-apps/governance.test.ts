import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Policy, RuleSetDto } from "../../generated/models/PowerPlatformforAdminsV2Model";

const { listRules, details, policies, inventory, resources, memberships, readPolicy, createGroup, createPolicy, add, remove, directRead } = vi.hoisted(() => ({
  listRules: vi.fn(), details: vi.fn(), policies: vi.fn(), inventory: vi.fn(), resources: vi.fn(),
  memberships: vi.fn(), readPolicy: vi.fn(), directRead: vi.fn(),
  createGroup: vi.fn(), createPolicy: vi.fn(), add: vi.fn(), remove: vi.fn(),
}));
vi.mock("../../generated", async () => {
  const actual = await vi.importActual<typeof import("../../generated")>("../../generated");
  return { ...actual, PowerPlatformforAdminsV2Service: {
    ...actual.PowerPlatformforAdminsV2Service, GetRuleSetListForTenant: listRules,
    CreateEnvironmentGroup: createGroup, CreateRuleBasedPolicy: createPolicy,
    AddEnvironmentToGroup: add, RemoveEnvironmentFromGroup: remove,
    GetEnvironmentByIdForUser: directRead,
  } };
});
vi.mock("../../data/adminEnrichment", async () => ({
  ...await vi.importActual<typeof import("../../data/adminEnrichment")>("../../data/adminEnrichment"),
  getEnvironmentGroupDetails: details,
}));
vi.mock("./data", async () => ({
  ...await vi.importActual<typeof import("./data")>("./data"),
  loadGroupPolicies: policies, loadManagedApps: inventory, loadPdeResources: resources, loadPdeMemberships: memberships, loadPolicy: readPolicy,
}));

import {
  assessGroupCopy, connectorEvidence, groupFacts, groupPortalUrl, loadGroupEvidenceBatch,
  matchesGroup, preparePdeMoves, rulesForGroup, type GroupEvidence,
} from "./governance";
import { readManagedApp, type EnvironmentRow } from "./data";

const policy = (id: string, connector = "shared_teams", mode = "AllAllowed"): Policy => ({
  id, name: `Synthetic ${id}`, ruleSets: [{
    id: "ConnectorManagement", version: "1", inputs: {
      AllowedConnectorList: [{ AllowedConnector: connector, AllowedActionsMode: mode, AllowedActions: ["SendMessage"], AllowedConnectionTypesMode: "AllAllowed" }],
    },
  }],
});
const evidence = (assigned: Policy[] = [policy("source-policy")]): GroupEvidence => ({
  groupId: "source", capturedAt: 123,
  details: { ok: true, data: { id: "source", displayName: "Source", description: "Synthetic description", parentGroupId: "parent" } },
  rulesets: { ok: true, data: { matching: [], unresolved: [] } },
  policies: { ok: true, data: assigned },
});
const env = (id: string, groupId = "source"): EnvironmentRow => ({
  id, displayName: `Synthetic ${id}`, environmentType: "Developer", isManaged: true,
  environmentGroupId: groupId, environmentGroup: groupId,
  region: "", createdAt: "", createdBy: "", lastModifiedAt: "", tenantId: "",
});
const app = (id: string, environmentId = "pde-one", type = "microsoft.powerapps/apps") => readManagedApp({
  name: id, type, properties: { displayName: id, environmentId, origin: "CopilotStudio" },
});
const group = (id: string) => ({ id, displayName: id, description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" });

beforeEach(() => {
  vi.clearAllMocks();
  listRules.mockResolvedValue({ success: true, data: { value: [] } });
  details.mockImplementation((id: string) => Promise.resolve({ ok: true, data: { data: { id, displayName: id } } }));
  policies.mockResolvedValue({ ok: true, data: [policy("source-policy")] });
  inventory.mockResolvedValue({ ok: true, data: {
    apps: [app("selected"), app("unselected")], environments: [env("pde-one")],
    groups: [group("source"), group("destination")], excludedApps: 0,
  } });
  resources.mockResolvedValue({ ok: true, data: [app("selected"), app("unselected"), app("canvas-sibling", "pde-one", "microsoft.powerapps/canvasapps")] });
  memberships.mockResolvedValue({ ok: true, data: [env("pde-one")] });
  directRead.mockImplementation(async (id: string) => ({
    success: true, data: { id, state: "Enabled", type: "Developer", dataverseId: "synthetic-db", environmentGroupId: id === "already" ? "destination" : "source" },
  }));
  readPolicy.mockResolvedValue({ ok: true, data: policy("source-policy") });
});

describe("complete group evidence", () => {
  it("reads tenant rules once for a batch and follows only supported skip tokens", async () => {
    const rule: RuleSetDto = { id: "rules-one", environmentFilter: { type: "Include", values: [{ id: "source", type: "EnvironmentGroup" }] } };
    listRules.mockResolvedValueOnce({ success: true, data: { value: [rule], "@odata.nextLink": "https://synthetic.invalid/rules?$skiptoken=next" } })
      .mockResolvedValueOnce({ success: true, data: { value: [{ ...rule, id: "rules-two" }] } });
    const result = await loadGroupEvidenceBatch(["source", "destination", "SOURCE"]);
    expect(result).toHaveLength(2);
    expect(listRules).toHaveBeenCalledTimes(2);
    expect(listRules.mock.calls[1][4]).toBe("next");
    expect(listRules.mock.calls.every((call) => call[5] === 100)).toBe(true);
    expect(result[0].rulesets.ok && result[0].rulesets.data.matching).toHaveLength(2);
    expect(details).toHaveBeenCalledTimes(2);
  });
  it("drains more than 100 rules using authoritative continuation without losing independent ACP evidence", async () => {
    const rule = (id: string) => ({ id, environmentFilter: { type: "Include", values: [{ id: "source", type: "EnvironmentGroup" }] } });
    listRules.mockResolvedValueOnce({ success: true, data: { value: Array.from({ length: 100 }, (_, index) => rule(`synthetic-${index}`)), "@odata.nextLink": "?$skiptoken=second" } })
      .mockResolvedValueOnce({ success: true, data: { value: [rule("synthetic-last")] } });
    const [result] = await loadGroupEvidenceBatch(["source"]);
    expect(result.rulesets.ok && result.rulesets.data.matching).toHaveLength(101);
    expect(result.policies.ok).toBe(true);
  });
  it.each([
    { value: [], "@odata.count": 2 },
    { value: [], nextLink: "?skip=100" },
  ])("rejects incomplete rules without hiding successful ACP evidence", async (data) => {
    listRules.mockResolvedValue({ success: true, data });
    const [result] = await loadGroupEvidenceBatch(["source"]);
    expect(result.rulesets.ok).toBe(false);
    expect(result.policies.ok).toBe(true);
  });
  it("rejects conflicting duplicate rules across pages", async () => {
    listRules.mockResolvedValueOnce({ success: true, data: { value: [{ id: "synthetic", name: "Before" }], "@odata.nextLink": "?$skiptoken=next" } })
      .mockResolvedValueOnce({ success: true, data: { value: [{ id: "synthetic", name: "After" }] } });
    const [result] = await loadGroupEvidenceBatch(["source"]);
    expect(result.rulesets.ok).toBe(false);
  });
  it.each(["https://synthetic.invalid/next", "https://synthetic.invalid/next?$skiptoken=repeat"])("fails closed on unsupported or stalled continuation %s", async (link) => {
    listRules.mockResolvedValue({ success: true, data: { value: [{ id: "rule" }], "@odata.nextLink": link } });
    const [result] = await loadGroupEvidenceBatch(["source"]);
    expect(result.rulesets.ok).toBe(false);
    expect(result.policies.ok).toBe(true);
  });
  it("keeps unknown / Exclude applicability distinct from explicit group settings", () => {
    const rows: RuleSetDto[] = [
      { id: "include", environmentFilter: { type: "Include", values: [{ id: "source", type: "EnvironmentGroup" }] } },
      { id: "exclude", environmentFilter: { type: "Exclude", values: [{ id: "source", type: "EnvironmentGroup" }] } },
      { id: "other-env", environmentFilter: { type: "Include", values: [{ id: "source", type: "Environment" }] } },
      { id: "unknown", environmentFilter: { type: "FutureMode" } },
    ];
    expect(rulesForGroup(rows, "source")).toEqual({ matching: [rows[0]], unresolved: [rows[3]] });
  });
  it("rejects changed group identity but preserves independent section errors", async () => {
    details.mockResolvedValue({ ok: true, data: { data: { id: "wrong" } } });
    const [result] = await loadGroupEvidenceBatch(["source"]);
    expect(result.details.ok).toBe(false);
    expect(result.policies.ok).toBe(true);
  });
  it("makes no tenant-rules request for empty groups or a cancelled batch", async () => {
    expect(await loadGroupEvidenceBatch([])).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    const result = await loadGroupEvidenceBatch(["source"], controller.signal);
    expect(result[0].policies.ok).toBe(false);
    expect(listRules).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
  });
  it("deduplicates shared policy reads across groups within a batch, but not across refreshes", async () => {
    policies.mockImplementation(async (_id, _signal, read) => {
      const result = await read("shared-policy");
      return result.ok ? { ok: true, data: [result.data] } : result;
    });
    await loadGroupEvidenceBatch(["source", "destination", "third"]);
    expect(readPolicy).toHaveBeenCalledTimes(1);
    await loadGroupEvidenceBatch(["source"]);
    expect(readPolicy).toHaveBeenCalledTimes(2);
  });
});

describe("conservative connector and rule filtering", () => {
  const filter = { search: "", connectors: ["teams", "sharepointonline"], connectorMode: "all" as const, field: "", value: "" };
  it("makes all / any matching explicit and normalizes ARM / shared IDs", () => {
    const result = evidence([policy("a", "/providers/Microsoft.PowerApps/apis/shared_teams")]);
    expect(matchesGroup({ name: "Source", description: "" }, result, filter)).toBe(false);
    expect(matchesGroup({ name: "Source", description: "" }, result, { ...filter, connectorMode: "any" })).toBe(true);
    expect(connectorEvidence(result, "teams").state).toBe("allowed-configured");
  });
  it("does not count unknown, missing, malformed or conflicting modes as allowed", () => {
    for (const result of [
      undefined, evidence([]), evidence([policy("future", "teams", "FutureMode")]),
      evidence([policy("valid"), policy("unknown", "teams", "FutureMode")]),
      evidence([{ id: "broken", ruleSets: [{ id: "ConnectorManagement", inputs: {} }] }]),
    ]) expect(matchesGroup({ name: "Source", description: "" }, result, { ...filter, connectors: ["teams"] })).toBe(false);
    expect(connectorEvidence(evidence([]), "teams").state).toBe("not-listed");
  });
  it("keeps action restrictions and each policy identity rather than unioning permissions", () => {
    const result = connectorEvidence(evidence([policy("one", "teams", "SomeAllowed"), policy("two")]), "teams");
    expect(result.state).toBe("restricted-configured");
    expect(result.declarations.map((entry) => entry.policyId)).toEqual(["one", "two"]);
  });
  it("filters actual exact property/rule values while retaining rule identities", () => {
    const result = evidence([{ id: "flags", ruleSets: [{ id: "AdvancedConnectorPoliciesOnly", version: "1", inputs: { EnableAdvancedConnectorPoliciesOnly: false } }] }]);
    expect(groupFacts(result)).toContainEqual({ field: "ModelB.AdvancedConnectorPoliciesOnly.inputs.EnableAdvancedConnectorPoliciesOnly", value: "false", identity: "Policy flags / AdvancedConnectorPoliciesOnly v1" });
    expect(matchesGroup({ name: "Source", description: "" }, result, { ...filter, connectors: [], field: "Group.description", value: "Synthetic description" })).toBe(true);
  });
});

describe("independent group-copy assessment", () => {
  it("proposes new ACP payloads without reusing source IDs, membership or hierarchy", () => {
    const source = evidence();
    const result = assessGroupCopy(source, "New empty group");
    expect(result.group).toEqual({ displayName: "New empty group", description: "Synthetic description" });
    expect(result.independentPolicies[0].isAcp).toBe(true);
    expect(result.independentPolicies[0].request).not.toHaveProperty("id");
    expect(result.independentPolicies[0].request.ruleSets).toEqual(source.policies.ok && source.policies.data[0].ruleSets);
    expect(result.independentPolicies[0].request.ruleSets).not.toBe(source.policies.ok && source.policies.data[0].ruleSets);
    expect(result.limitations.join(" ")).toContain("authorization");
    expect(createGroup).not.toHaveBeenCalled();
    expect(createPolicy).not.toHaveBeenCalled();
    expect(groupPortalUrl("synthetic group")).toContain("/manage/envgroups/synthetic%20group/details");
  });
  it("discloses the exact uncopiable Model A setting and missing ACP", () => {
    const source = evidence([]);
    source.rulesets = { ok: true, data: { matching: [{ id: "legacy", parameters: [{ type: "Sharing", resourceType: "CanvasApps", value: [{ id: "SharingLimit", value: "5" }] }] }], unresolved: [] } };
    const text = assessGroupCopy(source, "New").limitations.join(" ");
    expect(text).toContain("Sharing/CanvasApps/SharingLimit");
    expect(text).toContain("No readable source ACP");
  });
});

describe("fresh, deduplicated PDE move preparation", () => {
  it.each([
    [{ ...env("pde-one"), environmentType: "Production" }, "Production"],
    [{ ...env("pde-one"), isManaged: false }, "not managed"],
    [undefined, "not returned"],
  ])("rejects a displayed but ineligible/unverified parent before any impact or direct read", async (environment, reason) => {
    inventory.mockResolvedValue({ ok: true, data: {
      apps: [app("selected")], environments: environment ? [environment] : [],
      groups: [group("destination")], excludedApps: 0,
    } });
    const result = await preparePdeMoves([{ environmentId: "pde-one" }], "destination");
    expect(result.ok && result.data.pdes[0].status).toBe("error");
    expect(result.ok && result.data.pdes[0].error).toContain(reason);
    expect(resources).not.toHaveBeenCalled(); expect(directRead).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("deduplicates PDEs and includes unselected and non-board sibling apps", async () => {
    const result = await preparePdeMoves([{ environmentId: "PDE-ONE", appId: "selected" }, { environmentId: "pde-one", appId: "unselected" }], "destination");
    expect(result.ok && result.data.pdes).toHaveLength(1);
    expect(result.ok && result.data.pdes[0].apps.map((item) => item.id)).toEqual(["selected", "unselected", "canvas-sibling"]);
    expect(inventory).toHaveBeenCalledWith(true, undefined);
    expect(resources).toHaveBeenCalledTimes(1);
    expect(result.ok && result.data.pdes[0].connectors.map((connector) => connector.id)).toEqual(["teams"]);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("reports already-member, prepared and per-PDE failures without success-shaped writes", async () => {
    inventory.mockResolvedValue({ ok: true, data: {
      apps: [], environments: [env("already", "destination"), env("ready"), env("denied")],
      groups: [group("destination")], excludedApps: 0,
    } });
    resources.mockImplementation((id: string) => Promise.resolve(id === "denied" ? { ok: false, error: "Resource read denied" } : { ok: true, data: [] }));
    memberships.mockImplementation(async (ids: string[]) => ({ ok: true, data: ids.map((id) => env(id, id === "already" ? "destination" : "source")) }));
    const result = await preparePdeMoves(["already", "ready", "denied"].map((environmentId) => ({ environmentId })), "destination");
    expect(result.ok && result.data.pdes.map((pde) => pde.status)).toEqual(["already-member", "prepared", "error"]);
    expect(result.ok && result.data.pdes[2].error).toBe("Resource read denied");
  });
  it("invalidates disappeared selections and between-read app changes", async () => {
    const missing = await preparePdeMoves([{ environmentId: "pde-one", appId: "gone" }], "destination");
    expect(missing.ok && missing.data.pdes[0].status).toBe("error");
    resources.mockResolvedValue({ ok: true, data: [app("selected")] });
    const drift = await preparePdeMoves([{ environmentId: "pde-one", appId: "selected" }], "destination");
    expect(drift.ok && drift.data.pdes[0].error).toContain("changed between");
  });
  it("rejects a stale destination before reading resource impact", async () => {
    expect((await preparePdeMoves([{ environmentId: "pde-one" }], "removed-group")).ok).toBe(false);
    expect(resources).not.toHaveBeenCalled();
  });
  it("uses direct membership for source evidence when inventory grouping lags", async () => {
    memberships.mockResolvedValue({ ok: true, data: [env("pde-one", "changed-group")] });
    directRead.mockResolvedValue({ success: true, data: { id: "pde-one", state: "Enabled", type: "Developer", dataverseId: "synthetic-db", environmentGroupId: "source" } });
    const result = await preparePdeMoves([{ environmentId: "pde-one", appId: "selected" }], "destination");
    expect(result.ok && result.data.pdes[0].status).toBe("prepared");
    expect(result.ok && result.data.pdes[0].environment?.environmentGroupId).toBe("source");
    expect(result.ok && result.data.pdes[0].sourceEvidence?.groupId).toBe("source");
  });
  it("prepares the directly observed new source rather than reusing the stale inventory source", async () => {
    directRead.mockResolvedValue({ success: true, data: { id: "pde-one", state: "Enabled", type: "Developer", dataverseId: "synthetic-db", environmentGroupId: "destination" } });
    const result = await preparePdeMoves([{ environmentId: "pde-one" }], "source");
    expect(result.ok && result.data.pdes[0].environment?.environmentGroupId).toBe("destination");
    expect(result.ok && result.data.pdes[0].sourceEvidence?.groupId).toBe("destination");
  });
  it("does not show complete-looking apps if final membership verification fails", async () => {
    memberships.mockResolvedValue({ ok: false, error: "Final read denied" });
    const result = await preparePdeMoves([{ environmentId: "pde-one" }], "destination");
    expect(result.ok && result.data.pdes[0].error).toContain("Final read denied");
    expect(result.ok && result.data.pdes[0].resourceCount).toBe(0);
  });
  it("keeps invalid mixed selection explicit rather than dropping an unknown PDE identity", async () => {
    const result = await preparePdeMoves([{ environmentId: "pde-one" }, { environmentId: "" }], "destination");
    expect(result.ok).toBe(false);
    expect(inventory).not.toHaveBeenCalled();
  });
  it("cancels before policy fanout when a preview closes during resource reads", async () => {
    const controller = new AbortController();
    resources.mockImplementation(async () => {
      controller.abort();
      return { ok: true, data: [app("selected"), app("unselected")] };
    });
    expect((await preparePdeMoves([{ environmentId: "pde-one" }], "destination", controller.signal)).ok).toBe(false);
    expect(memberships).not.toHaveBeenCalled();
    expect(policies).not.toHaveBeenCalled();
  });
});
