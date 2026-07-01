/**
 * Unit tests for the Phase 2 computed-tile aggregator registry.
 *
 * Aggregators are pure functions over `AgentRow[]` — perfect for hand-rolled
 * fixtures. We pin behavior on representative inputs, edge cases (empty
 * input, missing nested operations, msdyn agents — handled at the data
 * source layer not here), and the discriminated output shapes.
 */
import { describe, it, expect } from "vitest";
import {
  AGGREGATOR_IDS,
  agentsUsingConnectorKnowledgeTable,
  authoringSurfaceMix,
  channelFrequencyBar,
  channelReachHistogram,
  cleanupCandidatesTable,
  cleanupNeverPublishedCohorts,
  cleanupStalePublishedCohorts,
  connectorOpUsageTypePerConnector,
  consentGatedAgentsTable,
  distinctConnectorsKpi,
  distinctConnectorsTable,
  getAggregator,
  knowledgeDiversityHistogram,
  listAggregatorIds,
  makerVsEndUserMix,
  mostSharedGroupsTable,
  mostSharedIndividualsTable,
  promptLengthHistogram,
  topConnectorsByAgentCount,
  toolRichnessHistogram,
} from "./dashboardAggregators";
import type { AgentRow, ResourceConnector, ResourceConnectorOperation } from "./inventory";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function op(overrides: Partial<ResourceConnectorOperation> = {}): ResourceConnectorOperation {
  return {
    operationId: "Op",
    usedAs: "Tool",
    connectionProvider: "Maker",
    requiresEndUserConsent: false,
    isEnabled: true,
    ...overrides,
  };
}

function connector(id: string, ops: ResourceConnectorOperation[]): ResourceConnector {
  return { connectorId: id, displayName: id, operations: ops };
}

function agent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    type: "microsoft.copilotstudio/agents",
    displayName: "Agent",
    schemaName: "agent_schema",
    environmentId: "env-1",
    environmentName: "Production",
    ownerId: "00000000-0000-0000-0000-000000000001",
    ownerDisplayName: "Owner",
    createdAt: "2025-01-01T00:00:00Z",
    createdBy: "00000000-0000-0000-0000-000000000001",
    lastPublishedAt: "",
    region: "unitedstates",
    tenantId: "tenant-1",
    entraAppId: "",
    titleId: "",
    createdIn: "Copilot Studio",
    authentication: "Microsoft Entra",
    orchestration: "Generative",
    model: "GPT-4o",
    instructionsCharactersCount: 0,
    isWebSearchEnabledForKnowledge: false,
    isCLIAgent: false,
    channels: [],
    sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
    sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: false },
    isManaged: false,
    isQuarantined: false,
    distinctConnectors: 0,
    distinctConnectorOperations: 0,
    connectors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Registry sanity
// ---------------------------------------------------------------------------

describe("aggregator registry", () => {
  it("getAggregator resolves every id exposed by AGGREGATOR_IDS", () => {
    for (const id of Object.values(AGGREGATOR_IDS)) {
      expect(getAggregator(id), `missing aggregator ${id}`).toBeTruthy();
    }
  });

  it("getAggregator returns null for unknown ids", () => {
    expect(getAggregator("nonexistent")).toBeNull();
  });

  it("listAggregatorIds returns the full set", () => {
    expect(new Set(listAggregatorIds())).toEqual(new Set(Object.values(AGGREGATOR_IDS)));
  });
});

// ---------------------------------------------------------------------------
// Tools & Connectors
// ---------------------------------------------------------------------------

describe("distinctConnectorsKpi", () => {
  it("counts distinct connectorIds across all agents", () => {
    const agents = [
      agent({ connectors: [connector("a", [op()]), connector("b", [op()])] }),
      agent({ connectors: [connector("b", [op()]), connector("c", [op()])] }),
    ];
    const out = distinctConnectorsKpi(agents);
    expect(out).toEqual({ kind: "kpi", total: 3, kpiLabel: "across 2 agents" });
  });

  it("returns 0 for an empty universe", () => {
    expect(distinctConnectorsKpi([])).toEqual({
      kind: "kpi",
      total: 0,
      kpiLabel: "across 0 agents",
    });
  });
});

