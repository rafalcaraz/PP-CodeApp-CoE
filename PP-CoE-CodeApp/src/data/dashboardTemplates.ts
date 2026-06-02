/**
 * Dashboard templates.
 *
 * A template is a builder that returns a list of `DashboardTile`s, ready
 * to drop into a fresh `Dashboard`. Templates exist so callers can spin
 * up a curated, opinionated dashboard with one click instead of building
 * 20 tiles by hand.
 *
 * The first template — Copilot Studio Estate — mirrors the headline
 * sections of the Azure Workbook in `docs/` (Overview KPIs, Configuration
 * pies, Sharing & Governance tables, Lifecycle tables, Created-over-time
 * trend). Workbook idioms that need per-row computation (composite risk
 * score, editor sprawl by nested numeric, channel exclusion via
 * mv-expand, etc.) are deferred — see `plan.md` for the Phase 2 backlog.
 *
 * Implementation notes:
 *
 * - KPI and Table tiles use `source: "raw"` with hand-crafted
 *   `Clause[]` so we can express idioms the `QuerySpec` builder doesn't
 *   support: `ago(180d)`, `isempty(...)`, nested `tobool(...)` checks.
 * - Chart tiles (pie / bar / line) MUST stay on `source: "builder"` —
 *   the tile renderer injects its own aggregation KQL on top of the
 *   spec, which conflicts with raw clauses (see `TileView.tsx`).
 * - We intentionally do NOT push `take(N)` into raw clauses — `take`
 *   caps `totalRecords` to N, which would make KPI counts lie. The
 *   tile renderer applies its own row cap on top of the items it gets.
 */

import type { Clause } from "../generated/models/PowerPlatformforAdminsV2Model";
import {
  ResourceType,
  extend,
  orderBy,
  where,
  type ResourceTypeValue,
} from "./inventory";
import type {
  DashboardTab,
  DashboardTile,
  TileSize,
  TileTableColumn,
  TileVizType,
} from "./dashboards";
import { newId } from "./dashboards";
import { AGGREGATOR_IDS } from "./dashboardAggregators";
// Side-effect import: registers the app-typed aggregators with the central
// registry so templates below that reference APP_AGGREGATOR_IDS resolve at
// render time. Without this import the registrations would only run when
// some other module happened to pull the file in.
import { APP_AGGREGATOR_IDS } from "./dashboardAppAggregators";

const AGENT_TYPE = `'${ResourceType.CopilotStudioAgent}'`;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

/** Shared first clauses: scope every Copilot Studio tile to agents only
 *  AND exclude first-party / system agents whose `schemaName` starts with
 *  `msdyn_` (Dynamics-installed bots, msdyn_msftcsa*, etc.). Mirrors the
 *  Azure Workbook's default Exclude=`msdyn_` parameter — without this,
 *  KPIs are dominated by first-party agents (often 10× the real customer
 *  agent count) which have system-owned IDs and tenant-wide sharing by
 *  default, drowning the actual signal.
 *
 *  Returns 3 clauses: type filter, `extend` aliasing schemaName, and
 *  `!startswith 'msdyn_'` on the alias. */
function agentScope(): Clause[] {
  return [
    where("type", "==", [AGENT_TYPE]),
    extend("__sn", "tostring(properties.schemaName)"),
    where("__sn", "!startswith", ["'msdyn_'"]),
  ];
}

/** Default sort for table tiles — newest first by created date. */
function orderByCreatedDesc(): Clause {
  return orderBy({ "tostring(properties.createdAt)": "desc" });
}

/** Columns shown on most agent-list table tiles. Includes `schemaName`
 *  so you can spot what kind of agent each row is (first-party vs.
 *  customer-authored). */
const AGENT_TABLE_COLUMNS: TileTableColumn[] = [
  { field: "properties.displayName", header: "Name" },
  { field: "properties.schemaName", header: "Schema" },
  { field: "properties.environmentId", header: "Environment" },
  { field: "properties.ownerId", header: "Owner" },
  { field: "properties.createdAt", header: "Created" },
  { field: "properties.lastPublishedAt", header: "Last published" },
];

/** Empty QuerySpec for tiles that use raw clauses only. The `spec` is
 *  still required by the `DashboardTile` shape — the tile renderer ignores
 *  it when `source === "raw"`. */
function rawSpec() {
  return {
    resourceTypes: [ResourceType.CopilotStudioAgent],
    filters: [],
    orderField: "",
    orderDirection: "desc" as const,
    limit: 1,
  };
}

// ---------------------------------------------------------------------------
// Tile factories — small wrappers so the template body reads as a flat list
// of "what" instead of a wall of object literals.
// ---------------------------------------------------------------------------

function kpiTile(
  title: string,
  kpiLabel: string,
  clauses: Clause[],
  size: TileSize = "xs",
  tabId?: string
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size,
    viz: { type: "kpi", kpiLabel },
    spec: rawSpec(),
    source: "raw",
    clauses,
    ...(tabId ? { tabId } : {}),
  };
}

function tableTile(
  title: string,
  clauses: Clause[],
  opts: { rows?: number; size?: TileSize; columns?: TileTableColumn[]; tabId?: string } = {}
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size: opts.size ?? "medium",
    viz: {
      type: "table",
      tableRows: opts.rows ?? 10,
      tableColumns: opts.columns ?? AGENT_TABLE_COLUMNS,
    },
    spec: rawSpec(),
    source: "raw",
    clauses,
    ...(opts.tabId ? { tabId: opts.tabId } : {}),
  };
}

function pieTile(
  title: string,
  groupBy: string,
  size: TileSize = "small",
  maxCategories = 8,
  tabId?: string
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size,
    viz: { type: "pie", groupBy, maxCategories },
    spec: {
      resourceTypes: [ResourceType.CopilotStudioAgent],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 500,
    },
    ...(tabId ? { tabId } : {}),
  };
}

function barTile(
  title: string,
  groupBy: string,
  size: TileSize = "medium",
  maxCategories = 10,
  tabId?: string
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size,
    viz: { type: "bar", groupBy, maxCategories },
    spec: {
      resourceTypes: [ResourceType.CopilotStudioAgent],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 500,
    },
    ...(tabId ? { tabId } : {}),
  };
}

function lineTile(
  title: string,
  dateField: string,
  bucket: "day" | "week" | "month",
  lookbackDays: number,
  size: TileSize = "large",
  tabId?: string
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size,
    viz: { type: "line", dateField, bucket, lookbackDays },
    spec: {
      resourceTypes: [ResourceType.CopilotStudioAgent],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 500,
    },
    ...(tabId ? { tabId } : {}),
  };
}

