/**
 * Unit tests for the Standard custom group ↔ DLP policy drift math.
 *
 * The drift summary is the most user-visible derived quantity in the
 * linked-DLP feature, and the most likely to silently regress
 * (especially with the four different `environmentType` scope values
 * the connector emits). Pin the behavior here so changes to
 * `policyAppliesToEnvironment` or `policyEnvEntryId` don't quietly
 * change what users see on the group detail page.
 */
import { describe, it, expect } from "vitest";
import { computeStandardGroupDlpDrift } from "./standardGroupDlpDrift";
import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";
import type { EnvironmentRow } from "./inventory";

function env(id: string, displayName: string): EnvironmentRow {
  return {
    id,
    displayName,
    environmentType: "Standard",
    region: "unitedstates",
    isManaged: false,
    createdAt: "",
    createdBy: "",
    lastModifiedAt: "",
    environmentGroupId: "",
    environmentGroup: "",
    tenantId: "",
  };
}

function policy(
  overrides: Partial<PolicyV2> & Pick<PolicyV2, "name">,
): PolicyV2 {
  return {
    name: overrides.name,
    displayName: overrides.displayName ?? "Test policy",
    defaultConnectorsClassification:
      overrides.defaultConnectorsClassification ?? "General",
    connectorGroups: overrides.connectorGroups ?? [],
    environmentType: overrides.environmentType ?? "AllEnvironments",
    environments: overrides.environments ?? [],
    createdBy: overrides.createdBy ?? { displayName: "", id: "" },
    createdTime: overrides.createdTime ?? "",
    lastModifiedBy: overrides.lastModifiedBy ?? { displayName: "", id: "" },
    lastModifiedTime: overrides.lastModifiedTime ?? "",
    isLegacySchemaVersion: overrides.isLegacySchemaVersion ?? false,
  };
}

// Build a `policy.environments[]` entry without spelling out the
// generated shape (`_type` is the connector's field name).
function envEntry(name: string) {
  return {
    id: `/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${name}`,
    name,
    _type: "Microsoft.BusinessAppPlatform/scopes/environments",
  };
}

describe("computeStandardGroupDlpDrift — AllEnvironments scope", () => {
  it("treats every env in the group as covered and flags scope as broad", () => {
    const p = policy({ name: "p1", environmentType: "AllEnvironments" });
    const a = env("env-a", "A");
    const b = env("env-b", "B");
    const drift = computeStandardGroupDlpDrift(p, [a, b], [a, b]);
    expect(drift.coveredInGroup.map((e) => e.id)).toEqual(["env-a", "env-b"]);
    expect(drift.uncoveredInGroup).toEqual([]);
    expect(drift.inPolicyNotInGroup).toEqual([]);
    expect(drift.scopeIsBroad).toBe(true);
  });
});

describe("computeStandardGroupDlpDrift — OnlyEnvironments scope", () => {
  it("splits group envs into covered/uncovered based on policy.environments[]", () => {
    const p = policy({
      name: "p2",
      environmentType: "OnlyEnvironments",
      environments: [envEntry("env-a")],
    });
    const a = env("env-a", "A");
    const b = env("env-b", "B");
    const drift = computeStandardGroupDlpDrift(p, [a, b], [a, b]);
    expect(drift.coveredInGroup.map((e) => e.id)).toEqual(["env-a"]);
    expect(drift.uncoveredInGroup.map((e) => e.id)).toEqual(["env-b"]);
    expect(drift.inPolicyNotInGroup).toEqual([]);
    expect(drift.scopeIsBroad).toBe(false);
  });

  it("flags policy envs that aren't in the group, looked up in allEnvs", () => {
    const p = policy({
      name: "p3",
      environmentType: "OnlyEnvironments",
      environments: [
        envEntry("env-a"),
        envEntry("env-c"), // not in group
        envEntry("env-deleted"), // not in tenant
      ],
    });
    const a = env("env-a", "A");
    const b = env("env-b", "B");
    const c = env("env-c", "C");
    const drift = computeStandardGroupDlpDrift(p, [a, b], [a, b, c]);
    expect(drift.coveredInGroup.map((e) => e.id)).toEqual(["env-a"]);
    expect(drift.uncoveredInGroup.map((e) => e.id)).toEqual(["env-b"]);
    // env-c is in policy but not in group, env-deleted is dropped
    // because it doesn't exist in allEnvs.
    expect(drift.inPolicyNotInGroup.map((e) => e.id)).toEqual(["env-c"]);
  });

  it("sorts inPolicyNotInGroup by display name", () => {
    const p = policy({
      name: "p4",
      environmentType: "OnlyEnvironments",
      environments: [envEntry("env-z"), envEntry("env-a"), envEntry("env-m")],
    });
    const z = env("env-z", "Zebra");
    const a = env("env-a", "Apple");
    const m = env("env-m", "Mango");
    const drift = computeStandardGroupDlpDrift(p, [], [z, a, m]);
    expect(drift.inPolicyNotInGroup.map((e) => e.displayName)).toEqual([
      "Apple",
      "Mango",
      "Zebra",
    ]);
  });
});

describe("computeStandardGroupDlpDrift — ExceptEnvironments scope", () => {
  it("treats non-excluded envs as covered and skips the in-policy-not-in-group list", () => {
    const p = policy({
      name: "p5",
      environmentType: "ExceptEnvironments",
      environments: [envEntry("env-b")],
    });
    const a = env("env-a", "A");
    const b = env("env-b", "B"); // explicitly excluded
    const drift = computeStandardGroupDlpDrift(p, [a, b], [a, b]);
    expect(drift.coveredInGroup.map((e) => e.id)).toEqual(["env-a"]);
    expect(drift.uncoveredInGroup.map((e) => e.id)).toEqual(["env-b"]);
    // Broad scope — we never enumerate "in-policy-not-in-group" here.
    expect(drift.inPolicyNotInGroup).toEqual([]);
    expect(drift.scopeIsBroad).toBe(true);
  });
});

describe("computeStandardGroupDlpDrift — empty group", () => {
  it("returns empty arrays and still surfaces extraneous policy envs", () => {
    const p = policy({
      name: "p6",
      environmentType: "OnlyEnvironments",
      environments: [envEntry("env-a")],
    });
    const a = env("env-a", "A");
    const drift = computeStandardGroupDlpDrift(p, [], [a]);
    expect(drift.coveredInGroup).toEqual([]);
    expect(drift.uncoveredInGroup).toEqual([]);
    expect(drift.inPolicyNotInGroup.map((e) => e.id)).toEqual(["env-a"]);
  });
});