describe("distinctConnectorsTable", () => {
  it("counts agents-per-connector once per agent (not per connector entry)", () => {
    // Same connector listed twice on a single agent must still count as 1 agent.
    const agents = [
      agent({
        connectors: [
          connector("a", [op({ usedAs: "Tool" })]),
          connector("a", [op({ usedAs: "Knowledge" })]),
        ],
      }),
      agent({ connectors: [connector("a", [op({ usedAs: "Topic Tool" })])] }),
    ];
    const out = distinctConnectorsTable(agents);
    expect(out.kind).toBe("table");
    const rows = out.kind === "table" ? out.items : [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      connectorId: "a",
      agentCount: 2,
      opCount: 3,
      toolOps: 1,
      topicToolOps: 1,
      knowledgeOps: 1,
    });
  });

  it("sorts by agent count desc, then by connectorId", () => {
    const agents = [
      agent({ connectors: [connector("z", [op()])] }),
      agent({ connectors: [connector("a", [op()])] }),
      agent({ connectors: [connector("a", [op()])] }),
    ];
    const out = distinctConnectorsTable(agents);
    expect(out.kind === "table" ? out.items.map((r) => r.connectorId) : []).toEqual(["a", "z"]);
  });
});

describe("topConnectorsByAgentCount", () => {
  it("returns top N + Other when more than N distinct connectors exist", () => {
    const agents = [
      agent({ connectors: [connector("a", [op()]), connector("b", [op()]), connector("c", [op()])] }),
      agent({ connectors: [connector("a", [op()]), connector("b", [op()])] }),
      agent({ connectors: [connector("a", [op()])] }),
      agent({ connectors: [connector("d", [op()])] }),
    ];
    const out = topConnectorsByAgentCount(agents, { topN: 2 });
    expect(out.kind).toBe("chart");
    const buckets = out.kind === "chart" ? out.buckets : [];
    // a=3, b=2, c=1, d=1 -> top 1 = a; Other = b+c+d = 2+1+1 = 4
    expect(buckets).toEqual([
      { name: "a", value: 3 },
      { name: "Other", value: 4 },
    ]);
  });

  it("returns plain list when N >= distinct count", () => {
    const agents = [agent({ connectors: [connector("a", [op()]), connector("b", [op()])] })];
    const out = topConnectorsByAgentCount(agents, { topN: 10 });
    const buckets = out.kind === "chart" ? out.buckets : [];
    expect(buckets.map((b) => b.name)).toEqual(["a", "b"]);
    expect(buckets.every((b) => b.value === 1)).toBe(true);
  });
});

describe("connectorOpUsageTypePerConnector", () => {
  it("splits each connector's operations by usedAs and returns stacked series", () => {
    const agents = [
      agent({
        connectors: [
          connector("a", [
            op({ usedAs: "Tool" }),
            op({ usedAs: "Tool" }),
            op({ usedAs: "Knowledge" }),
          ]),
        ],
      }),
      agent({
        connectors: [
          connector("a", [op({ usedAs: "Topic Tool" })]),
          connector("b", [op({ usedAs: "Tool" })]),
        ],
      }),
    ];
    const out = connectorOpUsageTypePerConnector(agents, { topN: 5 });
    expect(out.kind).toBe("stackedBar");
    if (out.kind !== "stackedBar") return;
    expect(out.series).toEqual(["Tool", "Topic Tool", "Knowledge"]);
    const a = out.data.find((d) => d.category === "a");
    expect(a).toMatchObject({ Tool: 2, "Topic Tool": 1, Knowledge: 1 });
    const b = out.data.find((d) => d.category === "b");
    expect(b).toMatchObject({ Tool: 1, "Topic Tool": 0, Knowledge: 0 });
  });
});

describe("makerVsEndUserMix", () => {
  it("counts every operation by connectionProvider", () => {
    const agents = [
      agent({
        connectors: [
          connector("a", [
            op({ connectionProvider: "Maker" }),
            op({ connectionProvider: "End user" }),
          ]),
        ],
      }),
      agent({
        connectors: [
          connector("b", [
            op({ connectionProvider: "Maker" }),
            op({ connectionProvider: "Maker" }),
            op({ connectionProvider: undefined }),
          ]),
        ],
      }),
    ];
    const out = makerVsEndUserMix(agents);
    expect(out.kind).toBe("chart");
    if (out.kind !== "chart") return;
    expect(out.buckets).toEqual([
      { name: "Maker-shared", value: 3 },
      { name: "End-user", value: 1 },
      { name: "Unknown", value: 1 },
    ]);
  });
});

