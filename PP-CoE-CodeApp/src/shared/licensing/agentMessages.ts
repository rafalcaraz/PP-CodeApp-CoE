/**
 * Fetches a single resource's MCS Messages consumption snapshot.
 *
 * Endpoint: `GET /v2.0/tenants/{t}/entitlements/MCSMessages/resources`
 *           with `searchRequest={resourceId}` to scope to one agent.
 *
 * Wire shape (observed):
 *   [
 *     {
 *       "resources": [
 *         {
 *           "environmentId": "...",
 *           "resourceId": "...",
 *           "consumed": 0.0,
 *           "unit": "Messages",
 *           "metadata": { "ResourceName": "ITSNowAgent", ... },
 *           "asOfDate": "2026-06-03T03:53:08.777"
 *         }
 *       ]
 *     },
 *     ...
 *   ]
 *
 * Normalization rules:
 *   - Flatten across the outer page array.
 *   - Filter to entries whose `resourceId` matches the requested one
 *     (case-insensitive — GUIDs round-trip in mixed case from some APIs).
 *   - Sum `consumed` across matching entries (typically only one).
 *   - Pick the most-recent `asOfDate` if multiple are present.
 *   - Pick the first non-empty `metadata.ResourceName` we see.
 *   - Empty matches is a SUCCESS with `empty: true` (no data reported for
 *     this resource in the window) — NOT an error. The UI should show
 *     "0 messages — no usage reported" rather than an error pane.
 */

import { callLicensing } from "./client";
import { buildAgentMcsConsumptionUrl } from "./urlBuilder";
import type {
  AgentMessagesConsumption,
  AgentMessagesQueryOpts,
  LicensingResult,
} from "./types";

const DEFAULT_UNIT = "Messages";

export async function getAgentMessagesConsumed(
  opts: AgentMessagesQueryOpts,
): Promise<LicensingResult<AgentMessagesConsumption>> {
  if (!opts.tenantId) {
    return { ok: false, error: "Missing tenantId — cannot query licensing API." };
  }
  if (!opts.resourceId) {
    return { ok: false, error: "Missing resourceId — cannot query licensing API." };
  }

  const now = new Date();
  const to = opts.to ?? now;
  const from = opts.from ?? defaultDaysBefore(to, 30);
  const url = buildAgentMcsConsumptionUrl({ ...opts, from, to }, now);

  const raw = await callLicensing({ method: "GET", url });
  if (!raw.ok) return raw;

  try {
    return {
      ok: true,
      data: normalizeAgentMessages(raw.data, opts.resourceId, from, to),
    };
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't parse licensing entitlement response: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

/**
 * Pure normalizer (exported for tests).
 *
 * Doesn't throw on malformed data — coerces missing fields to safe defaults.
 * Throws ONLY if `parsed` is so far from the expected shape that we can't
 * even iterate it (e.g. it's a string or number). The caller catches that.
 */
export function normalizeAgentMessages(
  parsed: unknown,
  expectedResourceId: string,
  from: Date,
  to: Date,
): AgentMessagesConsumption {
  const fromIso = toDateOnly(from);
  const toIso = toDateOnly(to);

  // The wire shape is either an array of `{resources:[...]}` pages OR
  // (defensively) a single object with `resources`. Coerce both forms.
  const pages: unknown[] = Array.isArray(parsed)
    ? parsed
    : isObjectWithResources(parsed)
      ? [parsed]
      : (() => {
          throw new Error(
            "Expected array of {resources:[]} pages or a single page object.",
          );
        })();

  const matches: ResourceEntry[] = [];
  for (const page of pages) {
    if (!isObjectWithResources(page)) continue;
    const resources = (page as { resources: unknown }).resources;
    if (!Array.isArray(resources)) continue;
    for (const r of resources) {
      if (!r || typeof r !== "object") continue;
      const entry = r as ResourceEntry;
      if (!sameGuid(entry.resourceId, expectedResourceId)) continue;
      matches.push(entry);
    }
  }

  if (matches.length === 0) {
    return {
      consumed: 0,
      unit: DEFAULT_UNIT,
      fromDate: fromIso,
      toDate: toIso,
      empty: true,
    };
  }

  let consumed = 0;
  let unit: string | undefined;
  let resourceName: string | undefined;
  let environmentId: string | undefined;
  let asOfDate: string | undefined;
  let asOfDateMs = -Infinity;

  for (const m of matches) {
    const c = typeof m.consumed === "number" ? m.consumed : Number(m.consumed) || 0;
    consumed += c;
    if (!unit && typeof m.unit === "string") unit = m.unit;
    if (!environmentId && typeof m.environmentId === "string") {
      environmentId = m.environmentId;
    }
    const metaName =
      m.metadata && typeof m.metadata === "object"
        ? (m.metadata as { ResourceName?: unknown }).ResourceName
        : undefined;
    if (!resourceName && typeof metaName === "string" && metaName.length > 0) {
      resourceName = metaName;
    }
    if (typeof m.asOfDate === "string") {
      const t = Date.parse(m.asOfDate);
      if (Number.isFinite(t) && t > asOfDateMs) {
        asOfDateMs = t;
        asOfDate = m.asOfDate;
      }
    }
  }

  return {
    consumed,
    unit: unit ?? DEFAULT_UNIT,
    resourceName,
    environmentId,
    asOfDate,
    fromDate: fromIso,
    toDate: toIso,
    empty: false,
  };
}

interface ResourceEntry {
  environmentId?: string;
  resourceId?: string;
  consumed?: number | string;
  unit?: string;
  metadata?: unknown;
  asOfDate?: string;
}

function isObjectWithResources(v: unknown): v is { resources: unknown } {
  return !!v && typeof v === "object" && "resources" in v;
}

function sameGuid(a: unknown, b: unknown): boolean {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.toLowerCase() === b.toLowerCase()
  );
}

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
