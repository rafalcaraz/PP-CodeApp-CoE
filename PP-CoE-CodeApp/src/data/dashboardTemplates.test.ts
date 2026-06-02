/**
 * Tests for the Copilot Studio Estate template's multi-tab layout.
 * The template controls the public template-creation flow, so we pin its
 * tab structure and verify back-compat with the flat `build()` path.
 */
import { describe, it, expect } from "vitest";
import { DASHBOARD_TEMPLATES, getDashboardTemplate } from "./dashboardTemplates";
import { getAggregator } from "./dashboardAggregators";

describe("Copilot Studio Estate template", () => {
  const tpl = getDashboardTemplate("copilot-studio-estate")!;

  it("exposes both build() and buildLayout()", () => {
    expect(typeof tpl.build).toBe("function");
    expect(typeof tpl.buildLayout).toBe("function");
  });

  it("buildLayout returns the ten Phase 2 tabs in order", () => {
    const layout = tpl.buildLayout!();
    expect(layout.tabs.map((t) => t.name)).toEqual([
      "Overview",
      "Configuration",
      "Channels & Reach",
      "Sharing & Governance",
      "Lifecycle",
      "Trends",
      "Tools & Connectors",
      "Knowledge & Grounding",
      "Authoring quality",
      "Authoring surface",
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

  it("every computed tile points at a registered aggregator", () => {
    const layout = tpl.buildLayout!();
    const computed = layout.tiles.filter((t) => t.source === "computed");
    expect(computed.length).toBeGreaterThan(0);
    for (const tile of computed) {
      const aggregatorId = tile.computed?.aggregatorId;
      expect(
        aggregatorId,
        `computed tile "${tile.title}" missing computed.aggregatorId`,
      ).toBeTruthy();
      expect(
        getAggregator(aggregatorId!),
        `computed tile "${tile.title}" references unknown aggregator "${aggregatorId}"`,
      ).toBeTruthy();
    }
  });

  it("stackedBar tiles always use source: 'computed'", () => {
    const layout = tpl.buildLayout!();
    for (const tile of layout.tiles) {
      if (tile.viz.type === "stackedBar") {
        expect(
          tile.source,
          `stacked-bar tile "${tile.title}" must be computed`,
        ).toBe("computed");
      }
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

describe("Canvas + Model-driven Estate template", () => {
  const tpl = getDashboardTemplate("canvas-mda-estate")!;

  it("exposes both build() and buildLayout()", () => {
    expect(typeof tpl.build).toBe("function");
    expect(typeof tpl.buildLayout).toBe("function");
  });

  it("buildLayout returns the five canvas+MDA tabs in order", () => {
    const layout = tpl.buildLayout!();
    expect(layout.tabs.map((t) => t.name)).toEqual([
      "Overview",
      "Sharing & Governance",
      "Lifecycle",
      "Trends",
      "Connectors & Dependencies",
    ]);
  });

  it("every tile references a real tab", () => {
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

  it("every computed tile points at a registered aggregator", () => {
    const layout = tpl.buildLayout!();
    const computed = layout.tiles.filter((t) => t.source === "computed");
    expect(computed.length).toBeGreaterThan(0);
    for (const tile of computed) {
      const aggregatorId = tile.computed?.aggregatorId;
      expect(aggregatorId, `computed tile "${tile.title}" missing aggregatorId`).toBeTruthy();
      expect(
        getAggregator(aggregatorId!),
        `computed tile "${tile.title}" references unknown aggregator "${aggregatorId}"`,
      ).toBeTruthy();
    }
  });

  it("first-party-app exclusion is consistent — no builder-source app pies/bars/lines", () => {
    // builder-source pie/bar/line tiles route through `runAggregateCount` /
    // `runTimeSeriesAggregate`, which only honor `spec.resourceTypes` and
    // NOT the `__sys` first-party exclusion clause. Every chart/trend
    // tile in this template MUST therefore use `source: "computed"` so
    // its data flows through `fetchAllCustomerApps` (which DOES exclude
    // system-owned apps). KPI / table tiles can still be `raw` because
    // they carry the exclusion in their `clauses` directly.
    const layout = tpl.buildLayout!();
    for (const tile of layout.tiles) {
      if (
        tile.viz.type === "pie" ||
        tile.viz.type === "bar" ||
        tile.viz.type === "line" ||
        tile.viz.type === "stackedBar"
      ) {
        expect(
          tile.source,
          `tile "${tile.title}" (${tile.viz.type}) must be source: "computed" — ` +
            "the builder path doesn't apply the first-party-app exclusion."
        ).toBe("computed");
      }
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
    expect(DASHBOARD_TEMPLATES.find((t) => t.id === "canvas-mda-estate")).toBeDefined();
  });
});

describe("Modern Apps Estate template", () => {
  const tpl = getDashboardTemplate("modern-apps-estate")!;

  it("exposes both build() and buildLayout()", () => {
    expect(typeof tpl.build).toBe("function");
    expect(typeof tpl.buildLayout).toBe("function");
  });

  it("buildLayout returns the three modern-apps tabs in order", () => {
    const layout = tpl.buildLayout!();
    expect(layout.tabs.map((t) => t.name)).toEqual(["Overview", "Inventory", "Trends"]);
  });

  it("every tab has at least one tile", () => {
    const layout = tpl.buildLayout!();
    const tileCountByTab = new Map<string, number>();
    for (const tile of layout.tiles) {
      tileCountByTab.set(tile.tabId!, (tileCountByTab.get(tile.tabId!) ?? 0) + 1);
    }
    for (const tab of layout.tabs) {
      expect(tileCountByTab.get(tab.id) ?? 0, `tab "${tab.name}" has no tiles`).toBeGreaterThan(0);
    }
  });

  it("first-party-app exclusion is consistent — no builder-source app pies/bars/lines", () => {
    const layout = tpl.buildLayout!();
    for (const tile of layout.tiles) {
      if (
        tile.viz.type === "pie" ||
        tile.viz.type === "bar" ||
        tile.viz.type === "line" ||
        tile.viz.type === "stackedBar"
      ) {
        expect(
          tile.source,
          `tile "${tile.title}" (${tile.viz.type}) must be source: "computed"`
        ).toBe("computed");
      }
    }
  });

  it("every computed tile points at a registered aggregator", () => {
    const layout = tpl.buildLayout!();
    const computed = layout.tiles.filter((t) => t.source === "computed");
    for (const tile of computed) {
      const aggregatorId = tile.computed?.aggregatorId;
      expect(aggregatorId).toBeTruthy();
      expect(getAggregator(aggregatorId!)).toBeTruthy();
    }
  });

  it("is registered in the DASHBOARD_TEMPLATES list", () => {
    expect(DASHBOARD_TEMPLATES.find((t) => t.id === "modern-apps-estate")).toBeDefined();
  });
});

