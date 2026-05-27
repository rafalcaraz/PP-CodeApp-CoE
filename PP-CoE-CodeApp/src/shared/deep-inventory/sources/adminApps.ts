/**
 * `admin-apps` deep-inventory source.
 *
 * Wraps the Power Platform for Admins V2 connector's `Get_AdminApps`
 * operation, which returns the full admin-scope payload for every app
 * in one environment — owner principal, embedded-app posture,
 * `usesPremiumApi` / `usesOnPremiseGateway` / `usesCustomApi`, DLP
 * evaluation, plan classification, etc.
 *
 * Why fan out by environment (rather than per-app):
 *
 *  - Per-app fanout is `O(apps)`; on a tenant with thousands of apps
 *    that's hours of admin calls and a fast trip to 429s.
 *  - Per-env fanout is `O(envs × pages)`; typical tenants have
 *    tens-to-low-hundreds of envs. The connector returns up to 250
 *    apps per page so most envs complete in one page.
 *  - The payload returned per app is the **same** rich shape you'd
 *    get from `Get_AdminApp(envId, appId)` — so all the deep
 *    properties (embeddedApp.type, usesPremiumApi, ...) are populated
 *    for free.
 *
 * Paging strategy: drive off `nextLink.skiptoken` returned by the
 * connector, capped at a defensive page-count to avoid runaway loops.
 * If the connector starts returning the same skiptoken twice in a
 * row (mirroring the bug `runQueryAllPages` works around for
 * QueryResources) we stop paging.
 */

import { PowerPlatformforAdminsV2Service } from "../../../generated";
import type { ResourceArrayPowerApp } from "../../../generated/models/PowerPlatformforAdminsV2Model";
import type { DeepRecord, DeepRecordIdentity } from "../catalog/types";
import type { DeepSource, ScopeUnit, SourcePage } from "./types";

const API_VERSION = "2024-10-01";
/** Connector page size. The endpoint accepts up to 250; we use the
 *  max so most envs complete in one round trip. */
const PAGE_SIZE = 250;
/** Defensive cap on pages per env. Saturates at ~16k apps per env;
 *  well past any real-world workload. Stops the iterable in the
 *  pathological case where the connector loops on skiptoken. */
const MAX_PAGES_PER_ENV = 64;

/**
 * Extract a `?$skiptoken=` value from a `nextLink` URL. The connector
 * returns absolute URLs; we only care about the cursor. Returns
 * `undefined` when the link is missing or doesn't carry the param.
 */
function extractSkipToken(nextLink: string | undefined): string | undefined {
  if (!nextLink) return undefined;
  // Use a permissive matcher — the param name casing has been seen
  // as both `$skiptoken` and `$skipToken` depending on the version.
  const match = nextLink.match(/[?&]\$skiptoken=([^&]+)/i);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Best-effort error message extractor. The generated client returns
 *  `{ success, error }`; the error shape varies. */
function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (typeof e.requestId === "string" && e.requestId)
      parts.push(`requestId ${e.requestId}`);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Detect a 429 / throttle / "too many requests" failure. The
 *  connector surfaces rate limits inconsistently — sometimes a
 *  structured `{ status: 429 }`, sometimes a free-form message with
 *  the code embedded. Mirrors the heuristic in `data/inventory.ts`
 *  so per-source retry behavior stays consistent across the app. */
function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.status === "number" && e.status === 429) return true;
    const msg =
      typeof e.message === "string"
        ? e.message
        : typeof e === "string"
          ? e
          : "";
    if (msg && /(\b429\b|rate ?limit|throttle|too many requests)/i.test(msg)) {
      return true;
    }
  }
  if (typeof err === "string") {
    return /(\b429\b|rate ?limit|throttle|too many requests)/i.test(err);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Max retry attempts for a single page request before surfacing
 *  the error as a scope-unit failure. */
const MAX_RETRIES_PER_PAGE = 3;
/** Base backoff in ms; each retry multiplies by 2 (500 → 1000 → 2000)
 *  plus 0-500ms jitter to spread parallel retries. */
const BASE_BACKOFF_MS = 500;

async function fetchPageWithRetry(
  envId: string,
  skipToken: string | undefined,
  signal: AbortSignal
): Promise<{ success: true; data: ResourceArrayPowerApp } | { success: false; error: unknown }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_PAGE; attempt++) {
    if (signal.aborted) {
      return { success: false, error: new Error("Aborted") };
    }
    const result = await PowerPlatformforAdminsV2Service.Get_AdminApps(
      envId,
      API_VERSION,
      PAGE_SIZE,
      skipToken
    );
    if (result.success) {
      return { success: true, data: result.data ?? {} };
    }
    // Throttle? Back off and try again.
    if (isRateLimitError(result.error) && attempt < MAX_RETRIES_PER_PAGE) {
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
      await sleep(backoff);
      lastError = result.error;
      continue;
    }
    // Non-throttle failure, or out of attempts — propagate.
    return { success: false, error: result.error };
  }
  return { success: false, error: lastError };
}

