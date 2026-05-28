/**
 * Dashboards & tiles.
 *
 * A dashboard is a named collection of tiles. Each tile holds a `QuerySpec`
 * (same shape the Queries view uses) plus a visualization config. Persistence
 * is localStorage today; the public functions wrap it so we can swap in a
 * Dataverse-backed store later without touching the views (see
 * `docs/roadmap.md` for the persistence migration plan).
 */

import { ResourceType, type QuerySpec, type ResourceTypeValue } from "./inventory";
import type { Clause } from "../generated/models/PowerPlatformforAdminsV2Model";

export type TileVizType = "kpi" | "table" | "bar" | "pie" | "line" | "combo";

/** A table column definition for table-viz tiles. */
export interface TileTableColumn {
  /** Dotted field path read off each item. e.g. "properties.displayName". */
  field: string;
  /** Optional header label. Falls back to a humanized version of `field`. */
  header?: string;
}

/** Time bucket size for line-chart tiles. */
export type TileTimeBucket = "day" | "week" | "month";

/** Mode for line-chart tiles. `delta` (default) plots the count per bucket —
 *  e.g. agents *created this week*. `cumulative` plots the running total
 *  through each bucket — e.g. *total* agents that existed as of the end of
 *  each week. Stock-vs-flow. Ignored for non-line viz types. */
export type TileLineMode = "delta" | "cumulative";

export interface TileViz {
  type: TileVizType;
  /** For chart viz: field whose distinct values become categories.
   *  e.g. "type", "properties.environmentId", "location". */
  groupBy?: string;
  /** For KPI viz: label under the number. Defaults to "Total". */
  kpiLabel?: string;
  /** For KPI viz: when set, an additional cumulative trend is fetched and
   *  rendered under the big number — as a sparkline (`"sparkline"`),
   *  a percent-change badge (`"percent"`), or both (`"both"`). Reuses the
   *  same data path as the cumulative line tile. */
  kpiTrend?: {
    /** Date field to bucket on. e.g. "properties.createdAt". */
    dateField: string;
    /** Lookback window in days. Defaults to 30. */
    lookbackDays?: number;
    /** Bucket size. Defaults to "day" for short windows; "week" for longer. */
    bucket?: TileTimeBucket;
    /** What to display under the number. Defaults to "both". */
    show?: "sparkline" | "percent" | "both";
  };
  /** For table viz: max rows to display. Defaults to 10. */
  tableRows?: number;
  /** For table viz: ordered list of columns to render. If unset, the renderer
   *  falls back to a sensible default (display name, type, environment). */
  tableColumns?: TileTableColumn[];
  /** Optional: cap categories shown in charts (others bucketed as "Other"). */
  maxCategories?: number;
  /** For line / combo viz: date field to bucket on X axis.
   *  e.g. "properties.createdAt", "properties.lastModifiedAt". */
  dateField?: string;
  /** For line / combo viz: time bucket size. Defaults to "week". */
  bucket?: TileTimeBucket;
  /** For line / combo viz: lookback window in days from today. Defaults to 90. */
  lookbackDays?: number;
  /** For line viz: `delta` (default) plots creations per bucket; `cumulative`
   *  plots the running total. Ignored for `combo` (which always renders both). */
  lineMode?: TileLineMode;
}

/** Display footprint hint for the auto-flow grid. */
export type TileSize = "xs" | "small" | "medium" | "large";

export interface DashboardTile {
  id: string;
  title: string;
  spec: QuerySpec;
  viz: TileViz;
  /** Display footprint hint for the auto-flow grid. */
  size?: TileSize;
  /** Where the tile's query came from. Defaults to "builder" (visual spec).
   *  When "raw", the tile runs `clauses` directly instead of `spec`. Only
   *  KPI and Table viz types support "raw" — chart viz types inject their
   *  own KQL on top of the spec and would conflict with hand-written clauses. */
  source?: "builder" | "raw";
  /** Present iff `source === "raw"`. The connector contract this tile runs. */
  clauses?: Clause[];
  /** Bookkeeping: the ID of the saved query that seeded this tile. Used to
   *  render a "Loaded from …" label in the editor; not used at render time. */
  savedQueryId?: string;
  /** Which tab inside the parent dashboard this tile belongs to. Optional in
   *  the stored shape for back-compat with v2 data that predates tabs;
   *  `normalizeDashboard` guarantees a value on every read. */
  tabId?: string;
}

/** A grouping page inside a dashboard. Tabs are a pure layout concern —
 *  they don't affect a tile's query, just where the tile renders. */
export interface DashboardTab {
  id: string;
  name: string;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  tiles: DashboardTile[];
  /** Ordered list of tabs. Optional in the stored shape for back-compat;
   *  `normalizeDashboard` guarantees ≥1 tab on every read. */
  tabs?: DashboardTab[];
  createdAt: string;
  updatedAt: string;
}

