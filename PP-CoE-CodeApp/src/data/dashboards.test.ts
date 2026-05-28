/**
 * Unit tests for the dashboards localStorage layer — covering the tab
 * model migration, tab CRUD, and the write-path normalization that keeps
 * legacy data from being re-flattened by the next mutation.
 *
 * The store and the read seams are tightly coupled — `normalizeDashboard`
 * is invoked at every read AND inside `updateDashboard`, so these tests
 * exercise both paths.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_TAB_ID,
  addTab,
  createDashboard,
  createDashboardFromTemplate,
  deleteTab,
  getDashboard,
  listDashboards,
  moveTileToTab,
  newId,
  newTileTemplate,
  normalizeDashboard,
  renameTab,
  reorderTabs,
  upsertTile,
  type Dashboard,
  type DashboardTile,
} from "./dashboards";
import { ResourceType } from "./inventory";

const STORAGE_KEY = "ppcoe.dashboards.v2";

function writeRawStore(items: Array<Record<string, unknown>>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function tile(id: string, overrides: Partial<DashboardTile> = {}): DashboardTile {
  return {
    id,
    title: `Tile ${id}`,
    size: "medium",
    viz: { type: "kpi", kpiLabel: "Count" },
    spec: {
      resourceTypes: [ResourceType.CanvasApp],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 1,
    },
    ...overrides,
  };
}

function legacyDashboard(id: string, tiles: DashboardTile[]): Record<string, unknown> {
  // Note: NO `tabs` field, tiles have NO `tabId` — this is the v2 shape
  // that existed before tabs landed. We intentionally write it raw so we
  // exercise the normalize/migrate path.
  return {
    id,
    name: `Dashboard ${id}`,
    description: "",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    tiles,
  };
}

describe("normalizeDashboard", () => {
  it("backfills a default tab and assigns orphan tiles to it (legacy v2 shape)", () => {
    const legacy = legacyDashboard("d1", [tile("t1"), tile("t2")]) as unknown as Dashboard;
    const normalized = normalizeDashboard(legacy);
    expect(normalized.tabs).toEqual([{ id: DEFAULT_TAB_ID, name: "Overview" }]);
    expect(normalized.tiles.map((t) => t.tabId)).toEqual([DEFAULT_TAB_ID, DEFAULT_TAB_ID]);
  });

  it("rehomes a tile with a bogus tabId to the first tab", () => {
    const d: Dashboard = {
      id: "d1",
      name: "X",
      description: "",
      createdAt: "",
      updatedAt: "",
      tabs: [{ id: "real", name: "Real" }],
      tiles: [tile("t1", { tabId: "ghost" }), tile("t2", { tabId: "real" })],
    };
    const normalized = normalizeDashboard(d);
    expect(normalized.tiles[0].tabId).toBe("real");
    expect(normalized.tiles[1].tabId).toBe("real");
  });

  it("returns the same object when nothing needed migrating (reference equality)", () => {
    const d: Dashboard = {
      id: "d1",
      name: "X",
      description: "",
      createdAt: "",
      updatedAt: "",
      tabs: [{ id: "a", name: "A" }],
      tiles: [tile("t1", { tabId: "a" })],
    };
    expect(normalizeDashboard(d)).toBe(d);
  });
});

describe("read seams normalize", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getDashboard returns a normalized record for legacy data", () => {
    writeRawStore([legacyDashboard("legacy1", [tile("t1"), tile("t2")])]);
    const got = getDashboard("legacy1");
    expect(got).not.toBeNull();
    expect(got!.tabs).toHaveLength(1);
    expect(got!.tiles.every((t) => t.tabId === DEFAULT_TAB_ID)).toBe(true);
  });

  it("listDashboards normalizes every record", () => {
    writeRawStore([
      legacyDashboard("legacy1", [tile("t1")]),
      legacyDashboard("legacy2", [tile("t2")]),
    ]);
    const items = listDashboards();
    expect(items).toHaveLength(2);
    for (const d of items) {
      expect(d.tabs).toHaveLength(1);
      expect(d.tiles.every((t) => t.tabId === DEFAULT_TAB_ID)).toBe(true);
    }
  });
});

describe("write-path migration persists normalized shape", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("upsertTile on a legacy dashboard persists tabs + tile.tabId", () => {
    writeRawStore([legacyDashboard("d1", [tile("t1")])]);
    upsertTile("d1", tile("t2", { title: "New" }));
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw[0].tabs).toEqual([{ id: DEFAULT_TAB_ID, name: "Overview" }]);
    expect(raw[0].tiles.every((t: DashboardTile) => t.tabId === DEFAULT_TAB_ID)).toBe(true);
  });

  it("addTab on a legacy dashboard persists the default tab plus the new tab", () => {
    writeRawStore([legacyDashboard("d1", [tile("t1")])]);
    const created = addTab("d1", "Lifecycle");
    expect(created).not.toBeNull();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw[0].tabs.map((t: { name: string }) => t.name)).toEqual([
      "Overview",
      "Lifecycle",
    ]);
    // Existing tile keeps its (default) tabId
    expect(raw[0].tiles[0].tabId).toBe(DEFAULT_TAB_ID);
  });

  it("updateDashboard via upsertTile does not drop the tabs array", () => {
    const d = createDashboard("test", "");
    upsertTile(d.id, tile("t1", { tabId: d.tabs![0].id }));
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw[0].tabs).toBeDefined();
    expect(raw[0].tabs).toHaveLength(1);
  });
});

describe("tab CRUD", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function seed(): { id: string; tabIds: () => string[] } {
    const d = createDashboard("D", "");
    return {
      id: d.id,
      tabIds: () => getDashboard(d.id)!.tabs!.map((t) => t.id),
    };
  }

  it("addTab appends to the end", () => {
    const s = seed();
    addTab(s.id, "B");
    addTab(s.id, "C");
    const tabs = getDashboard(s.id)!.tabs!;
    expect(tabs.map((t) => t.name)).toEqual(["Overview", "B", "C"]);
  });

  it("addTab falls back to 'New tab' on empty name", () => {
    const s = seed();
    const created = addTab(s.id, "   ");
    expect(created?.name).toBe("New tab");
  });

  it("renameTab updates the name", () => {
    const s = seed();
    const tabId = s.tabIds()[0];
    renameTab(s.id, tabId, "Renamed");
    expect(getDashboard(s.id)!.tabs![0].name).toBe("Renamed");
  });

  it("renameTab ignores empty names", () => {
    const s = seed();
    const tabId = s.tabIds()[0];
    renameTab(s.id, tabId, "   ");
    expect(getDashboard(s.id)!.tabs![0].name).toBe("Overview");
  });

  it("reorderTabs reorders by id list", () => {
    const s = seed();
    addTab(s.id, "B");
    addTab(s.id, "C");
    const ids = s.tabIds();
    reorderTabs(s.id, [ids[2], ids[0], ids[1]]);
    expect(getDashboard(s.id)!.tabs!.map((t) => t.name)).toEqual([
      "C",
      "Overview",
      "B",
    ]);
  });

  it("reorderTabs appends missing ids in original order (no silent drop)", () => {
    const s = seed();
    addTab(s.id, "B");
    addTab(s.id, "C");
    const ids = s.tabIds();
    // Only mention the last id — first two should be appended.
    reorderTabs(s.id, [ids[2]]);
    expect(getDashboard(s.id)!.tabs!.map((t) => t.name)).toEqual([
      "C",
      "Overview",
      "B",
    ]);
  });

  it("moveTileToTab updates the tile's tabId", () => {
    const s = seed();
    const b = addTab(s.id, "B")!;
    const t1 = tile("t1", { tabId: s.tabIds()[0] });
    upsertTile(s.id, t1);
    moveTileToTab(s.id, "t1", b.id);
    expect(getDashboard(s.id)!.tiles[0].tabId).toBe(b.id);
  });

  it("moveTileToTab rejects an unknown tabId", () => {
    const s = seed();
    const t1 = tile("t1", { tabId: s.tabIds()[0] });
    upsertTile(s.id, t1);
    const result = moveTileToTab(s.id, "t1", "nonexistent");
    expect(result).toBeNull();
    // tile.tabId unchanged
    expect(getDashboard(s.id)!.tiles[0].tabId).toBe(s.tabIds()[0]);
  });
});

describe("deleteTab", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function seedWithTiles(): {
    id: string;
    tabA: string;
    tabB: string;
    tabC: string;
  } {
    const d = createDashboard("D", "");
    const tabA = d.tabs![0].id;
    const tabB = addTab(d.id, "B")!.id;
    const tabC = addTab(d.id, "C")!.id;
    upsertTile(d.id, tile("ta1", { tabId: tabA }));
    upsertTile(d.id, tile("tb1", { tabId: tabB }));
    upsertTile(d.id, tile("tb2", { tabId: tabB }));
    upsertTile(d.id, tile("tc1", { tabId: tabC }));
    return { id: d.id, tabA, tabB, tabC };
  }

  it("'moveTilesToFirstRemaining' rehomes tiles to the first surviving tab", () => {
    const s = seedWithTiles();
    deleteTab(s.id, s.tabB, "moveTilesToFirstRemaining");
    const d = getDashboard(s.id)!;
    expect(d.tabs!.map((t) => t.id)).toEqual([s.tabA, s.tabC]);
    const tbIds = d.tiles.filter((t) => ["tb1", "tb2"].includes(t.id)).map((t) => t.tabId);
    expect(tbIds).toEqual([s.tabA, s.tabA]);
  });

  it("'moveTilesToFirstRemaining' handles deleting the FIRST tab correctly", () => {
    const s = seedWithTiles();
    // Delete tabA — first remaining should be tabB.
    deleteTab(s.id, s.tabA, "moveTilesToFirstRemaining");
    const d = getDashboard(s.id)!;
    expect(d.tabs!.map((t) => t.id)).toEqual([s.tabB, s.tabC]);
    expect(d.tiles.find((t) => t.id === "ta1")!.tabId).toBe(s.tabB);
  });

  it("'deleteTiles' removes the tab AND its tiles", () => {
    const s = seedWithTiles();
    deleteTab(s.id, s.tabB, "deleteTiles");
    const d = getDashboard(s.id)!;
    expect(d.tabs!.map((t) => t.id)).toEqual([s.tabA, s.tabC]);
    expect(d.tiles.map((t) => t.id).sort()).toEqual(["ta1", "tc1"]);
  });

  it("refuses to delete the last remaining tab", () => {
    const d = createDashboard("D", "");
    upsertTile(d.id, tile("t1", { tabId: d.tabs![0].id }));
    const before = JSON.stringify(getDashboard(d.id));
    const result = deleteTab(d.id, d.tabs![0].id, "deleteTiles");
    expect(result).toBeNull();
    expect(JSON.stringify(getDashboard(d.id))).toBe(before);
  });

  it("rejects an unknown tabId", () => {
    const s = seedWithTiles();
    const result = deleteTab(s.id, "nonexistent", "deleteTiles");
    expect(result).toBeNull();
  });
});

describe("createDashboard / createDashboardFromTemplate", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("createDashboard seeds a single default tab so the dashboard is tab-ready", () => {
    const d = createDashboard("New", "");
    expect(d.tabs).toEqual([{ id: DEFAULT_TAB_ID, name: "Overview" }]);
    expect(d.tiles).toEqual([]);
  });

  it("createDashboardFromTemplate accepts a layout with tabs and tiles", () => {
    const tabs = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const tiles = [tile("t1", { tabId: "a" }), tile("t2", { tabId: "b" })];
    const d = createDashboardFromTemplate("X", "desc", { tabs, tiles });
    expect(d.tabs).toEqual(tabs);
    expect(d.tiles.map((t) => t.tabId)).toEqual(["a", "b"]);
  });

  it("createDashboardFromTemplate falls back to a single default tab when no tabs provided", () => {
    const tiles = [tile("t1"), tile("t2")];
    const d = createDashboardFromTemplate("X", "", { tiles });
    expect(d.tabs).toEqual([{ id: DEFAULT_TAB_ID, name: "Overview" }]);
    expect(d.tiles.every((t) => t.tabId === DEFAULT_TAB_ID)).toBe(true);
  });

  it("createDashboardFromTemplate rehomes a tile that references an unsupplied tabId", () => {
    const tabs = [{ id: "a", name: "A" }];
    const tiles = [tile("t1", { tabId: "ghost" })];
    const d = createDashboardFromTemplate("X", "", { tabs, tiles });
    expect(d.tiles[0].tabId).toBe("a");
  });
});

describe("newTileTemplate", () => {
  it("sets tabId when provided", () => {
    expect(newTileTemplate("xyz").tabId).toBe("xyz");
  });
  it("omits tabId when not provided (relying on caller to set it later)", () => {
    expect(newTileTemplate().tabId).toBeUndefined();
  });
});

describe("newId", () => {
  it("produces distinct ids on rapid calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(newId("t"));
    expect(ids.size).toBe(50);
  });
});
