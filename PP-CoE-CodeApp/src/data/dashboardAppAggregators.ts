/**
 * Computed-tile aggregators for Power Apps dashboards.
 *
 * Mirrors `dashboardAggregators.ts` in spirit — pure functions over
 * `AppRow[]` that return a discriminated `AggregatorOutput`. Lives in
 * its own file so the agent aggregators stay focused on Copilot Studio
 * semantics and the row shape they expect.
 *
 * Each aggregator registers itself with the central registry via
 * `registerAggregators`. New aggregators MUST also be added to
 * `APP_AGGREGATOR_IDS` for stable string-ID lookup from templates.
 *
 * **Canvas-only signals:** several lifecycle aggregators below
 * (`appNeverLaunchedCohorts`, `appStaleCohorts`,
 * `appLaunchedVsNeverPerEnv`) filter the input down to canvas apps
 * before bucketing. `lastLaunchedTime`, `sharedUsersCount`, and friends
 * only exist on canvas apps in the inventory schema — including
 * model-driven, code, or app-builder rows in those buckets would
 * produce misleading "never launched" counts (they would *all* read
 * as never launched because the field isn't published).
 */
import type { AppRow } from "./inventory";
import { ResourceType } from "./inventory";
import {
  registerAggregators,
  type Aggregator,
  type AggregatorOutput,
  type AggregatorSeriesDatum,
  type ChartBucket,
  type ChartOutput,
  type KpiOutput,
  type SeriesOutput,
  type StackedBarOutput,
  type StackedChartDatum,
  type TableOutput,
} from "./dashboardAggregators";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function readNumberParam(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: number
): number {
  const v = params?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function readStringArrayParam(
  params: Record<string, unknown> | undefined,
  key: string
): string[] | null {
  const v = params?.[key];
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : null;
}

function parseDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY_MS));
}

function isCanvas(app: AppRow): boolean {
  return app.type === ResourceType.CanvasApp;
}

function hasLaunched(app: AppRow): boolean {
  return !!parseDate(app.lastLaunchedAt);
}

// Age-bucket scheme reused by the cohort aggregators. Tuned to the same
// thresholds the Lifecycle tab's tables use (90 / 180 / 365 days) so a
// reader can pivot from "11 apps in 90-180d bucket" to the matching
// detail-list tile without a unit mismatch.
const AGE_BUCKETS: Array<{ name: string; minDays: number; maxDays: number | null }> = [
  { name: "0-29 days", minDays: 0, maxDays: 29 },
  { name: "30-89 days", minDays: 30, maxDays: 89 },
  { name: "90-179 days", minDays: 90, maxDays: 179 },
  { name: "180-364 days", minDays: 180, maxDays: 364 },
  { name: "365+ days", minDays: 365, maxDays: null },
];

function bucketByAge(ageDays: number): string {
  for (const b of AGE_BUCKETS) {
    if (b.maxDays === null) {
      if (ageDays >= b.minDays) return b.name;
    } else if (ageDays >= b.minDays && ageDays <= b.maxDays) {
      return b.name;
    }
  }
  return AGE_BUCKETS[AGE_BUCKETS.length - 1].name;
}

function emptyBucketMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of AGE_BUCKETS) m.set(b.name, 0);
  return m;
}