/** Stable ID of the auto-generated default tab. Stable so legacy data
 *  always normalizes into the same tab id across reloads. */
export const DEFAULT_TAB_ID = "overview";
const DEFAULT_TAB_NAME = "Overview";

const STORAGE_KEY = "ppcoe.dashboards.v2";

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Public alias of the internal ID generator — useful for callers that need
 *  to produce stable IDs for duplicated entities. */
export function newId(prefix: string): string {
  return genId(prefix);
}

function nowIso(): string {
  return new Date().toISOString();
}

function readStore(): Dashboard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Dashboard[];
  } catch {
    return [];
  }
}

function writeStore(items: Dashboard[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota or privacy mode — silent */
  }
}

/** Backfill missing-but-required fields on a stored dashboard so the rest
 *  of the module can rely on `tabs.length >= 1` and `tile.tabId` always
 *  referencing a real tab.
 *
 *  Applied on every read AND inside `updateDashboard` so the first write
 *  after a legacy load persists the migrated shape (otherwise the next
 *  patch would re-flatten the record by reading raw store again).
 *
 *  Returns the same object reference when nothing needed migrating — keeps
 *  React reference equality intact for callers that memo on dashboard. */
export function normalizeDashboard(d: Dashboard): Dashboard {
  const hasTabs = Array.isArray(d.tabs) && d.tabs.length > 0;
  const tabs: DashboardTab[] = hasTabs
    ? d.tabs!
    : [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME }];
  const validIds = new Set(tabs.map((t) => t.id));
  const fallbackId = tabs[0].id;

  let tilesChanged = false;
  const tiles = d.tiles.map((t) => {
    if (t.tabId && validIds.has(t.tabId)) return t;
    tilesChanged = true;
    return { ...t, tabId: fallbackId };
  });

  if (hasTabs && !tilesChanged) return d;
  return { ...d, tabs, tiles };
}

/** First-run sample dashboard so the view isn't empty. Doubles as the
 *  default Home page. Uses server-side aggregates for the chart tiles, so
 *  it remains fast even on tenants with tens of thousands of resources.
 *
 *  Kept intentionally small: 4 KPIs across the top, then three bar charts.
 *  Bars are used (not pies) because real CoE distributions are skewed —
 *  one or two huge buckets dominate, which makes pie labels overlap. */
function sampleDashboard(): Dashboard {
  const ts = nowIso();
  const tabId = DEFAULT_TAB_ID;
  return {
    id: genId("d"),
    name: "Tenant overview",
    description:
      "Starter dashboard — auto-served as your Home page. Edit, duplicate, or delete it any time.",
    createdAt: ts,
    updatedAt: ts,
    tabs: [{ id: tabId, name: DEFAULT_TAB_NAME }],
    tiles: [
      // ── KPI strip ──────────────────────────────────────────────────────
      {
        id: genId("t"),
        title: "Apps",
        size: "xs",
        tabId,
        viz: { type: "kpi", kpiLabel: "All app types" },
        spec: {
          resourceTypes: [
            ResourceType.CanvasApp,
            ResourceType.ModelDrivenApp,
            ResourceType.CodeApp,
            ResourceType.AppBuilderApp,
          ],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 1,
        },
      },
      {
        id: genId("t"),
        title: "Flows",
        size: "xs",
        tabId,
        viz: { type: "kpi", kpiLabel: "All flow types" },
        spec: {
          resourceTypes: [
            ResourceType.CloudFlow,
            ResourceType.AgentFlow,
            ResourceType.WorkflowAgentFlow,
          ],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 1,
        },
      },
      {
        id: genId("t"),
        title: "Agents",
        size: "xs",
        tabId,
        viz: { type: "kpi", kpiLabel: "Copilot Studio agents" },
        spec: {
          resourceTypes: [ResourceType.CopilotStudioAgent],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 1,
        },
      },
      {
        id: genId("t"),
        title: "Environments",
        size: "xs",
        tabId,
        viz: { type: "kpi", kpiLabel: "All envs" },
        spec: {
          resourceTypes: [ResourceType.Environment],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 1,
        },
      },
      // ── Three bar charts (server-side aggregates) ──────────────────────
      {
        id: genId("t"),
        title: "Apps by type",
        size: "medium",
        tabId,
        viz: { type: "bar", groupBy: "type", maxCategories: 6 },
        spec: {
          resourceTypes: [
            ResourceType.CanvasApp,
            ResourceType.ModelDrivenApp,
            ResourceType.CodeApp,
            ResourceType.AppBuilderApp,
          ],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 500,
        },
      },
      {
        id: genId("t"),
        title: "Environments by type",
        size: "medium",
        tabId,
        viz: { type: "bar", groupBy: "properties.environmentType", maxCategories: 8 },
        spec: {
          resourceTypes: [ResourceType.Environment],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 500,
        },
      },
      {
        id: genId("t"),
        title: "Agents by model",
        size: "large",
        tabId,
        viz: { type: "bar", groupBy: "properties.model", maxCategories: 12 },
        spec: {
          resourceTypes: [ResourceType.CopilotStudioAgent],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 500,
        },
      },
      // ── Trend (line chart) ─────────────────────────────────────────────
      {
        id: genId("t"),
        title: "Apps created — last 90 days",
        size: "large",
        tabId,
        viz: {
          type: "line",
          dateField: "properties.createdAt",
          bucket: "week",
          lookbackDays: 90,
        },
        spec: {
          resourceTypes: [
            ResourceType.CanvasApp,
            ResourceType.ModelDrivenApp,
            ResourceType.CodeApp,
            ResourceType.AppBuilderApp,
          ],
          filters: [],
          orderField: "",
          orderDirection: "desc",
          limit: 500,
        },
      },
    ],
  };
}

