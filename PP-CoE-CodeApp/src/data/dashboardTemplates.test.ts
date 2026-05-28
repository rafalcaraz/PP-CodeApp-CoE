/**
 * Tests for the Copilot Studio Estate template's multi-tab layout.
 * The template controls the public template-creation flow, so we pin its
 * tab structure and verify back-compat with the flat `build()` path.
 */
import { describe, it, expect } from "vitest";
import { DASHBOARD_TEMPLATES, getDashboardTemplate } from "./dashboardTemplates";

describe("Copilot Studio Estate template", () => {
  const tpl = getDashboardTemplate("copilot-studio-estate")!;

  it("exposes both build() and buildLayout()", () => {
    expect(typeof tpl.build).toBe("function");
    expect(typeof tpl.buildLayout).toBe("function");
  });

  it("buildLayout returns six tabs", () => {
    const layout = tpl.buildLayout!();
    expect(layout.tabs.map((t) => t.name)).toEqual([
      "Overview",
      "Configuration",
      "Channels & Reach",
      "Sharing & Governance",
      "Lifecycle",
      "Trends",
    ]);
  });

  it("every tile in buildLayout references a real tab", () => {
    const layout = tpl.buildLayout!();
    const tabIds = new Set(layout.tabs.map((t) => t.id));
    for (const tile of layout.tiles) {
      expect(tile.tabId, `tile "${tile.title}" has no tabId`).toBeDefined();
      expect(
        tabIds.has(tile.tabId!),
        `tile "${tile.title}" points at unknown tab "${tile.tabId}"`,
      ).toBe(true);
    }
  });

  it("every tab has at least one tile (no empty sections)", () => {
    const layout = tpl.buildLayout!();
    const tileCountByTab = new Map<string, number>();
    for (const tile of layout.tiles) {
      tileCountByTab.set(tile.tabId!, (tileCountByTab.get(tile.tabId!) ?? 0) + 1);
    }
    for (const tab of layout.tabs) {
      expect(
        tileCountByTab.get(tab.id) ?? 0,
        `tab "${tab.name}" has no tiles`,
      ).toBeGreaterThan(0);
    }
  });

  it("build() returns the flat tile list with tabId stripped (back-compat)", () => {
    const flat = tpl.build();
    expect(flat.length).toBeGreaterThan(0);
    for (const tile of flat) {
      expect(tile.tabId).toBeUndefined();
    }
  });

  it("build() and buildLayout() return matching tile counts", () => {
    expect(tpl.build().length).toBe(tpl.buildLayout!().tiles.length);
  });

  it("is registered in the DASHBOARD_TEMPLATES list", () => {
    expect(DASHBOARD_TEMPLATES.find((t) => t.id === "copilot-studio-estate")).toBeDefined();
  });
});
