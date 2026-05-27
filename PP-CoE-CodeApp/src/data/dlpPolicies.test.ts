/**
 * Phase 4 tests for `dlpPolicies.ts` — DLP scope-matching helpers.
 *
 * These pin the most subtle pure logic in the codebase: how a tenant
 * DLP policy decides whether it applies to a given environment, with
 * the ARM-path-vs-bare-GUID normalization quirks the platform throws
 * at us.
 *
 * The big test at the bottom uses a REAL captured `[DLP coverage]
 * evaluation` trace from a tenant as the golden oracle: we reconstruct
 * `PolicyV2[]` inputs from the trace, run them through
 * `evaluateDlpCoverage`, and assert the output matches the trace
 * field-for-field. If the matching predicate ever regresses, this
 * test will catch it.
 */
import { describe, it, expect } from "vitest";
import {
  buildDuplicatePolicyBody,
  evaluateDlpCoverage,
  normalizeEnvIdForScope,
  policyAppliesToEnvironment,
  policyEnvEntryId,
} from "./dlpPolicies";
import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";
import dlpTrace from "../test/fixtures/dlp-evaluation-trace.json";

// ---------------------------------------------------------------------------
// normalizeEnvIdForScope
// ---------------------------------------------------------------------------

describe("normalizeEnvIdForScope", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeEnvIdForScope("")).toBe("");
  });

  it("returns the input lowercased when it's already a bare GUID", () => {
    expect(
      normalizeEnvIdForScope("ABCD1234-1234-1234-1234-123456789012"),
    ).toBe("abcd1234-1234-1234-1234-123456789012");
  });

  it("strips ARM-path prefixes (the real platform shape)", () => {
    // This is the exact shape from the captured tenant trace.
    const arm =
      "/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/AAAAAAAA-1111-2222-3333-444444444444";
    expect(normalizeEnvIdForScope(arm)).toBe(
      "aaaaaaaa-1111-2222-3333-444444444444",
    );
  });

  it("trims whitespace and lowercases", () => {
    expect(normalizeEnvIdForScope("  /x/ABC-DEF  ")).toBe("abc-def");
  });
});

// ---------------------------------------------------------------------------
// policyEnvEntryId — prefers `name` over normalized `id`
// ---------------------------------------------------------------------------

describe("policyEnvEntryId", () => {
  it("uses `name` verbatim (lowercased) when present", () => {
    expect(policyEnvEntryId({ name: "ABC-Def", id: "/x/wrong" })).toBe(
      "abc-def",
    );
  });

  it("falls back to normalizing `id` when name is absent / blank", () => {
    expect(policyEnvEntryId({ id: "/x/ABC-Def" })).toBe("abc-def");
    expect(policyEnvEntryId({ name: "  ", id: "/x/ABC-Def" })).toBe("abc-def");
  });

  it("returns empty string when both are missing", () => {
    expect(policyEnvEntryId({})).toBe("");
  });
});

// ---------------------------------------------------------------------------
// policyAppliesToEnvironment — the actual scope predicate
// ---------------------------------------------------------------------------

function policy(
  overrides: Partial<PolicyV2> = {},
  envs: Array<{ id?: string; name?: string }> = [],
): PolicyV2 {
  return {
    environmentType: "AllEnvironments",
    environments: envs as PolicyV2["environments"],
    ...overrides,
  } as PolicyV2;
}

