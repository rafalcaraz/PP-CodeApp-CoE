/**
 * Public API for the Power Platform Licensing API wrapper.
 *
 * Most consumers should only need `getUsageTimeseries` and the
 * `UsageSeries`/`ProductCategory` types. `callLicensing` is exported
 * for callers that need to hit non-timeseries endpoints later.
 */

export { callLicensing, clearLicensingInflight } from "./client";
export type { LicensingRequest } from "./client";
export { getUsageTimeseries, normalizeUsageSeries } from "./usage";
export {
  getAgentMessagesConsumed,
  normalizeAgentMessages,
} from "./agentMessages";
export {
  getEnvironmentMcsEntitlement,
  normalizeEnvironmentEntitlement,
} from "./environmentEntitlement";
export type {
  AgentMessagesConsumption,
  AgentMessagesQueryOpts,
  EntitlementId,
  EnvironmentEntitlement,
  EnvironmentEntitlementQueryOpts,
  LicensingResult,
  ProductCategory,
  UsageMetrics,
  UsagePoint,
  UsageQueryOpts,
  UsageSeries,
} from "./types";
