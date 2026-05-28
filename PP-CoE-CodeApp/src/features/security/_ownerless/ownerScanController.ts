/**
 * Owner-scan controller — module-level singleton that walks tenant
 * inventory, resolves distinct owner GUIDs against the Dataverse
 * `aaduser` virtual table, and buckets the results by owner health.
 *
 * Why a singleton (vs. React state)? The scan can take a couple of
 * minutes on large tenants, and the user explicitly asked for it to
 * survive route changes ("don't cancel if I go away"). Components
 * subscribe via `useSyncExternalStore` (see `useOwnerScan.ts`); the
 * scan loop runs to completion regardless of who's listening. Same
 * pattern as `src/data/userEnrichment.ts` uses for the resolver cache.
 *
 * Persistence:
 *   - In-memory `ScanResult` lives for the session.
 *   - On `completed`, a *summary* snapshot is written to localStorage
 *     (counts + ownerId list per bucket, NO affected-resource lists —
 *     a large tenant would blow the 5 MB quota). On module init, the
 *     snapshot is rehydrated as a `fromSnapshot: true` result so a
 *     fresh tab shows "Last scan 12 min ago".
 *
 * Cancellation:
 *   - `cancelScan()` flips an `AbortSignal`. The page-walk loops check
 *     it between pages. In-flight `resolveUsers` calls can't be
 *     aborted (the resolver doesn't expose abort), but they're fast
 *     (seconds) so we let them complete and discard the result by
 *     setting phase to `cancelled` without bucketing.
 */

import {
  listAgentsPage,
  listAppsPage,
  listFlowsPage,
  type ResourceTypeValue,
  type DataResult,
} from "../../../data/inventory";
import {
  resolveServicePrincipals,
  type ServicePrincipalRef,
} from "../../../data/spnEnrichment";
import { resolveUsers, type UserRef } from "../../../data/userEnrichment";
import type {
  AffectedResource,
  OwnerBucket,
  OwnerEntry,
  ScanProgress,
  ScanResult,
  ScanSnapshot,
} from "./types";

const SNAPSHOT_KEY = "ppcoe.ownerScan.lastSnapshot.v2";
const PAGE_SIZE = 500;

// A well-known sentinel pattern: GUIDs whose first four blocks are all
// zeros (e.g. `00000000-0000-0000-0000-5157eaa02fcd`). These appear in
// real inventory payloads (see `docs/inventory-schema-samples.md`) and
// represent system/placeholder identities rather than real users.
const SENTINEL_PATTERN = /^0{8}-0{4}-0{4}-0{4}-[0-9a-f]{12}$/i;

// Permissive GUID shape check, matching the one used by `userEnrichment`.
// Anything that doesn't look like a GUID is treated as "no owner".
const GUID_PATTERN =
  /^[{(]?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[)}]?$/i;

function normalize(id: string): string {
  return id.trim().toLowerCase().replace(/[{}()]/g, "");
}

function isSentinel(normalizedId: string): boolean {
  return SENTINEL_PATTERN.test(normalizedId);
}

/** The single, authoritative bucketing rule. Pure function so the
 *  controller test can hammer it without spinning up the full scan.
 *
 *  Order matters: sentinels short-circuit before SP lookup (their
 *  pattern can't be a real SP id), then user-resolved wins, then
 *  SP-resolved, then truly-unresolved.
 */
export function bucketFor(
  normalizedOwnerId: string,
  user: UserRef | null,
  servicePrincipal: ServicePrincipalRef | null,
): OwnerBucket {
  if (user === null && servicePrincipal === null) {
    if (isSentinel(normalizedOwnerId)) return "sentinel";
    return "unresolved";
  }
  if (user !== null) {
    // `disabled` wins over `guest` because a disabled account is a more
    // urgent action item than a present-but-external guest.
    if (user.enabled === false) return "disabled";
    if (user.userType === "Guest") return "guest";
    return "active";
  }
  // user === null && servicePrincipal !== null
  return "service-principal";
}

