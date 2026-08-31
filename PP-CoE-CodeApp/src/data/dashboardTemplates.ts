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
 *  customer-built signal.
 *
 *  Uses the alias-string + `!startswith` operator pattern (NOT a
 *  `startswith()` function call in `extend`) because the Inventory
 *  API's KQL whitelist surfaces `startswith` only as a `where` operator;
 *  using it as a function in `extend` returns KS006 "Missing
 *  expression" at query time. */
function appScope(types: ResourceTypeValue[]): Clause[] {
  const clauses: Clause[] = [];
  if (types.length === 1) {
    clauses.push(where("type", "==", [`'${types[0]}'`]));
  } else {
    clauses.push(where("type", "in~", types.map((t) => `'${t}'`)));
  }
  clauses.push(extend("__cb", "tostring(properties.createdBy)"));
  clauses.push(where("__cb", "!startswith", ["'00000000-'"]));
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

/** Filter to canvas apps whose `properties.powerPlatformConnectors` list
 *  contains the given connector id. Uses the documented `tostring(...)
 *  has` pattern from `docs/inventory-schema-samples.md` — the only
 *  proven-working shape for nested-array membership against the
 *  Inventory API's KQL whitelist. Canvas-scoped because that's the
 *  shape this property has; app-builder uses `properties.connectors`
 *  with a different structure and isn't covered by these KPIs. */
function appHasConnectorClauses(connectorId: string): Clause[] {
  return [
    extend("__conns_str", "tostring(properties.powerPlatformConnectors)"),
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
// Power Automate Estate template (server-side only)
// ---------------------------------------------------------------------------
//
// Tiles use ONLY server-side `source: "raw"` clauses + `source: "builder"`
// charts. There is no `fetchAllFlows`-backed client-side fold here ΓÇö the
// flow population on real tenants (often 100k+) is too large to walk
// client-side, and the connector's KQL whitelist (no `mv-expand`) means
// some aggregations are off the table entirely until Deep Scan
// integration lands.
//
// What we DROP vs. the original plan, and why:
//   - "Connectors & actions" tab ΓÇö every tile needs to walk
//     `powerPlatformConnectors[].operations[]`. Requires `mv-expand`.
//     Defer to Deep Scan.
//   - Age-cohort bar ΓÇö needed client-side bucketing.
//   - Single-owner-env table ΓÇö needed multi-axis aggregation per env.
//   - Trigger-pattern-mix bar ΓÇö the 5 individual KPIs already convey the
//     same signal without client-side rollup.
//   - Top connectors / AI flows table in Agent & AI tab ΓÇö same array-walk
//     limitation.
//
// What we MIGRATE to server-side (vs. the original computed plan):
//   - Risk score ΓåÆ `flowRiskScoreExtends()` mirrors the agent template's
//     `riskScoreExtends()` pattern. Components evaluated server-side per
//     flow, sortable, top-N takeable, count()-able.
//   - "Old recurring flows" ΓåÆ plain `where` on flowTriggerType +
//     lastModifiedAt < ago(1y).

const FLOW_TYPES = [
  ResourceType.CloudFlow,
  ResourceType.AgentFlow,
  ResourceType.WorkflowAgentFlow,
] as const;

const FLOW_TYPE_LITERALS = FLOW_TYPES.map((t) => `'${t}'`);

/** Empty QuerySpec for raw flow tiles. Renderer ignores `spec` when
 *  `source === "raw"` for the *query*, but it still reads
 *  `spec.resourceTypes` to render the type-list subheader under the tile
 *  title. Tiles that filter down to a single flow type via raw clauses
 *  should pass that type here so the subheader matches the actual scope
 *  (otherwise every per-type KPI shows all three types and looks like a
 *  double-count even though the count is correct). */
function rawFlowSpec(types: readonly ResourceTypeValue[] = FLOW_TYPES) {
  return {
    resourceTypes: [...types],
    filters: [],
    orderField: "",
    orderDirection: "desc" as const,
    limit: 1,
  };
}

/** Scope every Power Automate tile to all three flow types. */
function flowScope(): Clause[] {
  return [where("type", "in~", FLOW_TYPE_LITERALS)];
}

function orderByLastModifiedDesc(): Clause {
  return orderBy({ "tostring(properties.lastModifiedAt)": "desc" });
}

function orderByFlowCreatedDesc(): Clause {
  return orderBy({ "tostring(properties.createdAt)": "desc" });
}

// ΓöÇΓöÇ Status / lifecycle clause fragments ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function activatedClauses(): Clause[] {
  return [where("properties.status", "==", ["'Activated'"])];
}

function brokenStatusClauses(): Clause[] {
  return [where("properties.status", "in~", ["'Suspended'", "'Stopped'", "'Deactivated'"])];
}

function staleActivatedClauses(days: number): Clause[] {
  return [
    ...activatedClauses(),
    where("properties.lastModifiedAt", "<", [`ago(${days}d)`]),
  ];
}

function flowCreatedInLastDaysClauses(days: number): Clause[] {
  return [where("properties.createdAt", ">", [`ago(${days}d)`])];
}

function flowCreatedMoreThanDaysAgoClauses(days: number): Clause[] {
  return [where("properties.createdAt", "<", [`ago(${days}d)`])];
}

// ΓöÇΓöÇ Trigger-pattern clause fragments ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function pollingTriggerClauses(): Clause[] {
  return [where("properties.flowTriggerType", "in~", ["'Recurrence'", "'Scheduled'"])];
}

function powerAppsCoupledClauses(): Clause[] {
  return [
    extend(
      "__top",
      "coalesce(tostring(properties.triggerOperation), tostring(properties.trigger.operationId))"
    ),
    where("__top", "==", ["'RequestPowerAppV2'"]),
  ];
}

function emailTriggeredClauses(): Clause[] {
  return [
    extend(
      "__tcid",
      "coalesce(tostring(properties.trigger.connectorId), tostring(properties.trigger))"
    ),
    where("__tcid", "startswith", ["'office365'"]),
  ];
}

function sharePointEventClauses(): Clause[] {
  return [
    extend(
      "__tcid",
      "coalesce(tostring(properties.trigger.connectorId), tostring(properties.trigger))"
    ),
    where("__tcid", "==", ["'sharepointonline'"]),
  ];
}

function dataverseEventClauses(): Clause[] {
  return [
    extend(
      "__tcid",
      "coalesce(tostring(properties.trigger.connectorId), tostring(properties.trigger))"
    ),
    where("__tcid", "==", ["'commondataserviceforapps'"]),
  ];
}

/** Old recurring flows: polling trigger AND lastModified > 1y ago.
 *  INFORMATIONAL ΓÇö surfaces long-running schedules that may or may not
 *  be intentional. Not part of the risk score (too many false positives
 *  on legit cron-style flows: payroll, archival, monthly compliance). */
function oldRecurringFlowClauses(days = 365): Clause[] {
  return [
    ...pollingTriggerClauses(),
    where("properties.lastModifiedAt", "<", [`ago(${days}d)`]),
  ];
}

// ΓöÇΓöÇ Ownership clause fragments ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function orphanedFlowClauses(): Clause[] {
  return [
    extend("__ownset", "isnotempty(tostring(properties.ownerId))"),
    extend(
      "__own_orph",
      `iif(__ownset == false or tostring(properties.ownerId) == '${ZERO_GUID}', 1, 0)`
    ),
    where("__own_orph", "==", ["1"]),
  ];
}

