/**
 * Unit tests for the pure helpers in `zoneMoveImpact.ts`.
 *
 * The async orchestrator (`analyzeZoneMoveAcpImpact`) is left untested
 * here — it's thin glue around `runRawQuery` +
 * `getEnvironmentGroupAcpStatus` + the pure helpers below. The pure
 * helpers carry every classification rule that the dialog branches on,
 * so they're the highest-value coverage:
 *
 *   - `extractUsedConnectors` — connector slug extraction across the
 *     known payload shapes (`powerPlatformConnectors`, `connectors`,
 *     `trigger.connectorId`)
 *   - `isConnectorAllowed` — cross-form match (`shared_sql` vs `sql`)
 *   - `buildZoneMoveImpactResult` — the three target-ACP lifecycle
 *     branches (not-configured / advisory / enforced) and the
 *     at-risk-first sort
 */
import { describe, it, expect } from "vitest";
import {
  bareFormAllowSet,
  buildZoneMoveImpactResult,
  classifyTargetAcpState,
  extractUsedConnectors,
  isConnectorAllowed,
  readPublishedConnectorIds,
  ZONE_MOVE_IMPACT_TOP_N,
  type ZoneMoveImpactRanAgainst,
} from "./zoneMoveImpact";
import type { AcpSnapshot } from "./acpDiff";
import type { ResourceItem } from "../generated/models/PowerPlatformforAdminsV2Model";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function canvasApp(args: {
  id: string;
  displayName: string;
  envId?: string;
  connectorIds?: string[]; // raw connectorId strings (ARM path or slug)
}): ResourceItem {
  return {
    name: args.id,
    type: "microsoft.powerapps/canvasapps",
    properties: {
      displayName: args.displayName,
      environmentId: args.envId ?? "env-A",
      powerPlatformConnectors: (args.connectorIds ?? []).map((cid) => ({
        connectorId: cid,
      })),
    },
  } as unknown as ResourceItem;
}

function cloudFlow(args: {
  id: string;
  displayName: string;
  envId?: string;
  connectorIds?: string[];
  triggerConnectorId?: string;
}): ResourceItem {
  const props: Record<string, unknown> = {
    displayName: args.displayName,
    environmentId: args.envId ?? "env-A",
    powerPlatformConnectors: (args.connectorIds ?? []).map((cid) => ({
      connectorId: cid,
    })),
  };
  if (args.triggerConnectorId) {
    props.trigger = { connectorId: args.triggerConnectorId };
  }
  return {
    name: args.id,
    type: "microsoft.powerautomate/cloudflows",
    properties: props,
  } as unknown as ResourceItem;
}

function appBuilderApp(args: {
  id: string;
  displayName: string;
  envId?: string;
  connectorIds?: string[]; // typically ARM-path style
}): ResourceItem {
  return {
    name: args.id,
    type: "microsoft.powerapps/apps",
    properties: {
      displayName: args.displayName,
      environmentId: args.envId ?? "env-A",
      connectors: (args.connectorIds ?? []).map((cid) => ({ connectorId: cid })),
    },
  } as unknown as ResourceItem;
}

function snapshot(args: {
  configured?: boolean;
  acpOnly?: boolean;
  allowedRawIds?: string[];
}): AcpSnapshot {
  return {
    configured: args.configured ?? true,
    acpOnly: args.acpOnly ?? false,
    allowed: (args.allowedRawIds ?? []).map((rawId) => {
      const idx = rawId.lastIndexOf("/");
      const slug = (idx >= 0 ? rawId.substring(idx + 1) : rawId).toLowerCase();
      return {
        id: slug,
        rawId,
        name: slug,
        allowedActionsMode: "AllAllowed" as const,
        allowedActions: [] as string[],
        allowedConnectionTypesMode: "AllAllowed" as const,
      };
    }),
  };
}

const RAN_AGAINST: ZoneMoveImpactRanAgainst = {
  envId: "env-A",
  envDisplayName: "Env A",
  targetGroupId: "grp-target",
  targetGroupDisplayName: "Target Group",
};

// ---------------------------------------------------------------------------
// readPublishedConnectorIds
// ---------------------------------------------------------------------------

