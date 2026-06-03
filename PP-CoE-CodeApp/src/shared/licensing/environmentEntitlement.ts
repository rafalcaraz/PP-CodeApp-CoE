/**
 * Fetches a per-environment MCS Messages entitlement snapshot.
 *
 * Endpoint:
 *   GET /v0.1-alpha/tenants/{t}/environments/{envId}/entitlements/MCSMessages
 *
 * The endpoint version (`v0.1-alpha`) is unstable — the UI should flag
 * any data sourced through this fetcher as experimental.
 *
 * Wire shape (observed): a single object with nested `entitlement` block
 * holding `capacity` + `payGo` sub-objects. We flatten the nesting into
 * one level (`capacity.allocated`, `capacity.consumed`, …) for ergonomics.
 *
 * Normalization rules:
 *   - Missing numeric fields are coerced to 0 so the UI never null-checks.
 *   - Missing strings stay undefined so the UI can render an em-dash.
 *   - `enforcementRules` defaults to an empty array.
 *   - The response's `entitlementId` is trusted only if it matches the
 *     known set ("MCSMessages"); otherwise we fall back to the request's
 *     entitlement (currently always "MCSMessages") so the typed field is
 *     never a free-form string.
 */

import { callLicensing } from "./client";
import { buildEnvironmentMcsEntitlementUrl } from "./urlBuilder";
import type {
  EntitlementId,
  EnvironmentEntitlement,
  EnvironmentEntitlementQueryOpts,
  LicensingResult,
} from "./types";

const KNOWN_ENTITLEMENTS = new Set<EntitlementId>(["MCSMessages"]);
const DEFAULT_ENTITLEMENT_ID: EntitlementId = "MCSMessages";

export async function getEnvironmentMcsEntitlement(
  opts: EnvironmentEntitlementQueryOpts,
): Promise<LicensingResult<EnvironmentEntitlement>> {
  if (!opts.tenantId) {
    return { ok: false, error: "Missing tenantId — cannot query licensing API." };
  }
  if (!opts.environmentId) {
    return {
      ok: false,
      error: "Missing environmentId — cannot query licensing API.",
    };
  }

  const url = buildEnvironmentMcsEntitlementUrl(opts);
  const raw = await callLicensing({ method: "GET", url });
  if (!raw.ok) return raw;

  try {
    return {
      ok: true,
      data: normalizeEnvironmentEntitlement(raw.data, opts),
    };
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't parse environment entitlement response: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

/** Pure normalizer (exported for tests). */
export function normalizeEnvironmentEntitlement(
  parsed: unknown,
  opts: EnvironmentEntitlementQueryOpts,
): EnvironmentEntitlement {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Expected a single object payload.");
  }
  const obj = parsed as Record<string, unknown>;
  const requested = opts.entitlementId ?? DEFAULT_ENTITLEMENT_ID;
  const responseEnt = obj.entitlementId;
  const entitlementId: EntitlementId =
    typeof responseEnt === "string" && KNOWN_ENTITLEMENTS.has(responseEnt as EntitlementId)
      ? (responseEnt as EntitlementId)
      : requested;

  const entitlement =
    obj.entitlement && typeof obj.entitlement === "object"
      ? (obj.entitlement as Record<string, unknown>)
      : {};
  const capacity =
    entitlement.capacity && typeof entitlement.capacity === "object"
      ? (entitlement.capacity as Record<string, unknown>)
      : {};
  const allocated = numericPair(capacity.allocated, "value", "autoAllocated");
  const consumed = numericPair(capacity.consumed, "value", "writeOff");
  const consumptionType = stringField(capacity.consumed, "consumptionType");
  const lastUpdatedOn = stringField(capacity.consumed, "lastUpdatedOn");

  const payGo =
    entitlement.payGo && typeof entitlement.payGo === "object"
      ? (entitlement.payGo as Record<string, unknown>)
      : {};
  const payGoEntitled = numeric(payGo.entitled, "value");
  const payGoConsumed = numeric(payGo.consumed, "value");
  const payGoConsumptionType = stringField(payGo.consumed, "consumptionType");
  const payGoWriteOff = numeric(payGo.consumed, "writeOff");

  const enforcementRulesRaw = Array.isArray(capacity.enforcementRules)
    ? capacity.enforcementRules
    : [];
  const enforcementRules = enforcementRulesRaw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      ruleType: typeof r.ruleType === "string" ? r.ruleType : "",
      enabled: r.enabled === true,
    }));

  const productCategoriesRaw = Array.isArray(obj.productCategories)
    ? obj.productCategories
    : [];
  const productCategories = productCategoriesRaw.filter(
    (p): p is string => typeof p === "string",
  );

  return {
    environmentId:
      typeof obj.environmentId === "string" ? obj.environmentId : opts.environmentId,
    environmentName: optionalString(obj.environmentName),
    environmentType: optionalString(obj.environmentType),
    isManagedEnvironment:
      typeof obj.isManagedEnvironment === "boolean"
        ? obj.isManagedEnvironment
        : undefined,
    location: optionalString(obj.location),
    entitlementId,
    unit: typeof entitlement.unit === "string" ? entitlement.unit : "Count",
    capacity: {
      allocated: allocated[0],
      autoAllocated: allocated[1],
      consumed: consumed[0],
      consumptionType: consumptionType ?? undefined,
      lastUpdatedOn: lastUpdatedOn ?? undefined,
      writeOff: consumed[1],
      available: numeric(capacity, "availableQuantity"),
      status: optionalString(capacity.status),
    },
    payGo: {
      entitled: payGoEntitled,
      consumed: payGoConsumed,
      consumptionType: payGoConsumptionType ?? undefined,
      writeOff: payGoWriteOff,
    },
    enforcementRules,
    productCategories,
  };
}

function numeric(parent: unknown, key: string): number {
  if (!parent || typeof parent !== "object") return 0;
  const v = (parent as Record<string, unknown>)[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numericPair(
  parent: unknown,
  keyA: string,
  keyB: string,
): [number, number] {
  return [numeric(parent, keyA), numeric(parent, keyB)];
}

function stringField(parent: unknown, key: string): string | null {
  if (!parent || typeof parent !== "object") return null;
  const v = (parent as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