// ΓöÇΓöÇ Composite risk score (server-side) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
//
// Mirrors the CS template's `riskScoreExtends()` shape: a chain of
// `extend` clauses that each contribute 0 or 1 to a final `__risk` sum.
// Tiles wrap `flowRiskScoreExtends()` and add a `where __risk >= N` /
// `orderBy __risk desc` to filter / sort.

/** v1 risk components (each +1):
 *   - Orphaned: ownerId empty or zero-GUID
 *   - Stale-Activated: status Activated AND lastModifiedAt > 180d ago
 *   - Broken: status in (Suspended, Stopped, Deactivated)
 *   - Solution-less: workflowEntityId empty or zero-GUID
 *
 * "Abandoned polling" (Recurrence + old) deliberately excluded ΓÇö too many
 * false positives on legitimate long-running schedules. It surfaces as
 * the informational `oldRecurringFlowClauses` tile instead. */
function flowRiskScoreExtends(staleDays = 180): Clause[] {
  return [
    extend(
      "__r_orph",
      `iif(isempty(tostring(properties.ownerId)) or tostring(properties.ownerId) == '${ZERO_GUID}', 1, 0)`
    ),
    extend(
      "__r_act",
      "iif(tostring(properties.status) == 'Activated', 1, 0)"
    ),
    extend(
      "__r_lm_old",
      `iif(properties.lastModifiedAt < ago(${staleDays}d), 1, 0)`
    ),
    extend("__r_stale", "__r_act * __r_lm_old"),
    extend(
      "__r_broken",
      "iif(tostring(properties.status) in~ ('Suspended', 'Stopped', 'Deactivated'), 1, 0)"
    ),
    extend(
      "__r_solnless",
      `iif(isempty(tostring(properties.workflowEntityId)) or tostring(properties.workflowEntityId) == '${ZERO_GUID}', 1, 0)`
    ),
    extend("__risk", "__r_orph + __r_stale + __r_broken + __r_solnless"),
  ];
}

