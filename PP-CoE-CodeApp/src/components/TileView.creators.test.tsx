import { cloneElement, type ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { toAppRow, ResourceType } from "../data/inventory";
import { createManagedAppsEstateSource, type EstateManagedApp } from "../data/dashboardManagedAppSource";
import { getDashboardTemplate } from "../data/dashboardTemplates";
import { TileView } from "./TileView";

vi.mock("recharts", async () => ({
  ...await vi.importActual<typeof import("recharts")>("recharts"),
  // Give the real SVG chart deterministic dimensions; jsdom has no layout engine.
  ResponsiveContainer: ({ children, height }: { children: ReactElement<{ width?: number; height?: number }>; height: number }) =>
    cloneElement(children, { width: 640, height }),
}));

describe("Managed Apps Estate creator GUID chart", () => {
  const guid = "11111111-2222-4333-8444-555555555555";
  const app: EstateManagedApp = {
    ...toAppRow({ name: "synthetic-app", type: ResourceType.AppBuilderApp, properties: {
      subType: "microsoftApp", environmentId: "environment", createdBy: guid,
    } }),
    creatorName: "Synthetic resolved creator", origin: "", connectorIds: ["sql"],
    environmentType: "Developer", environmentManaged: true, environmentMapped: true,
    membershipKnown: true, groupId: "", groupName: "", acp: "Ungrouped", acpReason: "",
    snapshotAt: "2026-03-01T12:00:00Z",
  };
  it("renders the full GUID in the actual SVG axis, not a rank alias or tooltip-only label, for existing saved metric tiles", async () => {
    const tile = getDashboardTemplate("managed-apps-estate")!.build().find((tile) => tile.computed?.params?.metric === "topCreators")!;
    tile.title = "My saved creator chart";
    const read = vi.fn().mockResolvedValue({ ok: true, data: { apps: [app], capturedAt: app.snapshotAt } });
    render(<FluentProvider theme={webLightTheme}>
      <TileView tile={tile} managedAppsSource={createManagedAppsEstateSource(read)} />
    </FluentProvider>);
    const region = await screen.findByRole("region", { name: "Top creators by full GUID" });
    const label = within(region).getByText(guid);
    expect(label.closest("svg")).not.toBeNull();
    expect(Number(label.closest("text")?.getAttribute("x"))).toBeGreaterThan(280);
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).queryByText("Creator 1")).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not reserve the creator label area or scrolling region for other ranked charts", async () => {
    const tile = getDashboardTemplate("managed-apps-estate")!.build().find((tile) => tile.computed?.params?.metric === "connectors")!;
    const source = createManagedAppsEstateSource(vi.fn().mockResolvedValue({ ok: true, data: { apps: [app], capturedAt: app.snapshotAt } }));
    render(<FluentProvider theme={webLightTheme}><TileView tile={tile} managedAppsSource={source} /></FluentProvider>);
    const label = await screen.findByText("SQL Server");
    expect(Number(label.closest("text")?.getAttribute("x"))).toBeLessThan(200);
    expect(screen.queryByRole("region", { name: "Top creators by full GUID" })).not.toBeInTheDocument();
  });
});
