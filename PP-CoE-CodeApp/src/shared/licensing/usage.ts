/**
 * High-level helper that fetches a usage time series for a single
 * resource (agent / flow / app) and returns a normalized `UsageSeries`.
 *
 * Composes:
 *   buildTimeseriesUrl(opts) -> callLicensing(GET, url) -> normalize(json)
 *
 * Normalization choices:
 *   - Points are sorted ASCENDING by date (the API returns descending,
 *     but a left-to-right chart reads ascending).
 *   - Missing metrics are coerced to 0 (the wire shape sometimes omits
 *     `activeRuns` for product categories that don't track it).
 *   - `totals` are taken from the API if present; otherwise recomputed
 *     by summing the points (so a downstream component never has to
 *     null-check).
 *   - Empty `points: []` is a successful result with `points.length === 0` —
 *     not an error. The UI decides how to render "no data".
 */

import { callLicensing } from "./client";
import { buildTimeseriesUrl } from "./urlBuilder";
import type {
  LicensingResult,
  UsageMetrics,
  UsagePoint,
  UsageQueryOpts,
  UsageSeries,
} from "./types";

export async function getUsageTimeseries(
  opts: UsageQueryOpts,
): Promise<LicensingResult<UsageSeries>> {
  if (!opts.tenantId) {
    return { ok: false, error: "Missing tenantId — cannot query licensing API." };
  }
  if (!opts.resourceId) {
    return { ok: false, error: "Missing resourceId — cannot query licensing API." };
  }

  const url = buildTimeseriesUrl(opts);
  const raw = await callLicensing({ method: "GET", url });
  if (!raw.ok) return raw;

  try {
    return { ok: true, data: normalizeUsageSeries(raw.data, opts) };
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't parse licensing usage response: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

// Exported for unit tests. Pure.
export function normalizeUsageSeries(
  raw: unknown,
  opts: Pick<UsageQueryOpts, "productCategory" | "from" | "to">,
): UsageSeries {
  if (!raw || typeof raw !== "object") {
    throw new Error("Response is not an object");
  }
  const obj = raw as Record<string, unknown>;

  const points = toPoints(obj.points);
  // The API returns descending; sort ascending so the chart reads
  // left-to-right chronologically.
  points.sort((a, b) => a.date.localeCompare(b.date));

  const totals = isUsageMetrics(obj.totals)
    ? coerceMetrics(obj.totals)
    : sumMetrics(points);

  return {
    productCategory: typeof obj.productCategory === "string" ? obj.productCategory : opts.productCategory,
    interval: typeof obj.interval === "string" ? obj.interval : "Monthly",
    fromDate: typeof obj.fromDate === "string" ? obj.fromDate : (opts.from?.toISOString() ?? ""),
    toDate: typeof obj.toDate === "string" ? obj.toDate : (opts.to?.toISOString() ?? ""),
    points,
    totals,
  };
}

function toPoints(raw: unknown): UsagePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: UsagePoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const obj = p as Record<string, unknown>;
    if (typeof obj.date !== "string") continue;
    out.push({
      date: obj.date,
      metrics: coerceMetrics(obj.metrics),
    });
  }
  return out;
}

function coerceMetrics(raw: unknown): UsageMetrics {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    activeUsers: numOr0(obj.activeUsers),
    activeSessions: numOr0(obj.activeSessions),
    activeRuns: numOr0(obj.activeRuns),
  };
}

function isUsageMetrics(raw: unknown): boolean {
  return !!raw && typeof raw === "object";
}

function sumMetrics(points: UsagePoint[]): UsageMetrics {
  let users = 0,
    sessions = 0,
    runs = 0;
  for (const p of points) {
    users += p.metrics.activeUsers;
    sessions += p.metrics.activeSessions;
    runs += p.metrics.activeRuns;
  }
  return { activeUsers: users, activeSessions: sessions, activeRuns: runs };
}

function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
