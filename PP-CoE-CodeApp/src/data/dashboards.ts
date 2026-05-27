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
}

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  tiles: DashboardTile[];
  createdAt: string;
  updatedAt: string;
}

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

/** First-run sample dashboard so the view isn't empty. Doubles as the
 *  default Home page. Uses server-side aggregates for the chart tiles, so
 *  it remains fast even on tenants with tens of thousands of resources.
 *
 *  Kept intentionally small: 4 KPIs across the top, then three bar charts.
 *  Bars are used (not pies) because real CoE distributions are skewed —
 *  one or two huge buckets dominate, which makes pie labels overlap. */
function sampleDashboard(): Dashboard {
  const ts = nowIso();
  return {
    id: genId("d"),
    name: "Tenant overview",
    description:
      "Starter dashboard — auto-served as your Home page. Edit, duplicate, or delete it any time.",
    createdAt: ts,
    updatedAt: ts,
    tiles: [
      // ── KPI strip ──────────────────────────────────────────────────────
      {
        id: genId("t"),
        title: "Apps",
        size: "xs",
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

/** Read-all. If the store is empty, seeds it with a sample dashboard. */
export function listDashboards(): Dashboard[] {
  let items = readStore();
  if (items.length === 0) {
    items = [sampleDashboard()];
    writeStore(items);
  }
  return items;
}

export function getDashboard(id: string): Dashboard | null {
  return readStore().find((d) => d.id === id) ?? null;
}

export function createDashboard(name: string, description = ""): Dashboard {
  const items = readStore();
  const d: Dashboard = {
    id: genId("d"),
    name,
    description,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    tiles: [],
  };
  writeStore([d, ...items]);
  return d;
}

/** Create a new dashboard pre-populated from a template's tile builder.
 *  Caller is responsible for getting the template's tiles via its `build()`
 *  function and passing them in — that keeps this function decoupled from
 *  the template module (avoids a cycle). */
export function createDashboardFromTemplate(
  name: string,
  description: string,
  tiles: DashboardTile[]
): Dashboard {
  const items = readStore();
  const ts = nowIso();
  const d: Dashboard = {
    id: genId("d"),
    name,
    description,
    createdAt: ts,
    updatedAt: ts,
    tiles,
  };
  writeStore([d, ...items]);
  return d;
}

export function updateDashboard(
  id: string,
  patch: Partial<Pick<Dashboard, "name" | "description" | "tiles">>
): Dashboard | null {
  const items = readStore();
  const idx = items.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  const next: Dashboard = { ...items[idx], ...patch, updatedAt: nowIso() };
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

export function newTileTemplate(): DashboardTile {
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
  };
}