/** Factory for `source: "computed"` tiles — the aggregator does the
 *  fetching+folding, and we pass through any viz-specific bits the
 *  renderer reads (KPI label, table column hints, etc.). The `spec`
 *  field is required by the DashboardTile shape but the renderer
 *  ignores it for computed tiles. */
function computedTile(
  title: string,
  aggregatorId: string,
  vizType: TileVizType,
  opts: {
    size?: TileSize;
    tabId?: string;
    kpiLabel?: string;
    tableRows?: number;
    tableColumns?: TileTableColumn[];
    params?: Record<string, unknown>;
  } = {}
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size: opts.size ?? "medium",
    viz: {
      type: vizType,
      ...(opts.kpiLabel ? { kpiLabel: opts.kpiLabel } : {}),
      ...(opts.tableRows ? { tableRows: opts.tableRows } : {}),
      ...(opts.tableColumns ? { tableColumns: opts.tableColumns } : {}),
    },
    spec: rawSpec(),
    source: "computed",
    computed: {
      aggregatorId,
      ...(opts.params ? { params: opts.params } : {}),
    },
    ...(opts.tabId ? { tabId: opts.tabId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Reusable clause fragments. Centralizing them means the same filter is
// guaranteed to mean the same thing across the snapshot KPI and the
// matching detail-list table (e.g. "Stale" → 180d everywhere).
// ---------------------------------------------------------------------------

/** Filter to agents that have ever been published (lastPublishedAt set).
 *  Uses an explicit `extend` so the `where` clause only references a plain
 *  identifier — function-call FieldNames in `where` aren't a proven pattern
 *  for the connector. */
function publishedClauses(): Clause[] {
  return [
    extend("__lpa_set", "isnotempty(tostring(properties.lastPublishedAt))"),
    where("__lpa_set", "==", ["true"]),
  ];
}

/** Filter to agents that have never been published. */
function neverPublishedClauses(): Clause[] {
  return [
    extend("__lpa_set", "isnotempty(tostring(properties.lastPublishedAt))"),
    where("__lpa_set", "==", ["false"]),
  ];
}

/** Filter to agents whose last publish is older than N days. Skips
 *  never-published agents (those are counted by `neverPublishedClauses`).
 *  Date comparison uses the existing proven pattern: plain property path
 *  on the left, KQL `ago(Nd)` expression on the right. */
function stalePublishedClauses(days: number): Clause[] {
  return [
    extend("__lpa_set", "isnotempty(tostring(properties.lastPublishedAt))"),
    where("__lpa_set", "==", ["true"]),
    where("properties.lastPublishedAt", "<", [`ago(${days}d)`]),
  ];
}

/** Filter to agents created in the last N days. */
function createdInLastDaysClauses(days: number): Clause[] {
  return [where("properties.createdAt", ">", [`ago(${days}d)`])];
}

/** Filter to agents created more than N days ago. */
function createdMoreThanDaysAgoClauses(days: number): Clause[] {
  return [where("properties.createdAt", "<", [`ago(${days}d)`])];
}

/** Compute a per-row composite risk score (0..5) on top of the current row
 *  set. Each signal contributes +1: tenant-wide shared, no auth, quarantined,
 *  orphaned, unmanaged. The result is exposed as a top-level `__risk`
 *  column so table tiles can render it and sort on it. */
function riskScoreExtends(): Clause[] {
  return [
    extend(
      "__r_tw",
      "iif(tobool(properties.sharedWithViewers.entireTenant), 1, 0)"
    ),
    extend(
      "__r_noauth",
      "iif(tostring(properties.authentication) == 'None', 1, 0)"
    ),
    extend("__r_qu", "iif(tobool(properties.isQuarantined), 1, 0)"),
    extend(
      "__r_orph",
      `iif(tostring(properties.ownerId) == '${ZERO_GUID}', 1, 0)`
    ),
    extend("__r_unmgd", "iif(tobool(properties.isManaged), 0, 1)"),
    extend("__risk", "__r_tw + __r_noauth + __r_qu + __r_orph + __r_unmgd"),
  ];
}

/** Compute a per-row total editor count (users + groups) so we can sort
 *  by it. Exposes `__editors` as a top-level column. */
function editorCountExtend(): Clause {
  return extend(
    "__editors",
    "toint(properties.sharedWithEditors.userCount) + " +
      "toint(properties.sharedWithEditors.groupCount)"
  );
}

/** Filter to agents that are published ONLY to the Direct Line Channels
 *  channel — i.e. they exist as a deployable bot but have no real
 *  end-user surface (Teams / M365 Copilot / etc.). The workbook calls
 *  this out as a top "published but invisible" cleanup signal. */
function directLineOnlyClauses(): Clause[] {
  return [
    extend("__chs_count", "array_length(properties.channels)"),
    extend("__chs0", "tostring(properties.channels[0])"),
    where("__chs_count", "==", ["1"]),
    where("__chs0", "==", ["'Direct Line Channels'"]),
  ];
}

// ── Phase 2 raw-clause filter fragments ─────────────────────────────────

/** Filter to agents with at least one event trigger — autonomous mode. */
function autonomousAgentClauses(): Clause[] {
  return [
    extend("__trig_count", "array_length(properties.triggers)"),
    where("__trig_count", ">", ["0"]),
  ];
}

/** Filter to chatter-only agents — zero connector operations AND zero
 *  flows. These do no actions; they only talk. */
function chatterOnlyClauses(): Clause[] {
  return [
    extend(
      "__ops",
      "toint(properties.capabilitiesCounts.distinctPowerPlatformConnectorsOperations)"
    ),
    extend("__flows", "toint(properties.capabilitiesCounts.distinctFlows)"),
    where("__ops", "==", ["0"]),
    where("__flows", "==", ["0"]),
  ];
}

/** Filter to agents shared with the entire tenant (high-blast-radius). */
function tenantWideClauses(): Clause[] {
  return [
    extend(
      "__tw",
      "iif(tobool(properties.sharedWithViewers.entireTenant), 1, 0)"
    ),
    where("__tw", "==", ["1"]),
  ];
}

/** Filter to agents with web search enabled for knowledge. */
function webSearchEnabledClauses(): Clause[] {
  return [
    extend(
      "__ws",
      "iif(tobool(properties.isWebSearchEnabledForKnowledge), 1, 0)"
    ),
    where("__ws", "==", ["1"]),
  ];
}

// ---------------------------------------------------------------------------
// Template: Copilot Studio Estate
// ---------------------------------------------------------------------------

/** Tab ids used by the Copilot Studio Estate template. Stable strings (not
 *  generated) so we can render section-aware help text in the future and so
 *  re-running the template builder in tests produces deterministic ids. */
const ESTATE_TABS = {
  overview: "estate-overview",
  config: "estate-configuration",
  channels: "estate-channels",
  sharing: "estate-sharing",
  lifecycle: "estate-lifecycle",
  trends: "estate-trends",
  tools: "estate-tools",
  knowledge: "estate-knowledge",
  authoringQuality: "estate-authoring-quality",
  authoringSurface: "estate-authoring-surface",
} as const;

function estateTabs(): DashboardTab[] {
  return [
    { id: ESTATE_TABS.overview, name: "Overview" },
    { id: ESTATE_TABS.config, name: "Configuration" },
    { id: ESTATE_TABS.channels, name: "Channels & Reach" },
    { id: ESTATE_TABS.sharing, name: "Sharing & Governance" },
    { id: ESTATE_TABS.lifecycle, name: "Lifecycle" },
    { id: ESTATE_TABS.trends, name: "Trends" },
    { id: ESTATE_TABS.tools, name: "Tools & Connectors" },
    { id: ESTATE_TABS.knowledge, name: "Knowledge & Grounding" },
    { id: ESTATE_TABS.authoringQuality, name: "Authoring quality" },
    { id: ESTATE_TABS.authoringSurface, name: "Authoring surface" },
  ];
}

function copilotStudioEstateLayout(): { tabs: DashboardTab[]; tiles: DashboardTile[] } {
  // Custom column sets for the advanced tiles.
  const riskColumns: TileTableColumn[] = [
    { field: "properties.displayName", header: "Name" },
    { field: "__risk", header: "Risk" },
    { field: "__r_tw", header: "Tenant-wide" },
    { field: "__r_noauth", header: "No auth" },
    { field: "__r_qu", header: "Quarantined" },
    { field: "__r_orph", header: "Orphaned" },
    { field: "__r_unmgd", header: "Unmanaged" },
    { field: "properties.environmentId", header: "Environment" },
    { field: "properties.ownerId", header: "Owner" },
  ];
  const editorColumns: TileTableColumn[] = [
    { field: "properties.displayName", header: "Name" },
    { field: "__editors", header: "Editors (users+groups)" },
    { field: "properties.sharedWithEditors.userCount", header: "User editors" },
    { field: "properties.sharedWithEditors.groupCount", header: "Group editors" },
    { field: "properties.environmentId", header: "Environment" },
    { field: "properties.ownerId", header: "Owner" },
  ];
  const channelColumns: TileTableColumn[] = [
    { field: "properties.displayName", header: "Name" },
    { field: "properties.environmentId", header: "Environment" },
    { field: "properties.ownerId", header: "Owner" },
    { field: "properties.lastPublishedAt", header: "Last published" },
  ];

  const tabs = estateTabs();
  const t = ESTATE_TABS;

  const tiles: DashboardTile[] = [
    // ── Overview ─────────────────────────────────────────────────────────
    kpiTile(
      "Total agents",
      "Customer agents (excl. msdyn_)",
      [...agentScope()],
      "xs",
      t.overview
    ),
    kpiTile(
      "Published",
      "Has ever been published",
      [...agentScope(), ...publishedClauses()],
      "xs",
      t.overview
    ),
    kpiTile(
      "Never published",
      "Drafts only",
      [...agentScope(), ...neverPublishedClauses()],
      "xs",
      t.overview
    ),
    kpiTile(
      "Stale (180d+)",
      "Published >180 days ago",
      [...agentScope(), ...stalePublishedClauses(180)],
      "xs",
      t.overview
    ),
    kpiTile(
      "High risk (3+)",
      "Risk score \u2265 3 of 5",
      [
        ...agentScope(),
        ...riskScoreExtends(),
        where("__risk", ">=", ["3"]),
      ],
      "xs",
      t.overview
    ),

    // ── Configuration ────────────────────────────────────────────────────
    pieTile("Model distribution", "properties.model", "small", 8, t.config),
    pieTile("Orchestration mode", "properties.orchestration", "small", 8, t.config),
    pieTile("Authentication", "properties.authentication", "small", 8, t.config),
    // #14 — autonomous (event-driven) agents: KPI + table.
    kpiTile(
      "🤖 Autonomous agents",
      "≥1 event trigger",
      [...agentScope(), ...autonomousAgentClauses()],
      "small",
      t.config
    ),
    tableTile(
      "Autonomous agents (event-driven)",
      [
        ...agentScope(),
        ...autonomousAgentClauses(),
        orderByCreatedDesc(),
      ],
      { rows: 15, size: "large", tabId: t.config }
    ),

    // ── Channels & Reach ─────────────────────────────────────────────────
    tableTile(
      "🚩 Direct-Line-only agents (published, but no end-user surface)",
      [
        ...agentScope(),
        ...directLineOnlyClauses(),
        orderByCreatedDesc(),
      ],
      { rows: 15, columns: channelColumns, size: "large", tabId: t.channels }
    ),
    // #9a — dynamic per-channel agent count. Shows every distinct channel
    // string present in the data (Teams, M365 Copilot, SharePoint, Webchat,
    // Direct Line Channels, …) sorted by frequency. No hardcoded combos.
    computedTile(
      "Agents per channel (dynamic)",
      AGGREGATOR_IDS.channelFrequencyBar,
      "bar",
      { size: "large", tabId: t.channels, params: { topN: 15 } }
    ),
    // #9b — companion view: distribution of agents by number of channels.
    computedTile(
      "Channel reach distribution (agents by # of channels)",
      AGGREGATOR_IDS.channelReachHistogram,
      "bar",
      { size: "medium", tabId: t.channels }
    ),

    // ── Sharing & Governance ─────────────────────────────────────────────
    tableTile(
      "🚨 Risk score per agent (tenant-wide + no auth + quarantined + orphaned + unmanaged)",
      [
        ...agentScope(),
        ...riskScoreExtends(),
        where("__risk", ">", ["0"]),
        orderBy({ "__risk": "desc" }),
      ],
      { rows: 20, columns: riskColumns, size: "large", tabId: t.sharing }
    ),
    tableTile(
      "✏️ Editor sprawl (most co-authors)",
      [
        ...agentScope(),
        editorCountExtend(),
        where("__editors", ">", ["0"]),
        orderBy({ "__editors": "desc" }),
      ],
      { rows: 15, columns: editorColumns, size: "large", tabId: t.sharing }
    ),
    barTile("🏆 Top creators (top 10)", "properties.createdBy", "medium", 10, t.sharing),
    barTile(
      "🏭 Top environments by agent count",
      "properties.environmentId",
      "medium",
      10,
      t.sharing
    ),
    // #11 (pivoted) — tenant-wide shared agents red-flag KPI.
    kpiTile(
      "🚨 Tenant-wide shared",
      "Available to every user",
      [...agentScope(), ...tenantWideClauses()],
      "small",
      t.sharing
    ),
    // #4 — rich consent-gated table with sharing fan-out columns alongside
    // the friction signal.
    computedTile(
      "🪪 Consent-gated agents (end-user auth or explicit consent required)",
      AGGREGATOR_IDS.consentGatedAgentsTable,
      "table",
      {
        size: "large",
        tabId: t.sharing,
        tableRows: 15,
        tableColumns: [
          { field: "displayName", header: "Name" },
          { field: "environmentId", header: "Environment" },
          { field: "ownerId", header: "Owner" },
          { field: "consentOps", header: "Consent ops" },
          { field: "endUserUsers", header: "Viewer users" },
          { field: "endUserGroups", header: "Viewer groups" },
          { field: "tenantWide", header: "Tenant-wide" },
          { field: "editorsTotal", header: "Editors (total)" },
          { field: "lastPublishedAt", header: "Last published" },
        ],
      }
    ),
    // A — most shared with individuals.
    computedTile(
      "👤 Most-shared agents — by individuals",
      AGGREGATOR_IDS.mostSharedIndividualsTable,
      "table",
      {
        size: "large",
        tabId: t.sharing,
        tableRows: 20,
        params: { topN: 20 },
        tableColumns: [
          { field: "displayName", header: "Name" },
          { field: "environmentId", header: "Environment" },
          { field: "viewerUsers", header: "Viewer users" },
          { field: "editorUsers", header: "Editor users" },
          { field: "totalUsers", header: "Total users" },
          { field: "tenantWide", header: "Tenant-wide" },
          { field: "channels", header: "Channels" },
          { field: "ownerId", header: "Owner" },
        ],
      }
    ),
    // B — most shared with groups.
    computedTile(
      "👥 Most-shared agents — by groups",
      AGGREGATOR_IDS.mostSharedGroupsTable,
      "table",
      {
        size: "large",
        tabId: t.sharing,
        tableRows: 20,
        params: { topN: 20 },
        tableColumns: [
          { field: "displayName", header: "Name" },
          { field: "environmentId", header: "Environment" },
          { field: "viewerGroups", header: "Viewer groups" },
          { field: "editorGroups", header: "Editor groups" },
          { field: "totalGroups", header: "Total groups" },
          { field: "tenantWide", header: "Tenant-wide" },
          { field: "channels", header: "Channels" },
          { field: "ownerId", header: "Owner" },
        ],
      }
    ),

    // ── Lifecycle ────────────────────────────────────────────────────────
    tableTile(
      "🗑 Zombie drafts (>90d old, never published)",
      [
        ...agentScope(),
        ...neverPublishedClauses(),
        ...createdMoreThanDaysAgoClauses(90),
        orderBy({ "tostring(properties.createdAt)": "asc" }),
      ],
      { rows: 15, tabId: t.lifecycle }
    ),
    tableTile(
      "🥶 Stale agents (last published >180d ago)",
      [
        ...agentScope(),
        ...stalePublishedClauses(180),
        orderBy({ "tostring(properties.lastPublishedAt)": "asc" }),
      ],
      { rows: 15, tabId: t.lifecycle }
    ),
    tableTile(
      "🆕 New this week",
      [
        ...agentScope(),
        ...createdInLastDaysClauses(7),
        orderByCreatedDesc(),
      ],
      { rows: 10, tabId: t.lifecycle }
    ),
    // D1 — never-published cohorts.
    computedTile(
      "Cleanup queue: never-published agents by age",
      AGGREGATOR_IDS.cleanupNeverPublishedCohorts,
      "bar",
      { size: "medium", tabId: t.lifecycle }
    ),
    // D2 — stale-published cohorts.
    computedTile(
      "Stale-published agents by age since last publish",
      AGGREGATOR_IDS.cleanupStalePublishedCohorts,
      "bar",
      { size: "medium", tabId: t.lifecycle }
    ),
    // D3 — composite cleanup-candidates table.
    computedTile(
      "🧹 Cleanup candidates (scored)",
      AGGREGATOR_IDS.cleanupCandidatesTable,
      "table",
      {
        size: "large",
        tabId: t.lifecycle,
        tableRows: 30,
        params: { topN: 30 },
        tableColumns: [
          { field: "displayName", header: "Name" },
          { field: "environmentId", header: "Environment" },
          { field: "ownerId", header: "Owner" },
          { field: "score", header: "Score" },
          { field: "reasons", header: "Reasons" },
          { field: "ageDays", header: "Age (days)" },
          { field: "lastPublishedAt", header: "Last published" },
        ],
      }
    ),

    // ── Trends ───────────────────────────────────────────────────────────
    lineTile(
      "Agents created over time (weekly, 180d)",
      "properties.createdAt",
      "week",
      180,
      "large",
      t.trends
    ),

    // ── Tools & Connectors (NEW) ─────────────────────────────────────────
    // #1 — distinct connectors KPI + drill-through table.
    computedTile(
      "Distinct connectors in tenant",
      AGGREGATOR_IDS.distinctConnectorsKpi,
      "kpi",
      { size: "small", tabId: t.tools, kpiLabel: "Across all agents" }
    ),
    computedTile(
      "Connector breakdown (per agent + per usage type)",
      AGGREGATOR_IDS.distinctConnectorsTable,
      "table",
      {
        size: "large",
        tabId: t.tools,
        tableRows: 25,
        tableColumns: [
          { field: "connectorId", header: "Connector" },
          { field: "agentCount", header: "Agents" },
          { field: "opCount", header: "Operations" },
          { field: "toolOps", header: "Tool" },
          { field: "topicToolOps", header: "Topic Tool" },
          { field: "knowledgeOps", header: "Knowledge" },
        ],
      }
    ),
    // #2 — top connectors bar.
    computedTile(
      "Top connectors by agent count",
      AGGREGATOR_IDS.topConnectorsByAgentCount,
      "bar",
      { size: "large", tabId: t.tools, params: { topN: 10 } }
    ),
    // #3 — connector × usage type stacked bar.
    computedTile(
      "Connector operations by usage type",
      AGGREGATOR_IDS.connectorOpUsageTypePerConnector,
      "stackedBar",
      { size: "large", tabId: t.tools, params: { topN: 8 } }
    ),
    // #5 — maker-shared vs end-user pie.
    computedTile(
      "Maker-shared vs end-user connections",
      AGGREGATOR_IDS.makerVsEndUserMix,
      "pie",
      { size: "medium", tabId: t.tools }
    ),
    // #19 — tool-rich agents histogram (computed for distinctFlows inclusion).
    computedTile(
      "Tool-rich agents (distinct ops + flows)",
      AGGREGATOR_IDS.toolRichnessHistogram,
      "bar",
      { size: "medium", tabId: t.tools }
    ),

    // ── Knowledge & Grounding (NEW) ──────────────────────────────────────
    // #6 — web search enabled KPI.
    kpiTile(
      "🌐 Web search enabled",
      "Grounds on public web search",
      [...agentScope(), ...webSearchEnabledClauses()],
      "small",
      t.knowledge
    ),
    // #7 — agents using connector knowledge.
    computedTile(
      "Agents using connectors as Knowledge",
      AGGREGATOR_IDS.agentsUsingConnectorKnowledgeTable,
      "table",
      {
        size: "large",
        tabId: t.knowledge,
        tableRows: 20,
        tableColumns: [
          { field: "displayName", header: "Name" },
          { field: "environmentId", header: "Environment" },
          { field: "knowledgeSources", header: "Knowledge ops" },
          { field: "knowledgeConnectors", header: "Knowledge connectors" },
          { field: "ownerId", header: "Owner" },
          { field: "lastPublishedAt", header: "Last published" },
        ],
      }
    ),
    // #8 — knowledge source diversity histogram.
    computedTile(
      "Knowledge source diversity per agent",
      AGGREGATOR_IDS.knowledgeDiversityHistogram,
      "bar",
      { size: "medium", tabId: t.knowledge }
    ),

    // ── Authoring quality (NEW) ──────────────────────────────────────────
    // #12 — prompt length distribution.
    computedTile(
      "Prompt length distribution",
      AGGREGATOR_IDS.promptLengthHistogram,
      "bar",
      { size: "large", tabId: t.authoringQuality }
    ),
    // #15 — chatter-only agents KPI.
    kpiTile(
      "💬 Chatter-only agents",
      "Zero connector ops AND zero flows",
      [...agentScope(), ...chatterOnlyClauses()],
      "small",
      t.authoringQuality
    ),

    // ── Authoring surface (NEW) ──────────────────────────────────────────
    // #20 — authoring surface mix.
    computedTile(
      "Authoring surface mix",
      AGGREGATOR_IDS.authoringSurfaceMix,
      "pie",
      { size: "large", tabId: t.authoringSurface }
    ),
  ];

  return { tabs, tiles };
}

/** Flat tile list for back-compat with `DashboardTemplate.build()` callers
 *  that don't know about tabs. Strips `tabId` from each tile. */
function copilotStudioEstateTiles(): DashboardTile[] {
  return copilotStudioEstateLayout().tiles.map((tile) => {
    const rest = { ...tile };
    delete rest.tabId;
    return rest;
  });
}

// ---------------------------------------------------------------------------
// Power Apps templates — shared helpers
// ---------------------------------------------------------------------------

/** Scope a Power Apps tile to a set of app types AND exclude rows whose
 *  `createdBy` starts with the Dataverse system-user GUID prefix
 *  (`00000000-…`). The Power Apps analogue of `agentScope()` —
 *  without it, every Dataverse environment's first-party model-driven
 *  apps (Customer Service Hub, Sales Hub, Field Service, …) drown out
 *  customer-built signal. */
function appScope(types: ResourceTypeValue[]): Clause[] {
  const clauses: Clause[] = [];
  if (types.length === 1) {
    clauses.push(where("type", "==", [`'${types[0]}'`]));
  } else {
    clauses.push(where("type", "in~", types.map((t) => `'${t}'`)));
  }
  clauses.push(extend("__sys", "startswith(tostring(properties.createdBy), '00000000-')"));
  clauses.push(where("__sys", "==", ["false"]));
  return clauses;
}

/** Default `createdAt desc` ordering for app table tiles. */
function appOrderByCreatedDesc(): Clause {
  return orderBy({ "tostring(properties.createdAt)": "desc" });
}

/** Default column set for canvas + MDA app tables. */
const APP_TABLE_COLUMNS: TileTableColumn[] = [
  { field: "properties.displayName", header: "Name" },
  { field: "type", header: "Type" },
  { field: "properties.environmentId", header: "Environment" },
  { field: "properties.ownerId", header: "Owner" },
  { field: "properties.createdAt", header: "Created" },
  { field: "properties.lastModifiedAt", header: "Last modified" },
];

/** Canvas-only table columns (surfaces lastLaunchedTime + shared counts
 *  that only exist on canvas apps). */
const CANVAS_TABLE_COLUMNS: TileTableColumn[] = [
  { field: "properties.displayName", header: "Name" },
  { field: "properties.environmentId", header: "Environment" },
  { field: "properties.ownerId", header: "Owner" },
  { field: "properties.lastLaunchedTime", header: "Last launched" },
  { field: "properties.sharedUsersCount", header: "Users" },
  { field: "properties.sharedGroupsCount", header: "Groups" },
];

/** App-typed tile factories — small wrappers analogous to the agent
 *  factories above, parameterized by `resourceTypes` so the same factory
 *  serves canvas-only, canvas+MDA, and modern-app tiles. */
function appKpiTile(
  title: string,
  kpiLabel: string,
  clauses: Clause[],
  size: TileSize = "xs",
  tabId?: string
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size,
    viz: { type: "kpi", kpiLabel },
    spec: {
      resourceTypes: [ResourceType.CanvasApp],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 1,
    },
    source: "raw",
    clauses,
    ...(tabId ? { tabId } : {}),
  };
}

function appTableTile(
  title: string,
  clauses: Clause[],
  opts: {
    rows?: number;
    size?: TileSize;
    columns?: TileTableColumn[];
    tabId?: string;
  } = {}
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size: opts.size ?? "medium",
    viz: {
      type: "table",
      tableRows: opts.rows ?? 10,
      tableColumns: opts.columns ?? APP_TABLE_COLUMNS,
    },
    spec: {
      resourceTypes: [ResourceType.CanvasApp],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 1,
    },
    source: "raw",
    clauses,
    ...(opts.tabId ? { tabId: opts.tabId } : {}),
  };
}

function appComputedTile(
  title: string,
  aggregatorId: string,
  vizType: TileVizType,
  opts: {
    size?: TileSize;
    tabId?: string;
    kpiLabel?: string;
    tableRows?: number;
    tableColumns?: TileTableColumn[];
    params?: Record<string, unknown>;
  } = {}
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size: opts.size ?? "medium",
    viz: {
      type: vizType,
      ...(opts.kpiLabel ? { kpiLabel: opts.kpiLabel } : {}),
      ...(opts.tableRows ? { tableRows: opts.tableRows } : {}),
      ...(opts.tableColumns ? { tableColumns: opts.tableColumns } : {}),
    },
    spec: {
      resourceTypes: [ResourceType.CanvasApp],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 1,
    },
    source: "computed",
    computed: {
      aggregatorId,
      ...(opts.params ? { params: opts.params } : {}),
    },
    ...(opts.tabId ? { tabId: opts.tabId } : {}),
  };
}