// ΓöÇΓöÇ Tab structure ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const FLOW_ESTATE_TABS = {
  overview: "flow-estate-overview",
  config: "flow-estate-configuration",
  lifecycle: "flow-estate-lifecycle",
  ownership: "flow-estate-ownership",
  triggers: "flow-estate-triggers",
  agentAi: "flow-estate-agent-ai",
  risk: "flow-estate-risk",
} as const;

function flowEstateTabs(): DashboardTab[] {
  return [
    { id: FLOW_ESTATE_TABS.overview, name: "Overview" },
    { id: FLOW_ESTATE_TABS.config, name: "Configuration & triggers" },
    { id: FLOW_ESTATE_TABS.lifecycle, name: "Lifecycle" },
    { id: FLOW_ESTATE_TABS.ownership, name: "Ownership & environments" },
    { id: FLOW_ESTATE_TABS.triggers, name: "Trigger patterns" },
    { id: FLOW_ESTATE_TABS.agentAi, name: "Agent & AI flows" },
    { id: FLOW_ESTATE_TABS.risk, name: "Risk / governance" },
  ];
}

// ΓöÇΓöÇ Tile factories scoped to flows ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function flowKpiTile(
  title: string,
  kpiLabel: string,
  clauses: Clause[],
  size: TileSize = "xs",
  tabId?: string,
  scopedTypes?: readonly ResourceTypeValue[]
): DashboardTile {
  return {
    id: newId("t"),
    title,
    size,
    viz: { type: "kpi", kpiLabel },
    spec: rawFlowSpec(scopedTypes),
    source: "raw",
    clauses,
    ...(tabId ? { tabId } : {}),
  };
}

const FLOW_TABLE_COLUMNS: TileTableColumn[] = [
  { field: "properties.displayName", header: "Name" },
  { field: "type", header: "Type" },
  { field: "properties.status", header: "Status" },
  { field: "properties.flowTriggerType", header: "Trigger" },
  { field: "properties.environmentId", header: "Environment" },
  { field: "properties.ownerId", header: "Owner" },
  { field: "properties.lastModifiedAt", header: "Last modified" },
];

function flowTableTile(
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
      tableColumns: opts.columns ?? FLOW_TABLE_COLUMNS,
    },
    spec: rawFlowSpec(),
    source: "raw",
    clauses,
    ...(opts.tabId ? { tabId: opts.tabId } : {}),
  };
}

function flowPieTile(
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
      resourceTypes: [...FLOW_TYPES],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 500,
    },
    ...(tabId ? { tabId } : {}),
  };
}

function flowBarTile(
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
      resourceTypes: [...FLOW_TYPES],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 500,
    },
    ...(tabId ? { tabId } : {}),
  };
}

function flowLineTile(
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
      resourceTypes: [...FLOW_TYPES],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 500,
    },
    ...(tabId ? { tabId } : {}),
  };
}