describe("toolRichnessHistogram", () => {
  it("buckets agents by distinct ops + distinctFlows (defensive read)", () => {
    const agents = [
      agent({ distinctConnectorOperations: 0 }),
      agent({ distinctConnectorOperations: 2 }),
      agent({ distinctConnectorOperations: 5 }),
      agent({ distinctConnectorOperations: 7 }),
      agent({ distinctConnectorOperations: 15 }),
      agent({ distinctConnectorOperations: 30 }),
      // distinctFlows is duck-read off the row — adding flows pushes this
      // 9-op agent up into the 11-20 bucket.
      { ...agent({ distinctConnectorOperations: 9 }), distinctFlows: 3 } as AgentRow,
    ];
    const out = toolRichnessHistogram(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName).toEqual({
      "0": 1,
      "1-2": 1,
      "3-5": 1,
      "6-10": 1,
      "11-20": 2, // 15 + the 9+3 flows agent
      "21+": 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Knowledge & Grounding
// ---------------------------------------------------------------------------

describe("agentsUsingConnectorKnowledgeTable", () => {
  it("lists only agents with at least one Knowledge-typed op", () => {
    const agents = [
      agent({
        displayName: "K1",
        connectors: [
          connector("sp", [op({ usedAs: "Knowledge" }), op({ usedAs: "Knowledge" })]),
          connector("sn", [op({ usedAs: "Tool" })]),
        ],
      }),
      agent({ displayName: "NoKnowledge", connectors: [connector("a", [op({ usedAs: "Tool" })])] }),
    ];
    const out = agentsUsingConnectorKnowledgeTable(agents);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      displayName: "K1",
      knowledgeSources: 2,
      knowledgeConnectors: "sp",
    });
  });
});

describe("knowledgeDiversityHistogram", () => {
  it("buckets agents by count of Knowledge-typed ops", () => {
    const agents = [
      agent({ connectors: [] }), // 0
      agent({ connectors: [connector("a", [op({ usedAs: "Knowledge" })])] }), // 1
      agent({
        connectors: [
          connector("a", [op({ usedAs: "Knowledge" }), op({ usedAs: "Knowledge" })]),
          connector("b", [op({ usedAs: "Knowledge" })]),
        ],
      }), // 3
      agent({
        connectors: [
          connector("a", Array.from({ length: 5 }, () => op({ usedAs: "Knowledge" }))),
        ],
      }), // 5
      agent({
        connectors: [
          connector("a", Array.from({ length: 9 }, () => op({ usedAs: "Knowledge" }))),
        ],
      }), // 9
    ];
    const out = knowledgeDiversityHistogram(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName).toEqual({ "0": 1, "1": 1, "2-3": 1, "4-6": 1, "7+": 1 });
  });
});

// ---------------------------------------------------------------------------
// Reach & Channels
// ---------------------------------------------------------------------------

describe("channelFrequencyBar", () => {
  it("counts agents per distinct channel — DYNAMIC, no hardcoded names", () => {
    const agents = [
      agent({ channels: ["Teams", "Microsoft 365 Copilot"] }),
      agent({ channels: ["Teams", "SharePoint"] }),
      agent({ channels: ["Webchat"] }),
      agent({ channels: ["Slack", "Telegram"] }),
      agent({ channels: [] }),
    ];
    const out = channelFrequencyBar(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName["Teams"]).toBe(2);
    expect(byName["Microsoft 365 Copilot"]).toBe(1);
    expect(byName["SharePoint"]).toBe(1);
    expect(byName["Webchat"]).toBe(1);
    expect(byName["Slack"]).toBe(1);
    expect(byName["Telegram"]).toBe(1);
    expect(byName["(no channels)"]).toBe(1);
  });

  it("de-dupes channel strings within a single agent before counting", () => {
    const agents = [agent({ channels: ["Teams", "Teams"] })];
    const out = channelFrequencyBar(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const teams = out.buckets.find((b) => b.name === "Teams");
    expect(teams?.value).toBe(1);
  });

  it("collapses to Top-N + Other when distinct channels exceed N", () => {
    const agents = Array.from({ length: 20 }, (_, i) => agent({ channels: [`ch${i}`] }));
    const out = channelFrequencyBar(agents, { topN: 5 });
    if (out.kind !== "chart") throw new Error("expected chart");
    const names = out.buckets.map((b) => b.name);
    expect(names).toContain("Other");
  });

  it("omits the (no channels) bucket when no agent is unpublished", () => {
    const agents = [agent({ channels: ["Teams"] })];
    const out = channelFrequencyBar(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    expect(out.buckets.map((b) => b.name)).not.toContain("(no channels)");
  });
});

describe("channelReachHistogram", () => {
  it("buckets agents by number of distinct channels", () => {
    const agents = [
      agent({ channels: [] }),
      agent({ channels: ["Teams"] }),
      agent({ channels: ["Teams", "M365"] }),
      agent({ channels: ["Teams", "M365", "Slack"] }),
      agent({ channels: ["Teams", "M365", "Slack", "Webchat"] }),
      agent({ channels: ["A", "B", "C", "D", "E"] }),
    ];
    const out = channelReachHistogram(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName).toEqual({ "0": 1, "1": 1, "2-3": 2, "4+": 2 });
  });

  it("de-dupes channel strings per agent", () => {
    const agents = [agent({ channels: ["Teams", "Teams", "Teams"] })];
    const out = channelReachHistogram(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    expect(out.buckets.find((b) => b.name === "1")?.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sharing & Governance
// ---------------------------------------------------------------------------

describe("consentGatedAgentsTable", () => {
  it("includes only agents with consent-gated ops and adds sharing columns", () => {
    const agents = [
      agent({
        displayName: "Gated",
        connectors: [
          connector("a", [
            op({ requiresEndUserConsent: true, connectionProvider: "Maker" }),
            op({ connectionProvider: "End user" }),
          ]),
        ],
        sharedWithViewers: { userCount: 5, groupCount: 2, entireTenant: true },
        sharedWithEditors: { userCount: 1, groupCount: 1, entireTenant: false },
      }),
      agent({ displayName: "Open", connectors: [connector("a", [op({ connectionProvider: "Maker" })])] }),
    ];
    const out = consentGatedAgentsTable(agents);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      displayName: "Gated",
      consentOps: 2,
      endUserUsers: 5,
      endUserGroups: 2,
      tenantWide: "Yes",
      editorsTotal: 2,
    });
  });
});

describe("mostSharedIndividualsTable", () => {
  it("sorts by viewerUsers + editorUsers desc, filters out zero-share agents", () => {
    const agents = [
      agent({ displayName: "Big", sharedWithViewers: { userCount: 100, groupCount: 0, entireTenant: false }, sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false } }),
      agent({ displayName: "Medium", sharedWithViewers: { userCount: 20, groupCount: 0, entireTenant: false }, sharedWithEditors: { userCount: 5, groupCount: 0, entireTenant: false } }),
      agent({ displayName: "None", sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: false }, sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false } }),
    ];
    const out = mostSharedIndividualsTable(agents);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items.map((r) => r.displayName)).toEqual(["Big", "Medium"]);
    expect(out.items[0].totalUsers).toBe(100);
    expect(out.items[1].totalUsers).toBe(25);
  });

  it("excludes tenant-wide-shared agents from this list (covered by the Tenant-wide KPI)", () => {
    const agents = [
      // Tenant-wide flag set, userCount=0 — should be EXCLUDED.
      agent({
        displayName: "TenantWide",
        sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: true },
        sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
      }),
      agent({
        displayName: "SmallShare",
        sharedWithViewers: { userCount: 5, groupCount: 0, entireTenant: false },
        sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
      }),
    ];
    const out = mostSharedIndividualsTable(agents);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items.map((r) => r.displayName)).toEqual(["SmallShare"]);
  });

  it("respects topN", () => {
    const agents = Array.from({ length: 10 }, (_, i) =>
      agent({
        displayName: `A${i}`,
        sharedWithViewers: { userCount: 10 - i, groupCount: 0, entireTenant: false },
        sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
      })
    );
    const out = mostSharedIndividualsTable(agents, { topN: 3 });
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items).toHaveLength(3);
  });
});

describe("mostSharedGroupsTable", () => {
  it("sorts by viewerGroups + editorGroups desc", () => {
    const agents = [
      agent({ displayName: "Many", sharedWithViewers: { userCount: 0, groupCount: 12, entireTenant: false }, sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false } }),
      agent({ displayName: "Few", sharedWithViewers: { userCount: 0, groupCount: 2, entireTenant: false }, sharedWithEditors: { userCount: 0, groupCount: 1, entireTenant: false } }),
      agent({ displayName: "None", sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: false }, sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false } }),
    ];
    const out = mostSharedGroupsTable(agents);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items.map((r) => r.displayName)).toEqual(["Many", "Few"]);
  });

  it("excludes tenant-wide-shared agents from this list", () => {
    const agents = [
      agent({
        displayName: "TenantWide",
        sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: true },
        sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
      }),
      agent({
        displayName: "SomeGroups",
        sharedWithViewers: { userCount: 0, groupCount: 3, entireTenant: false },
        sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
      }),
    ];
    const out = mostSharedGroupsTable(agents);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items.map((r) => r.displayName)).toEqual(["SomeGroups"]);
  });
});

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

