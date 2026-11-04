import { beforeEach, describe, expect, it } from "vitest";
import { getDashboard, upsertTile, type Dashboard, type DashboardTile } from "./dashboards";
import { reviseManagedAppsEstateTile } from "./dashboardManagedAppPresentation";
import { getDashboardTemplate } from "./dashboardTemplates";
const storage = "ppcoe.dashboards.v2";
const oldTile = (metric: string, title: string, viz: DashboardTile["viz"]): DashboardTile => ({
  id: `saved-${metric}`, title, viz, size: "large", tabId: "my-custom-tab", source: "computed",
  computed: { aggregatorId: "managedApps.estate", params: { metric } },
  spec: { resourceTypes: [], filters: [], orderField: "", orderDirection: "asc", limit: 500 },
});
beforeEach(() => localStorage.clear());
describe("Managed Apps Estate saved-default revisions", () => {
  it("updates an existing saved dashboard in place on read and persists on the next supported write", () => {
    const tile = oldTile("environmentGroups", "Apps & environments by group", { type: "stackedBar", stackSeries: false });
    const dashboard: Dashboard = { id: "saved", name: "My estate", description: "My description",
      createdAt: "old-created", updatedAt: "old-updated", tabs: [{ id: tile.tabId!, name: "My tab" }], tiles: [tile] };
    localStorage.setItem(storage, JSON.stringify([dashboard]));
    const read = getDashboard("saved")!;
    expect(read).toMatchObject({ id: "saved", name: "My estate", description: "My description", tabs: dashboard.tabs });
    expect(read.tiles[0]).toMatchObject({ id: tile.id, title: tile.title, size: "large", tabId: tile.tabId, viz: { type: "table" },
      computed: { params: { metric: "environmentGroups", presentation: 2 } } });
    expect(JSON.parse(localStorage.getItem(storage)!)[0].tiles[0].viz.type).toBe("stackedBar");
    upsertTile("saved", read.tiles[0]);
    expect(JSON.parse(localStorage.getItem(storage)!)[0].tiles[0].viz.type).toBe("table");
    expect(getDashboard("saved")!.tiles).toHaveLength(1);
    expect(reviseManagedAppsEstateTile(read.tiles[0])).toBe(read.tiles[0]);
  });
  it("never overwrites customized titles, visualizations, parameters or other estates", () => {
    const tile = oldTile("connectorCoverage", "Connector usage coverage", { type: "bar" });
    for (const customized of [
      { ...tile, title: "My connector view" }, { ...tile, viz: { type: "pie" as const } },
      { ...tile, viz: { type: "bar" as const, maxCategories: 3 } },
      { ...tile, computed: { ...tile.computed!, params: { metric: "connectorCoverage", myParameter: true } } },
      { ...tile, computed: { aggregatorId: "apps.byType" } },
    ]) expect(reviseManagedAppsEstateTile(customized)).toBe(customized);
    const revised = reviseManagedAppsEstateTile(tile);
    expect(revised).toMatchObject({ viz: { type: "pie", compositionUnit: "apps" } });
    expect(revised.id).toBe(tile.id);
  });
  it("builds revised defaults without shared mutable visualizations or changing the old saved snapshot definition", () => {
    const first = getDashboardTemplate("managed-apps-estate")!.build();
    const second = getDashboardTemplate("managed-apps-estate")!.build();
    expect(first.find((tile) => tile.computed?.params?.metric === "connectorCoverage")?.viz)
      .toEqual({ type: "pie", compositionUnit: "apps" });
    expect(first.find((tile) => tile.computed?.params?.metric === "environmentGroups")?.viz.type).toBe("table");
    const a = first.find((tile) => tile.title === "Recent creation")!;
    const b = second.find((tile) => tile.title === "Recent creation")!;
    a.viz.tableRows = 300;
    expect(b.viz.tableRows).toBe(2);
    expect(first.filter((tile) => tile.viz.type === "kpi")).toHaveLength(4);
    expect(first.some((tile) => tile.computed?.params?.metric === "environmentManaged")).toBe(false);
    expect(first.some((tile) => tile.computed?.params?.metric === "environmentTypes")).toBe(true);
    expect(first.some((tile) => tile.computed?.params?.metric === "acpApps")).toBe(true);
  });
  it("removes both exact saved status defaults but preserves customized status tiles, layout and other estates", () => {
    const original = { ...oldTile("environmentManaged", "Managed-environment status", { type: "stackedBar", stackSeries: false }),
      tabId: "managed-governance", size: "medium" as const };
    const revised = { ...original, id: "revised-default", viz: { type: "pie" as const, compositionUnit: "apps" as const },
      computed: { ...original.computed!, params: { metric: "environmentManaged", presentation: 2 } } };
    const customized: DashboardTile[] = [
      { ...original, id: "renamed", title: "My status tile" },
      { ...revised, id: "resized", size: "large" },
      { ...revised, id: "moved", tabId: "custom" },
      { ...original, id: "custom-viz", viz: { ...original.viz, maxCategories: 3 } },
      { ...original, id: "custom-params", computed: { ...original.computed!, params: { metric: "environmentManaged", mySetting: true } } },
      { ...original, id: "another-estate", computed: { aggregatorId: "apps.byType" } },
    ];
    const dashboard: Dashboard = { id: "saved", name: "My estate", description: "", createdAt: "created", updatedAt: "updated",
      tabs: [{ id: "managed-governance", name: "Governance" }, { id: "custom", name: "Custom" }],
      tiles: [original, revised, ...customized] };
    localStorage.setItem(storage, JSON.stringify([dashboard]));
    const read = getDashboard("saved")!;
    expect(read.tiles).toEqual(customized);
    expect(read.tabs).toEqual(dashboard.tabs);
    expect(read.id).toBe(dashboard.id);
    expect(JSON.parse(localStorage.getItem(storage)!)[0].tiles).toHaveLength(8);
    upsertTile("saved", customized[0]);
    expect(getDashboard("saved")!.tiles).toEqual(customized);
    expect(JSON.parse(localStorage.getItem(storage)!)[0].tiles).toHaveLength(6);
  });
});