// Reusable clause fragments for Power Apps tiles.

/** Filter to canvas apps that have NEVER been launched. */
function neverLaunchedClauses(): Clause[] {
  return [
    extend("__lt_set", "isnotempty(tostring(properties.lastLaunchedTime))"),
    where("__lt_set", "==", ["false"]),
  ];
}

/** Filter to apps whose last launch is older than N days. Skips
 *  never-launched (those are counted separately). */
function staleLaunchedClauses(days: number): Clause[] {
  return [
    extend("__lt_set", "isnotempty(tostring(properties.lastLaunchedTime))"),
    where("__lt_set", "==", ["true"]),
    where("properties.lastLaunchedTime", "<", [`ago(${days}d)`]),
  ];
}

/** Filter to apps created in the last N days. */
function appCreatedInLastDaysClauses(days: number): Clause[] {
  return [where("properties.createdAt", ">", [`ago(${days}d)`])];
}

/** Filter to apps whose `sharedUsersCount` exceeds `threshold`. Canvas-only
 *  signal. Uses an alias `extend` so the `where` comparison stays on a
 *  plain identifier — the proven pattern for the connector's filter
 *  surface. */
function highShareUsersClauses(threshold: number): Clause[] {
  return [
    extend("__sus", "toint(properties.sharedUsersCount)"),
    where("__sus", ">", [`${threshold}`]),
  ];
}

