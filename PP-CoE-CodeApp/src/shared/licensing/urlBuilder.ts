/**
 * Pure URL builder for the Power Platform Licensing API time-series endpoint.
 *
 * Kept separate from `client.ts` / `usage.ts` so it can be unit-tested
 * without touching the generated flow client. The shape of the URL is
 * reverse-engineered from real licensing portal traffic (see the captured
 * samples in plan.md). The empty `filter=`, `searchRequest=`, and
 * `metrics=` query parameters are deliberately preserved — the licensing
 * API is undocumented and we don't have evidence it's safe to omit them.
 */

import type {
  AgentMessagesQueryOpts,
  EnvironmentEntitlementQueryOpts,
  UsageQueryOpts,
} from "./types";

const LICENSING_HOST = "https://licensing.powerplatform.microsoft.com";
const API_VERSION_PATH = "/v1.0";
/** Path prefix for the per-resource entitlements endpoint (v2.0). */
const ENTITLEMENTS_RESOURCES_API_VERSION_PATH = "/v2.0";
/** Path prefix for the per-environment entitlement endpoint (still alpha). */
const ENVIRONMENT_ENTITLEMENT_API_VERSION_PATH = "/v0.1-alpha";

/** Default trailing window when caller doesn't specify `from`/`to`.
 *  The licensing API enforces a strict `span <= 365 days` rule, so we
 *  ask for 12 months minus a day to stay comfortably under the cap
 *  regardless of which month boundary we land near (e.g. 12 months back
 *  from July 1 is 365 days; from March 1 in a leap year it's 366). */
const DEFAULT_WINDOW_MONTHS = 12;
const DEFAULT_WINDOW_SAFETY_DAYS = 1;

/** Default page size matches what the licensing portal sends. */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Build the GET URL for `usageData/<productCategory>/timeseries`.
 *
 * `now` is injectable so tests can lock the default date window to a
 * deterministic value.
 */
export function buildTimeseriesUrl(opts: UsageQueryOpts, now: Date = new Date()): string {
  const to = opts.to ?? now;
  const from = opts.from ?? defaultFrom(to);
  const interval = opts.interval ?? "Monthly";
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;

  // URLSearchParams keeps order deterministic (insertion order) which
  // matches the captured-sample URL exactly. Keep the empty params
  // even though they look superfluous — see the file header.
  const params = new URLSearchParams();
  params.set("pageNumber", "1");
  params.set("orderByProperty", "date");
  params.set("orderDirection", "descending");
  params.set("pageSize", String(pageSize));
  params.set("filter", "");
  params.set("searchRequest", "");
  params.set("metrics", "");
  params.set("trendInterval", interval);
  params.set("from", from.toISOString());
  params.set("to", to.toISOString());
  params.set("resourceId", opts.resourceId);

  const tenant = encodeURIComponent(opts.tenantId);
  const category = encodeURIComponent(opts.productCategory);
  return `${LICENSING_HOST}${API_VERSION_PATH}/tenants/${tenant}/usageData/${category}/timeseries?${params.toString()}`;
}

function defaultFrom(to: Date): Date {
  const d = new Date(to);
  d.setUTCMonth(d.getUTCMonth() - DEFAULT_WINDOW_MONTHS);
  d.setUTCDate(d.getUTCDate() + DEFAULT_WINDOW_SAFETY_DAYS);
  return d;
}

// ---------------------------------------------------------------------------
// Entitlement endpoints
// ---------------------------------------------------------------------------

/** Default trailing window for the per-resource entitlements endpoint. */
const DEFAULT_AGENT_MESSAGES_WINDOW_DAYS = 30;
/** Default page size for the per-resource entitlements endpoint. */
const DEFAULT_AGENT_MESSAGES_PAGE_SIZE = 100;
/** Default entitlement id for both endpoints — we only consume MCSMessages today. */
const DEFAULT_ENTITLEMENT_ID = "MCSMessages";

/**
 * Build the GET URL for the per-resource entitlements endpoint
 * (`/v2.0/tenants/{t}/entitlements/{entId}/resources`).
 *
 * The licensing portal uses `YYYY-MM-DD` date-only query params for this
 * endpoint, NOT ISO timestamps — there's no time-of-day component. We
 * preserve that format exactly so the API doesn't reinterpret the window.
 *
 * `now` is injectable so tests can lock the default window deterministically.
 */
export function buildAgentMcsConsumptionUrl(
  opts: AgentMessagesQueryOpts,
  now: Date = new Date(),
): string {
  const to = opts.to ?? now;
  const from = opts.from ?? defaultDaysBefore(to, DEFAULT_AGENT_MESSAGES_WINDOW_DAYS);
  const pageSize = opts.pageSize ?? DEFAULT_AGENT_MESSAGES_PAGE_SIZE;
  const entitlementId = opts.entitlementId ?? DEFAULT_ENTITLEMENT_ID;

  const params = new URLSearchParams();
  params.set("fromDate", toDateOnly(from));
  params.set("toDate", toDateOnly(to));
  params.set("pageNumber", "1");
  params.set("pageSize", String(pageSize));
  params.set("searchRequest", opts.resourceId);
  // `includeFields` is sent empty in the portal traffic; preserve it defensively
  // in case the API treats absence vs empty differently for some entitlements.
  params.set("includeFields", "");

  const tenant = encodeURIComponent(opts.tenantId);
  const ent = encodeURIComponent(entitlementId);
  return `${LICENSING_HOST}${ENTITLEMENTS_RESOURCES_API_VERSION_PATH}/tenants/${tenant}/entitlements/${ent}/resources?${params.toString()}`;
}

/**
 * Build the GET URL for the per-environment entitlement endpoint
 * (`/v0.1-alpha/tenants/{t}/environments/{envId}/entitlements/{entId}`).
 *
 * This endpoint is on the alpha route — surface that in the UI.
 * There are no query parameters; the entitlement id is path-positional.
 */
export function buildEnvironmentMcsEntitlementUrl(
  opts: EnvironmentEntitlementQueryOpts,
): string {
  const entitlementId = opts.entitlementId ?? DEFAULT_ENTITLEMENT_ID;
  const tenant = encodeURIComponent(opts.tenantId);
  const env = encodeURIComponent(opts.environmentId);
  const ent = encodeURIComponent(entitlementId);
  return `${LICENSING_HOST}${ENVIRONMENT_ENTITLEMENT_API_VERSION_PATH}/tenants/${tenant}/environments/${env}/entitlements/${ent}`;
}

/** UTC `YYYY-MM-DD` representation of a date for date-only query params. */
function toDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultDaysBefore(to: Date, days: number): Date {
  const d = new Date(to);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}