function emptyBuckets(): Record<OwnerBucket, string[]> {
  return {
    unresolved: [],
    "service-principal": [],
    disabled: [],
    guest: [],
    active: [],
    sentinel: [],
  };
}

function makeIdleProgress(): ScanProgress {
  return {
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    inventoryWalked: 0,
    inventoryTotal: null,
    distinctOwners: 0,
    ownersResolved: 0,
    spnsResolved: 0,
    noOwnerCount: 0,
    error: null,
  };
}

// ─── Module-level singleton state ─────────────────────────────────────────

let progress: ScanProgress = makeIdleProgress();
let result: ScanResult | null = null;
let aborter: AbortController | null = null;
const subscribers = new Set<() => void>();

// Rehydrate snapshot on module load. Guarded for environments without
// `localStorage` (SSR, some test contexts). jsdom (our test env) does
// expose it, but the guard keeps the module portable.
try {
  result = loadSnapshot();
} catch {
  // Corrupted snapshot — drop it silently. The user can re-scan.
  result = null;
}

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // A subscriber throwing must not poison the rest of the fan-out.
    }
  }
}

function updateProgress(patch: Partial<ScanProgress>): void {
  progress = { ...progress, ...patch };
  notify();
}

// ─── Public API ───────────────────────────────────────────────────────────

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getProgress(): ScanProgress {
  return progress;
}

export function getResult(): ScanResult | null {
  return result;
}

export function isRunning(): boolean {
  return (
    progress.phase === "loading-inventory" ||
    progress.phase === "resolving-owners"
  );
}

/** Cancel an in-flight scan. No-op when nothing is running. The phase
 *  flips to `cancelled` once the next abort check trips. */
export function cancelScan(): void {
  aborter?.abort();
}

/** Drop both the in-memory result and the persisted snapshot. Wired
 *  to a "Clear last scan" UI affordance. */
export function clearLastSnapshot(): void {
  result = null;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignore quota / privacy errors
  }
  notify();
}

/**
 * Test-only seam: reset the singleton to a clean state. Each test
 * imports the same module instance, so without this any state set by
 * one test leaks into the next. Exposed as `__resetForTests` with a
 * leading double-underscore so it stays out of the public API but is
 * still importable from tests.
 */
