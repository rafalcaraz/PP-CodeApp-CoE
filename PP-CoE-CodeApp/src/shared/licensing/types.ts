/**
 * Public types for the Power Platform Licensing API wrapper.
 *
 * The licensing API is reached via a wrapper Power Automate flow
 * (`PPLicensingAPI-Wrapper-Flow`) that takes a method + URL and
 * proxies to https://licensing.powerplatform.microsoft.com via the
 * `shared_webcontents` (HTTP with Microsoft Entra ID, preauthorized)
 * connector. The flow is pre-bound to a connection that has the
 * licensing host pre-authorized in its `ResourceUri`.
 *
 * We don't reuse `DataResult` from `src/data/inventory` because that
 * module lives in `shared-legacy` and `src/shared/*` may only import
 * from `shared` + `generated` (enforced by eslint-plugin-boundaries).
 * The shape is identical in spirit.
 */

export type LicensingResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Which product category to query usage telemetry for.
 *
 * Confirmed working against tenant samples: `CopilotStudio`, `PowerAutomate`.
 * `PowerApps` is experimental — the endpoint shape is assumed identical but
 * not yet validated against a real response; the UsageCard surfaces any
 * 4xx/5xx as a normal error.
 */
export type ProductCategory = "CopilotStudio" | "PowerAutomate" | "PowerApps";

/** Per-bucket activity counts the licensing API returns. */
export interface UsageMetrics {
  activeUsers: number;
  activeSessions: number;
  activeRuns: number;
}

/** One time-bucket in the series (monthly bucket by default). */
export interface UsagePoint {
  /** ISO timestamp of the start of the bucket. */
  date: string;
  metrics: UsageMetrics;
}

/**
 * Normalized usage time series for one resource.
 *
 * The wire shape from the licensing API is close to this; the
 * normalizer in `usage.ts` coerces missing fields to 0, sorts points
 * ascending by date (the API returns descending), and recomputes
 * totals from points if the API omits them.
 */
export interface UsageSeries {
  productCategory: string;
  /** e.g. "Monthly", "Daily", "Weekly". */
  interval: string;
  fromDate: string;
  toDate: string;
  points: UsagePoint[];
  totals: UsageMetrics;
}

/**
 * Options for fetching a usage time series.
 *
 * `from`/`to` default to the last 12 months → now. `interval` defaults
 * to "Monthly". `pageSize` defaults to 50 (the empirical default the
 * licensing portal uses).
 */
export interface UsageQueryOpts {
  productCategory: ProductCategory;
  tenantId: string;
  resourceId: string;
  from?: Date;
  to?: Date;
  interval?: "Monthly" | "Daily" | "Weekly";
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Entitlement endpoints (MCSMessages) — separate from `usageData/timeseries`.
//
// These are GET-only, scoped to a resource (agent) or an environment, and
// return point-in-time / window-aggregated counters rather than a per-bucket
// time series. They live in this same module because they're served by the
// same licensing host and use the same wrapper flow.
// ---------------------------------------------------------------------------

/**
 * The licensing API exposes several entitlements (Messages, AI Builder
 * credits, etc.). Today we only consume MCSMessages — but typing the field
 * explicitly leaves room to add more later without a breaking change.
 */
export type EntitlementId = "MCSMessages";

/**
 * Normalized agent-scope consumption.
 *
 * Wire shape: an array of pages each holding a `resources` array (see
 * sample in plan.md). We flatten/sum across pages and return a single
 * snapshot per request — the typical case for a per-agent card is one
 * matching resource with a single `consumed` figure.
 */
export interface AgentMessagesConsumption {
  /** Sum of `consumed` across all matching `resources` entries. */
  consumed: number;
  /** Display unit reported by the API (e.g. "Messages"). */
  unit: string;
  /** Friendly resource name from `metadata.ResourceName`, if reported. */
  resourceName?: string;
  /** Environment GUID reported by the API, if present. */
  environmentId?: string;
  /** Last-updated timestamp reported by the API, if present. */
  asOfDate?: string;
  /** Window the report covered (echo back of the request range, YYYY-MM-DD). */
  fromDate: string;
  toDate: string;
  /** True when the response contained no matching `resources` entries. */
  empty: boolean;
}

/** Options for fetching an agent-scope MCS consumption snapshot. */
export interface AgentMessagesQueryOpts {
  tenantId: string;
  /** The agent's bot GUID (matches `AgentRow.id`). */
  resourceId: string;
  /** Inclusive start date (defaults to 30 days before `to`). */
  from?: Date;
  /** Inclusive end date (defaults to today, UTC). */
  to?: Date;
  /** Override page size (default 100, matches portal). */
  pageSize?: number;
  /** Entitlement to query. Defaults to "MCSMessages". */
  entitlementId?: EntitlementId;
}

/**
 * Normalized per-environment entitlement snapshot. Mirrors the
 * `/environments/{id}/entitlements/{entitlementId}` v0.1-alpha endpoint
 * shape but flattened so the UI doesn't need to drill through 4 levels.
 */
export interface EnvironmentEntitlement {
  environmentId: string;
  environmentName?: string;
  environmentType?: string;
  isManagedEnvironment?: boolean;
  location?: string;
  /** Stable per-entitlement label ("MCSMessages", …). */
  entitlementId: EntitlementId;
  /** "Count" in the MCSMessages sample — display unit. */
  unit: string;
  capacity: {
    allocated: number;
    autoAllocated: number;
    consumed: number;
    consumptionType?: string;
    /** ISO timestamp of last consumption snapshot, if reported. */
    lastUpdatedOn?: string;
    writeOff: number;
    available: number;
    /** e.g. "WithinCapacity" — colour-code in the UI. */
    status?: string;
  };
  payGo: {
    entitled: number;
    consumed: number;
    consumptionType?: string;
    writeOff: number;
  };
  enforcementRules: Array<{ ruleType: string; enabled: boolean }>;
  productCategories: string[];
}

/** Options for fetching a per-environment MCS entitlement snapshot. */
export interface EnvironmentEntitlementQueryOpts {
  tenantId: string;
  environmentId: string;
  /** Entitlement to query. Defaults to "MCSMessages". */
  entitlementId?: EntitlementId;
}
