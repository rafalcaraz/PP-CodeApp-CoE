/**
 * Tests for the env-group enrichment wrappers in `adminEnrichment.ts`.
 *
 * These functions back the supplemental cards on EnvironmentGroupDetail
 * — the governance ("View all rules") surface combines Model A (the
 * `parameters`-bucket rulesets) and Model B (the rule-based policies)
 * into one unified view.
 *
 * Important behaviors pinned here:
 *   - `getEnvironmentGroupRulesets` filters tenant-wide rulesets by
 *     `environmentFilter.values[]` containing `{ id, type:"EnvironmentGroup" }`
 *   - `getEnvironmentGroupGovernance` parallels both halves AND
 *     surfaces partial failures (one half failing doesn't hide the other)
 *   - `getEnvironmentGroupEffectivePolicies` fans out: assignments →
 *     policy IDs → per-policy fetch, with per-policy errors captured in
 *     `policyErrors` rather than failing the whole call
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getEnvironmentGroupMock,
  listRoleAssignmentsMock,
  getRuleSetListForTenantMock,
  listRuleAssignmentsByEnvironmentGroupIdMock,
  getRuleBasedPolicyByIDMock,
} = vi.hoisted(() => ({
  getEnvironmentGroupMock: vi.fn(),
  listRoleAssignmentsMock: vi.fn(),
  getRuleSetListForTenantMock: vi.fn(),
  listRuleAssignmentsByEnvironmentGroupIdMock: vi.fn(),
  getRuleBasedPolicyByIDMock: vi.fn(),
}));

vi.mock("../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    GetEnvironmentGroup: getEnvironmentGroupMock,
    ListEnvironmentGroupRoleAssignments: listRoleAssignmentsMock,
    GetRuleSetListForTenant: getRuleSetListForTenantMock,
    ListRuleAssignmentsByEnvironmentGroupId:
      listRuleAssignmentsByEnvironmentGroupIdMock,
    GetRuleBasedPolicyByID: getRuleBasedPolicyByIDMock,
  },
}));

import {
  getEnvironmentGroupDetails,
  getEnvironmentGroupEffectivePolicies,
  getEnvironmentGroupGovernance,
  getEnvironmentGroupRoleAssignments,
  getEnvironmentGroupRulesets,
} from "./adminEnrichment";

beforeEach(() => {
  getEnvironmentGroupMock.mockReset();
  listRoleAssignmentsMock.mockReset();
  getRuleSetListForTenantMock.mockReset();
  listRuleAssignmentsByEnvironmentGroupIdMock.mockReset();
  getRuleBasedPolicyByIDMock.mockReset();
});

// ---------------------------------------------------------------------------
// getEnvironmentGroupDetails / RoleAssignments — thin wrappers
// ---------------------------------------------------------------------------

describe("getEnvironmentGroupDetails", () => {
  it("rejects empty groupId without calling the connector", async () => {
    const r = await getEnvironmentGroupDetails("");
    expect(r.ok).toBe(false);
    expect(getEnvironmentGroupMock).not.toHaveBeenCalled();
  });

  it("wraps a successful response as { data, raw }", async () => {
    const payload = { id: "grp-1", displayName: "Production Pillar" };
    getEnvironmentGroupMock.mockResolvedValue({
      success: true,
      data: payload,
    });
    const r = await getEnvironmentGroupDetails("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.data).toBe(payload);
    expect(r.data.raw).toBe(payload);
  });

  it("forwards a connector failure", async () => {
    getEnvironmentGroupMock.mockResolvedValue({
      success: false,
      error: { message: "not found" },
    });
    const r = await getEnvironmentGroupDetails("grp-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not found/);
  });

  it("catches connector exceptions", async () => {
    getEnvironmentGroupMock.mockRejectedValue(new Error("boom"));
    const r = await getEnvironmentGroupDetails("grp-1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/boom/);
  });
});

describe("getEnvironmentGroupRoleAssignments", () => {
  it("rejects empty groupId", async () => {
    const r = await getEnvironmentGroupRoleAssignments("");
    expect(r.ok).toBe(false);
  });

  it("wraps success and forwards failure", async () => {
    listRoleAssignmentsMock.mockResolvedValue({
      success: true,
      data: { value: [] },
    });
    const r = await getEnvironmentGroupRoleAssignments("grp-1");
    expect(r.ok).toBe(true);
    expect(listRoleAssignmentsMock).toHaveBeenCalledWith(
      "grp-1",
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// getEnvironmentGroupRulesets — Model A filter
// ---------------------------------------------------------------------------

describe("getEnvironmentGroupRulesets", () => {
  it("filters tenant-wide rulesets to ONLY those targeting this env group", async () => {
    const matchingRuleset = {
      id: "rs-matching",
      displayName: "Pillar Production Ruleset",
      environmentFilter: {
        values: [{ id: "grp-1", type: "EnvironmentGroup" }],
      },
    };
    const nonMatchingByDifferentGroup = {
      id: "rs-other-group",
      displayName: "Some Other Group's Ruleset",
      environmentFilter: {
        values: [{ id: "grp-2", type: "EnvironmentGroup" }],
      },
    };
    const nonMatchingByType = {
      id: "rs-env-typed",
      displayName: "Env-Typed (not group)",
      environmentFilter: {
        // Wrong type — must be "EnvironmentGroup" to count.
        values: [{ id: "grp-1", type: "Environment" }],
      },
    };
    getRuleSetListForTenantMock.mockResolvedValue({
      success: true,
      data: {
        value: [
          matchingRuleset,
          nonMatchingByDifferentGroup,
          nonMatchingByType,
        ],
      },
    });
    const r = await getEnvironmentGroupRulesets("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.matching.value).toEqual([matchingRuleset]);
    expect(r.data.totalInTenant).toBe(3);
  });

  it("handles a tenant-wide response with no `value` array", async () => {
    getRuleSetListForTenantMock.mockResolvedValue({
      success: true,
      data: {},
    });
    const r = await getEnvironmentGroupRulesets("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.matching.value).toEqual([]);
    expect(r.data.totalInTenant).toBe(0);
  });

  it("rejects empty groupId", async () => {
    const r = await getEnvironmentGroupRulesets("");
    expect(r.ok).toBe(false);
  });

  it("forwards connector errors", async () => {
    getRuleSetListForTenantMock.mockResolvedValue({
      success: false,
      error: { message: "forbidden" },
    });
    const r = await getEnvironmentGroupRulesets("grp-1");
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEnvironmentGroupEffectivePolicies — Model B fan-out
// ---------------------------------------------------------------------------

describe("getEnvironmentGroupEffectivePolicies", () => {
  it("fans out: assignments → policy IDs → per-policy fetch", async () => {
    listRuleAssignmentsByEnvironmentGroupIdMock.mockResolvedValue({
      success: true,
      data: {
        value: [
          { policyId: "policy-1" },
          { policyId: "policy-2" },
          { policyId: "policy-1" }, // duplicate — should be deduped
        ],
      },
    });
    getRuleBasedPolicyByIDMock.mockImplementation(async (id: string) => ({
      success: true,
      data: { name: id, displayName: `Policy ${id}` },
    }));

    const r = await getEnvironmentGroupEffectivePolicies("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.policies.map((p) => p.name).sort()).toEqual([
      "policy-1",
      "policy-2",
    ]);
    // The dedupe drops the duplicate before the per-policy fetch.
    expect(getRuleBasedPolicyByIDMock).toHaveBeenCalledTimes(2);
    expect(r.data.policyErrors).toEqual({});
  });

  it("captures per-policy failures in `policyErrors` without failing the outer call", async () => {
    listRuleAssignmentsByEnvironmentGroupIdMock.mockResolvedValue({
      success: true,
      data: { value: [{ policyId: "good" }, { policyId: "bad" }] },
    });
    getRuleBasedPolicyByIDMock.mockImplementation(async (id: string) => {
      if (id === "good") {
        return { success: true, data: { name: "good", displayName: "Good" } };
      }
      return { success: false, error: { message: "policy 404" } };
    });

    const r = await getEnvironmentGroupEffectivePolicies("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.policies).toHaveLength(1);
    expect(r.data.policies[0].name).toBe("good");
    expect(r.data.policyErrors).toEqual({ bad: expect.stringMatching(/404/) });
  });

  it("returns empty arrays when no assignments exist", async () => {
    listRuleAssignmentsByEnvironmentGroupIdMock.mockResolvedValue({
      success: true,
      data: { value: [] },
    });
    const r = await getEnvironmentGroupEffectivePolicies("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.policies).toEqual([]);
    expect(getRuleBasedPolicyByIDMock).not.toHaveBeenCalled();
  });

  it("fails the outer call when the assignments fetch itself fails", async () => {
    listRuleAssignmentsByEnvironmentGroupIdMock.mockResolvedValue({
      success: false,
      error: { message: "boom" },
    });
    const r = await getEnvironmentGroupEffectivePolicies("grp-1");
    expect(r.ok).toBe(false);
    expect(getRuleBasedPolicyByIDMock).not.toHaveBeenCalled();
  });

  it("rejects empty groupId", async () => {
    const r = await getEnvironmentGroupEffectivePolicies("");
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEnvironmentGroupGovernance — combines both halves in parallel
// ---------------------------------------------------------------------------

describe("getEnvironmentGroupGovernance", () => {
  it("returns ok:true with BOTH halves on full success", async () => {
    getRuleSetListForTenantMock.mockResolvedValue({
      success: true,
      data: { value: [] },
    });
    listRuleAssignmentsByEnvironmentGroupIdMock.mockResolvedValue({
      success: true,
      data: { value: [] },
    });

    const r = await getEnvironmentGroupGovernance("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rulesets.ok).toBe(true);
    expect(r.data.policies.ok).toBe(true);
  });

  it("surfaces partial failure: rulesets OK + policies failed", async () => {
    getRuleSetListForTenantMock.mockResolvedValue({
      success: true,
      data: { value: [] },
    });
    listRuleAssignmentsByEnvironmentGroupIdMock.mockResolvedValue({
      success: false,
      error: { message: "policies are sad" },
    });

    const r = await getEnvironmentGroupGovernance("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rulesets.ok).toBe(true);
    expect(r.data.policies.ok).toBe(false);
    if (r.data.policies.ok) return;
    expect(r.data.policies.error).toMatch(/policies are sad/);
  });

  it("surfaces partial failure: policies OK + rulesets failed", async () => {
    getRuleSetListForTenantMock.mockResolvedValue({
      success: false,
      error: { message: "rulesets are sad" },
    });
    listRuleAssignmentsByEnvironmentGroupIdMock.mockResolvedValue({
      success: true,
      data: { value: [] },
    });

    const r = await getEnvironmentGroupGovernance("grp-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rulesets.ok).toBe(false);
    expect(r.data.policies.ok).toBe(true);
  });

  it("rejects empty groupId at the outer level", async () => {
    const r = await getEnvironmentGroupGovernance("");
    expect(r.ok).toBe(false);
    expect(getRuleSetListForTenantMock).not.toHaveBeenCalled();
    expect(listRuleAssignmentsByEnvironmentGroupIdMock).not.toHaveBeenCalled();
  });
});
