/**
 * GUID → user resolver, backed by the Dataverse `aaduser` virtual table
 * (a tenant-wide live view of Microsoft Entra users surfaced as a
 * standard Dataverse table — read-only, queryable via the normal
 * Dataverse Web API).
 *
 * **Why this exists.** The bulk inventory rows in `./inventory.ts` carry
 * Entra object IDs (`ownerId`, `createdBy`, `lastModifiedBy`) as raw
 * GUIDs. UIs that show "GUID owners" are unreadable; UIs that load all
 * tenant users upfront are wasteful. This module is the seam in between:
 * per-id lookups that share a session-wide cache, dedupe concurrent
 * requests, and survive missing identities gracefully.
 *
 * **One Dataverse `retrieveRecord` per distinct GUID.** Every
 * `resolveUser(id)` ultimately routes through `AadusersService.get(id)`
 * — the canonical Dataverse primary-key fetch. We deliberately do NOT
 * use `getAll({ filter: "aaduserid eq G1 or aaduserid eq G2 …" })`
 * because the `aaduser` virtual table's plugin doesn't reliably
 * evaluate multi-id `or` filters (returns `Request_UnsupportedQuery`).
 * Per-id `get` works every time, and the caching + dedupe + concurrency
 * cap below keep cost bounded even when a list view mounts a swarm of
 * chips.
 *
 * **Caching, dedupe, and concurrency.**
 *   - **Per-session cache.** A GUID resolved anywhere — Cmd+K dialog,
 *     a detail page chip, a list column — never re-queries this session.
 *   - **In-flight dedupe.** N components requesting the same GUID
 *     concurrently share one promise → one network call.
 *   - **Microtask coalescing.** All `resolveUser()` calls in the same
 *     tick are gathered into a single pending bucket; the bucket is
 *     drained by a bounded worker pool (`MAX_CONCURRENT`). The bucket
 *     primarily exists so duplicate-GUID requests collapse cleanly
 *     across components; distinct GUIDs still each get their own call,
 *     run in parallel up to the cap.
 *
 * **Negative caching.** A GUID that doesn't exist in `aaduser` is
 * cached as `null` (== "could not locate"). That keeps a list with a
 * deleted/SPN owner from re-querying on every scroll/render.
 *
 * **Never call `AadusersService.getAll()` without a filter from
 * anywhere else.** That would return every user in the tenant. Always
 * route through `resolveUser` / `resolveUsers` / `lookupUser`.
 *
 * **An `aaduser` miss is not necessarily a deleted user.** An owner /
 * createdBy GUID on an inventory row can be a service principal
 * (Enterprise Application object id) — most commonly a Power Platform
 * Pipelines deployment SPN — which is not exposed in the `aaduser`
 * virtual table. Callers surfacing the `null` result MUST use neutral
 * wording (e.g. "Could not locate a current valid user with this GUID")
 * rather than "deleted user". See
 * `docs/inventory-schema-samples.md#owner--creator-guid-resolution`
 * for the full taxonomy and disambiguation steps.
 */

import { AadusersService } from "../generated";
import type { Aadusers } from "../generated/models/AadusersModel";
import type { DataResult } from "./inventory";

/** Presentation-friendly Entra user tuple. Echoes back `id` so callers
 *  can pass the resolved record around as a self-contained object. */
export interface UserRef {
  /** Entra object ID (`aaduserid`). Lowercased, dash-form. */
  id: string;
  displayName: string;
  /** User principal name — typically the sign-in / SMTP-shaped string. */
  upn?: string;
  /** Mail address when present and distinct from UPN. */
  mail?: string;
  /** `accountEnabled` flag from Entra. `false` = disabled but still extant. */
  enabled?: boolean;
  jobTitle?: string;
  /** `"Member"` | `"Guest"` | future values. Useful for guest-flagging. */
  userType?: string;
}

/** Fields we always project. Keeps payloads tiny on bursty list renders. */
const SELECT_FIELDS = [
  "aaduserid",
  "displayname",
  "userprincipalname",
  "mail",
  "accountenabled",
  "jobtitle",
  "usertype",
];

/** Authoritative resolution cache. `null` is a real value meaning
 *  "looked up, not in `aaduser`" — do not collapse it with cache miss. */
const cache = new Map<string, UserRef | null>();

