/**
 * Tests for the Copilot Studio Estate template's multi-tab layout.
 * The template controls the public template-creation flow, so we pin its
 * tab structure and verify back-compat with the flat `build()` path.
 */
import { describe, it, expect } from "vitest";
import { DASHBOARD_TEMPLATES, getDashboardTemplate } from "./dashboardTemplates";
import { getAggregator } from "./dashboardAggregators";
import { toAppRow, ResourceType } from "./inventory";
import type { EstateManagedApp } from "./dashboardManagedAppSource";

describe("Managed Apps Estate template", () => {
  it("registers four populated tabs, fresh IDs and four headline KPIs against the shared managed population", () => {
    const template = getDashboardTemplate("managed-apps-estate")!;
    const layout = template.buildLayout!();
    expect(layout.tabs.map((tab) => tab.name)).toEqual(["Overview", "People", "Environment & governance", "Connectors"]);
    expect(layout.tiles.filter((tile) => tile.viz.type === "kpi")).toHaveLength(4);
    for (const tab of layout.tabs) expect(layout.tiles.some((tile) => tile.tabId === tab.id)).toBe(true);
    const fresh = new Set(template.build().map((tile) => tile.id));
    for (const tile of layout.tiles) {
      expect(tile.source).toBe("computed");
      expect(getAggregator(tile.computed!.aggregatorId)).toBeDefined();
      expect(fresh.has(tile.id)).toBe(false);
      expect(layout.tabs.some((tab) => tab.id === tile.tabId)).toBe(true);
      if (tile.viz.type === "stackedBar") expect(tile.viz.stackSeries).toBe(false);
    }
    expect(template.build().every((tile) => !tile.tabId)).toBe(true);
  });
  it("every tile's actual output matches its renderer and table fields, with exact internal app/group detail support", () => {
    const app: EstateManagedApp = {
      ...toAppRow({ name: "synthetic-app", type: ResourceType.AppBuilderApp, properties: { subType: "microsoftApp" } }),
      creatorName: "", connectorIds: [], origin: "", environmentType: "", environmentMapped: false, environmentManaged: null,
      membershipKnown: true, groupId: "group", groupName: "Group", acp: "Without ACP", acpReason: "Empty assignment",
      snapshotAt: "2026-03-01T12:00:00Z",
    };
    const layout = getDashboardTemplate("managed-apps-estate")!.buildLayout!();
    for (const tile of layout.tiles) {
      const output = getAggregator(tile.computed!.aggregatorId)!([app], tile.computed!.params);
      const expected = ["bar", "pie"].includes(tile.viz.type) ? "chart" : tile.viz.type === "line" ? "series" : tile.viz.type;
      expect(output.kind, tile.title).toBe(expected);
      if (output.kind === "table") for (const row of output.items) {
        for (const column of tile.viz.tableColumns ?? []) expect(column.field in row, `${tile.title}: ${column.field}`).toBe(true);
      }
    }
    expect(layout.tiles.find((tile) => tile.title === "Groups without assigned ACP")?.viz.tableColumns).toContainEqual(
      expect.objectContaining({ linkTo: "environment-group" }));
    expect(layout.tiles.find((tile) => tile.title === "Managed app inventory")?.viz.tableColumns).toContainEqual(
      expect.objectContaining({ linkTo: "app" }));
  });
});

describe("Copilot Studio Estate template", () => {
  const tpl = getDashboardTemplate("copilot-studio-estate")!;

  it("exposes both build() and buildLayout()", () => {
    expect(typeof tpl.build).toBe("function");
    expect(typeof tpl.buildLayout).toBe("function");
  });

  it("only scores explicitly unmanaged agents, not null / unavailable status", () => {
    const clauses = tpl.build().flatMap((tile) => tile.clauses ?? []);
    expect(clauses).toContainEqual(expect.objectContaining({
      $type: "extend",
      FieldName: "__r_unmgd",
      Expression: "iif(tobool(properties.isManaged) == false, 1, 0)",
    }));
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

describe("Power Automate Estate template", () => {
  const tpl = getDashboardTemplate("power-automate-estate")!;

  it("is registered and exposes both build() and buildLayout()", () => {
    expect(tpl).toBeDefined();
    expect(typeof tpl.build).toBe("function");
    expect(typeof tpl.buildLayout).toBe("function");
  });

  it("buildLayout returns the seven server-side tabs in order", () => {
    const layout = tpl.buildLayout!();
    expect(layout.tabs.map((t) => t.name)).toEqual([
      "Overview",
      "Configuration & triggers",
      "Lifecycle",
      "Ownership & environments",
      "Trigger patterns",
      "Agent & AI flows",
      "Risk / governance",
    ]);
  });

  it("tab ids are unique", () => {
    const layout = tpl.buildLayout!();
    const ids = layout.tabs.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("every tab has at least one tile", () => {
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

  it("uses NO computed-source tiles — server-side only (raw + builder)", () => {
    const layout = tpl.buildLayout!();
    for (const tile of layout.tiles) {
      expect(
        tile.source,
        `tile "${tile.title}" must be server-side (raw or builder), not computed`,
      ).not.toBe("computed");
    }
  });

  it("build() strips tabIds for back-compat", () => {
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
    expect(DASHBOARD_TEMPLATES.find((t) => t.id === "power-automate-estate")).toBeDefined();
  });
});