function bucketMapToChart(m: Map<string, number>): ChartBucket[] {
  // Preserve the canonical AGE_BUCKETS order so the rendered bar chart
  // reads left-to-right as youngest → oldest, regardless of insertion
  // order during the fold.
  return AGE_BUCKETS.map((b) => ({ name: b.name, value: m.get(b.name) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Lifecycle cohorts
// ---------------------------------------------------------------------------

/** Canvas apps that have NEVER been launched, bucketed by age since
 *  creation. The "0-29 days" bucket is intentionally kept (not filtered
 *  out as noise) because *brand new and not yet launched* is itself an
 *  onboarding signal worth surfacing. */
export const appNeverLaunchedCohorts: Aggregator<AppRow> = (apps): ChartOutput => {
  const now = new Date();
  const m = emptyBucketMap();
  for (const a of apps) {
    if (!isCanvas(a)) continue;
    if (hasLaunched(a)) continue;
    const created = parseDate(a.createdAt);
    if (!created) continue;
    const bucket = bucketByAge(daysBetween(created, now));
    m.set(bucket, (m.get(bucket) ?? 0) + 1);
  }
  return { kind: "chart", buckets: bucketMapToChart(m) };
};

/** Canvas apps that HAVE been launched at some point, bucketed by days
 *  since the last launch. "Stale" cohort tile — pairs naturally with the
 *  detail table on the Lifecycle tab. */
export const appStaleCohorts: Aggregator<AppRow> = (apps): ChartOutput => {
  const now = new Date();
  const m = emptyBucketMap();
  for (const a of apps) {
    if (!isCanvas(a)) continue;
    const last = parseDate(a.lastLaunchedAt);
    if (!last) continue;
    const bucket = bucketByAge(daysBetween(last, now));
    m.set(bucket, (m.get(bucket) ?? 0) + 1);
  }
  return { kind: "chart", buckets: bucketMapToChart(m) };
};

/** Stacked-bar: per environment, how many canvas apps were ever launched
 *  vs never launched. Surfaces "this env has 47 apps and 38 are never
 *  launched" patterns — the cleanup signal that motivated this tile.
 *  Categories are sorted by total descending and capped at `topN` (default
 *  15); the rest roll into an "Other" category so the bar isn't dominated
 *  by long-tail one-app environments. */
export const appLaunchedVsNeverPerEnv: Aggregator<AppRow> = (apps, params): StackedBarOutput => {
  const topN = readNumberParam(params, "topN", 15);
  const perEnv = new Map<string, { launched: number; never: number }>();
  for (const a of apps) {
    if (!isCanvas(a)) continue;
    const env = a.environmentId || "(unknown)";
    const entry = perEnv.get(env) ?? { launched: 0, never: 0 };
    if (hasLaunched(a)) entry.launched += 1;
    else entry.never += 1;
    perEnv.set(env, entry);
  }
  const sorted = Array.from(perEnv.entries())
    .map(([env, counts]) => ({ env, ...counts, total: counts.launched + counts.never }))
    .sort((a, b) => b.total - a.total || a.env.localeCompare(b.env));

  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);
  const data: StackedChartDatum[] = head.map((row) => ({
    category: row.env,
    Launched: row.launched,
    "Never launched": row.never,
  }));
  if (tail.length > 0) {
    const launchedSum = tail.reduce((s, r) => s + r.launched, 0);
    const neverSum = tail.reduce((s, r) => s + r.never, 0);
    data.push({ category: "Other", Launched: launchedSum, "Never launched": neverSum });
  }
  return {
    kind: "stackedBar",
    series: ["Launched", "Never launched"],
    data,
  };
};

// ---------------------------------------------------------------------------
// Cleanup candidates (scored)
// ---------------------------------------------------------------------------

interface CleanupRow extends Record<string, unknown> {
  displayName: string;
  type: string;
  environmentId: string;
  ownerId: string;
  score: number;
  reasons: string;
  ageDays: number;
  lastLaunchedAt: string;
  lastModifiedAt: string;
}

/** Composite cleanup-candidates table. Each app accumulates +1 per
 *  signal that fires — never launched after 90 days, last launched
 *  >180 days ago, last modified >365 days ago, quarantined. Apps with
 *  zero signals are omitted (they aren't cleanup candidates). Capped
 *  at `topN` rows (default 30), highest score first, ties broken by
 *  oldest `lastModifiedAt` so the rows most worth looking at surface
 *  first.
 *
 *  Canvas-only signals (`never launched`, `stale launch`) only fire
 *  for canvas apps — `lastLaunchedTime` is not published for other
 *  modalities, and we would mis-flag every MDA / code / app-builder
 *  row otherwise.
 *
 *  Per-tile narrowing: pass `params.types = [...]` to restrict the
 *  scoring universe to specific app types so e.g. the Canvas+MDA
 *  template's cleanup table doesn't surface Code apps just because
 *  their lastModifiedAt is over a year old. Defaults to all types. */
export const appCleanupCandidatesTable: Aggregator<AppRow> = (apps, params): TableOutput => {
  const topN = readNumberParam(params, "topN", 30);
  const typeFilter = readStringArrayParam(params, "types");
  const now = new Date();
  const rows: CleanupRow[] = [];
  for (const a of apps) {
    if (typeFilter && !typeFilter.includes(a.type)) continue;
    const created = parseDate(a.createdAt);
    const ageDays = created ? daysBetween(created, now) : 0;
    const reasons: string[] = [];
    let score = 0;

    if (isCanvas(a)) {
      if (!hasLaunched(a) && ageDays > 90) {
        reasons.push("never launched (>90d old)");
        score += 1;
      }
      const last = parseDate(a.lastLaunchedAt);
      if (last && daysBetween(last, now) > 180) {
        reasons.push("last launched >180d ago");
        score += 1;
      }
    }
    const modified = parseDate(a.lastModifiedAt);
    if (modified && daysBetween(modified, now) > 365) {
      reasons.push("unmodified >365d");
      score += 1;
    }
    if (a.isQuarantined) {
      reasons.push("quarantined");
      score += 1;
    }
    if (score === 0) continue;

    rows.push({
      displayName: a.displayName,
      type: a.type,
      environmentId: a.environmentId,
      ownerId: a.ownerId,
      score,
      reasons: reasons.join(", "),
      ageDays,
      lastLaunchedAt: a.lastLaunchedAt,
      lastModifiedAt: a.lastModifiedAt,
    });
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Older lastModifiedAt → higher cleanup priority on a tie.
    return (a.lastModifiedAt || "").localeCompare(b.lastModifiedAt || "");
  });
  return {
    kind: "table",
    items: rows.slice(0, topN),
    total: rows.length,
  };
};

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

/** Top connectors by app count across every app type. `AppRow.connectors`
 *  is already a normalized shape (canvas `powerPlatformConnectors[]` and
 *  app-builder `connectors[]` both flatten into the same array via
 *  `readConnectors` in `inventory.ts`), so a single uniqueness pass per
 *  row is enough — no per-modality fan-out needed here.
 *
 *  Per-tile narrowing: pass `params.types = [...]` to restrict the input
 *  to specific app types (e.g. `[ResourceType.CanvasApp]`) so a single
 *  registered aggregator can power both "top connectors across canvas"
 *  and "top connectors across all app types" tiles in the same dashboard. */
export const appTopConnectorsAllTypes: Aggregator<AppRow> = (apps, params): ChartOutput => {
  const topN = readNumberParam(params, "topN", 15);
  const typeFilter = readStringArrayParam(params, "types");
  const counts = new Map<string, number>();
  for (const a of apps) {
    if (typeFilter && !typeFilter.includes(a.type)) continue;
    const seen = new Set<string>();
    for (const c of a.connectors ?? []) {
      if (!c?.connectorId || seen.has(c.connectorId)) continue;
      seen.add(c.connectorId);
      counts.set(c.displayName || c.connectorId, (counts.get(c.displayName || c.connectorId) ?? 0) + 1);
    }
  }
  const sorted = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (sorted.length <= topN) return { kind: "chart", buckets: sorted };
  const head = sorted.slice(0, topN - 1);
  const tail = sorted.slice(topN - 1).reduce((s, b) => s + b.value, 0);
  return { kind: "chart", buckets: [...head, { name: "Other", value: tail }] };
};

const CONNECTOR_COUNT_BUCKETS: Array<{ name: string; min: number; max: number | null }> = [
  { name: "0", min: 0, max: 0 },
  { name: "1", min: 1, max: 1 },
  { name: "2-3", min: 2, max: 3 },
  { name: "4-5", min: 4, max: 5 },
  { name: "6-10", min: 6, max: 10 },
  { name: "11+", min: 11, max: null },
];

/** Histogram: how many connectors each app references. Answers
 *  "is the average app simple (1 source) or sprawling (10+
 *  connectors)?" — a useful proxy for governance review effort. */
export const appConnectorsPerAppHistogram: Aggregator<AppRow> = (apps): ChartOutput => {
  const m = new Map<string, number>(CONNECTOR_COUNT_BUCKETS.map((b) => [b.name, 0]));
  for (const a of apps) {
    const count = new Set((a.connectors ?? []).map((c) => c.connectorId).filter(Boolean)).size;
    for (const b of CONNECTOR_COUNT_BUCKETS) {
      if (b.max === null) {
        if (count >= b.min) {
          m.set(b.name, (m.get(b.name) ?? 0) + 1);
          break;
        }
      } else if (count >= b.min && count <= b.max) {
        m.set(b.name, (m.get(b.name) ?? 0) + 1);
        break;
      }
    }
  }
  return {
    kind: "chart",
    buckets: CONNECTOR_COUNT_BUCKETS.map((b) => ({ name: b.name, value: m.get(b.name) ?? 0 })),
  };
};

// ---------------------------------------------------------------------------
// Distribution / top-N / trend aggregators
//
// These exist because the builder-source pie/bar/line tile path applies
// only `spec.resourceTypes`/`spec.filters` and does NOT include the
// first-party-app exclusion (`__sys == false`) that raw clauses use.
// Driving these tiles through computed aggregators routes them through
// `fetchAllCustomerApps`, which DOES exclude system-owned apps — so the
// Customer Service Hub / Sales Hub / Field Service first-party MDA apps
// stay out of "distribution by type", "top creators", "top environments",
// and the creation trend lines. Without this routing, those tiles would
// be dominated by Dataverse-installed first-party rows.
// ---------------------------------------------------------------------------

function topNChartFromCounts(counts: Map<string, number>, topN: number): ChartBucket[] {
  const sorted = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  if (sorted.length <= topN) return sorted;
  const head = sorted.slice(0, topN - 1);
  const tail = sorted.slice(topN - 1).reduce((s, b) => s + b.value, 0);
  return [...head, { name: "Other", value: tail }];
}

/** Distribution of apps by `type`. Honors an optional `types` param
 *  to restrict the universe to specific app types — without it, the
 *  pie shows all four type buckets. */
export const appsByType: Aggregator<AppRow> = (apps, params): ChartOutput => {
  const typeFilter = readStringArrayParam(params, "types");
  const counts = new Map<string, number>();
  for (const a of apps) {
    if (typeFilter && !typeFilter.includes(a.type)) continue;
    const t = a.type || "(unknown)";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return { kind: "chart", buckets: topNChartFromCounts(counts, 8) };
};

/** Top-N creators (`createdBy`) across the supplied app types. Used in
 *  place of the builder-source `barTile("...", "properties.createdBy")`
 *  so first-party / system-owned apps stay excluded. */
export const appsTopCreators: Aggregator<AppRow> = (apps, params): ChartOutput => {
  const topN = readNumberParam(params, "topN", 10);
  const typeFilter = readStringArrayParam(params, "types");
  const counts = new Map<string, number>();
  for (const a of apps) {
    if (typeFilter && !typeFilter.includes(a.type)) continue;
    const c = a.createdBy || "(unknown)";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return { kind: "chart", buckets: topNChartFromCounts(counts, topN) };
};

/** Top-N environments by app count across the supplied app types. */
export const appsTopEnvironments: Aggregator<AppRow> = (apps, params): ChartOutput => {
  const topN = readNumberParam(params, "topN", 10);
  const typeFilter = readStringArrayParam(params, "types");
  const counts = new Map<string, number>();
  for (const a of apps) {
    if (typeFilter && !typeFilter.includes(a.type)) continue;
    const e = a.environmentId || "(unknown)";
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return { kind: "chart", buckets: topNChartFromCounts(counts, topN) };
};

/** Distribution of Code apps by `subType` (e.g. `byocApp`). Implicitly
 *  filters to `microsoft.powerapps/codeapps` — other modalities don't
 *  publish a meaningful `subType` for this view. */
export const appsByCodeSubType: Aggregator<AppRow> = (apps): ChartOutput => {
  const counts = new Map<string, number>();
  for (const a of apps) {
    if (a.type !== ResourceType.CodeApp) continue;
    const s = a.subType || "(unspecified)";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return { kind: "chart", buckets: topNChartFromCounts(counts, 8) };
};

// ── Trend / time-series ───────────────────────────────────────────────

type TrendBucket = "day" | "week" | "month";

function readStringParam(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: string
): string {
  const v = params?.[key];
  return typeof v === "string" && v ? v : fallback;
}

function readBoolParam(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: boolean
): boolean {
  const v = params?.[key];
  return typeof v === "boolean" ? v : fallback;
}

/** Truncate `d` to the start of its bucket (in UTC) for a given size.
 *  Week buckets align to the Monday on or before the date — picking
 *  Monday matches what the existing server-side `runTimeSeriesAggregate`
 *  produces, so per-bucket label alignment looks identical to a reader
 *  comparing the tiles side by side. */
function truncateToBucket(d: Date, bucket: TrendBucket): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (bucket === "day") return new Date(Date.UTC(y, m, day));
  if (bucket === "month") return new Date(Date.UTC(y, m, 1));
  // Week — align to Monday.
  const start = new Date(Date.UTC(y, m, day));
  const dow = start.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMonday = (dow + 6) % 7; // Monday => 0, Sunday => 6
  start.setUTCDate(start.getUTCDate() - offsetToMonday);
  return start;
}

function advanceBucket(d: Date, bucket: TrendBucket): Date {
  const next = new Date(d.getTime());
  if (bucket === "day") next.setUTCDate(next.getUTCDate() + 1);
  else if (bucket === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function formatBucketLabel(d: Date, bucket: TrendBucket): string {
  if (bucket === "month") {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface AppsCreatedTrendParams {
  /** Bucket size for the X axis. Defaults to "month". */
  bucket?: TrendBucket;
  /** How many days back from today to render. Defaults to 365. */
  lookbackDays?: number;
  /** Which date field on each app to bucket. Defaults to `createdAt`.
   *  Set to `lastModifiedAt` for an "activity heartbeat" line. */
  dateField?: "createdAt" | "lastModifiedAt";
  /** When true, plot the running total of matching apps through each
   *  bucket end (apps with date ≤ bucket end are counted, including
   *  the baseline before the window starts). When false, plot per-bucket
   *  deltas (apps with date inside the bucket). */
  cumulative?: boolean;
  /** Optional app-type filter. Same semantics as the other aggregators. */
  types?: string[];
}

/** Time-bucketed app creation / activity trend. Drives line tiles via
 *  `SeriesOutput`. Handles both delta and cumulative modes so a template
 *  can have a "created this month" line right next to a "cumulative
 *  inventory" line, fed by the same underlying app universe and excluding
 *  first-party apps consistently across both. */
export const appsCreatedTrend: Aggregator<AppRow> = (apps, params): SeriesOutput => {
  const p = (params ?? {}) as AppsCreatedTrendParams;
  const bucket: TrendBucket = (p.bucket as TrendBucket) ?? "month";
  const lookbackDays = readNumberParam(params, "lookbackDays", 365);
  const dateField = readStringParam(params, "dateField", "createdAt") as
    | "createdAt"
    | "lastModifiedAt";
  const cumulative = readBoolParam(params, "cumulative", false);
  const typeFilter = readStringArrayParam(params, "types");

  const now = new Date();
  const windowStart = new Date(now.getTime() - lookbackDays * DAY_MS);
  const firstBucketStart = truncateToBucket(windowStart, bucket);
  const finalBucketStart = truncateToBucket(now, bucket);

  // Walk forward, collecting bucket starts. Cap iterations so a
  // misconfigured `lookbackDays = 10_000_000` can't lock the renderer.
  const bucketStarts: Date[] = [];
  const MAX_BUCKETS = 600;
  for (
    let cur = firstBucketStart;
    cur.getTime() <= finalBucketStart.getTime() && bucketStarts.length < MAX_BUCKETS;
    cur = advanceBucket(cur, bucket)
  ) {
    bucketStarts.push(cur);
  }
  if (bucketStarts.length === 0) bucketStarts.push(finalBucketStart);

  const counts = new Map<number, number>();
  let baseline = 0;
  for (const a of apps) {
    if (typeFilter && !typeFilter.includes(a.type)) continue;
    const raw = dateField === "lastModifiedAt" ? a.lastModifiedAt : a.createdAt;
    const d = parseDate(raw);
    if (!d) continue;
    if (d.getTime() < firstBucketStart.getTime()) {
      if (cumulative) baseline += 1;
      continue;
    }
    const key = truncateToBucket(d, bucket).getTime();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let runningTotal = baseline;
  const series: AggregatorSeriesDatum[] = bucketStarts.map((start) => {
    const delta = counts.get(start.getTime()) ?? 0;
    runningTotal += delta;
    const value = cumulative ? runningTotal : delta;
    return {
      date: start.toISOString(),
      label: formatBucketLabel(start, bucket),
      delta,
      total: runningTotal,
      value,
    };
  });

  return { kind: "series", series };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Stable string IDs for app-typed aggregators. Prefixed with `apps.`
 *  to keep them clearly separated from `agents.*` ids in the central
 *  registry. */
export const APP_AGGREGATOR_IDS = {
  neverLaunchedCohorts: "apps.neverLaunchedCohorts",
  staleCohorts: "apps.staleCohorts",
  launchedVsNeverPerEnv: "apps.launchedVsNeverPerEnv",
  cleanupCandidatesTable: "apps.cleanupCandidatesTable",
  topConnectorsAllTypes: "apps.topConnectorsAllTypes",
  connectorsPerAppHistogram: "apps.connectorsPerAppHistogram",
  byType: "apps.byType",
  topCreators: "apps.topCreators",
  topEnvironments: "apps.topEnvironments",
  byCodeSubType: "apps.byCodeSubType",
  createdTrend: "apps.createdTrend",
} as const;

registerAggregators({
  [APP_AGGREGATOR_IDS.neverLaunchedCohorts]: {
    fn: appNeverLaunchedCohorts as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.staleCohorts]: {
    fn: appStaleCohorts as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.launchedVsNeverPerEnv]: {
    fn: appLaunchedVsNeverPerEnv as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.cleanupCandidatesTable]: {
    fn: appCleanupCandidatesTable as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.topConnectorsAllTypes]: {
    fn: appTopConnectorsAllTypes as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.connectorsPerAppHistogram]: {
    fn: appConnectorsPerAppHistogram as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.byType]: {
    fn: appsByType as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.topCreators]: {
    fn: appsTopCreators as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.topEnvironments]: {
    fn: appsTopEnvironments as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.byCodeSubType]: {
    fn: appsByCodeSubType as Aggregator<unknown>,
    dataSource: "apps",
  },
  [APP_AGGREGATOR_IDS.createdTrend]: {
    fn: appsCreatedTrend as Aggregator<unknown>,
    dataSource: "apps",
  },
});

// Re-export the shared output types so template / test consumers don't
// need a second import from `dashboardAggregators`.
export type {
  AggregatorOutput,
  AggregatorSeriesDatum,
  ChartOutput,
  KpiOutput,
  SeriesOutput,
  StackedBarOutput,
  TableOutput,
};