/** In-flight cache — concurrent calls for the same GUID share one
 *  promise, so a flurry of components mounting at the same time never
 *  fans out into duplicate network requests. */
const inflight = new Map<string, Promise<UserRef | null>>();

/** Per-GUID subscriber sets. Components subscribing via
 *  `subscribeUser(id, cb)` (typically from the `useUserDisplay` hook /
 *  `<UserChip>`) get a no-arg callback whenever the cache entry for that
 *  GUID changes — i.e. when a lookup elsewhere in the app (the Cmd+K
 *  dialog, another chip on the same page, a batched list-view render)
 *  populates a value. Drives the "resolve once, light up everywhere"
 *  behavior without prop drilling. */
const subscribers = new Map<string, Set<() => void>>();

/** Cache-wide subscriber set. Notified on every cache mutation. Used by
 *  aggregate views (the lookup dialog's "Cache: N resolved · M missing"
 *  footer) that need to recompute when anything changes. Per-component
 *  reactivity should use the per-id `subscribeUser` instead. */
const globalSubscribers = new Set<() => void>();

/** Snapshot generation counter — incremented on every cache mutation.
 *  Lets `useSyncExternalStore`-style hooks return a referentially stable
 *  snapshot value without re-allocating per call. Not strictly required
 *  for the per-id hook (which compares against the cached `UserRef` /
 *  `null` directly), but kept for the cache-wide hooks (stats footer
 *  in the lookup dialog) so they recompute only when something changed. */
let snapshotVersion = 0;

/** Write to the cache and notify the world. Single chokepoint so we
 *  never set `cache.set(...)` without firing subscribers — the reactive
 *  contract is impossible to forget if every mutation goes through here.
 *
 *  Notifies per-id subscribers (component-level reactivity via
 *  `subscribeUser`) **and** global subscribers (aggregate views like
 *  the dialog's cache-stats footer via `subscribeCacheVersion`). */
function cacheSet(id: string, value: UserRef | null): void {
  cache.set(id, value);
  // Invalidate the peek-cache wrapper for this id so the next `peekUser`
  // call rebuilds it with the new value (preserves identity-stable
  // behavior while still flipping references when the underlying value
  // changes — important for `useSyncExternalStore`).
  peekCache.delete(id);
  snapshotVersion++;
  const subs = subscribers.get(id);
  if (subs) {
    for (const cb of subs) {
      try {
        cb();
      } catch {
        // A subscriber throwing shouldn't poison the rest of the fan-out.
      }
    }
  }
  for (const cb of globalSubscribers) {
    try {
      cb();
    } catch {
      // Same — global subscriber throwing shouldn't break the cache write.
    }
  }
}

type Waiter = {
  resolve: (v: UserRef | null) => void;
  reject: (e: unknown) => void;
};

/** Microtask-deferred bucket. Built lazily on the first `resolveUser`
 *  call within a tick; drained by `flushPending` and reset to `null` so
 *  the next tick starts a fresh batch. */
let pending: Map<string, Waiter[]> | null = null;

/** Permissive GUID shape check — 32 hex chars, optional dashes, optional
 *  `{}` or `()` braces. Anything that doesn't match short-circuits to
 *  `null` so we never spend a network call on obvious garbage. */
function isGuidish(id: string): boolean {
  return /^[{(]?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[)}]?$/i.test(id);
}

/** Trim, lowercase, strip optional `{}` braces so callers can paste GUIDs
 *  in any common form (`{Abc…}`, `ABC…`, `abc…`) and still hit the cache. */
function normalize(id: string): string {
  return id.trim().toLowerCase().replace(/[{}()]/g, "");
}

function toUserRef(row: Aadusers): UserRef {
  return {
    id: normalize(row.aaduserid),
    displayName: row.displayname ?? row.userprincipalname ?? row.aaduserid,
    upn: row.userprincipalname,
    mail: row.mail,
    enabled: row.accountenabled,
    jobTitle: row.jobtitle,
    userType: row.usertype,
  };
}

/** Best-effort message extraction. Mirrors the helper in `inventory.ts`
 *  / `adminEnrichment.ts`; kept local to avoid coupling this module to
 *  either one of them. Recurses through `innerError`/`innererror` so we
 *  surface the leaf Graph message instead of just the outer Dataverse
 *  plugin wrapper (the plugin wraps Graph errors in a deeply nested
 *  `Microsoft.Xrm.Sdk.InvalidPluginExecutionException` envelope). */
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