describe("promptLengthHistogram", () => {
  it("buckets by instructionsCharactersCount", () => {
    const agents = [
      agent({ instructionsCharactersCount: 0 }),
      agent({ instructionsCharactersCount: 50 }),
      agent({ instructionsCharactersCount: 250 }),
      agent({ instructionsCharactersCount: 1500 }),
      agent({ instructionsCharactersCount: 3000 }),
      agent({ instructionsCharactersCount: 6000 }),
      agent({ instructionsCharactersCount: 12000 }),
    ];
    const out = promptLengthHistogram(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName).toEqual({ "<100": 2, "100-500": 1, "500-2k": 1, "2k-4k": 1, "4k-8k": 1, "8k+": 1 });
  });
});

describe("authoringSurfaceMix", () => {
  it("groups by createdIn, splits CLI-authored into its own slice", () => {
    const agents = [
      agent({ createdIn: "Copilot Studio" }),
      agent({ createdIn: "Copilot Studio" }),
      agent({ createdIn: "Teams" }),
      { ...agent({ createdIn: "Copilot Studio" }), isCLIAgent: true } as AgentRow,
    ];
    const out = authoringSurfaceMix(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName).toEqual({ "Copilot Studio": 2, Teams: 1, CLI: 1 });
  });

  it("rolls missing createdIn into 'Unknown'", () => {
    const agents = [agent({ createdIn: "" })];
    const out = authoringSurfaceMix(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    expect(out.buckets).toEqual([{ name: "Unknown", value: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle cleanup
// ---------------------------------------------------------------------------

describe("cleanupNeverPublishedCohorts", () => {
  it("buckets only never-published agents older than 30 days by age", () => {
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
    const agents = [
      agent({ createdAt: daysAgo(10), lastPublishedAt: "" }), // < 30d, excluded
      agent({ createdAt: daysAgo(45), lastPublishedAt: "" }), // 30-89d
      agent({ createdAt: daysAgo(120), lastPublishedAt: "" }), // 90-179d
      agent({ createdAt: daysAgo(200), lastPublishedAt: "" }), // 180-364d
      agent({ createdAt: daysAgo(500), lastPublishedAt: "" }), // 365d+
      agent({ createdAt: daysAgo(500), lastPublishedAt: daysAgo(100) }), // published, excluded
    ];
    const out = cleanupNeverPublishedCohorts(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName).toEqual({ "30-89d": 1, "90-179d": 1, "180-364d": 1, "365d+": 1 });
  });
});

describe("cleanupStalePublishedCohorts", () => {
  it("buckets published agents older than 180 days", () => {
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
    const agents = [
      agent({ lastPublishedAt: daysAgo(50) }), // < 180d, excluded
      agent({ lastPublishedAt: daysAgo(200) }), // 180-364d
      agent({ lastPublishedAt: daysAgo(500) }), // 1-2y
      agent({ lastPublishedAt: daysAgo(900) }), // 2y+
      agent({ lastPublishedAt: "" }), // never published, excluded
    ];
    const out = cleanupStalePublishedCohorts(agents);
    if (out.kind !== "chart") throw new Error("expected chart");
    const byName = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(byName).toEqual({ "180-364d": 1, "1-2y": 1, "2y+": 1 });
  });
});

describe("cleanupCandidatesTable", () => {
  it("scores each agent by number of cleanup signals matched", () => {
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
    const agents = [
      // High-score: never published >90d, no channels, quarantined, orphaned owner
      agent({
        displayName: "Worst",
        createdAt: daysAgo(200),
        lastPublishedAt: "",
        channels: [],
        isQuarantined: true,
        ownerId: "00000000-0000-0000-0000-000000000000",
      }),
      // Medium: stale published, no channels
      agent({
        displayName: "Stale",
        lastPublishedAt: daysAgo(300),
        channels: [],
      }),
      // Clean: no signals
      agent({ displayName: "Healthy", lastPublishedAt: daysAgo(30), channels: ["Teams"] }),
    ];
    const out = cleanupCandidatesTable(agents);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({ displayName: "Worst", score: 4 });
    expect(out.items[1]).toMatchObject({ displayName: "Stale", score: 2 });
  });

  it("respects topN", () => {
    const agents = Array.from({ length: 50 }, (_, i) =>
      agent({ displayName: `Q${i}`, isQuarantined: true })
    );
    const out = cleanupCandidatesTable(agents, { topN: 5 });
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items).toHaveLength(5);
    expect(out.total).toBe(50);
  });
});
