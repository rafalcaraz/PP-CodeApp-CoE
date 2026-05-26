/**
 * Tests for the pure helpers in `dlpImpact.ts`.
 *
 * The connector-bound `runImpactQuery` is intentionally NOT tested here
 * — it would require mocking runQuery's whole pipeline. The picker /
 * scope / variant helpers below are pure and constitute the highest-
 * value coverage in this file: they're what the DLP Impact view UI
 * branches on, so silent regressions show up as bad picker rows or
 * wrong env-scope queries.
 */
import { describe, it, expect } from "vitest";
import {
  connectorIdVariants,
  countExcludedConnectors,
  extractHiddenConnectors,
  extractNonBlockedConnectors,
  resolveDlpScope,
  synthesizeFreeformConnectorOption,
} from "./dlpImpact";
import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";

function policy(overrides: Partial<PolicyV2> = {}): PolicyV2 {
  return {
    defaultConnectorsClassification: "General",
    environmentType: "AllEnvironments",
    environments: [],
    connectorGroups: [],
    ...(overrides as object),
  } as PolicyV2;
}

function connector(
  id: string,
  name: string,
  type = "Microsoft",
): { id: string; name: string; _type: string } {
  return { id: `/providers/Microsoft.PowerApps/apis/${id}`, name, _type: type };
}

// ---------------------------------------------------------------------------
// extractNonBlockedConnectors — picker rows
// ---------------------------------------------------------------------------

describe("extractNonBlockedConnectors", () => {
  it("returns empty list for an empty policy", () => {
    expect(extractNonBlockedConnectors(policy())).toEqual([]);
  });

  it("includes Confidential and General connectors only (skips Blocked)", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "Confidential",
          connectors: [connector("shared_sql", "SQL Server")],
        },
        {
          classification: "General",
          connectors: [connector("shared_sharepoint", "SharePoint")],
        },
        {
          classification: "Blocked",
          connectors: [connector("shared_dropbox", "Dropbox")],
        },
      ],
    });
    const rows = extractNonBlockedConnectors(p);
    expect(rows.map((r) => r.id)).toEqual([
      "shared_sql",
      "shared_sharepoint",
    ]);
    // The Blocked row should not appear.
    expect(rows.find((r) => r.id === "shared_dropbox")).toBeUndefined();
  });

  it("skips Custom connectors", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "General",
          connectors: [connector("custom_one", "Mine", "Custom")],
        },
      ],
    });
    expect(extractNonBlockedConnectors(p)).toEqual([]);
  });

  it("normalizes ARM-path ids to inventory slugs", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "General",
          connectors: [connector("shared_sql", "SQL Server")],
        },
      ],
    });
    const [row] = extractNonBlockedConnectors(p);
    expect(row.id).toBe("shared_sql");
    expect(row.rawId).toContain("/providers/");
  });

  it("dedupes by slug (first-seen wins)", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "Confidential",
          connectors: [connector("shared_sql", "SQL First")],
        },
        {
          classification: "General",
          connectors: [connector("shared_sql", "SQL Dup")],
        },
      ],
    });
    const rows = extractNonBlockedConnectors(p);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("SQL First");
    expect(rows[0].classification).toBe("Confidential");
  });

  it("sorts Confidential before General, then alphabetical within group", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "General",
          connectors: [
            connector("shared_z", "Zeta"),
            connector("shared_a", "Alpha"),
          ],
        },
        {
          classification: "Confidential",
          connectors: [
            connector("shared_y", "Yankee"),
            connector("shared_b", "Bravo"),
          ],
        },
      ],
    });
    const names = extractNonBlockedConnectors(p).map((r) => r.name);
    expect(names).toEqual(["Bravo", "Yankee", "Alpha", "Zeta"]);
  });

  it("tags rows as source=explicit (they came from connectorGroups)", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "General",
          connectors: [connector("shared_sql", "SQL Server")],
        },
      ],
    });
    expect(extractNonBlockedConnectors(p)[0].source).toBe("explicit");
  });
});

// ---------------------------------------------------------------------------
// countExcludedConnectors
// ---------------------------------------------------------------------------

describe("countExcludedConnectors", () => {
  it("counts Blocked + Custom separately", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "Blocked",
          connectors: [
            connector("shared_dropbox", "Dropbox"),
            connector("shared_box", "Box"),
          ],
        },
        {
          classification: "General",
          connectors: [
            connector("custom_a", "A", "Custom"),
            connector("shared_sharepoint", "SharePoint"), // not counted
          ],
        },
      ],
    });
    expect(countExcludedConnectors(p)).toEqual({ blocked: 2, custom: 1 });
  });

  it("counts a custom connector inside a Blocked group as Custom (custom wins)", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "Blocked",
          connectors: [connector("custom_blocked", "Mine", "Custom")],
        },
      ],
    });
    expect(countExcludedConnectors(p)).toEqual({ blocked: 0, custom: 1 });
  });
});

// ---------------------------------------------------------------------------
// extractHiddenConnectors
// ---------------------------------------------------------------------------