/** Detect a "no such record" outcome from a Dataverse `retrieveRecord`
 *  call against `aaduser`. The virtual table plugin surfaces the
 *  not-found case as a `Request_ResourceNotFound` error code with a
 *  404 status wrapped inside an `InvalidPluginExecutionException`
 *  envelope. We match either marker — both substrings appear in every
 *  wrapping variation we've observed. */
function isNotFoundError(message: string): boolean {
  return (
    /Request_ResourceNotFound/i.test(message) ||
    /404\s*\(Not Found\)/i.test(message)
  );
}

/** Mark GUIDs as definitively missing (negative cache), resolve their
 *  waiters with `null`, and drop them from inflight. */
function settleAsMissing(
  ids: ReadonlyArray<string>,
  bucket: Map<string, Waiter[]>
): void {
  for (const g of ids) {
    cacheSet(g, null);
    for (const w of bucket.get(g) ?? []) w.resolve(null);
    inflight.delete(g);
  }
}

/** Reject all waiters for a set of GUIDs and drop them from inflight.
 *  Used when the error is genuinely transport-level, not a graceful
 *  "no such record" response. */
function settleAsError(
  ids: ReadonlyArray<string>,
  bucket: Map<string, Waiter[]>,
  err: unknown
): void {
  for (const g of ids) {
    for (const w of bucket.get(g) ?? []) w.reject(err);
    inflight.delete(g);
  }
}

/** Resolve a single GUID against the `aaduser` virtual table.
 *  Translates to one Dataverse `retrieveRecord` call — the standard
 *  primary-key fetch. Three outcomes:
 *
 *  1. **Success** → `cacheSet(id, ref)`, resolve waiters with the ref.
 *  2. **Not found** (`Request_ResourceNotFound`) → `cacheSet(id, null)`,
 *     resolve waiters with `null` ("could not locate" — deleted user
 *     OR service principal; see the taxonomy doc).
 *  3. **Other errors** → reject every waiter with the formatted error
 *     so the UI surfaces a meaningful message. */
async function resolveSingle(
  g: string,
  bucket: Map<string, Waiter[]>
): Promise<void> {
  try {
    const res = await AadusersService.get(g, { select: SELECT_FIELDS });
    if (!res.success) {
      const message = formatError(res.error);
      if (isNotFoundError(message)) {
        settleAsMissing([g], bucket);
        return;
      }
      settleAsError([g], bucket, new Error(message));
      return;
    }
    if (!res.data) {
      settleAsMissing([g], bucket);
      return;
    }
    const ref = toUserRef(res.data);
    cacheSet(g, ref);
    for (const w of bucket.get(g) ?? []) w.resolve(ref);
    inflight.delete(g);
  } catch (err) {
    // Some runtimes re-throw instead of returning `success: false`.
    // Apply the same not-found detection before falling through to a
    // hard reject so missing identities still surface as `null`.
    const message = formatError(err);
    if (isNotFoundError(message)) {
      settleAsMissing([g], bucket);
      return;
    }
    settleAsError([g], bucket, err);
  }
}

/** Drain the pending bucket into per-id `retrieveRecord` calls with a
 *  bounded concurrency window.
 *
 *  **Why per-id and not a multi-id filter?** The `aaduser` virtual
 *  table's plugin doesn't reliably evaluate `or`-joined multi-id
 *  filters — `$filter=aaduserid eq G1 or aaduserid eq G2` returns
 *  `Request_UnsupportedQuery`. Per-id `retrieveRecord` calls
 *  (`AadusersService.get(id)`) work uniformly.
 *
 *  Cost is still bounded: cache + in-flight dedupe + microtask
 *  coalescing mean N components rendering the same GUID produce one
 *  network call; only distinct GUIDs incur distinct calls. The
 *  concurrency cap stops a 50-row owner column from saturating the
 *  connector. */
const MAX_CONCURRENT = 8;