describe("readPublishedConnectorIds", () => {
  it("extracts connectorIds from `powerPlatformConnectors[]`", () => {
    const item = canvasApp({
      id: "a1",
      displayName: "A1",
      connectorIds: ["shared_sql", "shared_sharepointonline"],
    });
    expect(readPublishedConnectorIds(item)).toEqual([
      "shared_sql",
      "shared_sharepointonline",
    ]);
  });

  it("extracts from `connectors[]` for app-builder apps (ARM path)", () => {
    const item = appBuilderApp({
      id: "ab1",
      displayName: "AB1",
      connectorIds: [
        "/providers/Microsoft.PowerApps/apis/shared_sql",
        "/providers/Microsoft.PowerApps/apis/shared_office365users",
      ],
    });
    // ARM paths get reduced to their last segment.
    expect(readPublishedConnectorIds(item)).toEqual([
      "shared_sql",
      "shared_office365users",
    ]);
  });

  it("includes the cloud-flow trigger connector", () => {
    const item = cloudFlow({
      id: "f1",
      displayName: "F1",
      connectorIds: ["sharepointonline"],
      triggerConnectorId: "outlook",
    });
    expect(readPublishedConnectorIds(item)).toEqual([
      "sharepointonline",
      "outlook",
    ]);
  });

  it("returns an empty array when no connectors are declared", () => {
    const item = canvasApp({ id: "a", displayName: "A" });
    expect(readPublishedConnectorIds(item)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractUsedConnectors
// ---------------------------------------------------------------------------

describe("extractUsedConnectors", () => {
  it("buckets by bare slug regardless of published prefix", () => {
    const items = [
      canvasApp({ id: "a1", displayName: "Canvas", connectorIds: ["shared_sql"] }),
      cloudFlow({ id: "f1", displayName: "Flow", connectorIds: ["sql"] }),
    ];
    const used = extractUsedConnectors(items);
    expect(used).toHaveLength(1);
    expect(used[0].slug).toBe("sql");
    expect(used[0].publishedForms.sort()).toEqual(["shared_sql", "sql"]);
    // Both resources land under the same bucket.
    expect(used[0].resources.map((r) => r.id).sort()).toEqual(["a1", "f1"]);
  });

  it("dedupes a single resource that declares the same connector twice (trigger + body)", () => {
    const items = [
      cloudFlow({
        id: "f1",
        displayName: "F1",
        connectorIds: ["sql"],
        triggerConnectorId: "shared_sql",
      }),
    ];
    const used = extractUsedConnectors(items);
    expect(used).toHaveLength(1);
    expect(used[0].resources).toHaveLength(1);
    expect(used[0].publishedForms.sort()).toEqual(["shared_sql", "sql"]);
  });

  it("sorts by friendly display name", () => {
    const items = [
      canvasApp({ id: "a1", displayName: "A", connectorIds: ["shared_sql"] }),
      canvasApp({
        id: "a2",
        displayName: "B",
        connectorIds: ["shared_office365users"],
      }),
    ];
    const used = extractUsedConnectors(items);
    // Friendly names: "Office 365 Users" < "SQL Server" alphabetically.
    expect(used.map((c) => c.slug)).toEqual(["office365users", "sql"]);
  });

  it("ignores resources with no connectors", () => {
    const items = [
      canvasApp({ id: "a1", displayName: "Empty" }),
      canvasApp({ id: "a2", displayName: "Real", connectorIds: ["shared_sql"] }),
    ];
    const used = extractUsedConnectors(items);
    expect(used).toHaveLength(1);
    expect(used[0].resources.map((r) => r.id)).toEqual(["a2"]);
  });

  it("returns an empty array when items is empty", () => {
    expect(extractUsedConnectors([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bareFormAllowSet + isConnectorAllowed — the shared_ cross-form match
// ---------------------------------------------------------------------------

describe("isConnectorAllowed (cross-form `shared_` match)", () => {
  it("matches a flow's bare `sql` against an ACP allow-list entry of `shared_sql`", () => {
    const snap = snapshot({
      allowedRawIds: ["/providers/Microsoft.PowerApps/apis/shared_sql"],
    });
    const allowSet = bareFormAllowSet(snap);
    expect(isConnectorAllowed("sql", allowSet)).toBe(true);
  });

  it("matches an app's prefixed `shared_sharepointonline` against an allow-list entry of `sharepointonline`", () => {
    // Constructed: allow-list bareForm becomes `sharepointonline`.
    const snap = snapshot({ allowedRawIds: ["sharepointonline"] });
    const allowSet = bareFormAllowSet(snap);
    expect(isConnectorAllowed("sharepointonline", allowSet)).toBe(true);
  });

  it("returns false when the connector is not in the allow-list (neither form)", () => {
    const snap = snapshot({
      allowedRawIds: [
        "/providers/Microsoft.PowerApps/apis/shared_office365users",
      ],
    });
    const allowSet = bareFormAllowSet(snap);
    expect(isConnectorAllowed("sql", allowSet)).toBe(false);
  });

  it("returns false for an empty slug regardless of allow-list contents", () => {
    const snap = snapshot({ allowedRawIds: ["shared_sql"] });
    expect(isConnectorAllowed("", bareFormAllowSet(snap))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyTargetAcpState
// ---------------------------------------------------------------------------

describe("classifyTargetAcpState", () => {
  it("returns `not-configured` when no ConnectorManagement rule is present", () => {
    expect(
      classifyTargetAcpState(snapshot({ configured: false }))
    ).toBe("not-configured");
  });

  it("returns `advisory` when configured but `acpOnly` is off", () => {
    expect(
      classifyTargetAcpState(
        snapshot({ configured: true, acpOnly: false, allowedRawIds: ["shared_sql"] })
      )
    ).toBe("advisory");
  });

  it("returns `enforced` when configured AND `acpOnly` is on", () => {
    expect(
      classifyTargetAcpState(
        snapshot({ configured: true, acpOnly: true, allowedRawIds: ["shared_sql"] })
      )
    ).toBe("enforced");
  });
});

// ---------------------------------------------------------------------------
// buildZoneMoveImpactResult — top-level shape
// ---------------------------------------------------------------------------

describe("buildZoneMoveImpactResult", () => {
  it("returns zero at-risk when target group has no ACP configured", () => {
    const used = extractUsedConnectors([
      canvasApp({ id: "a1", displayName: "Has SQL", connectorIds: ["shared_sql"] }),
    ]);
    const snap = snapshot({ configured: false });
    const result = buildZoneMoveImpactResult({
      used,
      totalResourcesScanned: 1,
      snapshot: snap,
      ranAgainst: RAN_AGAINST,
    });
    expect(result.targetAcpState).toBe("not-configured");
    expect(result.atRiskConnectors).toEqual([]);
    expect(result.summary.atRiskConnectors).toBe(0);
    expect(result.summary.impactedResources).toBe(0);
    // usedConnectors still surfaces the env's actual usage for context.
    expect(result.summary.totalConnectors).toBe(1);
    expect(result.usedConnectors[0].slug).toBe("sql");
  });

  it("returns zero at-risk when every used connector is on the allow-list (cross-form)", () => {
    const used = extractUsedConnectors([
      canvasApp({ id: "a1", displayName: "App", connectorIds: ["shared_sql"] }),
      cloudFlow({ id: "f1", displayName: "Flow", connectorIds: ["sharepointonline"] }),
    ]);
    const snap = snapshot({
      allowedRawIds: [
        // Mix the two forms on purpose — both must still match.
        "/providers/Microsoft.PowerApps/apis/shared_sql",
        "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
      ],
    });
    const result = buildZoneMoveImpactResult({
      used,
      totalResourcesScanned: 2,
      snapshot: snap,
      ranAgainst: RAN_AGAINST,
    });
    expect(result.targetAcpState).toBe("advisory");
    expect(result.atRiskConnectors).toEqual([]);
    expect(result.summary.atRiskConnectors).toBe(0);
    expect(result.summary.impactedResources).toBe(0);
    expect(result.summary.totalConnectors).toBe(2);
  });

  it("flags at-risk connectors when used in env but not on the allow-list", () => {
    const used = extractUsedConnectors([
      canvasApp({ id: "a1", displayName: "App", connectorIds: ["shared_sql"] }),
      canvasApp({
        id: "a2",
        displayName: "App2",
        connectorIds: ["shared_sql", "shared_office365users"],
      }),
      cloudFlow({
        id: "f1",
        displayName: "Flow",
        connectorIds: ["sharepointonline"],
      }),
    ]);
    const snap = snapshot({
      // Only `office365users` is allowed.
      allowedRawIds: [
        "/providers/Microsoft.PowerApps/apis/shared_office365users",
      ],
    });
    const result = buildZoneMoveImpactResult({
      used,
      totalResourcesScanned: 3,
      snapshot: snap,
      ranAgainst: RAN_AGAINST,
    });
    expect(result.targetAcpState).toBe("advisory");
    expect(result.atRiskConnectors).toHaveLength(2);
    // At-risk-first sort: most impacted connector leads. `sql` is used
    // by 2 resources, `sharepointonline` by 1.
    expect(result.atRiskConnectors[0].slug).toBe("sql");
    expect(result.atRiskConnectors[0].resources).toHaveLength(2);
    expect(result.atRiskConnectors[1].slug).toBe("sharepointonline");
    expect(result.atRiskConnectors[1].resources).toHaveLength(1);
    // Impacted resources dedupe: a2 only counts once across two
    // at-risk connectors.
    expect(result.summary.impactedResources).toBe(3); // a1, a2, f1
    expect(result.summary.atRiskConnectors).toBe(2);
  });

  it("preserves `enforced` framing when acpOnly is on", () => {
    const used = extractUsedConnectors([
      canvasApp({ id: "a1", displayName: "App", connectorIds: ["shared_sql"] }),
    ]);
    const snap = snapshot({ acpOnly: true, allowedRawIds: [] });
    const result = buildZoneMoveImpactResult({
      used,
      totalResourcesScanned: 1,
      snapshot: snap,
      ranAgainst: RAN_AGAINST,
    });
    expect(result.targetAcpState).toBe("enforced");
    // With an empty allow-list, every used connector is at risk.
    expect(result.atRiskConnectors).toHaveLength(1);
    expect(result.atRiskConnectors[0].slug).toBe("sql");
  });

  it("returns a clean zero-impact result for an env with no resources", () => {
    const snap = snapshot({
      allowedRawIds: ["/providers/Microsoft.PowerApps/apis/shared_sql"],
    });
    const result = buildZoneMoveImpactResult({
      used: [],
      totalResourcesScanned: 0,
      snapshot: snap,
      ranAgainst: RAN_AGAINST,
    });
    expect(result.targetAcpState).toBe("advisory");
    expect(result.atRiskConnectors).toEqual([]);
    expect(result.usedConnectors).toEqual([]);
    expect(result.summary).toEqual({
      totalResources: 0,
      totalConnectors: 0,
      atRiskConnectors: 0,
      impactedResources: 0,
    });
  });

  it("trims topResources to ZONE_MOVE_IMPACT_TOP_N", () => {
    // Build a single at-risk connector used by more resources than the
    // top-N cap.
    const items: ResourceItem[] = [];
    for (let i = 0; i < ZONE_MOVE_IMPACT_TOP_N + 3; i++) {
      items.push(
        canvasApp({
          id: `a${i}`,
          displayName: `App ${String.fromCharCode(65 + i)}`,
          connectorIds: ["shared_sql"],
        })
      );
    }
    const used = extractUsedConnectors(items);
    const snap = snapshot({ allowedRawIds: [] });
    const result = buildZoneMoveImpactResult({
      used,
      totalResourcesScanned: items.length,
      snapshot: snap,
      ranAgainst: RAN_AGAINST,
    });
    expect(result.atRiskConnectors).toHaveLength(1);
    expect(result.atRiskConnectors[0].topResources).toHaveLength(
      ZONE_MOVE_IMPACT_TOP_N
    );
    // Full list still available for "view all".
    expect(result.atRiskConnectors[0].resources).toHaveLength(
      ZONE_MOVE_IMPACT_TOP_N + 3
    );
  });
});