describe("extractHiddenConnectors", () => {
  it("emits hidden rows for Blocked AND Custom; skips Confidential/General Microsoft connectors", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "Blocked",
          connectors: [connector("shared_dropbox", "Dropbox")],
        },
        {
          classification: "General",
          connectors: [
            connector("custom_x", "Custom X", "Custom"),
            connector("shared_visible", "Visible Microsoft"),
          ],
        },
      ],
    });
    const hidden = extractHiddenConnectors(p);
    expect(hidden.map((r) => r.id)).toEqual(["shared_dropbox", "custom_x"]);
  });

  it("labels Custom-in-Blocked as `custom` (custom wins)", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "Blocked",
          connectors: [connector("custom_blocked", "Mine", "Custom")],
        },
      ],
    });
    const [row] = extractHiddenConnectors(p);
    expect(row.reason).toBe("custom");
  });

  it("sorts: blocked rows first, then custom; alphabetical within group", () => {
    const p = policy({
      connectorGroups: [
        {
          classification: "Blocked",
          connectors: [
            connector("shared_zeta", "Zeta"),
            connector("shared_alpha", "Alpha"),
          ],
        },
        {
          classification: "General",
          connectors: [
            connector("custom_b", "Bravo Custom", "Custom"),
            connector("custom_a", "Alpha Custom", "Custom"),
          ],
        },
      ],
    });
    const names = extractHiddenConnectors(p).map((r) => r.name);
    expect(names).toEqual(["Alpha", "Zeta", "Alpha Custom", "Bravo Custom"]);
  });
});

// ---------------------------------------------------------------------------
// synthesizeFreeformConnectorOption
// ---------------------------------------------------------------------------

describe("synthesizeFreeformConnectorOption", () => {
  it("uses the policy's defaultConnectorsClassification as the before-bucket", () => {
    const p = policy({ defaultConnectorsClassification: "Blocked" });
    const row = synthesizeFreeformConnectorOption(p, "shared_unknown");
    expect(row.classification).toBe("Blocked");
    expect(row.source).toBe("default");
    expect(row.rawId).toBe(""); // not present in connectorGroups
  });

  it("defaults to General when no defaultConnectorsClassification is set", () => {
    const p = { connectorGroups: [], environmentType: "AllEnvironments", environments: [] } as unknown as PolicyV2;
    const row = synthesizeFreeformConnectorOption(p, "shared_unknown");
    expect(row.classification).toBe("General");
  });
});

// ---------------------------------------------------------------------------
// resolveDlpScope
// ---------------------------------------------------------------------------

describe("resolveDlpScope", () => {
  it("AllEnvironments → mode 'all', no env ids", () => {
    expect(
      resolveDlpScope(policy({ environmentType: "AllEnvironments" })),
    ).toEqual({ mode: "all", envIds: [], rawType: "AllEnvironments" });
  });

  it("OnlyEnvironments → mode 'include' with normalized env ids", () => {
    const p = policy({
      environmentType: "OnlyEnvironments",
      environments: [
        { id: "/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/abc123" },
        { name: "DEF-456" },
      ],
    } as Partial<PolicyV2>);
    expect(resolveDlpScope(p)).toEqual({
      mode: "include",
      envIds: ["abc123", "def-456"],
      rawType: "OnlyEnvironments",
    });
  });

  it("SingleEnvironment → mode 'include' (treated like OnlyEnvironments)", () => {
    const p = policy({
      environmentType: "SingleEnvironment",
      environments: [{ name: "solo-env" }],
    } as Partial<PolicyV2>);
    expect(resolveDlpScope(p).mode).toBe("include");
  });

  it("ExceptEnvironments → mode 'exclude' with normalized env ids", () => {
    const p = policy({
      environmentType: "ExceptEnvironments",
      environments: [{ name: "skip-me" }],
    } as Partial<PolicyV2>);
    expect(resolveDlpScope(p)).toEqual({
      mode: "exclude",
      envIds: ["skip-me"],
      rawType: "ExceptEnvironments",
    });
  });

  it("missing environmentType defaults to AllEnvironments", () => {
    const p = { environments: [] } as unknown as PolicyV2;
    expect(resolveDlpScope(p).mode).toBe("all");
  });

  it("filters out empty env ids from the policy.environments[] list", () => {
    const p = policy({
      environmentType: "OnlyEnvironments",
      environments: [{ name: "" }, { id: "" }, { name: "real-env" }],
    } as Partial<PolicyV2>);
    expect(resolveDlpScope(p).envIds).toEqual(["real-env"]);
  });
});

// ---------------------------------------------------------------------------
// connectorIdVariants
// ---------------------------------------------------------------------------

describe("connectorIdVariants", () => {
  it("emits the prefixed AND bare form from a `shared_` slug", () => {
    expect(connectorIdVariants("shared_sql")).toEqual(["shared_sql", "sql"]);
  });

  it("emits the prefixed form for a bare slug (and includes the bare form once)", () => {
    expect(connectorIdVariants("sql")).toEqual(["shared_sql", "sql"]);
  });

  it("normalizes case + whitespace before generating variants", () => {
    expect(connectorIdVariants("  SHARED_SQL  ")).toEqual([
      "shared_sql",
      "sql",
    ]);
  });

  it("returns empty array for empty / whitespace input", () => {
    expect(connectorIdVariants("")).toEqual([]);
    expect(connectorIdVariants("   ")).toEqual([]);
  });

  it("dedupes when the bare form equals the input (e.g. someone types `shared_`)", () => {
    expect(connectorIdVariants("shared_")).toEqual(["shared_"]);
  });
});