/** Read-all. If the store is empty, seeds it with a sample dashboard.
 *  Every returned dashboard is normalized (tabs present, every tile has a
 *  valid tabId). */
export function listDashboards(): Dashboard[] {
  let items = readStore();
  if (items.length === 0) {
    items = [sampleDashboard()];
    writeStore(items);
  }
  return items.map(normalizeDashboard);
}

export function getDashboard(id: string): Dashboard | null {
  const found = readStore().find((d) => d.id === id);
  return found ? normalizeDashboard(found) : null;
}

export function createDashboard(name: string, description = ""): Dashboard {
  const items = readStore();
  const ts = nowIso();
  const d: Dashboard = {
    id: genId("d"),
    name,
    description,
    createdAt: ts,
    updatedAt: ts,
    tabs: [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME }],
    tiles: [],
  };
  writeStore([d, ...items]);
  return d;
}

/** Layout passed to `createDashboardFromTemplate`. Bundling tabs+tiles in
 *  one object (instead of separate args) means a template can't ship a
 *  tile whose `tabId` references a tab that wasn't supplied — every
 *  tile.tabId is validated against `tabs` before write. */
export interface DashboardLayout {
  /** Tabs to seed the new dashboard with. When omitted, a single default
   *  tab is created (matches legacy single-tab behaviour). */
  tabs?: DashboardTab[];
  tiles: DashboardTile[];
}

/** Create a new dashboard pre-populated from a template-built layout.
 *  Caller produces the layout from its template; we handle persistence
 *  and validate that every tile is assigned to one of the supplied tabs. */
export function createDashboardFromTemplate(
  name: string,
  description: string,
  layout: DashboardLayout
): Dashboard {
  const items = readStore();
  const ts = nowIso();
  const tabs: DashboardTab[] =
    layout.tabs && layout.tabs.length > 0
      ? layout.tabs
      : [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME }];
  const validIds = new Set(tabs.map((t) => t.id));
  // Validate up front so template authors get a noisy failure rather than
  // silent rehoming. In dev this surfaces as an Error in the console; in
  // prod, the fallback assignment in normalizeDashboard still saves the
  // dashboard from rendering empty.
  for (const t of layout.tiles) {
    if (t.tabId && !validIds.has(t.tabId)) {
      console.error(
        `Dashboard template "${name}": tile "${t.title}" references ` +
          `unknown tabId "${t.tabId}". It will be rehomed to "${tabs[0].id}".`
      );
    }
  }
  const fallbackId = tabs[0].id;
  const tiles = layout.tiles.map((t) =>
    t.tabId && validIds.has(t.tabId) ? t : { ...t, tabId: fallbackId }
  );
  const d: Dashboard = {
    id: genId("d"),
    name,
    description,
    createdAt: ts,
    updatedAt: ts,
    tabs,
    tiles,
  };
  writeStore([d, ...items]);
  return d;
}

export function updateDashboard(
  id: string,
  patch: Partial<Pick<Dashboard, "name" | "description" | "tiles" | "tabs">>
): Dashboard | null {
  const items = readStore();
  const idx = items.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  // Normalize the existing record before patching so legacy data carries
  // its migrated tabs/tabId forward instead of being re-flattened.
  const current = normalizeDashboard(items[idx]);
  const merged: Dashboard = { ...current, ...patch, updatedAt: nowIso() };
  const next = normalizeDashboard(merged);
  items[idx] = next;
  writeStore(items);
  return next;
}

export function deleteDashboard(id: string): void {
  writeStore(readStore().filter((d) => d.id !== id));
}

