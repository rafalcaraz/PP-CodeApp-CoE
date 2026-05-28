/**
 * GUID → Service Principal resolver, backed by Microsoft Graph through
 * the `HTTP with Microsoft Entra ID (preauthorized)` connector.
 *
 * Sibling of `userEnrichment.ts` — same caching / dedupe contract,
 * different backend. The combined chain is:
 *
 *   inventory.ownerId  →  resolveUser   →  hit?  use it
 *                                       →  null? fall through to
 *                          resolveServicePrincipal  →  hit?  service principal
 *                                                   →  null? truly unresolved
 *
 * **Why a separate module vs. extending `userEnrichment`?** They speak
 * to different backends (Dataverse aaduser vs Graph) with different
 * batch semantics: aaduser is per-id only (the virtual-table plugin
 * doesn't honor multi-id `or` filters); Graph supports real bulk
 * lookups via `directoryObjects/getByIds` (up to 1000 ids per call).
 * Keeping the resolvers separate lets each pick the right transport.
 *
 * **What "not found" means here.** A GUID that misses on BOTH
 * `aaduser` AND Graph `servicePrincipals` is genuinely unresolvable —
 * almost always a deleted user account (Graph also covers external
 * SPs and managed identities, so a miss here is meaningful). The
 * `unresolved` bucket in the owner-scan controller should rely on
 * this combined result, not on `aaduser` alone (which over-reports —
 * see `docs/inventory-schema-samples.md`).
 *
 * **Slim Graph projections.** We deliberately don't pull every field
 * Graph returns for a service principal — the unscoped payload is
 * ~23 KB / SP (a real measurement). With `$select`, ~500 bytes / SP.
 * 45× smaller, same information value for our use case.
 */

import { HTTPwithMicrosoftEntraID_preauthorized_Service as HttpService } from "../generated/services/HTTPwithMicrosoftEntraID_preauthorized_Service";
import type { HttpRequest } from "../generated/models/HTTPwithMicrosoftEntraID_preauthorized_Model";
import type { DataResult } from "./inventory";

// ─── Constants ────────────────────────────────────────────────────────────

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Tenant ID under which Microsoft owns its first-party app
 *  registrations (Office, Power Platform, Dataverse, etc.). When a
 *  service principal's `appOwnerOrganizationId` equals this, the SP
 *  is a Microsoft-managed identity — no in-tenant escalation contact
 *  exists, and the row is informational only.
 *
 *  Public, well-known constant; documented in
 *  https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types
 *  and visible on every first-party SP returned by Graph. */
export const MICROSOFT_TENANT_ID = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";

const SP_SELECT_FIELDS = [
  "id",
  "displayName",
  "appId",
  "servicePrincipalType",
  "appOwnerOrganizationId",
  "accountEnabled",
];

const OWNER_SELECT_FIELDS = [
  "id",
  "accountEnabled",
  "deletedDateTime",
  "displayName",
  "mail",
];

/** Max ids per `directoryObjects/getByIds` call. Documented Graph
 *  limit. We never batch beyond this — the resolver chunks the input
 *  into groups of this size and fires one call per chunk. */
const BATCH_LIMIT = 1000;

// ─── Types ────────────────────────────────────────────────────────────────

/** Categorization derived from `appOwnerOrganizationId` +
 *  `servicePrincipalType`. Pre-computed during resolution so the page
 *  layer doesn't repeat the rule. */
export type SpKind =
  | "first-party"     // Microsoft-owned (appOwnerOrganizationId === MICROSOFT_TENANT_ID)
  | "managed-identity" // servicePrincipalType === "ManagedIdentity"
  | "tenant"          // appOwnerOrganizationId === <some non-Microsoft tenant>
  | "legacy"          // servicePrincipalType === "Legacy"
  | "social-idp"      // servicePrincipalType === "SocialIdp"
  | "unknown";

