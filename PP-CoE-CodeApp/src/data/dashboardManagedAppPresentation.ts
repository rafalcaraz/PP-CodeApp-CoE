import type { DashboardTile, TileViz } from "./dashboards";

const groupColumns: NonNullable<TileViz["tableColumns"]> = [
  { field: "groupName", header: "Environment group", linkTo: "environment-group", titleField: "groupId" },
  { field: "apps", header: "Apps" }, { field: "environments", header: "Environments" },
  { field: "acp", header: "ACP assignment", titleField: "reason" },
];
const revisions: Record<string, { title: string; before: TileViz; after: TileViz; newTitle?: string }> = {
  creatorsTable: {
    title: "Creator counts",
    before: { type: "table", tableRows: 25, tableColumns: [
      { field: "creator", header: "Created by", titleField: "creatorId" }, { field: "apps", header: "Apps" },
    ], tableExpandable: true },
    after: { type: "table", tableRows: 25, tableColumns: [
      { field: "rank", header: "Rank" },
      { field: "creator", header: "Created by", titleField: "creatorId" }, { field: "apps", header: "Apps" },
    ], tableExpandable: true },
  },
  environmentGroups: {
    title: "Apps & environments by group", before: { type: "stackedBar", stackSeries: false },
    after: { type: "table", tableRows: 25, tableExpandable: true, tableColumns: groupColumns },
  },
  environmentTypes: {
    title: "Environment types", before: { type: "stackedBar", stackSeries: false },
    after: { type: "pie", compositionUnit: "apps" },
  },
  acpApps: {
    title: "ACP coverage · apps", before: { type: "bar" }, after: { type: "pie", compositionUnit: "apps" },
  },
  acpGroups: {
    title: "ACP coverage · app-bearing groups", before: { type: "bar" }, after: { type: "pie", compositionUnit: "groups" },
  },
  connectorCoverage: {
    title: "Connector usage coverage", before: { type: "bar" }, after: { type: "pie", compositionUnit: "apps" },
  },
  coverage: {
    title: "Creation & data coverage", newTitle: "Recent creation",
    before: { type: "table", tableRows: 10, tableColumns: [
      { field: "field", header: "Measure" }, { field: "apps", header: "Apps" },
    ], tableExpandable: true },
    after: { type: "table", tableRows: 2, tableColumns: [
      { field: "field", header: "Created" }, { field: "apps", header: "Apps" },
    ], tableExpandable: false },
  },
};

/** Retire only the unchanged template tile, including the first-build saved form. */
export function isRetiredManagedAppsDefaultTile(tile: DashboardTile): boolean {
  if (tile.source !== "computed" || tile.computed?.aggregatorId !== "managedApps.estate"
    || tile.title !== "Managed-environment status" || tile.computed.params?.metric !== "environmentManaged"
    || tile.size !== "medium" || (tile.tabId !== undefined && tile.tabId !== "managed-governance")
    || tile.savedQueryId || tile.clauses) return false;
  const params = tile.computed.params;
  if (Object.keys(params).some((key) => key !== "metric" && key !== "presentation")) return false;
  return params.presentation === undefined && sameValue(tile.viz, { type: "stackedBar", stackSeries: false })
    || params.presentation === 2 && sameValue(tile.viz, { type: "pie", compositionUnit: "apps" });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

/** Upgrade only exact first-build defaults; retain IDs, placement and every customized tile. */
export function reviseManagedAppsEstateTile(tile: DashboardTile): DashboardTile {
  if (tile.source !== "computed" || tile.computed?.aggregatorId !== "managedApps.estate") return tile;
  const params = tile.computed.params ?? {};
  if (params.presentation !== undefined || Object.keys(params).some((key) => key !== "metric")) return tile;
  const revision = typeof params.metric === "string" ? revisions[params.metric] : undefined;
  if (!revision || tile.title !== revision.title || !sameValue(tile.viz, revision.before)) return tile;
  return { ...tile, title: revision.newTitle ?? tile.title, viz: { ...revision.after,
    ...(revision.after.tableColumns ? { tableColumns: revision.after.tableColumns.map((column) => ({ ...column })) } : {}) },
    computed: { ...tile.computed, params: { ...params, presentation: 2 } } };
}
