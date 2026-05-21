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

export type TileVizType = "kpi" | "table" | "bar" | "pie";

export interface TileViz {
  type: TileVizType;
  /** For chart viz: field whose distinct values become categories.
   *  e.g. "type", "properties.environmentId", "location". */
  groupBy?: string;
  /** For KPI viz: label under the number. Defaults to "Total". */
  kpiLabel?: string;
  /** For table viz: max rows to display. Defaults to 10. */
  tableRows?: number;
  /** Optional: cap categories shown in charts (others bucketed as "Other"). */
  maxCategories?: number;
}

export interface DashboardTile {
  id: string;
  title: string;
  spec: QuerySpec;
  viz: TileViz;
  /** Display footprint hint for the auto-flow grid. */
  size?: "xs" | "small" | "medium" | "large";
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
