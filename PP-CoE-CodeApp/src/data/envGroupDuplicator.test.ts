/**
 * Tests for `envGroupDuplicator.ts`:
 *   - `buildDuplicateRuleSetBody` — pure helper that re-shapes a source
 *     `RuleSetDto` into the PUT body for a clone on a new env group.
 *   - `newRuleSetId` — thin wrapper over `crypto.randomUUID()` with a
 *     fallback shim for exotic test envs.
 *
 * The orchestrator (`duplicateEnvironmentGroup`) is exercised through
 * the view's smoke test; here we focus on the pure logic that the UI
 * trusts to round-trip the source ruleset correctly.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildDuplicatePolicyRequest,
  buildDuplicateRuleSetBody,
  newRuleSetId,
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
const NEW_RULESET_ID = "new-ruleset-guid";

describe("buildDuplicateRuleSetBody", () => {
  it("uses the caller-provided newRuleSetId as the body id", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID, NEW_RULESET_ID);
    expect(body.id).toBe(NEW_RULESET_ID);
  });

  it("replaces environmentFilter.values with a single EnvironmentGroup entry pointing at the new group", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID, NEW_RULESET_ID);
    expect(body.environmentFilter?.values).toEqual([
      { id: NEW_GROUP_ID, type: "EnvironmentGroup" },
    ]);
  });

  it("preserves environmentFilter.type from the source", () => {
    const body = buildDuplicateRuleSetBody(
      { ...SOURCE, environmentFilter: { type: "Exclude", values: [] } },
      NEW_GROUP_ID,
      NEW_RULESET_ID,
    );
    expect(body.environmentFilter?.type).toBe("Exclude");
  });

  it("defaults environmentFilter.type to Include when source has none", () => {
    const body = buildDuplicateRuleSetBody(
      { id: "src", parameters: [] },
      NEW_GROUP_ID,
      NEW_RULESET_ID,
    );
    expect(body.environmentFilter?.type).toBe("Include");
  });

  it("copies parameters verbatim", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID, NEW_RULESET_ID);
    expect(body.parameters).toEqual(SOURCE.parameters);
  });

  it("deep-clones parameters so caller mutations don't poison the source", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID, NEW_RULESET_ID);
    body.parameters![0].value![0].value = "true";
    expect(SOURCE.parameters![0].value![0].value).toBe("false");
  });

  it("omits server-managed `lastModified` so the server picks the timestamp", () => {
    const body = buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID, NEW_RULESET_ID);
    expect(body.lastModified).toBeUndefined();
  });

  it("handles source rulesets with no parameters at all", () => {
    const body = buildDuplicateRuleSetBody(
      { id: "src" },
      NEW_GROUP_ID,
      NEW_RULESET_ID,
    );
    expect(body.parameters).toEqual([]);
  });

  it("throws when newGroupId is empty", () => {
    expect(() => buildDuplicateRuleSetBody(SOURCE, "", NEW_RULESET_ID)).toThrow(
      /newGroupId/,
    );
  });

  it("throws when newRuleSetId is empty", () => {
    expect(() => buildDuplicateRuleSetBody(SOURCE, NEW_GROUP_ID, "")).toThrow(
      /newRuleSetId/,
    );
  });
});

describe("newRuleSetId", () => {
  it("uses crypto.randomUUID when available", () => {
    const spy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("11111111-2222-4333-8444-555555555555");
    try {
      expect(newRuleSetId()).toBe("11111111-2222-4333-8444-555555555555");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to a UUID-v4-shaped string when crypto.randomUUID is missing", () => {
    const originalCrypto = (globalThis as { crypto?: unknown }).crypto;
    // Force the fallback by hiding randomUUID.
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
      writable: true,
    });
    try {
      const id = newRuleSetId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    }
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
