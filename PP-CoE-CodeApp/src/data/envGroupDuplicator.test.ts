/**
 * Tests for `envGroupDuplicator.ts`:
 *   - `buildDuplicateRuleSetBody` — pure helper that re-shapes a source
 *     `RuleSetDto` into the POST body for `CreateRuleSet`.
 *   - `buildDuplicatePolicyRequest` — pure helper that builds the
 *     Model B `PolicyRequest` body.
 *
 * The orchestrator (`duplicateEnvironmentGroup`) is exercised through
 * the view's smoke test; here we focus on the pure logic that the UI
 * trusts to round-trip the source ruleset / policy correctly.
 */
import { describe, it, expect } from "vitest";
import {
  buildDuplicatePolicyRequest,
  buildDuplicateRuleSetBody,
} from "./envGroupDuplicator";
import type {
  Policy,
  RuleSetDto,
} from "../generated/models/PowerPlatformforAdminsV2Model";

const SOURCE: RuleSetDto = {
  id: "source-ruleset-guid",
  lastModified: "2026-02-03T21:59:58.4215366Z",
  environmentFilter: {
    type: "Include",
    values: [
      { id: "old-group-guid", type: "EnvironmentGroup" },
      { id: "extra-env-guid", type: "Environment" },
    ],
  },
  parameters: [
    {
      type: "Copilot",
      resourceType: "App",
      value: [{ id: "DisableAiGeneratedDescriptions", value: "false" }],
    },
    {
      type: "Sharing",
      resourceType: "UsersBot",
      value: [
        { id: "CanShareWithSecurityGroups", value: "excludeSharingToSecurityGroups" },
        { id: "MaximumShareLimit", value: "99" },
      ],
    },
  ],
};

const NEW_GROUP_ID = "new-group-guid";

describe("buildDuplicateRuleSetBody", () => {
  it("omits `id` — the server assigns it on CreateRuleSet", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID);
    expect(body.id).toBeUndefined();
  });

  it("replaces environmentFilter.values with a single EnvironmentGroup entry pointing at the new group", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID);
    expect(body.environmentFilter?.values).toEqual([
      { id: NEW_GROUP_ID, type: "EnvironmentGroup" },
    ]);
  });

  it("preserves environmentFilter.type from the source", () => {
    const body = buildDuplicateRuleSetBody(
      { ...SOURCE, environmentFilter: { type: "Exclude", values: [] } },
      NEW_GROUP_ID,
    );
    expect(body.environmentFilter?.type).toBe("Exclude");
  });

  it("defaults environmentFilter.type to Include when source has none", () => {
    const body = buildDuplicateRuleSetBody(
      { id: "src", parameters: [] },
      NEW_GROUP_ID,
    );
    expect(body.environmentFilter?.type).toBe("Include");
  });

  it("copies parameters verbatim", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID);
    expect(body.parameters).toEqual(SOURCE.parameters);
  });

  it("deep-clones parameters so caller mutations don't poison the source", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID);
    body.parameters![0].value![0].value = "true";
    expect(SOURCE.parameters![0].value![0].value).toBe("false");
  });

  it("omits server-managed `lastModified` so the server picks the timestamp", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID);
    expect(body.lastModified).toBeUndefined();
  });

  it("handles source rulesets with no parameters at all", () => {
    const body = buildDuplicateRuleSetBody({ id: "src" }, NEW_GROUP_ID);
    expect(body.parameters).toEqual([]);
  });

  it("throws when newGroupId is empty", () => {
    expect(() => buildDuplicateRuleSetBody(SOURCE, "")).toThrow(/newGroupId/);
  });

  it("emits `hasStagedChanges: true` — the server requires it to actually apply the ruleset", () => {
    // Regression: without this flag the create succeeds but the rules
    // never take effect on the group (verified live; the Power
    // Automate reference flow has to inject the same field).
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID) as Record<
      string,
      unknown
    >;
    expect(body.hasStagedChanges).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDuplicatePolicyRequest — Model B clone shape
// ---------------------------------------------------------------------------

const SOURCE_POLICY: Policy = {
  id: "src-policy-guid",
  tenantId: "tenant-guid",
  name: "Default Policy Name",
  lastModified: "2026-05-22T21:09:45Z",
  ruleSetCount: 1,
  ruleSets: [
    {
      id: "ConnectorManagement",
      version: "1.0",
      inputs: {
        AllowedConnectorList: [
          {
            AllowedConnector:
              "/providers/Microsoft.PowerApps/apis/shared_office365users",
            AllowedActions: ["MyProfile", "UserProfile"],
            AllowedActionsMode: "SomeAllowed",
            AllowedConnectionTypesMode: "AllAllowed",
          },
        ],
      },
    },
  ],
};

describe("buildDuplicatePolicyRequest", () => {
  it("uses the source name by default", () => {
    const body = buildDuplicatePolicyRequest(SOURCE_POLICY);
    expect(body.name).toBe("Default Policy Name");
  });

  it("respects a caller-provided name override (trimmed)", () => {
    const body = buildDuplicatePolicyRequest(SOURCE_POLICY, {
      name: "  My Custom Name  ",
    });
    expect(body.name).toBe("My Custom Name");
  });

  it("copies ruleSets verbatim", () => {
    const body = buildDuplicatePolicyRequest(SOURCE_POLICY);
    expect(body.ruleSets).toEqual(SOURCE_POLICY.ruleSets);
  });

  it("deep-clones ruleSets so caller mutations don't poison the source", () => {
    const body = buildDuplicatePolicyRequest(SOURCE_POLICY);
    (body.ruleSets![0].inputs as Record<string, unknown>).AllowedConnectorList = [];
    expect(
      (SOURCE_POLICY.ruleSets![0].inputs as Record<string, unknown>)
        .AllowedConnectorList,
    ).toBeDefined();
    expect(
      (
        (SOURCE_POLICY.ruleSets![0].inputs as Record<string, unknown>)
          .AllowedConnectorList as unknown[]
      ).length,
    ).toBe(1);
  });

  it("drops server-managed fields (id, tenantId, lastModified, ruleSetCount)", () => {
    const body = buildDuplicatePolicyRequest(SOURCE_POLICY) as Record<
      string,
      unknown
    >;
    expect(body.id).toBeUndefined();
    expect(body.tenantId).toBeUndefined();
    expect(body.lastModified).toBeUndefined();
    expect(body.ruleSetCount).toBeUndefined();
  });

  it("handles a source policy with no ruleSets", () => {
    const body = buildDuplicatePolicyRequest({
      id: "x",
      name: "Empty",
    });
    expect(body.ruleSets).toEqual([]);
  });

  it("throws when no name can be resolved", () => {
    expect(() =>
      buildDuplicatePolicyRequest({ id: "x" }, { name: "" }),
    ).toThrow(/name/i);
    expect(() => buildDuplicatePolicyRequest({ id: "x" })).toThrow(/name/i);
  });
});
