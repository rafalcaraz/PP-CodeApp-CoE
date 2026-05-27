/**
 * Per-source LRU cache for deep-inventory scope-unit fetches.
 *
 * Why: re-running the same scan a minute later (after tweaking a
 * filter / column) shouldn't refetch every env. Why per-source:
 * `admin-apps` and `admin-flows` have independent freshness needs;
 * sharing one cache would conflate them.
 *
 * Scope:
 *  - In-memory only. Session-lifetime. Surviving a hard refresh
 *    would surprise admins more than it'd help (after a publish
 *    they expect a clean view).
 *  - Keyed by `(sourceId, scopeKind, scopeId)` — scopeId is `'tenant'`
 *    for the tenant-wide variant. NOT keyed by filters / columns
 *    (those are applied client-side post-cache).
 *  - Default TTL: 10 minutes. Tune by source if needed; pass
 *    `cacheTtlMs` when calling `cacheGet` / `cacheSet`.
 *
 * Concurrency:
 *  - No request coalescing today. If the user kicks off two scans
 *    in parallel against the same scope, both will fetch. That's
 *    a rare and minor inefficiency; adding coalescing is a small
 *    follow-up.
 */

import type { DeepSourceId } from "./catalog/types";
import type { DeepRecord } from "./catalog/types";

/** Default cache TTL — 10 minutes is a good balance between
 *  freshness for governance-style use ("did the new app I just made
 *  show up?") and avoiding redundant per-env fetches during a
 *  filter/column iteration session. */
export const DEFAULT_CACHE_TTL_MS = 10 * 60_000;

/** Max distinct keys retained in the cache. Per-tenant scans use
 *  a handful; per-env scans use one per env. 200 is comfortable for
 *  a long working session. */
const MAX_ENTRIES = 200;

/** What we cache: the full record list for one scope unit, plus the
 *  errors yielded during the original fetch so a cached scan
 *  surfaces the same per-env errors as a fresh one. */
export interface CachedScopeUnit {
  records: DeepRecord[];
  errors: { message: string }[];
  fetchedAt: number;
  expiresAt: number;
}

interface CacheStore {
  map: Map<string, CachedScopeUnit>;
}

function makeKey(
  source: DeepSourceId,
  scopeKind: string,
  scopeId: string,
  scopeUnitId: string
): string {
  return `${source}|${scopeKind}|${scopeId}|${scopeUnitId}`;
}

const store: CacheStore = { map: new Map() };

export interface CacheGetParams {
  source: DeepSourceId;
  scopeKind: string;
  scopeId: string;
  scopeUnitId: string;
}

export function cacheGet(params: CacheGetParams): CachedScopeUnit | undefined {
  const key = makeKey(
    params.source,
    params.scopeKind,
    params.scopeId,
    params.scopeUnitId
  );
  const entry = store.map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.map.delete(key);
    return undefined;
  }
  return entry;
}

export interface CacheSetParams extends CacheGetParams {
  records: DeepRecord[];
  errors: { message: string }[];
  ttlMs?: number;
}

export function cacheSet(params: CacheSetParams): void {
  const ttlMs = params.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const key = makeKey(
    params.source,
    params.scopeKind,
    params.scopeId,
    params.scopeUnitId
  );
  // Insertion-order LRU: when adding a brand-new key past the cap,
  // evict the oldest first. Updates to an existing key implicitly
  // refresh its insertion order (Map semantics).
  if (!store.map.has(key) && store.map.size >= MAX_ENTRIES) {
    const oldest = store.map.keys().next().value;
    if (oldest !== undefined) store.map.delete(oldest);
  }
  store.map.set(key, {
    records: params.records,
    errors: params.errors,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
}

/** Clear the whole cache. Wire to a UI "Refresh" affordance when the
 *  user wants to bust cached scope units in one shot. */
export function cacheClear(): void {
  store.map.clear();
}

/** Clear all entries for one source. Wire when the user has reason
 *  to believe a source is stale (e.g. after a publish in another
 *  tab). */
export function cacheClearSource(source: DeepSourceId): void {
  for (const key of Array.from(store.map.keys())) {
    if (key.startsWith(`${source}|`)) store.map.delete(key);
  }
}

/** Test-only: snapshot of the cache size. Lets unit tests assert
 *  eviction behavior without poking at module-private state. */
export function __cacheSize(): number {
  return store.map.size;
}
