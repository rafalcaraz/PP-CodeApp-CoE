import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { DashboardTile } from "../data/dashboards";

const { runRawQuery, runAggregateCount } = vi.hoisted(() => ({
  runRawQuery: vi.fn(),
  runAggregateCount: vi.fn(),
}));
vi.mock("../data/inventory", async () => ({
  ...await vi.importActual<typeof import("../data/inventory")>("../data/inventory"),
  runRawQuery,
  runAggregateCount,
}));

import { TileView } from "./TileView";
import { buildClausesFromSpec } from "../data/inventory";

beforeEach(() => vi.clearAllMocks());

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
