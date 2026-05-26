/**
 * Unit tests for `diffDlpPolicies`.
 *
 * The diff is pure (no React, no connector), so all we need is to hand
 * it two `PolicyV2`-shaped objects and pin the result. These tests
 * focus on the trickier branches that are easy to regress:
 *
 *  - default-vs-explicit source tagging
 *  - connectors falling through to `defaultConnectorsClassification`
 *  - sort order (differing rows first, then alphabetical)
 *  - env-list set diff with the `usesEnvListA/B` flag
 *  - scope and summary metadata
 */
import { describe, it, expect } from "vitest";
import { diffDlpPolicies } from "./dlpDiff";
import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";

type Policy = PolicyV2;

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    policyDefinition: {
      name: "p1",
      displayName: "Policy 1",
      defaultConnectorsClassification: "General",
      connectorGroups: [],
      environmentType: "AllEnvironments",
      environments: [],
    },
    ...(overrides as object),
    // PolicyV2 nests under policyDefinition in some shapes; the diff
    // reads flat fields directly. Spread overrides at the top level so
    // tests can pass `{ defaultConnectorsClassification: "Blocked" }`
    // and have it land where the diff actually looks.
    defaultConnectorsClassification: "General",
    environmentType: "AllEnvironments",
    environments: [],
    connectorGroups: [],
    ...(overrides as Policy),
  } as Policy;
}

function connector(
  id: string,
  classification: "General" | "Confidential" | "Blocked",
  name = id,
): Policy {
  return policy({
    connectorGroups: [
      {
        classification,
        connectors: [{ id, name, _type: "Microsoft.PowerApps/apis" }],
      },
    ],
  } as Partial<Policy>);
}

describe("diffDlpPolicies — defaults & summary", () => {
  it("flags identical default classifications as same", () => {
    const result = diffDlpPolicies(policy(), policy());
    expect(result.defaultA).toBe("General");
    expect(result.defaultB).toBe("General");
    expect(result.summary.defaultClassificationSame).toBe(true);
  });

  it("flags different default classifications", () => {
    const a = policy({ defaultConnectorsClassification: "Blocked" } as Partial<Policy>);
    const b = policy({ defaultConnectorsClassification: "General" } as Partial<Policy>);
    const result = diffDlpPolicies(a, b);
    expect(result.defaultA).toBe("Blocked");
    expect(result.defaultB).toBe("General");
    expect(result.summary.defaultClassificationSame).toBe(false);
  });

  it("counts matching vs differing connectors", () => {
    const a: Policy = policy({
      connectorGroups: [
        {
          classification: "Confidential",
          connectors: [
            { id: "shared_sql", name: "SQL Server", _type: "x" },
            { id: "shared_sharepoint", name: "SharePoint", _type: "x" },
          ],
        },
      ],
    } as Partial<Policy>);
    const b: Policy = policy({
      connectorGroups: [
        {
          classification: "Confidential",
          connectors: [{ id: "shared_sql", name: "SQL Server", _type: "x" }],
        },
        {
          classification: "Blocked",
          connectors: [
            { id: "shared_sharepoint", name: "SharePoint", _type: "x" },
          ],
        },
      ],
    } as Partial<Policy>);
    const result = diffDlpPolicies(a, b);
    expect(result.summary.totalConnectors).toBe(2);
    expect(result.summary.matchingConnectors).toBe(1);
    expect(result.summary.differingConnectors).toBe(1);
  });
});