/** Filter to apps whose connector list (works for both `powerPlatformConnectors`
 *  on canvas apps AND `connectors` on app-builder apps) contains the given
 *  connector id. Uses the documented `tostring(...) has` pattern from
 *  `docs/inventory-schema-samples.md` for nested-array string search.
 *  Concatenates the two shapes with a `|` separator via `strcat` so a
 *  match can never bleed across the boundary between the two arrays. */
function appHasConnectorClauses(connectorId: string): Clause[] {
  return [
    extend(
      "__conns_str",
      "strcat(tostring(properties.powerPlatformConnectors), '|', tostring(properties.connectors))"
    ),
    where("__conns_str", "has", [`'${connectorId}'`]),
  ];
}

// ---------------------------------------------------------------------------
// Template: Canvas + Model-driven Estate
// ---------------------------------------------------------------------------

const CANVAS_MDA_TYPES: ResourceTypeValue[] = [
  ResourceType.CanvasApp,
  ResourceType.ModelDrivenApp,
];

const CANVAS_MDA_TABS = {
  overview: "apps-overview",
  sharing: "apps-sharing",
  lifecycle: "apps-lifecycle",
  trends: "apps-trends",
  connectors: "apps-connectors",
} as const;

function canvasMdaEstateTabs(): DashboardTab[] {
  return [
    { id: CANVAS_MDA_TABS.overview, name: "Overview" },
    { id: CANVAS_MDA_TABS.sharing, name: "Sharing & Governance" },
    { id: CANVAS_MDA_TABS.lifecycle, name: "Lifecycle" },
    { id: CANVAS_MDA_TABS.trends, name: "Trends" },
    { id: CANVAS_MDA_TABS.connectors, name: "Connectors & Dependencies" },
  ];
}

