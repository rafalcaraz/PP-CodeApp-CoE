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
} from "./inventory";
import type {
  DashboardTab,
  DashboardTile,
  TileSize,
  TileTableColumn,
} from "./dashboards";
import { newId } from "./dashboards";

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
} as const;

function estateTabs(): DashboardTab[] {
  return [
    { id: ESTATE_TABS.overview, name: "Overview" },
    { id: ESTATE_TABS.config, name: "Configuration" },
    { id: ESTATE_TABS.channels, name: "Channels & Reach" },
    { id: ESTATE_TABS.sharing, name: "Sharing & Governance" },
    { id: ESTATE_TABS.lifecycle, name: "Lifecycle" },
    { id: ESTATE_TABS.trends, name: "Trends" },
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

    // ── Trends ───────────────────────────────────────────────────────────
    lineTile(
      "Agents created over time (weekly, 180d)",
      "properties.createdAt",
      "week",
      180,
      "large",
      t.trends
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
];

export function getDashboardTemplate(id: string): DashboardTemplate | null {
  return DASHBOARD_TEMPLATES.find((t) => t.id === id) ?? null;
}