describe("diffDlpPolicies — explicit vs default source", () => {
  it("tags a connector listed in A but not B as `default` on B", () => {
    const a = connector("shared_sql", "Confidential", "SQL Server");
    const b = policy({ defaultConnectorsClassification: "General" } as Partial<Policy>);
    const [row] = diffDlpPolicies(a, b).connectors;
    expect(row.sourceA).toBe("explicit");
    expect(row.sourceB).toBe("default");
    expect(row.bucketA).toBe("Confidential");
    expect(row.bucketB).toBe("General");
    expect(row.sameBucket).toBe(false);
  });

  it("treats two `default`-sourced classifications as same when defaults match", () => {
    // Connector listed only in one side but the other side's default
    // happens to match — sameBucket should still be true.
    const a = connector("shared_sql", "General", "SQL Server");
    const b = policy({ defaultConnectorsClassification: "General" } as Partial<Policy>);
    const [row] = diffDlpPolicies(a, b).connectors;
    expect(row.bucketA).toBe("General");
    expect(row.bucketB).toBe("General");
    expect(row.sameBucket).toBe(true);
  });
});

describe("diffDlpPolicies — sort order", () => {
  it("puts differing connectors before matching ones, alphabetically within group", () => {
    const a: Policy = policy({
      connectorGroups: [
        {
          classification: "Confidential",
          connectors: [
            { id: "alpha", name: "Alpha", _type: "x" },
            { id: "zeta", name: "Zeta", _type: "x" },
            { id: "bravo", name: "Bravo", _type: "x" },
          ],
        },
      ],
    } as Partial<Policy>);
    const b: Policy = policy({
      connectorGroups: [
        {
          classification: "Confidential",
          connectors: [
            { id: "alpha", name: "Alpha", _type: "x" },
            { id: "zeta", name: "Zeta", _type: "x" },
          ],
        },
        {
          classification: "Blocked",
          connectors: [{ id: "bravo", name: "Bravo", _type: "x" }],
        },
      ],
    } as Partial<Policy>);
    const names = diffDlpPolicies(a, b).connectors.map((c) => c.name);
    // 'Bravo' is the only differing row → goes first.
    expect(names[0]).toBe("Bravo");
    // The matching rows follow, alphabetized.
    expect(names.slice(1)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("diffDlpPolicies — scope", () => {
  it("flags `AllEnvironments` as not using the env list", () => {
    const a = policy({ environmentType: "AllEnvironments" } as Partial<Policy>);
    const b = policy({ environmentType: "OnlyEnvironments" } as Partial<Policy>);
    const { scope } = diffDlpPolicies(a, b);
    expect(scope.usesEnvListA).toBe(false);
    expect(scope.usesEnvListB).toBe(true);
    expect(scope.typeSame).toBe(false);
    expect(scope.typeA).toBe("AllEnvironments");
    expect(scope.typeB).toBe("OnlyEnvironments");
  });

  it("computes set diff over environments[] by id", () => {
    const a = policy({
      environmentType: "OnlyEnvironments",
      environments: [
        { id: "env1", name: "Prod", _type: "x" },
        { id: "env2", name: "Dev", _type: "x" },
      ],
    } as Partial<Policy>);
    const b = policy({
      environmentType: "OnlyEnvironments",
      environments: [
        { id: "env2", name: "Dev", _type: "x" },
        { id: "env3", name: "Test", _type: "x" },
      ],
    } as Partial<Policy>);
    const { scope, summary } = diffDlpPolicies(a, b);
    expect(scope.envsAOnly.map((e) => e.id)).toEqual(["env1"]);
    expect(scope.envsBOnly.map((e) => e.id)).toEqual(["env3"]);
    expect(scope.envsBoth.map((e) => e.id)).toEqual(["env2"]);
    // scopeSame requires BOTH same envType AND no env-list deltas.
    expect(summary.scopeSame).toBe(false);
  });

  it("flags scopeSame=true when env types match and env lists are identical", () => {
    const envList = [{ id: "env1", name: "Prod", _type: "x" }];
    const a = policy({
      environmentType: "OnlyEnvironments",
      environments: envList,
    } as Partial<Policy>);
    const b = policy({
      environmentType: "OnlyEnvironments",
      environments: envList,
    } as Partial<Policy>);
    expect(diffDlpPolicies(a, b).summary.scopeSame).toBe(true);
  });
});