export function __resetForTests(): void {
  progress = makeIdleProgress();
  result = null;
  aborter = null;
  subscribers.clear();
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Kick off a scan. No-op when one is already running. Returns a
 * promise that resolves when the scan reaches a terminal phase
 * (`completed`, `cancelled`, or `error`). Callers don't need to await
 * it — the page subscribes to progress updates instead — but tests
 * use the promise to wait for the full lifecycle.
 */
export async function startScan(): Promise<void> {
  if (isRunning()) return;

  aborter = new AbortController();
  const signal = aborter.signal;

  // Reset progress to a fresh starting point. Keep the previous
  // `result` until we successfully finish — that way the page keeps
  // showing the last completed scan while a re-scan is in flight.
  // (Cleared on a successful new run via the assignment below.)
  updateProgress({
    phase: "loading-inventory",
    startedAt: Date.now(),
    finishedAt: null,
    inventoryWalked: 0,
    inventoryTotal: null,
    distinctOwners: 0,
    ownersResolved: 0,
    spnsResolved: 0,
    noOwnerCount: 0,
    error: null,
  });

  // Accumulators for the walk. `ownersInProgress` is the per-GUID
  // affected-resource list that becomes `result.ownerIndex`.
  const ownersInProgress = new Map<string, AffectedResource[]>();
  let noOwnerCount = 0;
  let inventoryWalked = 0;
  let inventoryTotalSum = 0;
  let anyPageReported = false;

  const collect = (row: {
    id: string;
    displayName: string;
    environmentId: string;
    type: string;
    ownerId: string;
  }): void => {
    if (!row.ownerId || !GUID_PATTERN.test(row.ownerId)) {
      noOwnerCount++;
      return;
    }
    const key = normalize(row.ownerId);
    let list = ownersInProgress.get(key);
    if (!list) {
      list = [];
      ownersInProgress.set(key, list);
    }
    list.push({
      id: row.id,
      displayName: row.displayName,
      environmentId: row.environmentId,
      type: row.type as ResourceTypeValue,
    });
  };

  const reportPage = (rowsThisPage: number, totalIfFirst?: number): void => {
    inventoryWalked += rowsThisPage;
    if (totalIfFirst !== undefined) {
      inventoryTotalSum += totalIfFirst;
      anyPageReported = true;
    }
    updateProgress({
      inventoryWalked,
      inventoryTotal: anyPageReported ? inventoryTotalSum : null,
      distinctOwners: ownersInProgress.size,
      noOwnerCount,
    });
  };

  try {
    // Three streams run in parallel. The shared `runQuery` throttle
    // (MAX_CONCURRENT_QUERIES = 4 in inventory.ts) keeps this from
    // overwhelming the connector — we'd burst to 3 concurrent calls,
    // well under the cap.
    await Promise.all([
      walkStream(
        (token, skip) => listAppsPage({}, token, PAGE_SIZE, skip),
        collect,
        reportPage,
        signal,
      ),
      walkStream(
        (token, skip) => listFlowsPage({}, token, PAGE_SIZE, skip),
        collect,
        reportPage,
        signal,
      ),
      walkStream(
        (token, skip) => listAgentsPage({}, token, PAGE_SIZE, skip),
        collect,
        reportPage,
        signal,
      ),
    ]);

    if (signal.aborted) {
      updateProgress({ phase: "cancelled", finishedAt: Date.now() });
      return;
    }

    // Phase: resolving-owners. resolveUsers handles its own batching
    // (microtask coalescing, dedupe, concurrency cap of 8), so we
    // just hand it the full list.
    updateProgress({
      phase: "resolving-owners",
      distinctOwners: ownersInProgress.size,
      ownersResolved: 0,
      spnsResolved: 0,
    });

    const ownerIds = Array.from(ownersInProgress.keys());
    const resolvedUsers = await resolveUsers(ownerIds);

    if (signal.aborted) {
      updateProgress({ phase: "cancelled", finishedAt: Date.now() });
      return;
    }

    // Phase: resolving-spns. Take every GUID that came back null from
    // the user resolver, exclude sentinels (their pattern can't be a
    // real SP Object ID), and run them through Graph as a single batch
    // via `directoryObjects/getByIds`. One round-trip per ≤1000 GUIDs.
    const spCandidates: string[] = [];
    for (const ownerId of ownerIds) {
      const user = resolvedUsers.get(ownerId) ?? null;
      if (user === null && !isSentinel(ownerId)) spCandidates.push(ownerId);
    }
    updateProgress({
      phase: "resolving-spns",
      ownersResolved: ownerIds.length,
      spnsResolved: 0,
    });

    const resolvedSps =
      spCandidates.length > 0
        ? await resolveServicePrincipals(spCandidates)
        : new Map<string, ServicePrincipalRef | null>();

    if (signal.aborted) {
      updateProgress({ phase: "cancelled", finishedAt: Date.now() });
      return;
    }

    // Bucketing.
    const ownerIndex = new Map<string, OwnerEntry>();
    const buckets = emptyBuckets();
    for (const [ownerId, affectedResources] of ownersInProgress) {
      const user = resolvedUsers.get(ownerId) ?? null;
      const servicePrincipal = resolvedSps.get(ownerId) ?? null;
      const bucket = bucketFor(ownerId, user, servicePrincipal);
      ownerIndex.set(ownerId, {
        ownerId,
        user,
        servicePrincipal,
        bucket,
        affectedResources,
      });
      buckets[bucket].push(ownerId);
    }

    const totalResources =
      Array.from(ownersInProgress.values()).reduce(
        (sum, list) => sum + list.length,
        0,
      ) + noOwnerCount;

    const newResult: ScanResult = {
      scannedAt: Date.now(),
      totalResources,
      noOwnerCount,
      ownerIndex,
      buckets,
      fromSnapshot: false,
    };
    result = newResult;
    persistSnapshot(newResult);

    updateProgress({
      phase: "completed",
      finishedAt: Date.now(),
      ownersResolved: ownerIds.length,
      spnsResolved: spCandidates.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateProgress({
      phase: "error",
      error: message,
      finishedAt: Date.now(),
    });
  } finally {
    aborter = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Walk one paged stream end-to-end, feeding rows into `collect` and
 * page metadata into `reportPage`. Aborts cleanly on `signal.aborted`.
 *
 * Per `docs/inventory-schema-samples.md` and the inventory rules in
 * the repo guidance, `totalRecords` is approximate and `skipToken` is
 * authoritative — we always pass both `Skip` AND `SkipToken` so the
 * connector can't silently re-return page 1. The inventory data layer
 * already does that; this loop just terminates when the stream stops
 * advancing (empty skipToken OR zero new rows).
 */
async function walkStream<R extends {
  id: string;
  displayName: string;
  environmentId: string;
  type: string;
  ownerId: string;
}>(
  pager: (
    skipToken: string,
    skip: number,
  ) => Promise<
    DataResult<{ rows: R[]; skipToken?: string; totalRecords: number }>
  >,
  collect: (row: R) => void,
  reportPage: (rowsThisPage: number, totalIfFirst?: number) => void,
  signal: AbortSignal,
): Promise<void> {
  let skipToken = "";
  let skip = 0;
  let firstPage = true;

  while (true) {
    if (signal.aborted) return;
    const res = await pager(skipToken, skip);
    if (signal.aborted) return;
    if (!res.ok) {
      throw new Error(res.error);
    }
    const rows = res.data.rows;
    for (const row of rows) {
      collect(row);
    }
    reportPage(rows.length, firstPage ? res.data.totalRecords : undefined);
    firstPage = false;

    // Termination: no skipToken OR a page returned zero rows. The
    // zero-rows guard protects against the documented "connector
    // returns a stale skipToken indefinitely" failure mode.
    if (!res.data.skipToken || rows.length === 0) return;
    skipToken = res.data.skipToken;
    skip += rows.length;
  }
}

function persistSnapshot(result: ScanResult): void {
  const snapshot: ScanSnapshot = {
    version: 2,
    scannedAt: result.scannedAt,
    totalResources: result.totalResources,
    noOwnerCount: result.noOwnerCount,
    bucketCounts: {
      unresolved: result.buckets.unresolved.length,
      "service-principal": result.buckets["service-principal"].length,
      disabled: result.buckets.disabled.length,
      guest: result.buckets.guest.length,
      active: result.buckets.active.length,
      sentinel: result.buckets.sentinel.length,
    },
    ownerIdsByBucket: { ...result.buckets },
  };
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota / privacy errors are non-fatal — the in-memory result is
    // unaffected. We just won't have a "Last scan" surface on the next
    // page load.
  }
}

function loadSnapshot(): ScanResult | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return null;
  const snapshot = JSON.parse(raw) as ScanSnapshot;
  if (snapshot.version !== 2) return null;

  const buckets = emptyBuckets();
  const ownerIndex = new Map<string, OwnerEntry>();
  for (const bucket of Object.keys(buckets) as OwnerBucket[]) {
    const ids = snapshot.ownerIdsByBucket?.[bucket] ?? [];
    for (const ownerId of ids) {
      ownerIndex.set(ownerId, {
        ownerId,
        user: null,
        servicePrincipal: null,
        bucket,
        // affectedResources is NOT persisted (see ScanSnapshot doc).
        // The UI must render a "Re-scan to view affected resources"
        // hint when `result.fromSnapshot === true`.
        affectedResources: [],
      });
      buckets[bucket].push(ownerId);
    }
  }
  return {
    scannedAt: snapshot.scannedAt,
    totalResources: snapshot.totalResources,
    noOwnerCount: snapshot.noOwnerCount ?? 0,
    ownerIndex,
    buckets,
    fromSnapshot: true,
  };
}