/** Convenience for tile CRUD on a specific dashboard. */
export function upsertTile(dashboardId: string, tile: DashboardTile): Dashboard | null {
  const dash = getDashboard(dashboardId);
  if (!dash) return null;
  const tiles = dash.tiles.slice();
  const idx = tiles.findIndex((t) => t.id === tile.id);
  if (idx >= 0) tiles[idx] = tile;
  else tiles.push(tile);
  return updateDashboard(dashboardId, { tiles });
}

export function deleteTile(dashboardId: string, tileId: string): Dashboard | null {
  const dash = getDashboard(dashboardId);
  if (!dash) return null;
  return updateDashboard(dashboardId, {
    tiles: dash.tiles.filter((t) => t.id !== tileId),
  });
}

// ---------------------------------------------------------------------------
// Tab CRUD
// ---------------------------------------------------------------------------

/** Append a new tab to the dashboard. Returns the new tab (with its
 *  generated id) so callers can immediately activate it. */
export function addTab(dashboardId: string, name: string): DashboardTab | null {
  const dash = getDashboard(dashboardId);
  if (!dash) return null;
  const trimmed = name.trim() || "New tab";
  const tab: DashboardTab = { id: genId("tab"), name: trimmed };
  const tabs = [...(dash.tabs ?? []), tab];
  const updated = updateDashboard(dashboardId, { tabs });
  return updated ? tab : null;
}

export function renameTab(
  dashboardId: string,
  tabId: string,
  name: string
): Dashboard | null {
  const dash = getDashboard(dashboardId);
  if (!dash || !dash.tabs) return null;
  const trimmed = name.trim();
  if (!trimmed) return dash;
  const tabs = dash.tabs.map((t) => (t.id === tabId ? { ...t, name: trimmed } : t));
  return updateDashboard(dashboardId, { tabs });
}

/** Delete a tab. Last-tab delete is rejected (returns null) — a dashboard
 *  must always have at least one tab. When mode is `"deleteTiles"`, tiles
 *  in the deleted tab are dropped. When `"moveTilesToFirstRemaining"`, they
 *  are rehomed to the first tab in the post-deletion list (well-defined
 *  even when deleting tab 0). */
export function deleteTab(
  dashboardId: string,
  tabId: string,
  mode: "deleteTiles" | "moveTilesToFirstRemaining"
): Dashboard | null {
  const dash = getDashboard(dashboardId);
  if (!dash || !dash.tabs) return null;
  if (dash.tabs.length <= 1) return null;
  if (!dash.tabs.some((t) => t.id === tabId)) return null;
  const tabs = dash.tabs.filter((t) => t.id !== tabId);
  const targetId = tabs[0].id;
  const tiles =
    mode === "deleteTiles"
      ? dash.tiles.filter((t) => t.tabId !== tabId)
      : dash.tiles.map((t) => (t.tabId === tabId ? { ...t, tabId: targetId } : t));
  return updateDashboard(dashboardId, { tabs, tiles });
}

/** Reorder tabs to match the given id list. Ids missing from `orderedIds`
 *  are appended (in their original order) so a partial reorder can never
 *  silently drop a tab. */
export function reorderTabs(
  dashboardId: string,
  orderedIds: string[]
): Dashboard | null {
  const dash = getDashboard(dashboardId);
  if (!dash || !dash.tabs) return null;
  const byId = new Map(dash.tabs.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const next: DashboardTab[] = [];
  for (const id of orderedIds) {
    const tab = byId.get(id);
    if (tab && !seen.has(id)) {
      next.push(tab);
      seen.add(id);
    }
  }
  for (const t of dash.tabs) {
    if (!seen.has(t.id)) next.push(t);
  }
  return updateDashboard(dashboardId, { tabs: next });
}

export function moveTileToTab(
  dashboardId: string,
  tileId: string,
  tabId: string
): Dashboard | null {
  const dash = getDashboard(dashboardId);
  if (!dash || !dash.tabs) return null;
  if (!dash.tabs.some((t) => t.id === tabId)) return null;
  const tiles = dash.tiles.map((t) =>
    t.id === tileId ? { ...t, tabId } : t
  );
  return updateDashboard(dashboardId, { tiles });
}

export function newTileTemplate(tabId?: string): DashboardTile {
  return {
    id: genId("t"),
    title: "New tile",
    size: "medium",
    viz: { type: "kpi", kpiLabel: "Count" },
    spec: {
      resourceTypes: [ResourceType.CanvasApp] as ResourceTypeValue[],
      filters: [],
      orderField: "properties.lastModifiedAt",
      orderDirection: "desc",
      limit: 100,
    },
    ...(tabId ? { tabId } : {}),
  };
}