export interface ServicePrincipalRef {
  /** Service principal's Object ID (matches inventory `ownerId`). Normalized lowercase. */
  id: string;
  displayName: string;
  appId: string;
  servicePrincipalType: string;
  /** Home-tenant ID of the application this SP is an instance of.
   *  `null` for legacy / a few odd cases; non-null usually means the
   *  classification rule below can decide cleanly. */
  appOwnerOrganizationId: string | null;
  accountEnabled: boolean;
  /** Pre-computed classification (see `classifyServicePrincipal`). */
  kind: SpKind;
}

/** Lightweight owner record returned by the per-SP "owners" drill-in.
 *  We deliberately keep this small — the page just needs enough to
 *  render a chip and offer click-through. */
export interface ServicePrincipalOwner {
  /** Discriminator: `user` for human owners, `servicePrincipal` for
   *  rare nested-SP ownership (a child SP owned by a parent SP). */
  type: "user" | "servicePrincipal";
  id: string;
  displayName?: string;
  mail?: string;
  accountEnabled?: boolean;
  /** Set when Graph reports the user is in the soft-delete window. */
  deletedDateTime?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function normalize(id: string): string {
  return id.trim().toLowerCase().replace(/[{}()]/g, "");
}

function isGuidish(id: string): boolean {
  return /^[{(]?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[)}]?$/i.test(id);
}

function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string" && e.message) return e.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Classification rule. Pure function — exported so the controller
 *  tests can pin it without spinning up the resolver. */
export function classifyServicePrincipal(
  sp: Pick<ServicePrincipalRef, "appOwnerOrganizationId" | "servicePrincipalType">,
): SpKind {
  // Microsoft-owned first-party SPs are by far the most common case
  // (Pipelines, Dataverse, etc.). Check that first.
  if (
    sp.appOwnerOrganizationId &&
    normalize(sp.appOwnerOrganizationId) === MICROSOFT_TENANT_ID
  ) {
    return "first-party";
  }
  const type = (sp.servicePrincipalType ?? "").toLowerCase();
  if (type === "managedidentity") return "managed-identity";
  if (type === "legacy") return "legacy";
  if (type === "socialidp") return "social-idp";
  if (sp.appOwnerOrganizationId) return "tenant";
  return "unknown";
}

// ─── HTTP wrapper ─────────────────────────────────────────────────────────

/**
 * The connector's `InvokeHttp` is typed `Promise<IOperationResult<void>>`
 * because its OpenAPI schema doesn't pin a response shape. At runtime
 * the response is the actual HTTP envelope: `{ statusCode, headers, body }`.
 * We cast once here and never again — the rest of the module deals in
 * the parsed `body`.
 *
 * 404 → `{ ok: true, data: null }`. Mirrors the resolver's "looked up,
 * not present" contract. The connector framework sometimes surfaces
 * 4xx as `success:false` and sometimes as `success:true` with an
 * embedded status code; we handle both.
 */
interface HttpEnvelope<T> {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: T | { error?: { code?: string; message?: string } };
}

async function callGraph<T>(
  method: HttpRequest["method"],
  path: string,
  jsonBody?: object,
): Promise<DataResult<T | null>> {
  const request: HttpRequest = {
    method,
    url: `${GRAPH_BASE}${path}`,
    headers: {
      Accept: "application/json",
      ...(jsonBody ? { "Content-Type": "application/json" } : {}),
    },
    body: jsonBody ? JSON.stringify(jsonBody) : undefined,
  };

  // The cast: schema types `data` as void, the runtime returns the envelope.
  type RuntimeResult = {
    success: boolean;
    data?: HttpEnvelope<T>;
    error?: unknown;
  };
  const raw = (await HttpService.InvokeHttp(request)) as unknown as RuntimeResult;

  if (!raw.success) {
    const msg = formatError(raw.error);
    if (/\b404\b/.test(msg) || /not\s*found/i.test(msg)) {
      return { ok: true, data: null };
    }
    return { ok: false, error: msg };
  }

  const envelope = raw.data;
  if (!envelope) return { ok: false, error: "Empty response from Graph" };

  const status = envelope.statusCode;
  if (status === 404) return { ok: true, data: null };
  if (typeof status === "number" && status >= 400) {
    // Surface Graph's own error message when present.
    const errBody = envelope.body as
      | { error?: { code?: string; message?: string } }
      | undefined;
    const detail = errBody?.error?.message ?? `HTTP ${status}`;
    return { ok: false, error: detail };
  }

  // Some connector flavors return the body directly under `data` rather
  // than under `data.body` — handle both.
  const body =
    envelope.body !== undefined
      ? (envelope.body as T)
      : (envelope as unknown as T);
  return { ok: true, data: body };
}

// ─── Cache + dedupe ───────────────────────────────────────────────────────

const cache = new Map<string, ServicePrincipalRef | null>();
const inflight = new Map<string, Promise<ServicePrincipalRef | null>>();

/** Drop all cached SP resolutions. Wired to the same "Refresh" affordance
 *  that calls `clearUserCache`. */
export function clearServicePrincipalCache(): void {
  cache.clear();
  inflight.clear();
}

/** Synchronous read of the SP cache. Mirrors `peekUser` shape; used by
 *  the page when rendering already-resolved SPs from a recent scan
 *  without re-fetching. */
export function peekServicePrincipal(
  id: string | undefined | null,
): ServicePrincipalRef | null | undefined {
  if (!id || !isGuidish(id)) return undefined;
  const g = normalize(id);
  return cache.get(g);
}

// ─── Resolution: single ───────────────────────────────────────────────────

/**
 * Resolve a single Object ID through Graph `/servicePrincipals/{id}`.
 *
 *  - **Cache-first.** Never re-queries an id already in the cache.
 *  - **In-flight dedupe.** Concurrent requests for the same id share
 *    one promise → one network call.
 *  - **Slim payload.** Only the fields needed for bucketing + UI.
 *  - **Returns `null`** when the GUID isn't a service principal (404).
 *    That `null` is cached so re-renders don't re-fetch.
 */
export function resolveServicePrincipal(
  id: string | undefined | null,
): Promise<ServicePrincipalRef | null> {
  if (!id) return Promise.resolve(null);
  if (!isGuidish(id)) return Promise.resolve(null);

  const g = normalize(id);
  if (cache.has(g)) return Promise.resolve(cache.get(g) ?? null);
  const existing = inflight.get(g);
  if (existing) return existing;

  const promise = (async () => {
    const select = `$select=${SP_SELECT_FIELDS.join(",")}`;
    const res = await callGraph<RawServicePrincipal>(
      "GET",
      `/servicePrincipals/${encodeURIComponent(g)}?${select}`,
    );
    if (!res.ok) {
      // Transport error — don't cache; let the next call retry.
      inflight.delete(g);
      throw new Error(res.error);
    }
    const ref = res.data ? toServicePrincipalRef(res.data) : null;
    cache.set(g, ref);
    inflight.delete(g);
    return ref;
  })();

  inflight.set(g, promise);
  return promise;
}

// ─── Resolution: bulk ─────────────────────────────────────────────────────

/**
 * Bulk resolve via Graph `/directoryObjects/getByIds`. Up to
 * {@link BATCH_LIMIT} ids per call; we chunk larger inputs into
 * parallel calls. Filters `types: ["servicePrincipal"]` so users /
 * groups / devices don't come back.
 *
 * **Returns a Map keyed by the original ids the caller passed in**
 * (preserves case + brace formatting), so callers can match
 * input-to-output without re-normalizing. Ids present in the input
 * but missing from Graph's response are mapped to `null` and
 * negative-cached so subsequent lookups don't re-fetch.
 *
 * The internal cache is updated alongside the returned map, so a
 * subsequent `resolveServicePrincipal(id)` for any id in this batch
 * is an instant cache hit.
 */
export async function resolveServicePrincipals(
  ids: ReadonlyArray<string | undefined | null>,
): Promise<Map<string, ServicePrincipalRef | null>> {
  const result = new Map<string, ServicePrincipalRef | null>();

  // Bucket inputs: cached, in-flight, or to-fetch.
  const toFetch: string[] = [];
  const toFetchSet = new Set<string>();
  const pendingPromises: Array<Promise<unknown>> = [];

  for (const raw of ids) {
    if (!raw) continue;
    if (!isGuidish(raw)) {
      result.set(raw, null);
      continue;
    }
    const g = normalize(raw);
    if (cache.has(g)) {
      result.set(raw, cache.get(g) ?? null);
      continue;
    }
    const inFlight = inflight.get(g);
    if (inFlight) {
      pendingPromises.push(
        inFlight.then((ref) => {
          result.set(raw, ref);
        }),
      );
      continue;
    }
    if (!toFetchSet.has(g)) {
      toFetchSet.add(g);
      toFetch.push(g);
    }
  }

  // Chunk into batches of BATCH_LIMIT and fire in parallel.
  const batches: string[][] = [];
  for (let i = 0; i < toFetch.length; i += BATCH_LIMIT) {
    batches.push(toFetch.slice(i, i + BATCH_LIMIT));
  }

  await Promise.all([
    ...pendingPromises,
    ...batches.map((batch) => fetchBatch(batch, ids, result)),
  ]);

  // Anything still missing from `result` (because its normalized id
  // wasn't in any batch response) → null. Walk inputs again to catch
  // ones we may have overlooked due to duplicates / case variants.
  for (const raw of ids) {
    if (!raw) continue;
    if (!result.has(raw)) {
      if (!isGuidish(raw)) {
        result.set(raw, null);
        continue;
      }
      const g = normalize(raw);
      result.set(raw, cache.get(g) ?? null);
    }
  }
  return result;
}

async function fetchBatch(
  batch: string[],
  originalIds: ReadonlyArray<string | undefined | null>,
  result: Map<string, ServicePrincipalRef | null>,
): Promise<void> {
  // Mark every id in this batch as "in flight" so concurrent callers
  // don't duplicate the work. Resolve them all from the same batch
  // promise.
  const select = `$select=${SP_SELECT_FIELDS.join(",")}`;
  const batchPromise = callGraph<{ value?: RawServicePrincipal[] }>(
    "POST",
    `/directoryObjects/getByIds?${select}`,
    { ids: batch, types: ["servicePrincipal"] },
  );

  // Per-id inflight pointer that resolves when this batch lands.
  const sharedPromise: Promise<ServicePrincipalRef | null> = batchPromise.then(
    () => null /* placeholder; we set per-id values below */,
  );
  for (const g of batch) {
    if (!inflight.has(g)) inflight.set(g, sharedPromise);
  }

  try {
    const res = await batchPromise;
    if (!res.ok) {
      // On batch failure, clear in-flight markers so callers can retry,
      // and bubble up as an error on this batch (other batches still
      // succeed independently).
      for (const g of batch) inflight.delete(g);
      throw new Error(res.error);
    }
    const returned: RawServicePrincipal[] = res.data?.value ?? [];
    const seen = new Set<string>();
    for (const raw of returned) {
      const ref = toServicePrincipalRef(raw);
      cache.set(ref.id, ref);
      seen.add(ref.id);
    }
    // Negative-cache any id we asked for but didn't get back.
    for (const g of batch) {
      if (!seen.has(g)) cache.set(g, null);
      inflight.delete(g);
    }

    // Populate `result` for every originalId whose normalized form is
    // in this batch (preserves input identity).
    for (const raw of originalIds) {
      if (!raw || !isGuidish(raw)) continue;
      const g = normalize(raw);
      if (batch.includes(g)) {
        result.set(raw, cache.get(g) ?? null);
      }
    }
  } catch (err) {
    for (const g of batch) inflight.delete(g);
    throw err;
  }
}

// ─── Per-SP owners drill-in ───────────────────────────────────────────────

/**
 * Fetch the Entra-assigned owners for a single service principal.
 * Used by the page's drill-in for an SP row — "who in our org can
 * manage this SP?" Returns an empty array when the SP has no
 * assigned owners (the common case for first-party Microsoft SPs).
 *
 * Per-call; **not** cached at this level. The page caches the result
 * inside the expanded row's state — owners change rarely and a fresh
 * read on each expand is fine for a feature surfaced behind a click.
 *
 * Slim projection on owners (id + the basics) — full owner detail
 * (UPN, jobTitle, etc.) is rendered via the existing `<UserChip>`
 * which pulls from the `aaduser` resolver cache and lights up
 * everywhere across the app for free.
 */
export async function fetchServicePrincipalOwners(
  id: string,
): Promise<DataResult<ServicePrincipalOwner[]>> {
  if (!isGuidish(id)) {
    return { ok: false, error: "Not a valid GUID." };
  }
  const g = normalize(id);
  // Use the SP fetch with $expand=owners(...) so we get the owners in
  // the same round-trip as the SP details (which were cached but the
  // owners weren't — those are deliberately deferred to drill-in).
  const select = `$select=${SP_SELECT_FIELDS.join(",")}`;
  const expand = `$expand=owners($select=${OWNER_SELECT_FIELDS.join(",")})`;
  const res = await callGraph<RawServicePrincipalWithOwners>(
    "GET",
    `/servicePrincipals/${encodeURIComponent(g)}?${select}&${expand}`,
  );
  if (!res.ok) return res;
  if (!res.data) return { ok: true, data: [] };
  const owners = (res.data.owners ?? []).map(toServicePrincipalOwner);
  return { ok: true, data: owners };
}

// ─── Wire-format adapters ─────────────────────────────────────────────────

interface RawServicePrincipal {
  id?: string;
  displayName?: string;
  appId?: string;
  servicePrincipalType?: string;
  appOwnerOrganizationId?: string | null;
  accountEnabled?: boolean;
}

interface RawServicePrincipalWithOwners extends RawServicePrincipal {
  owners?: RawOwner[];
}

interface RawOwner {
  "@odata.type"?: string;
  id?: string;
  displayName?: string;
  mail?: string;
  accountEnabled?: boolean;
  deletedDateTime?: string | null;
}

function toServicePrincipalRef(raw: RawServicePrincipal): ServicePrincipalRef {
  const id = raw.id ? normalize(raw.id) : "";
  return {
    id,
    displayName: raw.displayName ?? "",
    appId: raw.appId ?? "",
    servicePrincipalType: raw.servicePrincipalType ?? "",
    appOwnerOrganizationId: raw.appOwnerOrganizationId ?? null,
    accountEnabled: raw.accountEnabled ?? false,
    kind: classifyServicePrincipal({
      appOwnerOrganizationId: raw.appOwnerOrganizationId ?? null,
      servicePrincipalType: raw.servicePrincipalType ?? "",
    }),
  };
}

function toServicePrincipalOwner(raw: RawOwner): ServicePrincipalOwner {
  // `@odata.type` looks like `#microsoft.graph.user` —
  // strip the prefix and discriminate.
  const odataType = raw["@odata.type"] ?? "";
  const isSp = /servicePrincipal/i.test(odataType);
  return {
    type: isSp ? "servicePrincipal" : "user",
    id: raw.id ? normalize(raw.id) : "",
    displayName: raw.displayName,
    mail: raw.mail,
    accountEnabled: raw.accountEnabled,
    deletedDateTime: raw.deletedDateTime ?? null,
  };
}
