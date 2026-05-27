/**
 * Background scan registry — keeps an in-flight deep scan alive across
 * page navigations.
 *
 * **The problem.** `runDeepScan` is an async generator. The page that
 * `for await`s its events owns the rendered state — when the user
 * navigates away, the page unmounts and the consumer disappears. The
 * generator might keep ticking for a beat but its emitted events go
 * nowhere; partial results are lost. Per-env cache helps on the way
 * back (completed envs replay from cache) but in-progress envs lose
 * their work.
 *
 * **The fix.** This module owns the active scan as singleton state.
 * The view subscribes on mount, unsubscribes on unmount. The runner
 * keeps pushing events into the store regardless of whether anyone
 * is currently listening. When the user navigates back, the view
 * reads the latest snapshot from the store and re-attaches its
 * subscription.
 *
 * **Single active scan, by design.** We only keep one scan in
 * memory at a time. Starting a new scan supersedes whatever was
 * running (the previous controller is aborted). This keeps the
 * mental model simple, the memory footprint bounded, and the UI
 * indicator unambiguous ("a scan is running" vs "which one").
 *
 * **Session-lifetime only.** No persistence to localStorage / IDB.
 * A hard refresh starts clean — async generators don't survive page
 * reload, and the user expects refresh to be a hard reset. The
 * observed-schema and per-source cache that survive in localStorage
 * are independent of this store.
 */

import type {
  DeepQuerySpec,
  DeepScanRow,
  DeepScanScopeError,
  ScanEvent,
  ScanSummary,
} from "./catalog/types";
import type { ScopeResolver } from "./runner";
import { runDeepScan } from "./runner";

/** Snapshot of the active scan's state. Either nothing has ever run,
 *  a scan is in progress, or the most recent scan finished. */
export type ScanSnapshot =
  | { kind: "idle" }
  | {
      kind: "running";
      spec: DeepQuerySpec;
      startedAt: number;
      rows: DeepScanRow[];
      scopeErrors: DeepScanScopeError[];
      progress: {
        scopeUnitsTotal: number;
        scopeUnitsDone: number;
        recordsScanned: number;
        matches: number;
      };
    }
  | {
      kind: "ready";
      spec: DeepQuerySpec;
      startedAt: number;
      finishedAt: number;
      rows: DeepScanRow[];
      scopeErrors: DeepScanScopeError[];
      summary: ScanSummary;
    };

type Subscriber = (snapshot: ScanSnapshot) => void;

interface StoreState {
  snapshot: ScanSnapshot;
  controller: AbortController | null;
  subscribers: Set<Subscriber>;
}

const state: StoreState = {
  snapshot: { kind: "idle" },
  controller: null,
  subscribers: new Set(),
};

function emit(): void {
  for (const sub of state.subscribers) {
    try {
      sub(state.snapshot);
    } catch {
      /* never let one bad subscriber break the others */
    }
  }
}

/** Subscribe to scan state changes. Returns an unsubscribe function.
 *  The first call after subscription receives the current snapshot
 *  synchronously via the same callback, so consumers don't have to
 *  read the initial state separately. */
export function subscribeToScan(callback: Subscriber): () => void {
  state.subscribers.add(callback);
  // Fire once synchronously with the current snapshot.
  try {
    callback(state.snapshot);
  } catch {
    /* see emit() */
  }
  return () => {
    state.subscribers.delete(callback);
  };
}

/** Read the current snapshot without subscribing. Useful for views
 *  that initialize their local state from the store before wiring up
 *  a subscription. */
export function getScanSnapshot(): ScanSnapshot {
  return state.snapshot;
}

/** Start a new scan. If a scan is currently running, it's aborted
 *  and the new one supersedes it. The generator drains in the
 *  background — callers don't have to await it. */