function canvasMdaEstateLayout(): { tabs: DashboardTab[]; tiles: DashboardTile[] } {
  const tabs = canvasMdaEstateTabs();
  const t = CANVAS_MDA_TABS;

  const cleanupColumns: TileTableColumn[] = [
    { field: "displayName", header: "Name" },
    { field: "type", header: "Type" },
    { field: "environmentId", header: "Environment" },
    { field: "score", header: "Score" },
    { field: "reasons", header: "Reasons" },
    { field: "ageDays", header: "Age (days)" },
    { field: "lastLaunchedAt", header: "Last launched" },
    { field: "lastModifiedAt", header: "Last modified" },
  ];

  const tiles: DashboardTile[] = [
    // ── Overview ─────────────────────────────────────────────────────────
    appKpiTile(
      "Total apps",
      "Customer-built (excl. first-party MDA)",
      [...appScope(CANVAS_MDA_TYPES)],
      "xs",
      t.overview
    ),
    appKpiTile(
      "Canvas apps",
      "Customer-built canvas",
      [...appScope([ResourceType.CanvasApp])],
      "xs",
      t.overview
    ),
    appKpiTile(
      "Model-driven apps",
      "Customer-built MDA (excl. first-party)",
      [...appScope([ResourceType.ModelDrivenApp])],
      "xs",
      t.overview
    ),
    appKpiTile(
      "Code apps",
      "Cross-link from Modern template",
      [...appScope([ResourceType.CodeApp])],
      "xs",
      t.overview
    ),
    appKpiTile(
      "App-builder apps",
      "Cross-link from Modern template",
      [...appScope([ResourceType.AppBuilderApp])],
      "xs",
      t.overview
    ),
    appComputedTile(
      "Distribution by type",
      APP_AGGREGATOR_IDS.byType,
      "pie",
      {
        size: "medium",
        tabId: t.overview,
        params: { types: CANVAS_MDA_TYPES },
      }
    ),

    // ── Sharing & Governance (canvas-only signals) ───────────────────────
    appTableTile(
      "👤 Top shared canvas apps — by users",
      [
        ...appScope([ResourceType.CanvasApp]),
        extend("__sus", "toint(properties.sharedUsersCount)"),
        where("__sus", ">", ["0"]),
        orderBy({ "__sus": "desc" }),
      ],
      { rows: 20, columns: CANVAS_TABLE_COLUMNS, size: "large", tabId: t.sharing }
    ),
    appTableTile(
      "👥 Top shared canvas apps — by groups",
      [
        ...appScope([ResourceType.CanvasApp]),
        extend("__sgs", "toint(properties.sharedGroupsCount)"),
        where("__sgs", ">", ["0"]),
        orderBy({ "__sgs": "desc" }),
      ],
      { rows: 20, columns: CANVAS_TABLE_COLUMNS, size: "large", tabId: t.sharing }
    ),
    appKpiTile(
      "🚨 Canvas apps shared with >100 users",
      "Blast radius",
      [...appScope([ResourceType.CanvasApp]), ...highShareUsersClauses(100)],
      "small",
      t.sharing
    ),
    appComputedTile(
      "🏆 Top creators (top 10)",
      APP_AGGREGATOR_IDS.topCreators,
      "bar",
      {
        size: "medium",
        tabId: t.sharing,
        params: { topN: 10, types: CANVAS_MDA_TYPES },
      }
    ),
    appComputedTile(
      "🏭 Top environments by app count",
      APP_AGGREGATOR_IDS.topEnvironments,
      "bar",
      {
        size: "medium",
        tabId: t.sharing,
        params: { topN: 10, types: CANVAS_MDA_TYPES },
      }
    ),

    // ── Lifecycle ────────────────────────────────────────────────────────
    appTableTile(
      "🥶 Stale canvas apps (last launched >180d ago)",
      [
        ...appScope([ResourceType.CanvasApp]),
        ...staleLaunchedClauses(180),
        orderBy({ "tostring(properties.lastLaunchedTime)": "asc" }),
      ],
      { rows: 15, columns: CANVAS_TABLE_COLUMNS, size: "large", tabId: t.lifecycle }
    ),
    appTableTile(
      "👻 Never-launched canvas apps",
      [
        ...appScope([ResourceType.CanvasApp]),
        ...neverLaunchedClauses(),
        appOrderByCreatedDesc(),
      ],
      { rows: 15, columns: CANVAS_TABLE_COLUMNS, size: "large", tabId: t.lifecycle }
    ),
    appTableTile(
      "🆕 New this week",
      [
        ...appScope(CANVAS_MDA_TYPES),
        ...appCreatedInLastDaysClauses(7),
        appOrderByCreatedDesc(),
      ],
      { rows: 10, tabId: t.lifecycle }
    ),
    appComputedTile(
      "Never-launched canvas apps by age",
      APP_AGGREGATOR_IDS.neverLaunchedCohorts,
      "bar",
      { size: "medium", tabId: t.lifecycle }
    ),
    appComputedTile(
      "Stale canvas apps by age since last launch",
      APP_AGGREGATOR_IDS.staleCohorts,
      "bar",
      { size: "medium", tabId: t.lifecycle }
    ),
    appComputedTile(
      "Launched vs never-launched canvas apps per environment",
      APP_AGGREGATOR_IDS.launchedVsNeverPerEnv,
      "stackedBar",
      { size: "large", tabId: t.lifecycle, params: { topN: 15 } }
    ),
    appComputedTile(
      "🧹 Cleanup candidates (scored)",
      APP_AGGREGATOR_IDS.cleanupCandidatesTable,
      "table",
      {
        size: "large",
        tabId: t.lifecycle,
        tableRows: 30,
        tableColumns: cleanupColumns,
        params: { topN: 30, types: CANVAS_MDA_TYPES },
      }
    ),

    // ── Trends ───────────────────────────────────────────────────────────
    appComputedTile(
      "Apps created over time (monthly, 12 mo)",
      APP_AGGREGATOR_IDS.createdTrend,
      "line",
      {
        size: "large",
        tabId: t.trends,
        params: {
          bucket: "month",
          lookbackDays: 365,
          dateField: "createdAt",
          types: CANVAS_MDA_TYPES,
        },
      }
    ),
    appComputedTile(
      "Cumulative app inventory (monthly, 12 mo)",
      APP_AGGREGATOR_IDS.createdTrend,
      "line",
      {
        size: "large",
        tabId: t.trends,
        params: {
          bucket: "month",
          lookbackDays: 365,
          dateField: "createdAt",
          cumulative: true,
          types: CANVAS_MDA_TYPES,
        },
      }
    ),
    appComputedTile(
      "Apps last modified — activity heartbeat (weekly, 90d)",
      APP_AGGREGATOR_IDS.createdTrend,
      "line",
      {
        size: "large",
        tabId: t.trends,
        params: {
          bucket: "week",
          lookbackDays: 90,
          dateField: "lastModifiedAt",
          types: CANVAS_MDA_TYPES,
        },
      }
    ),

    // ── Connectors & Dependencies ────────────────────────────────────────
    appComputedTile(
      "Top connectors across canvas apps",
      APP_AGGREGATOR_IDS.topConnectorsAllTypes,
      "bar",
      {
        size: "large",
        tabId: t.connectors,
        params: { topN: 15, types: [ResourceType.CanvasApp] },
      }
    ),
    appComputedTile(
      "Top connectors across all app types",
      APP_AGGREGATOR_IDS.topConnectorsAllTypes,
      "bar",
      { size: "large", tabId: t.connectors, params: { topN: 15 } }
    ),
    appComputedTile(
      "Connectors-per-app distribution",
      APP_AGGREGATOR_IDS.connectorsPerAppHistogram,
      "bar",
      { size: "medium", tabId: t.connectors }
    ),
    appKpiTile(
      "Canvas apps using SharePoint",
      "shared_sharepointonline",
      [
        ...appScope([ResourceType.CanvasApp]),
        ...appHasConnectorClauses("shared_sharepointonline"),
      ],
      "small",
      t.connectors
    ),
    appKpiTile(
      "Canvas apps using Office 365 Users",
      "shared_office365users",
      [
        ...appScope([ResourceType.CanvasApp]),
        ...appHasConnectorClauses("shared_office365users"),
      ],
      "small",
      t.connectors
    ),
    appKpiTile(
      "Canvas apps using SQL Server",
      "shared_sql",
      [
        ...appScope([ResourceType.CanvasApp]),
        ...appHasConnectorClauses("shared_sql"),
      ],
      "small",
      t.connectors
    ),
  ];

  return { tabs, tiles };
}

