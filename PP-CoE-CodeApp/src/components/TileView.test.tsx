import { describe, expect, it, vi } from "vitest";
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