async function* fetchAdminAppsPages(
  scopeUnit: ScopeUnit,
  signal: AbortSignal
): AsyncIterable<SourcePage> {
  if (signal.aborted) return;
  let skipToken: string | undefined = undefined;

  for (let page = 0; page < MAX_PAGES_PER_ENV; page++) {
    if (signal.aborted) return;

    const result = await fetchPageWithRetry(scopeUnit.envId, skipToken, signal);

    if (signal.aborted) return;

    if (!result.success) {
      throw new Error(formatError(result.error));
    }

    const data = result.data;
    const records = (data.value ?? []) as unknown as DeepRecord[];
    const nextToken = extractSkipToken(data.nextLink);

    // Defensive: if the server hands back the SAME token it received
    // (i.e. paging cursor isn't advancing), treat this as the last
    // page. Mirrors `runQueryAllPages` belt-and-suspenders behavior.
    const stuck = !!nextToken && nextToken === skipToken;
    const isLast = !nextToken || stuck;

    yield { records, isLast };

    if (isLast) return;
    skipToken = nextToken;
  }
}

function identifyAdminApp(
  record: DeepRecord,
  scopeUnit: ScopeUnit
): DeepRecordIdentity | null {
  const name = readString(record, "name");
  const displayName = readNested(record, ["properties", "displayName"]) ?? name;
  if (!name) return null;
  return {
    id: name,
    environmentId: scopeUnit.envId,
    displayName: displayName ? String(displayName) : name,
    // `Get_AdminApps` returns canvas, code, and app-builder apps.
    // We don't have a per-record discriminator on the V2 payload
    // (the inventory graph has it, but here we only know "it's an
    // app"). Default to `canvasapps` since the SharePoint form / Teams
    // / Power BI use cases all land there.
    resourceType: "microsoft.powerapps/canvasapps",
  };
}

function readString(record: DeepRecord, key: string): string | undefined {
  const v = record[key];
  return typeof v === "string" ? v : undefined;
}

function readNested(record: DeepRecord, path: string[]): unknown {
  let cur: unknown = record;
  for (const segment of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/** Public list of paths the `admin-apps` source filters out of the
 *  observed schema (and the merged catalog). Centralized so both the
 *  flattener-at-write-time and the merger-at-display-time use the
 *  same list — that way already-cached entries from before a new
 *  prefix was added still get hidden in the UI without forcing the
 *  user to clear their observed schema.
 *
 *  Heuristic for adding a prefix here: the path either (a) carries
 *  per-save / per-user noise that pollutes the catalog without ever
 *  being a useful filter (signed URIs, version bags), or (b)
 *  expands into hundreds of sibling leaves that aren't queryable
 *  fleet-level (Dataverse table dumps, canvas component refs). */
export const ADMIN_APPS_EXCLUDE_PREFIXES: string[] = [
  // Per-save signed blob URIs — rotate on every edit.
  "properties.appUris",
  "properties.appPlayUri",
  "properties.appPlayEmbeddedUri",
  "properties.appPlayTeamsUri",
  "properties.appOpenUri",
  "properties.appOpenProtocolUri",
  "properties.backgroundImageUri",
  "properties.unauthenticatedWebPackageHint",
  // Version sub-objects (major/minor/build/revision × every record).
  "properties.createdByClientVersion",
  "properties.minClientVersion",
  // Maker-internal payload bags. `databaseReferences` alone can
  // explode into hundreds of `default.cds.dataSources.<TableName>.{
  // entitySetName,isHidden,logicalName}` leaves on any model-driven
  // or CDS-backed canvas app — none of which are queryable
  // fleet-level. Same story for `componentReferences`.
  "properties.databaseReferences",
  "properties.componentReferences",
  // Per-user state, not a fleet concept.
  "properties.userAppMetadata",
  // Tag bags that rotate per save.
  "tags.sienaVersion",
  "tags.publisherVersion",
  "tags.minimumRequiredApiVersion",
];

/** Public `admin-apps` source instance. The runner imports this from
 *  `sources/index.ts` and wires it up by `DeepSourceId`. */
export const adminAppsSource: DeepSource = {
  id: "admin-apps",
  label: "Apps (admin scope)",
  flattenOptions: {
    excludePrefixes: ADMIN_APPS_EXCLUDE_PREFIXES,
  },
  fetch: fetchAdminAppsPages,
  identify: identifyAdminApp,
  defaultColumns: [
    "properties.displayName",
    "properties.appPlanClassification",
    "properties.embeddedApp.type",
    "properties.lastModifiedTime",
  ],
};

// Exposed for tests so they can exercise the skiptoken parsing
// without setting up a fake connector response. NOT part of the
// public API outside this folder.
export const __test = { extractSkipToken, isRateLimitError };