describe("policyAppliesToEnvironment", () => {
  const ENV_ID = "11111111-2222-3333-4444-555555555555";

  it("returns applies:false for empty envId", () => {
    const r = policyAppliesToEnvironment(policy(), "");
    expect(r).toEqual({ applies: false, reason: "none" });
  });

  it("AllEnvironments → applies to everything", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "AllEnvironments" }),
      ENV_ID,
    );
    expect(r).toEqual({ applies: true, reason: "all" });
  });

  it("missing / unknown environmentType → defaults to AllEnvironments", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "" }),
      ENV_ID,
    );
    expect(r.applies).toBe(true);
    expect(r.reason).toBe("all");
  });

  it("OnlyEnvironments + env in list → applies", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "OnlyEnvironments" }, [{ name: ENV_ID }]),
      ENV_ID,
    );
    expect(r).toEqual({ applies: true, reason: "included" });
  });

  it("OnlyEnvironments + env NOT in list → does not apply", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "OnlyEnvironments" }, [
        { name: "00000000-0000-0000-0000-000000000000" },
      ]),
      ENV_ID,
    );
    expect(r).toEqual({ applies: false, reason: "none" });
  });

  it("OnlyEnvironments resolves ARM-path ids on the policy side", () => {
    // The platform commonly emits the ARM-path in `id` with NO `name`.
    // The predicate must still match by stripping the prefix.
    const arm = `/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${ENV_ID}`;
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "OnlyEnvironments" }, [{ id: arm }]),
      ENV_ID,
    );
    expect(r).toEqual({ applies: true, reason: "included" });
  });

  it("SingleEnvironment behaves like OnlyEnvironments", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "SingleEnvironment" }, [{ name: ENV_ID }]),
      ENV_ID,
    );
    expect(r).toEqual({ applies: true, reason: "included" });
  });

  it("ExceptEnvironments + env NOT in list → applies (not-excluded)", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "ExceptEnvironments" }, [
        { name: "00000000-0000-0000-0000-000000000000" },
      ]),
      ENV_ID,
    );
    expect(r).toEqual({ applies: true, reason: "not-excluded" });
  });

  it("ExceptEnvironments + env in list → does NOT apply", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "ExceptEnvironments" }, [{ name: ENV_ID }]),
      ENV_ID,
    );
    expect(r).toEqual({ applies: false, reason: "none" });
  });

  it("unknown environmentType → conservative non-match", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "MysteryFutureScope" }, [{ name: ENV_ID }]),
      ENV_ID,
    );
    expect(r).toEqual({ applies: false, reason: "none" });
  });

  it("comparison is case-insensitive on the bare GUID", () => {
    const r = policyAppliesToEnvironment(
      policy({ environmentType: "OnlyEnvironments" }, [
        { name: ENV_ID.toUpperCase() },
      ]),
      ENV_ID.toLowerCase(),
    );
    expect(r.applies).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateDlpCoverage — golden-oracle test
//
// We reconstruct PolicyV2[] inputs from a real captured tenant trace
// (anonymized), run them through evaluateDlpCoverage, and assert the
// output matches the captured trace field-for-field.
// ---------------------------------------------------------------------------

interface TraceEntry {
  policyId: string;
  displayName: string;
  environmentType: string;
  applies: boolean;
  reason: string;
  targetEnvIdRaw: string;
  targetEnvIdNormalized: string;
  policyEnvIdsRaw: string[];
  policyEnvIdsNormalized: string[];
}

interface TraceFixture {
  envId: string;
  isManaged: boolean;
  environmentGroupId: string;
  appliedCount: number;
  totalPolicies: number;
  trace: TraceEntry[];
}

function policiesFromTrace(trace: TraceEntry[]): PolicyV2[] {
  return trace.map(
    (t) =>
      ({
        name: t.policyId,
        displayName: t.displayName,
        environmentType: t.environmentType,
        // Reconstruct the environments[] using only `id` (the platform
        // shape we observed — `name` was not populated, which is why
        // the trace's normalization was meaningful).
        environments: t.policyEnvIdsRaw.map((id) => ({ id })),
      }) as unknown as PolicyV2,
  );
}

describe("evaluateDlpCoverage — golden oracle from captured trace", () => {
  const fixture = dlpTrace as unknown as TraceFixture;

  it("recreates the exact trace from the captured tenant evaluation", () => {
    const policies = policiesFromTrace(fixture.trace);
    const result = evaluateDlpCoverage(policies, fixture.envId);

    // Shape: same number of entries (one per policy).
    expect(result).toHaveLength(fixture.trace.length);

    // Per-entry: compare the diagnostic fields that the captured
    // production trace also exposes.
    for (let i = 0; i < fixture.trace.length; i++) {
      const expected = fixture.trace[i];
      const actual = result[i];
      expect(actual.policyId).toBe(expected.policyId);
      expect(actual.displayName).toBe(expected.displayName);
      expect(actual.environmentType).toBe(expected.environmentType);
      expect(actual.applies).toBe(expected.applies);
      expect(actual.reason).toBe(expected.reason);
      expect(actual.targetEnvIdRaw).toBe(expected.targetEnvIdRaw);
      expect(actual.targetEnvIdNormalized).toBe(expected.targetEnvIdNormalized);
      expect(actual.policyEnvIdsRaw).toEqual(expected.policyEnvIdsRaw);
      expect(actual.policyEnvIdsNormalized).toEqual(
        expected.policyEnvIdsNormalized,
      );
    }
  });

  it("matches the captured appliedCount", () => {
    const policies = policiesFromTrace(fixture.trace);
    const result = evaluateDlpCoverage(policies, fixture.envId);
    const applied = result.filter((r) => r.applies);
    expect(applied).toHaveLength(fixture.appliedCount);
  });

  it("puts the applying policy first in the sort order", () => {
    const policies = policiesFromTrace(fixture.trace);
    const result = evaluateDlpCoverage(policies, fixture.envId);
    expect(result[0].applies).toBe(true);
    // Everything after the applying ones is sorted alphabetically.
    const tail = result.filter((r) => !r.applies);
    const sorted = [...tail].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    expect(tail).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// buildDuplicatePolicyBody — DLP Duplicator request shape
// ---------------------------------------------------------------------------

describe("buildDuplicatePolicyBody", () => {
  const source: PolicyV2 = {
    name: "source-policy-guid",
    displayName: "Source Policy",
    defaultConnectorsClassification: "General",
    connectorGroups: [
      {
        classification: "Confidential",
        connectors: [
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_office365",
            name: "shared_office365",
            _type: "Microsoft.PowerApps/apis",
          },
        ],
      },
      {
        classification: "General",
        connectors: [
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_twitter",
            name: "shared_twitter",
            _type: "Microsoft.PowerApps/apis",
          },
        ],
      },
    ],
    environmentType: "AllEnvironments",
    environments: [],
    createdBy: {},
    createdTime: "",
    lastModifiedBy: {},
    lastModifiedTime: "",
    isLegacySchemaVersion: false,
  };

  const ENV_A = "aaaaaaaa-1111-2222-3333-444444444444";
  const ENV_B = "bbbbbbbb-1111-2222-3333-444444444444";

  it("forces environmentType to OnlyEnvironments", () => {
    const body = buildDuplicatePolicyBody(source, {
      displayName: "Copy of Source",
      environmentIds: [ENV_A],
    });
    expect(body.environmentType).toBe("OnlyEnvironments");
  });

  it("uses the caller-provided displayName (trimmed)", () => {
    const body = buildDuplicatePolicyBody(source, {
      displayName: "  My Copy  ",
      environmentIds: [ENV_A],
    });
    expect(body.displayName).toBe("My Copy");
  });

  it("copies defaultConnectorsClassification from source", () => {
    const body = buildDuplicatePolicyBody(
      { ...source, defaultConnectorsClassification: "Blocked" },
      { displayName: "X", environmentIds: [ENV_A] },
    );
    expect(body.defaultConnectorsClassification).toBe("Blocked");
  });

  it("defaults defaultConnectorsClassification to General when source is missing it", () => {
    const body = buildDuplicatePolicyBody(
      { ...source, defaultConnectorsClassification: "" as unknown as string },
      { displayName: "X", environmentIds: [ENV_A] },
    );
    expect(body.defaultConnectorsClassification).toBe("General");
  });

  it("deep-clones connectorGroups so caller mutations don't poison the source", () => {
    const body = buildDuplicatePolicyBody(source, {
      displayName: "X",
      environmentIds: [ENV_A],
    });
    expect(body.connectorGroups).toEqual(source.connectorGroups);
    // Mutate the clone — original must be untouched.
    body.connectorGroups![0].connectors[0].name = "mutated";
    expect(source.connectorGroups[0].connectors[0].name).toBe(
      "shared_office365",
    );
  });

  it("emits the connector-expected environment shape for each picked id", () => {
    const body = buildDuplicatePolicyBody(source, {
      displayName: "X",
      environmentIds: [ENV_A, ENV_B],
    });
    expect(body.environments).toEqual([
      {
        id: `/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${ENV_A}`,
        name: ENV_A,
        _type: "Microsoft.BusinessAppPlatform/scopes/environments",
      },
      {
        id: `/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${ENV_B}`,
        name: ENV_B,
        _type: "Microsoft.BusinessAppPlatform/scopes/environments",
      },
    ]);
  });

  it("filters out blank / whitespace-only environment ids", () => {
    const body = buildDuplicatePolicyBody(source, {
      displayName: "X",
      environmentIds: [ENV_A, "", "  ", ENV_B],
    });
    expect(body.environments).toHaveLength(2);
    expect(body.environments![0].name).toBe(ENV_A);
    expect(body.environments![1].name).toBe(ENV_B);
  });

  it("throws when displayName is empty / whitespace", () => {
    expect(() =>
      buildDuplicatePolicyBody(source, {
        displayName: "   ",
        environmentIds: [ENV_A],
      }),
    ).toThrow(/displayName/);
  });

  it("throws when no environment ids are provided", () => {
    expect(() =>
      buildDuplicatePolicyBody(source, {
        displayName: "X",
        environmentIds: [],
      }),
    ).toThrow(/environment/i);
  });

  it("throws when all environment ids are blank", () => {
    expect(() =>
      buildDuplicatePolicyBody(source, {
        displayName: "X",
        environmentIds: ["", "   "],
      }),
    ).toThrow(/environment/i);
  });
});
