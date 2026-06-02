/**
 * Unit tests for the app-typed computed-tile aggregator registry.
 *
 * Mirrors `dashboardAggregators.test.ts` for the Power Apps aggregators —
 * pure functions over hand-rolled `AppRow[]` fixtures with deterministic
 * outputs we can pin. Covers the discriminated output shapes, the
 * canvas-only gating behavior, per-tile `params.types` filtering, and
 * the trend aggregator's delta vs cumulative modes.
 */
import { describe, it, expect } from "vitest";
import {
  APP_AGGREGATOR_IDS,
  appCleanupCandidatesTable,
  appConnectorsPerAppHistogram,
  appLaunchedVsNeverPerEnv,
  appNeverLaunchedCohorts,
  appStaleCohorts,
  appTopConnectorsAllTypes,
  appsByCodeSubType,
  appsByType,
  appsCreatedTrend,
  appsTopCreators,
  appsTopEnvironments,
} from "./dashboardAppAggregators";
import { getAggregator, getAggregatorRegistration } from "./dashboardAggregators";
import { ResourceType, type AppRow, type ResourceConnector } from "./inventory";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function connector(id: string): ResourceConnector {
  return { connectorId: id, displayName: id, operations: [] };
}

const DAY_MS = 86_400_000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

function app(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: "app-1",
    type: ResourceType.CanvasApp,
    displayName: "App 1",
    environmentId: "env-A",
    environmentName: "Env A",
    ownerId: "user-1",
    ownerDisplayName: "User 1",
    createdAt: daysAgo(10),
    createdBy: "user-1",
    lastModifiedAt: daysAgo(5),
    lastModifiedBy: "user-1",
    lastLaunchedAt: "",
    appType: "",
    subType: "",
    region: "unitedstates",
    tenantId: "tenant-1",
    isFeatured: false,
    bypassConsent: false,
    isQuarantined: false,
    sharedUsersCount: 0,
    sharedGroupsCount: 0,
    logicalName: "",
    appModuleId: "",
    connectors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle cohorts
// ---------------------------------------------------------------------------

describe("appNeverLaunchedCohorts", () => {
  it("buckets only canvas apps that were never launched", () => {
    const out = appNeverLaunchedCohorts([
      // brand new, never launched
      app({ id: "a1", createdAt: daysAgo(5), lastLaunchedAt: "" }),
      // canvas, launched — should be skipped
      app({ id: "a2", createdAt: daysAgo(5), lastLaunchedAt: daysAgo(1) }),
      // MDA, never launched — should be skipped (not canvas)
      app({ id: "a3", type: ResourceType.ModelDrivenApp, createdAt: daysAgo(5), lastLaunchedAt: "" }),
      // canvas, never launched, 100d old
      app({ id: "a4", createdAt: daysAgo(100), lastLaunchedAt: "" }),
      // canvas, never launched, 400d old
      app({ id: "a5", createdAt: daysAgo(400), lastLaunchedAt: "" }),
    ]);
    expect(out.kind).toBe("chart");
    if (out.kind !== "chart") return;
    const m = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(m["0-29 days"]).toBe(1);
    expect(m["90-179 days"]).toBe(1);
    expect(m["365+ days"]).toBe(1);
    // Total across buckets == 3 canvas-never-launched rows.
    expect(out.buckets.reduce((s, b) => s + b.value, 0)).toBe(3);
  });

  it("returns all-zero buckets for an empty universe", () => {
    const out = appNeverLaunchedCohorts([]);
    expect(out.kind).toBe("chart");
    if (out.kind !== "chart") return;
    expect(out.buckets.every((b) => b.value === 0)).toBe(true);
    // Buckets are present even when empty — UI expects a stable axis.
    expect(out.buckets.length).toBe(5);
  });
});

describe("appStaleCohorts", () => {
  it("buckets only canvas apps that HAVE been launched", () => {
    const out = appStaleCohorts([
      app({ id: "a1", lastLaunchedAt: daysAgo(10) }),
      app({ id: "a2", lastLaunchedAt: daysAgo(200) }),
      app({ id: "a3", lastLaunchedAt: "" }), // never launched — skipped
      app({ id: "a4", type: ResourceType.ModelDrivenApp, lastLaunchedAt: daysAgo(10) }), // not canvas — skipped
    ]);
    if (out.kind !== "chart") throw new Error("expected chart");
    expect(out.buckets.reduce((s, b) => s + b.value, 0)).toBe(2);
  });
});

describe("appLaunchedVsNeverPerEnv", () => {
  it("emits one row per env with Launched / Never launched series", () => {
    const out = appLaunchedVsNeverPerEnv([
      app({ id: "a", environmentId: "env-A", lastLaunchedAt: daysAgo(1) }),
      app({ id: "b", environmentId: "env-A", lastLaunchedAt: "" }),
      app({ id: "c", environmentId: "env-A", lastLaunchedAt: "" }),
      app({ id: "d", environmentId: "env-B", lastLaunchedAt: daysAgo(5) }),
      // MDA in env-A — must be excluded from a canvas-only signal.
      app({ id: "e", type: ResourceType.ModelDrivenApp, environmentId: "env-A" }),
    ]);
    expect(out.kind).toBe("stackedBar");
    if (out.kind !== "stackedBar") return;
    expect(out.series).toEqual(["Launched", "Never launched"]);
    const envA = out.data.find((d) => d.category === "env-A");
    const envB = out.data.find((d) => d.category === "env-B");
    expect(envA).toBeDefined();
    expect(envA!.Launched).toBe(1);
    expect(envA!["Never launched"]).toBe(2);
    expect(envB!.Launched).toBe(1);
    expect(envB!["Never launched"]).toBe(0);
  });

  it("rolls long-tail environments into an Other bucket beyond topN", () => {
    // 4 envs, ask for topN=2 — head should keep 2, tail rolls into Other.
    const apps: AppRow[] = [];
    for (const env of ["env-1", "env-2", "env-3", "env-4"]) {
      apps.push(app({ id: `${env}-a`, environmentId: env, lastLaunchedAt: daysAgo(1) }));
    }
    // env-1 gets 3 total to ensure it wins the topN race.
    apps.push(app({ id: "env-1-b", environmentId: "env-1", lastLaunchedAt: "" }));
    apps.push(app({ id: "env-1-c", environmentId: "env-1", lastLaunchedAt: "" }));
    const out = appLaunchedVsNeverPerEnv(apps, { topN: 2 });
    if (out.kind !== "stackedBar") throw new Error("expected stackedBar");
    expect(out.data.length).toBe(3); // 2 head + Other
    expect(out.data.find((d) => d.category === "Other")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cleanup candidates
// ---------------------------------------------------------------------------

describe("appCleanupCandidatesTable", () => {
  it("scores apps and omits rows with score 0", () => {
    const rows = [
      // clean canvas app — no signals, omitted.
      app({ id: "clean", createdAt: daysAgo(10), lastLaunchedAt: daysAgo(1), lastModifiedAt: daysAgo(1) }),
      // canvas, never launched + 200d old → +1 never-launched.
      app({ id: "never", createdAt: daysAgo(200), lastLaunchedAt: "", lastModifiedAt: daysAgo(10) }),
      // canvas, stale launch + unmodified → +1 stale-launch +1 unmodified = score 2.
      app({
        id: "stale",
        createdAt: daysAgo(500),
        lastLaunchedAt: daysAgo(300),
        lastModifiedAt: daysAgo(400),
      }),
      // canvas, quarantined → +1.
      app({ id: "quar", createdAt: daysAgo(5), lastLaunchedAt: daysAgo(1), lastModifiedAt: daysAgo(1), isQuarantined: true }),
    ];
    const out = appCleanupCandidatesTable(rows);
    if (out.kind !== "table") throw new Error("expected table");
    const ids = out.items.map((r) => r.id as string | undefined);
    expect(ids).not.toContain("clean");
    expect(out.items.length).toBe(3);
    // Highest score first.
    expect((out.items[0] as { score: number }).score).toBeGreaterThanOrEqual(
      (out.items[1] as { score: number }).score
    );
  });

  it("honors params.types filter (Canvas+MDA template scope)", () => {
    const rows = [
      app({ id: "canvas-bad", type: ResourceType.CanvasApp, isQuarantined: true }),
      app({ id: "code-bad", type: ResourceType.CodeApp, isQuarantined: true }),
    ];
    const out = appCleanupCandidatesTable(rows, {
      types: [ResourceType.CanvasApp, ResourceType.ModelDrivenApp],
    });
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items.length).toBe(1);
    expect((out.items[0] as { displayName: string }).displayName).toBe("App 1");
    expect((out.items[0] as { type: string }).type).toBe(ResourceType.CanvasApp);
  });

  it("does not fire canvas-only signals on non-canvas apps", () => {
    // MDA row with no launch info shouldn't accumulate any score solely
    // from the never-launched signal (which is canvas-only). Only the
    // unmodified-365d / quarantined signals apply across all types.
    const out = appCleanupCandidatesTable([
      app({
        id: "mda-old",
        type: ResourceType.ModelDrivenApp,
        createdAt: daysAgo(500),
        lastLaunchedAt: "",
        lastModifiedAt: daysAgo(10),
      }),
    ]);
    if (out.kind !== "table") throw new Error("expected table");
    expect(out.items.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

describe("appTopConnectorsAllTypes", () => {
  it("counts distinct connectors per app and ranks by frequency", () => {
    const out = appTopConnectorsAllTypes([
      app({ id: "a", connectors: [connector("shared_sharepointonline"), connector("shared_office365users")] }),
      app({ id: "b", connectors: [connector("shared_sharepointonline")] }),
      app({ id: "c", connectors: [connector("shared_sql")] }),
    ]);
    if (out.kind !== "chart") throw new Error("expected chart");
    const top = out.buckets[0];
    expect(top.name).toBe("shared_sharepointonline");
    expect(top.value).toBe(2);
  });

  it("respects params.types to restrict universe per tile", () => {
    const out = appTopConnectorsAllTypes(
      [
        app({ id: "c1", type: ResourceType.CanvasApp, connectors: [connector("shared_sharepointonline")] }),
        app({ id: "b1", type: ResourceType.AppBuilderApp, connectors: [connector("shared_sharepointonline")] }),
      ],
      { types: [ResourceType.CanvasApp] }
    );
    if (out.kind !== "chart") throw new Error("expected chart");
    expect(out.buckets.find((b) => b.name === "shared_sharepointonline")?.value).toBe(1);
  });

  it("dedupes same connector listed twice on one app", () => {
    const out = appTopConnectorsAllTypes([
      app({ id: "a", connectors: [connector("shared_sql"), connector("shared_sql")] }),
    ]);
    if (out.kind !== "chart") throw new Error("expected chart");
    expect(out.buckets[0].value).toBe(1);
  });
});

describe("appConnectorsPerAppHistogram", () => {
  it("buckets each app by its distinct connector count", () => {
    const out = appConnectorsPerAppHistogram([
      app({ id: "a", connectors: [] }), // 0
      app({ id: "b", connectors: [connector("x")] }), // 1
      app({ id: "c", connectors: [connector("x"), connector("y"), connector("z")] }), // 2-3
      app({
        id: "d",
        connectors: [connector("x"), connector("y"), connector("z"), connector("p"), connector("q"), connector("r"), connector("s")],
      }), // 6-10
    ]);
    if (out.kind !== "chart") throw new Error("expected chart");
    const m = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(m["0"]).toBe(1);
    expect(m["1"]).toBe(1);
    expect(m["2-3"]).toBe(1);
    expect(m["6-10"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Distribution / top-N
// ---------------------------------------------------------------------------

describe("appsByType", () => {
  it("buckets apps by type, ignoring types not in filter when supplied", () => {
    const apps = [
      app({ id: "c1", type: ResourceType.CanvasApp }),
      app({ id: "c2", type: ResourceType.CanvasApp }),
      app({ id: "m1", type: ResourceType.ModelDrivenApp }),
      app({ id: "code1", type: ResourceType.CodeApp }),
    ];
    const allOut = appsByType(apps);
    if (allOut.kind !== "chart") throw new Error("expected chart");
    expect(allOut.buckets.length).toBe(3);

    const filteredOut = appsByType(apps, {
      types: [ResourceType.CanvasApp, ResourceType.ModelDrivenApp],
    });
    if (filteredOut.kind !== "chart") throw new Error("expected chart");
    expect(filteredOut.buckets.length).toBe(2);
    expect(filteredOut.buckets.reduce((s, b) => s + b.value, 0)).toBe(3);
  });
});

describe("appsTopCreators", () => {
  it("ranks creators by app count, capping at topN", () => {
    const apps: AppRow[] = [];
    for (let i = 0; i < 5; i++) apps.push(app({ id: `u1-${i}`, createdBy: "user-1" }));
    for (let i = 0; i < 3; i++) apps.push(app({ id: `u2-${i}`, createdBy: "user-2" }));
    for (let i = 0; i < 1; i++) apps.push(app({ id: `u3-${i}`, createdBy: "user-3" }));
    const out = appsTopCreators(apps, { topN: 2 });
    if (out.kind !== "chart") throw new Error("expected chart");
    // topN=2 → 1 head + Other.
    expect(out.buckets.length).toBe(2);
    expect(out.buckets[0].name).toBe("user-1");
    expect(out.buckets[0].value).toBe(5);
    expect(out.buckets.find((b) => b.name === "Other")?.value).toBe(4); // 3 + 1
  });
});

describe("appsTopEnvironments", () => {
  it("groups by environmentId", () => {
    const out = appsTopEnvironments([
      app({ id: "a", environmentId: "env-A" }),
      app({ id: "b", environmentId: "env-A" }),
      app({ id: "c", environmentId: "env-B" }),
    ]);
    if (out.kind !== "chart") throw new Error("expected chart");
    expect(out.buckets[0]).toEqual({ name: "env-A", value: 2 });
    expect(out.buckets[1]).toEqual({ name: "env-B", value: 1 });
  });
});

describe("appsByCodeSubType", () => {
  it("only counts code apps", () => {
    const out = appsByCodeSubType([
      app({ id: "code-byoc", type: ResourceType.CodeApp, subType: "byocApp" }),
      app({ id: "code-byoc2", type: ResourceType.CodeApp, subType: "byocApp" }),
      app({ id: "code-unset", type: ResourceType.CodeApp, subType: "" }),
      // App-builder app should be excluded even though it has a subType.
      app({ id: "appbuilder", type: ResourceType.AppBuilderApp, subType: "appBuilderApp" }),
    ]);
    if (out.kind !== "chart") throw new Error("expected chart");
    const m = Object.fromEntries(out.buckets.map((b) => [b.name, b.value]));
    expect(m["byocApp"]).toBe(2);
    expect(m["(unspecified)"]).toBe(1);
    expect(m["appBuilderApp"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Time-series
// ---------------------------------------------------------------------------

describe("appsCreatedTrend", () => {
  it("delta mode counts apps per bucket within the window", () => {
    const out = appsCreatedTrend(
      [
        app({ id: "a", createdAt: daysAgo(3) }),
        app({ id: "b", createdAt: daysAgo(3) }),
        // outside the 7d window:
        app({ id: "c", createdAt: daysAgo(50) }),
      ],
      { bucket: "day", lookbackDays: 7 }
    );
    if (out.kind !== "series") throw new Error("expected series");
    // Sum of deltas inside the window = 2 (the two apps from 3d ago).
    const totalDelta = out.series.reduce((s, p) => s + p.delta, 0);
    expect(totalDelta).toBe(2);
    // Bucket count is bounded; lookbackDays=7 with day buckets → ~8 buckets.
    expect(out.series.length).toBeGreaterThan(0);
    expect(out.series.length).toBeLessThanOrEqual(10);
  });

  it("cumulative mode includes the baseline of apps created before the window", () => {
    const out = appsCreatedTrend(
      [
        app({ id: "old", createdAt: daysAgo(500) }), // baseline
        app({ id: "new1", createdAt: daysAgo(2) }),
        app({ id: "new2", createdAt: daysAgo(2) }),
      ],
      { bucket: "day", lookbackDays: 7, cumulative: true }
    );
    if (out.kind !== "series") throw new Error("expected series");
    const final = out.series[out.series.length - 1];
    expect(final.value).toBe(3); // baseline 1 + 2 in window
    expect(final.total).toBe(3);
    // First bucket's value should already include the baseline (no zero
    // start if there's pre-window data).
    expect(out.series[0].value).toBeGreaterThanOrEqual(1);
  });

  it("filters by params.types when supplied", () => {
    const out = appsCreatedTrend(
      [
        app({ id: "c", type: ResourceType.CanvasApp, createdAt: daysAgo(1) }),
        app({ id: "code", type: ResourceType.CodeApp, createdAt: daysAgo(1) }),
      ],
      { bucket: "day", lookbackDays: 7, types: [ResourceType.CanvasApp] }
    );
    if (out.kind !== "series") throw new Error("expected series");
    expect(out.series.reduce((s, p) => s + p.delta, 0)).toBe(1);
  });

  it("honors dateField override (e.g. lastModifiedAt for activity heartbeat)", () => {
    const out = appsCreatedTrend(
      [
        // created long ago, modified yesterday — counts under lastModifiedAt
        app({ id: "a", createdAt: daysAgo(500), lastModifiedAt: daysAgo(1) }),
        // created yesterday, modified long ago — does NOT count under lastModifiedAt
        app({ id: "b", createdAt: daysAgo(1), lastModifiedAt: daysAgo(500) }),
      ],
      { bucket: "day", lookbackDays: 7, dateField: "lastModifiedAt" }
    );
    if (out.kind !== "series") throw new Error("expected series");
    expect(out.series.reduce((s, p) => s + p.delta, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Registry integration
// ---------------------------------------------------------------------------

describe("registry integration", () => {
  it("every app aggregator id resolves through getAggregator()", () => {
    for (const id of Object.values(APP_AGGREGATOR_IDS)) {
      expect(getAggregator(id), `missing registration for ${id}`).toBeTruthy();
    }
  });

  it("every app aggregator is registered with dataSource: 'apps'", () => {
    for (const id of Object.values(APP_AGGREGATOR_IDS)) {
      const reg = getAggregatorRegistration(id);
      expect(reg?.dataSource, `wrong dataSource on ${id}`).toBe("apps");
    }
  });
});