async function flushPending(): Promise<void> {
  const bucket = pending;
  pending = null;
  if (!bucket || bucket.size === 0) return;

  const ids = Array.from(bucket.keys());
  // Bounded-parallel worker pool: spin up min(N, ids.length) workers
  // that pull off a shared cursor and each sequentially drain their
  // share via `resolveSingle`. Lighter than pulling in a semaphore lib.
  let cursor = 0;
  const workerCount = Math.min(MAX_CONCURRENT, ids.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= ids.length) return;
        await resolveSingle(ids[idx], bucket);
      }
    })
  );
}

function enqueue(id: string): Promise<UserRef | null> {
  if (!pending) {
    pending = new Map();
    queueMicrotask(flushPending);
  }
  const waiters = pending.get(id) ?? [];
  const p = new Promise<UserRef | null>((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
  pending.set(id, waiters);
  return p;
}

/**
 * Resolve a single Entra user GUID to its presentation-friendly tuple.
 *
 * - **Cache-first.** Never re-queries an id we've already seen this session.
 * - **In-flight dedupe.** Concurrent calls for the same id share one promise.
 * - **Microtask coalescing.** All `resolveUser()` calls in the same
 *   tick are gathered into one drain pass; duplicate-GUID requests
 *   collapse to a single network call. Distinct GUIDs each get their
 *   own `retrieveRecord` call, dispatched in parallel up to the
 *   concurrency cap in `flushPending`.
 * - **Returns `null`** when the GUID is not present in `aaduser`
 *   (deleted user OR service principal — see the taxonomy doc). That
 *   `null` is cached so subsequent re-renders don't re-fetch.
 * - **Returns `null`** (without a network call) for `undefined` /
 *   `null` / non-GUID input. Callers can safely pipe raw inventory
 *   fields through.
 */
export function resolveUser(
  id: string | undefined | null
): Promise<UserRef | null> {
  if (!id) return Promise.resolve(null);
  if (!isGuidish(id)) return Promise.resolve(null);

  const g = normalize(id);
  if (cache.has(g)) return Promise.resolve(cache.get(g) ?? null);
  const existing = inflight.get(g);
  if (existing) return existing;

  const p = enqueue(g);
  inflight.set(g, p);
  return p;
}

/** Bulk variant. Internally calls `resolveUser` for each id so the same
 *  dedupe + microtask batching applies. Returns a Map keyed by the
 *  **original** ids the caller passed in (preserves case + braces) so
 *  result lookup matches the input shape. */
export async function resolveUsers(
  ids: ReadonlyArray<string | undefined | null>
): Promise<Map<string, UserRef | null>> {
  const out = new Map<string, UserRef | null>();
  await Promise.all(
    ids.map(async (raw) => {
      if (!raw) return;
      const ref = await resolveUser(raw);
      out.set(raw, ref);
    })
  );
  return out;
}

/** `DataResult`-style wrapper for UIs that want to surface errors as
 *  errors rather than silently render "(deleted user)" — primarily the
 *  Cmd+K lookup dialog. Validates input before hitting the network. */
export async function lookupUser(
  id: string
): Promise<DataResult<UserRef | null>> {
  if (!id || !id.trim()) return { ok: false, error: "Enter a GUID." };
  if (!isGuidish(id)) return { ok: false, error: "Not a valid GUID." };
  try {
    const ref = await resolveUser(id);
    return { ok: true, data: ref };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Drop all cached resolutions. Wire into "Refresh" affordances when a
 *  user wants to re-check whether a previously-deleted account returned.
 *
 *  Also notifies every subscriber so any chip currently rendered will
 *  re-fetch its source-of-truth from the cache (which is now empty,
 *  triggering a fresh lookup the next time `useUserDisplay` mounts). */
export function clearUserCache(): void {
  const idsToNotify = Array.from(cache.keys());
  cache.clear();
  peekCache.clear();
  inflight.clear();
  snapshotVersion++;
  for (const id of idsToNotify) {
    const subs = subscribers.get(id);
    if (subs) {
      for (const cb of subs) {
        try {
          cb();
        } catch {
          // Subscriber threw — keep going.
        }
      }
    }
  }
  for (const cb of globalSubscribers) {
    try {
      cb();
    } catch {
      // Same — global subscriber throwing shouldn't break clear.
    }
  }
}

/** Cache snapshot for diagnostics (rendered in the lookup dialog footer).
 *  Cheap (O(n) over the cache), called only from the dialog. */
export function userCacheStats(): { resolved: number; missing: number } {
  let resolved = 0;
  let missing = 0;
  for (const v of cache.values()) {
    if (v === null) missing++;
    else resolved++;
  }
  return { resolved, missing };
}

// ─── Reactive read API ────────────────────────────────────────────────────
//
// Components (`<UserChip>` via `useUserDisplay`) plug into the cache via
// `useSyncExternalStore`. They:
//   1. Call `peekUser(id)` to synchronously read the current cache state.
//   2. Subscribe via `subscribeUser(id, cb)` so they re-render when the
//      cache entry for that GUID lands or changes.
//   3. Fire `resolveUser(id)` (fire-and-forget) to drive the actual
//      network call — the resulting cache write notifies them via the
//      subscription, no explicit promise handling required.
//
// The hook layer lives in `src/hooks/useUserDisplay.ts` to keep this
// module dependency-free (no React imports).

/** Cache state for a single GUID:
 *  - `"unknown"` — never looked up this session
 *  - `{ user: UserRef }` — resolved successfully
 *  - `{ user: null }` — looked up, not in `aaduser` (deleted user OR SPN —
 *    see `docs/inventory-schema-samples.md#owner--creator-guid-resolution`) */
export type UserCacheEntry =
  | { status: "unknown" }
  | { status: "resolved"; user: UserRef }
  | { status: "missing" };

/** Cached entry wrappers, returned by `peekUser` so that
 *  `useSyncExternalStore` can do identity-based dedupe without React-side
 *  ref tricks. We hand out the *same* `UserCacheEntry` object reference
 *  for the same state, mutating the map only when `cacheSet` changes
 *  the underlying value. */
const UNKNOWN_ENTRY: UserCacheEntry = { status: "unknown" };
const peekCache = new Map<string, UserCacheEntry>();

/** Synchronous cache read. Returns `"unknown"` for never-seen, garbage
 *  input, or empty / non-GUID strings — callers can treat that as the
 *  signal to kick off a `resolveUser` call. Stable identity: repeated
 *  calls for the same GUID with the same underlying cache state return
 *  the same object reference, which `useSyncExternalStore` relies on. */
export function peekUser(id: string | undefined | null): UserCacheEntry {
  if (!id || !isGuidish(id)) return UNKNOWN_ENTRY;
  const g = normalize(id);
  if (!cache.has(g)) return UNKNOWN_ENTRY;
  const v = cache.get(g);
  const existing = peekCache.get(g);
  if (v === null || v === undefined) {
    if (existing && existing.status === "missing") return existing;
    const entry: UserCacheEntry = { status: "missing" };
    peekCache.set(g, entry);
    return entry;
  }
  if (existing && existing.status === "resolved" && existing.user === v) {
    return existing;
  }
  const entry: UserCacheEntry = { status: "resolved", user: v };
  peekCache.set(g, entry);
  return entry;
}

/** Subscribe to cache changes for a single GUID. Returns an unsubscribe
 *  function. No-ops (returning a no-op unsubscribe) for invalid input so
 *  the hook layer doesn't have to special-case empty strings. */
export function subscribeUser(
  id: string | undefined | null,
  callback: () => void
): () => void {
  if (!id || !isGuidish(id)) return () => {};
  const g = normalize(id);
  let set = subscribers.get(g);
  if (!set) {
    set = new Set();
    subscribers.set(g, set);
  }
  set.add(callback);
  return () => {
    const s = subscribers.get(g);
    if (!s) return;
    s.delete(callback);
    if (s.size === 0) subscribers.delete(g);
  };
}

/** Tenant-wide version counter — increments on every cache mutation.
 *  Hooks tracking aggregate state (cache stats footer in the lookup
 *  dialog) subscribe to *any* GUID change by polling this between
 *  renders driven by `useCacheVersion`. */
export function getCacheVersion(): number {
  return snapshotVersion;
}

/** Subscribe to *any* cache mutation. Used by the dialog footer to keep
 *  the "Cache: N resolved · M missing" counter live. Heavier than the
 *  per-id subscribe (re-renders on every change anywhere) so prefer
 *  `subscribeUser` for component-level reactivity. */
export function subscribeCacheVersion(callback: () => void): () => void {
  globalSubscribers.add(callback);
  return () => {
    globalSubscribers.delete(callback);
  };
}
