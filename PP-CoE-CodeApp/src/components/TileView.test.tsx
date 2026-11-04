import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { DashboardTile } from "../data/dashboards";

const { runRawQuery, runAggregateCount, userGet, assignmentRead } = vi.hoisted(() => ({
  runRawQuery: vi.fn(),
  runAggregateCount: vi.fn(),
  userGet: vi.fn(), assignmentRead: vi.fn(),
}));
vi.mock("../generated", () => ({
  AadusersService: { get: userGet },
  PowerPlatformforAdminsV2Service: { ListRuleAssignmentsByEnvironmentGroupId: assignmentRead },
}));
vi.mock("../data/inventory", async () => ({
  ...await vi.importActual<typeof import("../data/inventory")>("../data/inventory"),
  runRawQuery,
  runAggregateCount,
}));

import { TileView } from "./TileView";
import { dashboardTableHref } from "../data/dashboards";
import { buildClausesFromSpec } from "../data/inventory";
import { createManagedAppsEstateSource, type EstateManagedApp } from "../data/dashboardManagedAppSource";
import { getDashboardTemplate } from "../data/dashboardTemplates";
import { ResourceType, toAppRow } from "../data/inventory";
import { clearUserCache, resolveUser } from "../data/userEnrichment";
import { UserLookupContext } from "../hooks/useUserLookup";
import { ManagedAppsEstateFreshness } from "./ManagedAppsEstateFreshness";

beforeEach(() => { vi.clearAllMocks(); clearUserCache(); });