export function startScan(
  spec: DeepQuerySpec,
  resolveScope: ScopeResolver
): void {
  // Supersede any in-flight scan.
  if (state.controller) {
    state.controller.abort();
  }
  const controller = new AbortController();
  state.controller = controller;
  const startedAt = Date.now();
  state.snapshot = {
    kind: "running",
    spec,
    startedAt,
    rows: [],
    scopeErrors: [],
    progress: {
      scopeUnitsTotal: 0,
      scopeUnitsDone: 0,
      recordsScanned: 0,
      matches: 0,
    },
  };
  emit();

  // Fire-and-forget; we'll mutate state.snapshot as events arrive.
  void drain(spec, resolveScope, controller, startedAt);
}

async function drain(
  spec: DeepQuerySpec,
  resolveScope: ScopeResolver,
  controller: AbortController,
  startedAt: number
): Promise<void> {
  try {
    for await (const event of runDeepScan(spec, resolveScope, {
      signal: controller.signal,
    })) {
      // If a later scan superseded us, stop pushing events into the
      // shared snapshot — they belong to a stale scan.
      if (state.controller !== controller) return;
      applyEvent(event, spec, startedAt);
      emit();
    }
  } catch (err) {
    if (state.controller !== controller) return;
    const message = err instanceof Error ? err.message : String(err);
    state.snapshot = {
      kind: "ready",
      spec,
      startedAt,
      finishedAt: Date.now(),
      rows: state.snapshot.kind === "running" ? state.snapshot.rows : [],
      scopeErrors:
        state.snapshot.kind === "running"
          ? [
              ...state.snapshot.scopeErrors,
              {
                scopeUnitId: "<top-level>",
                scopeUnitName: "Scan",
                message,
              },
            ]
          : [
              {
                scopeUnitId: "<top-level>",
                scopeUnitName: "Scan",
                message,
              },
            ],
      summary: {
        scopeUnitsTotal: 0,
        scopeUnitsDone: 0,
        scopeUnitsErrored: 0,
        recordsScanned: 0,
        matches: 0,
        errors: [],
        cancelled: false,
        observedAfter: {
          source: spec.source,
          windowRecords: 0,
          windowSize: 0,
          paths: new Map(),
          updatedAt: new Date().toISOString(),
        },
      },
    };
    emit();
  } finally {
    if (state.controller === controller) {
      state.controller = null;
    }
  }
}

function applyEvent(
  event: ScanEvent,
  spec: DeepQuerySpec,
  startedAt: number
): void {
  const cur = state.snapshot;
  if (cur.kind !== "running") return;

  if (event.kind === "progress") {
    state.snapshot = {
      ...cur,
      progress: {
        scopeUnitsTotal: event.scopeUnitsTotal,
        scopeUnitsDone: event.scopeUnitsDone,
        recordsScanned: event.recordsScanned,
        matches: event.matches,
      },
    };
    return;
  }
  if (event.kind === "match") {
    state.snapshot = {
      ...cur,
      rows: [...cur.rows, event.row],
    };
    return;
  }
  if (event.kind === "scopeUnitError") {
    state.snapshot = {
      ...cur,
      scopeErrors: [...cur.scopeErrors, event.error],
    };
    return;
  }
  if (event.kind === "done") {
    state.snapshot = {
      kind: "ready",
      spec,
      startedAt,
      finishedAt: Date.now(),
      rows: cur.rows,
      scopeErrors: cur.scopeErrors,
      summary: event.summary,
    };
    return;
  }
}

/** Cancel the currently-running scan, if any. The next event from
 *  the runner will be a `done` event with `summary.cancelled = true`
 *  which transitions the store to `ready`. */
export function cancelScan(): void {
  if (state.controller) {
    state.controller.abort();
  }
}

/** Reset the store back to `idle`. Cancels any running scan and
 *  clears the most recent results. Wire to a "Clear results" UI
 *  action when the user explicitly wants a clean slate. */
export function resetScan(): void {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
  state.snapshot = { kind: "idle" };
  emit();
}

/** True if a scan is currently running. Used by the top-level
 *  navigation indicator. */
export function isScanRunning(): boolean {
  return state.snapshot.kind === "running";
}