// ΓöÇΓöÇ The layout ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function powerAutomateEstateLayout(): { tabs: DashboardTab[]; tiles: DashboardTile[] } {
  const tabs = flowEstateTabs();
  const t = FLOW_ESTATE_TABS;

  const riskColumns: TileTableColumn[] = [
    { field: "properties.displayName", header: "Name" },
    { field: "__risk", header: "Risk" },
    { field: "__r_orph", header: "Orphaned" },
    { field: "__r_stale", header: "Stale-Activated" },
    { field: "__r_broken", header: "Broken" },
    { field: "__r_solnless", header: "Solution-less" },
    { field: "type", header: "Type" },
    { field: "properties.environmentId", header: "Environment" },
    { field: "properties.ownerId", header: "Owner" },
    { field: "properties.lastModifiedAt", header: "Last modified" },
  ];
  const oldRecurringColumns: TileTableColumn[] = [
    { field: "properties.displayName", header: "Name" },
    { field: "properties.environmentId", header: "Environment" },
    { field: "properties.ownerId", header: "Owner" },
    { field: "properties.status", header: "Status" },
    { field: "properties.flowTriggerType", header: "Trigger" },
    { field: "properties.lastModifiedAt", header: "Last modified" },
  ];

  const tiles: DashboardTile[] = [
    // ΓöÇΓöÇ Overview ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    flowKpiTile("Total flows", "All flow types", [...flowScope()], "xs", t.overview),
    flowKpiTile(
      "Cloud flows",
      "microsoft.powerautomate/cloudflows",
      [where("type", "==", [`'${ResourceType.CloudFlow}'`])],
      "xs",
      t.overview,
      [ResourceType.CloudFlow]
    ),
    flowKpiTile(
      "Agent flows",
      "microsoft.powerautomate/agentflows",
      [where("type", "==", [`'${ResourceType.AgentFlow}'`])],
      "xs",
      t.overview,
      [ResourceType.AgentFlow]
    ),
    flowKpiTile(
      "Workflow agent flows",
      "microsoft.powerautomate/m365agentflows",
      [where("type", "==", [`'${ResourceType.WorkflowAgentFlow}'`])],
      "xs",
      t.overview,
      [ResourceType.WorkflowAgentFlow]
    ),
    flowKpiTile(
      "Activated",
      "Currently running",
      [...flowScope(), ...activatedClauses()],
      "xs",
      t.overview
    ),
    flowKpiTile(
      "Broken / disabled",
      "Suspended + Stopped + Deactivated",
      [...flowScope(), ...brokenStatusClauses()],
      "xs",
      t.overview
    ),
    flowKpiTile(
      "≡ƒÑ╢ Stale-Activated (180d+)",
      "Activated but unmodified >180d",
      [...flowScope(), ...staleActivatedClauses(180)],
      "xs",
      t.overview
    ),
    flowKpiTile(
      "≡ƒåò New this week",
      "Created in last 7 days",
      [...flowScope(), ...flowCreatedInLastDaysClauses(7)],
      "xs",
      t.overview
    ),

    // ΓöÇΓöÇ Configuration & triggers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    flowPieTile("Status distribution", "properties.status", "small", 8, t.config),
    flowPieTile("Trigger type", "properties.flowTriggerType", "small", 8, t.config),
    flowBarTile("Flows by type", "type", "medium", 6, t.config),
    flowPieTile(
      "Trigger source (connector)",
      "properties.trigger",
      "medium",
      10,
      t.config
    ),
    flowBarTile(
      "Top trigger operations",
      "properties.triggerOperation",
      "large",
      12,
      t.config
    ),

    // ΓöÇΓöÇ Lifecycle ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    flowTableTile(
      "≡ƒÑ╢ Stale-Activated flows (>180d unmodified, still Activated)",
      [...flowScope(), ...staleActivatedClauses(180), orderByLastModifiedDesc()],
      { rows: 15, size: "large", tabId: t.lifecycle }
    ),
    flowTableTile(
      "≡ƒÆÇ Broken / disabled flows (>90d old)",
      [
        ...flowScope(),
        ...brokenStatusClauses(),
        ...flowCreatedMoreThanDaysAgoClauses(90),
        orderByLastModifiedDesc(),
      ],
      { rows: 15, size: "large", tabId: t.lifecycle }
    ),
    flowTableTile(
      "≡ƒåò New this week",
      [...flowScope(), ...flowCreatedInLastDaysClauses(7), orderByFlowCreatedDesc()],
      { rows: 10, tabId: t.lifecycle }
    ),
    flowLineTile(
      "Flows created over time (weekly, 180d)",
      "properties.createdAt",
      "week",
      180,
      "large",
      t.lifecycle
    ),

    // ΓöÇΓöÇ Ownership & environments ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    flowBarTile("≡ƒÅå Top creators", "properties.createdBy", "medium", 10, t.ownership),
    flowBarTile("Top owners", "properties.ownerId", "medium", 10, t.ownership),
    flowBarTile(
      "≡ƒÅ¡ Top environments by flow count",
      "properties.environmentId",
      "medium",
      10,
      t.ownership
    ),
    flowKpiTile(
      "≡ƒ¬ª Orphaned flows",
      "Owner is empty or zero-GUID",
      [...flowScope(), ...orphanedFlowClauses()],
      "small",
      t.ownership
    ),

    // ΓöÇΓöÇ Trigger patterns ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    flowKpiTile(
      "≡ƒòÆ Polling flows",
      "Recurrence / Scheduled trigger",
      [...flowScope(), ...pollingTriggerClauses()],
      "xs",
      t.triggers
    ),
    flowKpiTile(
      "≡ƒº⌐ Power Apps-coupled",
      "Triggered by a canvas/model app",
      [...flowScope(), ...powerAppsCoupledClauses()],
      "xs",
      t.triggers
    ),
    flowKpiTile(
      "≡ƒôº Email-triggered",
      "Triggered by Outlook / Office 365 mail",
      [...flowScope(), ...emailTriggeredClauses()],
      "xs",
      t.triggers
    ),
    flowKpiTile(
      "≡ƒôü SharePoint-event",
      "Triggered by a SharePoint event",
      [...flowScope(), ...sharePointEventClauses()],
      "xs",
      t.triggers
    ),
    flowKpiTile(
      "≡ƒôª Dataverse-event",
      "Triggered by a Dataverse event",
      [...flowScope(), ...dataverseEventClauses()],
      "xs",
      t.triggers
    ),
    flowTableTile(
      "Γä╣∩╕Å Old recurring flows (>1y unmodified) ΓÇö informational, not a risk signal",
      [
        ...flowScope(),
        ...oldRecurringFlowClauses(365),
        orderByLastModifiedDesc(),
      ],
      {
        rows: 20,
        size: "large",
        tabId: t.triggers,
        columns: oldRecurringColumns,
      }
    ),

    // ΓöÇΓöÇ Agent & AI flows ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    flowKpiTile(
      "Agent flows",
      "microsoft.powerautomate/agentflows",
      [where("type", "==", [`'${ResourceType.AgentFlow}'`])],
      "xs",
      t.agentAi,
      [ResourceType.AgentFlow]
    ),
    flowKpiTile(
      "Workflow agent flows",
      "microsoft.powerautomate/m365agentflows",
      [where("type", "==", [`'${ResourceType.WorkflowAgentFlow}'`])],
      "xs",
      t.agentAi,
      [ResourceType.WorkflowAgentFlow]
    ),
    flowBarTile(
      "Agent + workflow flows by trigger type",
      "properties.flowTriggerType",
      "medium",
      8,
      t.agentAi
    ),
    flowBarTile(
      "Agent + workflow flows by environment",
      "properties.environmentId",
      "medium",
      10,
      t.agentAi
    ),

    // ΓöÇΓöÇ Risk / governance ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    flowKpiTile(
      "≡ƒÜ¿ High-risk flows (score ΓëÑ 3)",
      "Risk components: orphaned + stale-Activated + broken + solution-less",
      [...flowScope(), ...flowRiskScoreExtends(180), where("__risk", ">=", ["3"])],
      "small",
      t.risk
    ),
    flowKpiTile(
      "ΓÜá∩╕Å Flows with any risk (score ΓëÑ 1)",
      "Any single risk component triggered",
      [...flowScope(), ...flowRiskScoreExtends(180), where("__risk", ">=", ["1"])],
      "small",
      t.risk
    ),
    flowTableTile(
      "Risk score per flow (top 30)",
      [
        ...flowScope(),
        ...flowRiskScoreExtends(180),
        where("__risk", ">=", ["1"]),
        orderBy({ "__risk": "desc" }),
      ],
      {
        rows: 30,
        size: "large",
        tabId: t.risk,
        columns: riskColumns,
      }
    ),
  ];

  return { tabs, tiles };
}

/** Flat tile list for back-compat with `DashboardTemplate.build()`. */
function powerAutomateEstateTiles(): DashboardTile[] {
  return powerAutomateEstateLayout().tiles.map((tile) => {
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
  {
    id: "power-automate-estate",
    name: "Power Automate Estate",
    description:
      "Estate health snapshot for every Power Automate flow in the tenant " +
      "— cloud flows, agent flows, and workflow (M365) agent flows " +
      "together. Server-side tiles only (no client-side population walk), " +
      "so it loads fast even on tenants with 100k+ flows. Covers status " +
      "and trigger mix, lifecycle cleanup signals (stale-Activated, " +
      "broken, new), ownership concentration, trigger patterns " +
      "(polling, app-coupled, email/SharePoint/Dataverse-event), and a " +
      "composite risk score (orphaned + stale-Activated + broken + " +
      "solution-less). Deep array-walking queries (top connectors, " +
      "AI-connector usage) require a manual deep scan and aren't in this " +
      "template.",
    build: powerAutomateEstateTiles,
    buildLayout: powerAutomateEstateLayout,
  },
];

export function getDashboardTemplate(id: string): DashboardTemplate | null {
  return DASHBOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}