describe("Managed Apps Estate tile integration", () => {
  const app: EstateManagedApp = {
    ...toAppRow({ name: "synthetic-app", type: ResourceType.AppBuilderApp, properties: {
      subType: "microsoftApp", environmentId: "synthetic-env", displayName: "Synthetic managed app",
    } }),
    creatorName: "", origin: "", connectorIds: [], environmentType: "Sandbox", environmentManaged: false, environmentMapped: true,
    membershipKnown: true, groupId: "group", groupName: "Synthetic group", acp: "Without ACP", acpReason: "No assigned policy",
    snapshotAt: "2026-03-01T12:00:00Z",
  };
  it("shares one snapshot across mounted tiles, tab-style remounts and one explicit refresh without customer-app reads", async () => {
    const read = vi.fn().mockResolvedValue({ ok: true, data: { apps: [app], capturedAt: app.snapshotAt } });
    const source = createManagedAppsEstateSource(read);
    const template = getDashboardTemplate("managed-apps-estate")!.build();
    const total = template.find((tile) => tile.title === "Managed apps")!;
    const details = template.find((tile) => tile.title === "Managed app inventory")!;
    const view = (refreshKey: number, showDetails: boolean) => <FluentProvider theme={webLightTheme}>
      <ManagedAppsEstateFreshness source={source} />
      <TileView tile={total} refreshKey={refreshKey} managedAppsSource={source} />
      {showDetails && <TileView tile={details} refreshKey={refreshKey} managedAppsSource={source} />}
    </FluentProvider>;
    const { rerender } = render(view(0, true));
    await screen.findByRole("link", { name: "Synthetic managed app" });
    expect(screen.getByRole("link", { name: "Synthetic managed app" })).toHaveAttribute("href", "#/apps/synthetic-app?envId=synthetic-env");
    expect(screen.getByRole("link", { name: "Synthetic group" })).toHaveAttribute("href", "#/environment-groups/group");
    expect(screen.getAllByText(/Snapshot/)).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    rerender(view(0, false));
    rerender(view(0, true));
    await screen.findByRole("link", { name: "Synthetic managed app" });
    expect(read).toHaveBeenCalledTimes(1);
    rerender(view(1, true));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(runRawQuery).not.toHaveBeenCalled();
  });
  it("shows full creator GUIDs in every creator table, updates looked-up names without refetching or recounting, and distinguishes missing IDs", async () => {
    const guid = "11111111-2222-4333-8444-555555555555";
    const rows = [{ ...app, createdBy: guid }, { ...app, id: "another", createdBy: guid }, { ...app, id: "missing", createdBy: "" }];
    const read = vi.fn().mockResolvedValue({ ok: true, data: { apps: rows, capturedAt: app.snapshotAt } });
    const source = createManagedAppsEstateSource(read);
    const tiles = getDashboardTemplate("managed-apps-estate")!.build().filter((tile) =>
      ["Creator counts", "Apps by creator", "Managed app inventory"].includes(tile.title));
    const open = vi.fn();
    render(<FluentProvider theme={webLightTheme}><UserLookupContext.Provider value={open}>
      {tiles.map((tile) => <TileView key={tile.id} tile={tile} managedAppsSource={source} />)}
    </UserLookupContext.Provider></FluentProvider>);
    await waitFor(() => expect(screen.getAllByText(guid)).toHaveLength(5));
    expect(screen.getAllByText("Creator ID unavailable")).toHaveLength(3);
    expect(screen.queryByText(/Unresolved creator/)).not.toBeInTheDocument();
    expect(userGet).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: `Click to look up ${guid}` })[0]);
    expect(open).toHaveBeenCalledExactlyOnceWith(guid);
    userGet.mockResolvedValue({ success: true, data: { aaduserid: guid, displayname: "Synthetic creator" } });
    await act(async () => { await resolveUser(guid); });
    expect(screen.getAllByText("Synthetic creator")).toHaveLength(5);
    expect(screen.getAllByText(guid)).toHaveLength(5);
    expect(read).toHaveBeenCalledTimes(1);
    expect(userGet).toHaveBeenCalledTimes(1);
    expect(assignmentRead).not.toHaveBeenCalled();
    expect(runRawQuery).not.toHaveBeenCalled();
    const creatorRow = screen.getAllByText(guid)[0].closest("tr")!;
    expect(within(creatorRow).getByText("2")).toBeVisible();
  });
  it("shows connector counts and a full app denominator including malformed metadata, with secondary notes collapsed", async () => {
    const source = createManagedAppsEstateSource(vi.fn().mockResolvedValue({ ok: true, data: {
      apps: [app, { ...app, id: "uses", connectorIds: ["sql"] }, { ...app, id: "unknown", connectorIds: null }],
      capturedAt: app.snapshotAt,
    } }));
    const tile = getDashboardTemplate("managed-apps-estate")!.build().find((tile) => tile.computed?.params?.metric === "connectorCoverage")!;
    render(<FluentProvider theme={webLightTheme}><TileView tile={tile} managedAppsSource={source} /></FluentProvider>);
    const table = await screen.findByRole("table", { name: "3 apps in snapshot" });
    expect(within(table).getByText("Uses connectors")).toBeVisible();
    expect(within(table).getByText("No connectors used")).toBeVisible();
    expect(within(table).getByText("Connector metadata malformed")).toBeVisible();
    expect(within(table).getAllByText("33%")).toHaveLength(3);
  });
  it("does not display ACP group percentages over unassessed groups", async () => {
    const source = createManagedAppsEstateSource(vi.fn().mockResolvedValue({ ok: true, data: {
      apps: [app, { ...app, id: "unknown", groupId: "unknown-group", acp: "Unable to assess" }], capturedAt: app.snapshotAt,
    } }));
    const tile = getDashboardTemplate("managed-apps-estate")!.build().find((tile) => tile.computed?.params?.metric === "acpGroups")!;
    render(<FluentProvider theme={webLightTheme}><TileView tile={tile} managedAppsSource={source} /></FluentProvider>);
    const table = await screen.findByRole("table", { name: "2 groups in snapshot" });
    expect(within(table).getByText(/1 assessed/)).toBeVisible();
    expect(within(table).queryByText("Share")).not.toBeInTheDocument();
    expect(within(table).queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText("About this measure").closest("details")).not.toHaveAttribute("open");
  });
  it("expands complete detail rows locally and preserves an explicit source error", async () => {
    const read = vi.fn().mockResolvedValueOnce({ ok: true, data: { apps: [app, { ...app, id: "another", displayName: "Another app" }], capturedAt: app.snapshotAt } })
      .mockResolvedValueOnce({ ok: false, error: "Inventory incomplete" });
    const tile = getDashboardTemplate("managed-apps-estate")!.build().find((tile) => tile.title === "Managed app inventory")!;
    tile.viz.tableRows = 1;
    const source = createManagedAppsEstateSource(read);
    const { rerender } = render(<FluentProvider theme={webLightTheme}><TileView tile={tile} managedAppsSource={source} /></FluentProvider>);
    await screen.findByRole("link", { name: "Synthetic managed app" });
    expect(screen.queryByRole("link", { name: "Another app" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("link", { name: "Another app" })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
    rerender(<FluentProvider theme={webLightTheme}><TileView tile={tile} managedAppsSource={source} refreshKey={1} /></FluentProvider>);
    expect(await screen.findByText(/Inventory incomplete/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Synthetic managed app" })).not.toBeInTheDocument();
  });
  it("only constructs known internal context links and does not invent missing identities", () => {
    expect(dashboardTableHref({ field: "name", linkTo: "app" }, { id: "id/with?characters", environmentId: "env space" }))
      .toBe("#/apps/id%2Fwith%3Fcharacters?envId=env+space");
    expect(dashboardTableHref({ field: "name", linkTo: "environment" }, {})).toBeUndefined();
    expect(dashboardTableHref({ field: "name" }, { id: "javascript:alert(1)" })).toBeUndefined();
  });
});

describe("TileView grouped queries", () => {
  const groupedTile = (type: "kpi" | "table" | "bar"): DashboardTile => ({
    id: `grouped-${type}`, title: "Grouped inventory", source: "builder", viz: { type, groupBy: "type" },
    spec: {
      resourceTypes: [], filters: [], orderField: "", orderDirection: "asc", limit: 100,
      conditions: { kind: "group", operator: "any", children: [
        { kind: "condition", filter: { field: "location", op: "==", value: "west" } },
        { kind: "condition", filter: { field: "location", op: "==", value: "east" } },
      ] },
    },
  });

  it.each(["kpi", "table"] as const)("executes grouped %s with runnable grouped clauses", async (type) => {
    runRawQuery.mockResolvedValue({ ok: true, data: { items: [], totalRecords: 12 } });
    const tile = groupedTile(type);
    render(<FluentProvider theme={webLightTheme}><TileView tile={tile} /></FluentProvider>);
    await waitFor(() => expect(runRawQuery).toHaveBeenCalled());
    expect(runRawQuery.mock.calls[0][0]).toEqual(buildClausesFromSpec(tile.spec));
  });

  it("passes the intact AST into server chart aggregation", async () => {
    runAggregateCount.mockResolvedValue({ ok: true, data: [] });
    const tile = groupedTile("bar");
    render(<FluentProvider theme={webLightTheme}><TileView tile={tile} /></FluentProvider>);
    await waitFor(() => expect(runAggregateCount).toHaveBeenCalled());
    expect(runAggregateCount.mock.calls[0][0]).toEqual(tile.spec);
    expect(runRawQuery).not.toHaveBeenCalled();
  });

  it("rejects paired leaves inside groups before querying", async () => {
    const tile = groupedTile("kpi");
    tile.spec.conditions!.children.push({ kind: "condition", filter: {
      field: "__operation", op: "==", value: "DeleteItem", connectorId: "sql",
    } });
    render(<FluentProvider theme={webLightTheme}><TileView tile={tile} /></FluentProvider>);
    await waitFor(() => expect(screen.getByText(/not supported in dashboard tiles/)).toBeInTheDocument());
    expect(runRawQuery).not.toHaveBeenCalled();
    expect(runAggregateCount).not.toHaveBeenCalled();
  });
});

describe("TileView paired operation guard", () => {
  it.each(["kpi", "table"] as const)("shows unsupported %s instead of a misleading zero or empty result", async (type) => {
    const tile: DashboardTile = {
      id: `paired-${type}`,
      title: "Paired operation",
      source: "builder",
      viz: { type },
      spec: {
        resourceTypes: [],
        filters: [{ field: "__operation", op: "==", value: "DeleteItem", connectorId: "sharepointonline" }],
        orderField: "",
        orderDirection: "desc",
        limit: 100,
      },
    };
    render(<FluentProvider theme={webLightTheme}><TileView tile={tile} /></FluentProvider>);
    await waitFor(() => expect(screen.getByText(/not supported in dashboard tiles/)).toBeInTheDocument());
    expect(screen.getByText(/Run this saved query in Queries/)).toBeInTheDocument();
    expect(runRawQuery).not.toHaveBeenCalled();
    expect(runAggregateCount).not.toHaveBeenCalled();
  });
});