function canvasMdaEstateTiles(): DashboardTile[] {
  return canvasMdaEstateLayout().tiles.map((tile) => {
    const rest = { ...tile };
    delete rest.tabId;
    return rest;
  });
}

// ---------------------------------------------------------------------------
// Template: Modern Apps Estate (Code + App Builder)
// ---------------------------------------------------------------------------

const MODERN_APP_TYPES: ResourceTypeValue[] = [
  ResourceType.CodeApp,
  ResourceType.AppBuilderApp,
];

const MODERN_APPS_TABS = {
  overview: "modern-overview",
  inventory: "modern-inventory",
  trends: "modern-trends",
} as const;

function modernAppsEstateTabs(): DashboardTab[] {
  return [
    { id: MODERN_APPS_TABS.overview, name: "Overview" },
    { id: MODERN_APPS_TABS.inventory, name: "Inventory" },
    { id: MODERN_APPS_TABS.trends, name: "Trends" },
  ];
}

function modernAppsEstateLayout(): { tabs: DashboardTab[]; tiles: DashboardTile[] } {
  const tabs = modernAppsEstateTabs();
  const t = MODERN_APPS_TABS;

  const modernColumns: TileTableColumn[] = [
    { field: "properties.displayName", header: "Name" },
    { field: "properties.environmentId", header: "Environment" },
    { field: "properties.ownerId", header: "Owner" },
    { field: "properties.subType", header: "Sub-type" },
    { field: "properties.createdAt", header: "Created" },
    { field: "properties.lastModifiedAt", header: "Last modified" },
  ];

  const tiles: DashboardTile[] = [
    // ── Overview ─────────────────────────────────────────────────────────
    appKpiTile(
      "Code apps",
      "Total customer-built",
      [...appScope([ResourceType.CodeApp])],
      "xs",
      t.overview
    ),
    appKpiTile(
      "App-builder apps",
      "Total customer-built",
      [...appScope([ResourceType.AppBuilderApp])],
      "xs",
      t.overview
    ),
    appKpiTile(
      "Code apps — new this month",
      "Created in last 30 days",
      [
        ...appScope([ResourceType.CodeApp]),
        ...appCreatedInLastDaysClauses(30),
      ],
      "xs",
      t.overview
    ),
    appKpiTile(
      "App-builder apps — new this month",
      "Created in last 30 days",
      [
        ...appScope([ResourceType.AppBuilderApp]),
        ...appCreatedInLastDaysClauses(30),
      ],
      "xs",
      t.overview
    ),
    appComputedTile(
      "Code app sub-types",
      APP_AGGREGATOR_IDS.byCodeSubType,
      "pie",
      { size: "medium", tabId: t.overview }
    ),

    // ── Inventory ────────────────────────────────────────────────────────
    appTableTile(
      "All Code apps",
      [...appScope([ResourceType.CodeApp]), appOrderByCreatedDesc()],
      { rows: 30, size: "large", columns: modernColumns, tabId: t.inventory }
    ),
    appTableTile(
      "All App-builder apps",
      [...appScope([ResourceType.AppBuilderApp]), appOrderByCreatedDesc()],
      { rows: 30, size: "large", columns: modernColumns, tabId: t.inventory }
    ),

    // ── Trends ───────────────────────────────────────────────────────────
    appComputedTile(
      "Code + App-builder creation trend (monthly, 12 mo)",
      APP_AGGREGATOR_IDS.createdTrend,
      "line",
      {
        size: "large",
        tabId: t.trends,
        params: {
          bucket: "month",
          lookbackDays: 365,
          dateField: "createdAt",
          types: MODERN_APP_TYPES,
        },
      }
    ),
  ];

  return { tabs, tiles };
}

function modernAppsEstateTiles(): DashboardTile[] {
  return modernAppsEstateLayout().tiles.map((tile) => {
    const rest = { ...tile };
    delete rest.tabId;
    return rest;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  /** Builder — returns fresh tiles (with fresh IDs) on every call. Kept
   *  for back-compat with callers that want a flat single-tab layout. */
  build: () => DashboardTile[];
  /** Optional multi-tab builder. When present, callers should prefer this
   *  over `build()` so the resulting dashboard renders with the template's
   *  intended tab grouping. */
  buildLayout?: () => { tabs: DashboardTab[]; tiles: DashboardTile[] };
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: "copilot-studio-estate",
    name: "Copilot Studio Estate",
    description:
      "Estate health snapshot, configuration mix, channels & reach, " +
      "sharing & governance (incl. composite risk score and editor sprawl), " +
      "and lifecycle hot-spots for every customer-authored Copilot Studio " +
      "agent in the tenant. First-party `msdyn_*` agents are excluded by " +
      "default so the signal isn't drowned out by Dynamics-installed bots.",
    build: copilotStudioEstateTiles,
    buildLayout: copilotStudioEstateLayout,
  },
  {
    id: "canvas-mda-estate",
    name: "Canvas + Model-driven Estate",
    description:
      "Overview, sharing & governance, lifecycle hot-spots, creation trends, " +
      "and connector dependencies for every customer-built canvas and model-driven " +
      "app in the tenant. First-party Microsoft model-driven apps (system-owned " +
      "Customer Service Hub, Sales Hub, etc.) are excluded by default so the " +
      "signal isn't drowned out by Dataverse-installed apps.",
    build: canvasMdaEstateTiles,
    buildLayout: canvasMdaEstateLayout,
  },
  {
    id: "modern-apps-estate",
    name: "Modern Apps Estate (Code + App Builder)",
    description:
      "Inventory and creation trends for the newer Power Apps modalities — " +
      "Code apps (BYOC) and App Builder apps. Kept separate from the Canvas + " +
      "MDA template so growth in these emerging surfaces is visible at a glance " +
      "rather than buried under the larger canvas / model-driven population.",
    build: modernAppsEstateTiles,
    buildLayout: modernAppsEstateLayout,
  },
];

export function getDashboardTemplate(id: string): DashboardTemplate | null {
  return DASHBOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}
