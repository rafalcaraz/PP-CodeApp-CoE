/**
 * Deep-scan runner.
 *
 * The runner is the orchestration layer between the UI and the
 * source/cache/catalog modules. Its job is to:
 *
 *  1. Expand `DeepQuerySpec.scope` into a flat list of scope units
 *     (envs). It does this via an injected `resolveScope` callback so
 *     the runner stays free of dependencies on the legacy `data/`
 *     inventory module (`shared/` boundary rule). The feature layer
 *     wires the callback to `listEnvironments` / `listEnvironmentsInGroup`.
 *
 *  2. For each scope unit, hit the cache. On miss, drain the source's
 *     async iterable, accumulating records and per-page errors. On
 *     hit, replay the cached results without re-fetching.
 *
 *  3. Project + filter every record. Yields:
 *      - `progress` after each scope unit completes
 *      - `match` for every record that satisfies the filter
 *      - `scopeUnitError` when a scope unit's fetch threw
 *      - `done` at the end with a summary
 *
 *  4. Update the per-source observed schema as records flow through,
 *     so the introspected catalog stays current.
 *
 * Concurrency: bounded fan-out (`MAX_CONCURRENT_SCOPE_UNITS`).
 * Without a cap, scanning a tenant with 200 envs would spawn 200
 * parallel admin calls and immediately hit 429s. With 4 in flight,
 * a 200-env scan completes in ~50 batches × per-env latency — fast
 * enough and friendly to the connector quota.
 *
 * Cancellation: the runner respects `AbortSignal.aborted` between
 * scope units and between pages. Passes the same signal through to
 * the source so an in-flight fetch can also bail.
 */

import {
  flatten,
  type FlatPayload,
  type FlattenOptions,
} from "./catalog/flatten";
import {
  loadObservedSchema,
  saveObservedSchema,
  updateObservedSchema,
} from "./catalog/introspect";
import type {
  DeepFilterClause,
  DeepQuerySpec,
  DeepRecord,
  DeepScanRow,
  ScanEvent,
  ScanSummary,
} from "./catalog/types";
import { cacheGet, cacheSet } from "./cache";
import { evaluateFilter } from "./filter";
import { getSource, type ScopeUnit } from "./sources";

/** Default upper bound on concurrent in-flight scope-unit fetches.
 *  Tuned to stay under the connector's per-tenant rate limit while
 *  draining a typical 50-env tenant in ~13 batches. */
export const MAX_CONCURRENT_SCOPE_UNITS = 4;

/** Resolver callback the feature layer injects. Lets the runner stay
 *  decoupled from the legacy inventory data module (boundary rule:
 *  `shared/` can't import `shared-legacy/`).
 *
 *  The callback should:
 *   - return a list of envs for the given spec scope (tenant /
 *     env-group / single env), in some deterministic order
 *   - throw on resolution failure; the runner converts the throw
 *     into a `done` event with `summary.errors`
 */
export type ScopeResolver = (
  spec: DeepQuerySpec
) => Promise<ScopeUnit[]>;

export interface RunDeepScanOptions {
  /** Caller-provided abort signal. Default: a never-aborted signal. */
  signal?: AbortSignal;
  /** Override the bounded concurrency. Useful in tests. */
  concurrency?: number;
  /** Override the per-source flatten options used by introspection.
   *  Defaults to the source's own `flattenOptions`. */
  flattenOptions?: FlattenOptions;
}

/**
 * Run a deep scan and yield events as the work progresses.
 *
 * Typical UI usage:
 * ```ts
 * for await (const event of runDeepScan(spec, resolveScope, { signal })) {
 *   switch (event.kind) {
 *     case 'progress': updateBar(event); break;
 *     case 'match':    appendRow(event.row); break;
 *     case 'scopeUnitError': appendError(event.error); break;
 *     case 'done':     finalize(event.summary); break;
 *   }
 * }
 * ```
 *
 * Errors:
 *  - Scope resolution failure → single `done` event with the error
 *    captured in `summary.errors` and `summary.scopeUnitsTotal = 0`.
 *  - Per-scope-unit fetch failure → `scopeUnitError` event, scan
 *    continues with remaining units.
 *  - Cancellation → `done` event with `summary.cancelled = true`.
 */
export async function* runDeepScan(
  spec: DeepQuerySpec,
  resolveScope: ScopeResolver,
  options: RunDeepScanOptions = {}
): AsyncGenerator<ScanEvent, void, void> {
  const signal = options.signal ?? new AbortController().signal;
  const concurrency = options.concurrency ?? MAX_CONCURRENT_SCOPE_UNITS;
  const source = getSource(spec.source);
  const flattenOptions = options.flattenOptions ?? source.flattenOptions;

  // ── 1. Resolve scope ─────────────────────────────────────────────
  let scopeUnits: ScopeUnit[];
  try {
    scopeUnits = await resolveScope(spec);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield doneEvent({
      scopeUnitsTotal: 0,
      scopeUnitsDone: 0,
      scopeUnitsErrored: 0,
      recordsScanned: 0,
      matches: 0,
      errors: [
        {
          scopeUnitId: "<scope-resolve>",
          scopeUnitName: "Scope resolution",
          message,
        },
      ],
      cancelled: signal.aborted,
      observedAfter: loadObservedSchema(spec.source),
    });
    return;
  }

  if (signal.aborted) {
    yield doneEvent({
      scopeUnitsTotal: scopeUnits.length,
      scopeUnitsDone: 0,
      scopeUnitsErrored: 0,
      recordsScanned: 0,
      matches: 0,
      errors: [],
      cancelled: true,
      observedAfter: loadObservedSchema(spec.source),
    });
    return;
  }

  // ── 2. Fan out, bounded ──────────────────────────────────────────
  const scopeKind = spec.scope.kind;
  const scopeId =
    spec.scope.kind === "envGroup"
      ? spec.scope.groupId
      : spec.scope.kind === "env"
        ? spec.scope.envId
        : "tenant";

  let observed = loadObservedSchema(spec.source);
  const summary: ScanSummary = {
    scopeUnitsTotal: scopeUnits.length,
    scopeUnitsDone: 0,
    scopeUnitsErrored: 0,
    recordsScanned: 0,
    matches: 0,
    errors: [],
    cancelled: false,
    observedAfter: observed,
  };

  // Result accumulator for completed scope-unit fetches. We drain
  // this between batches and yield events in the order results
  // arrived. Lets the UI render rows as soon as their env completes
  // even when other envs in the same batch are still in flight.
  const queue: ScopeUnitResult[] = [];
  let nextIndex = 0;
  const inflight = new Map<number, Promise<void>>();

  const launchOne = (idx: number): void => {
    const unit = scopeUnits[idx];
    const p = fetchOneScopeUnit({
      unit,
      source,
      spec,
      scopeKind,
      scopeId,
      signal,
    })
      .then((result) => {
        queue.push(result);
      })
      .catch((err) => {
        // fetchOneScopeUnit shouldn't throw — it normalizes failure
        // into the result envelope. Belt-and-suspenders: convert any
        // escape into a scope-unit error so the runner doesn't crash.
        const message = err instanceof Error ? err.message : String(err);
        queue.push({
          unit,
          records: [],
          errors: [{ message }],
          fromCache: false,
        });
      })
      .finally(() => {
        inflight.delete(idx);
      });
    inflight.set(idx, p);
  };

  // Prime the pump.
  while (nextIndex < scopeUnits.length && inflight.size < concurrency) {
    launchOne(nextIndex++);
  }

  while (inflight.size > 0 || queue.length > 0) {
    if (signal.aborted) {
      summary.cancelled = true;
      // Drain in-flight so we don't leave dangling promises (the
      // source itself respects the signal so this resolves quickly).
      await Promise.allSettled(Array.from(inflight.values()));
      break;
    }

    // Wait for at least one in-flight to settle, unless the queue
    // already has work to drain.
    if (queue.length === 0 && inflight.size > 0) {
      await Promise.race(Array.from(inflight.values()));
    }

    while (queue.length > 0) {
      const result = queue.shift()!;
      summary.scopeUnitsDone += 1;
      if (result.errors.length > 0) {
        summary.scopeUnitsErrored += 1;
        for (const e of result.errors) {
          const scopedError = {
            scopeUnitId: result.unit.envId,
            scopeUnitName: result.unit.envName,
            message: e.message,
          };
          summary.errors.push(scopedError);
          yield { kind: "scopeUnitError", error: scopedError };
        }
      }

      // Update introspection (only for fresh fetches — cached
      // records already informed the schema in a prior scan).
      if (!result.fromCache && result.records.length > 0) {
        observed = updateObservedSchema(observed, result.records, {
          flattenOptions,
        });
        summary.observedAfter = observed;
      }

      // Project + filter every record.
      for (const record of result.records) {
        summary.recordsScanned += 1;
        const flat = flatten(record, flattenOptions);
        if (!matchesAllFilters(flat, spec.filters)) continue;

        const identity = source.identify(record, result.unit);
        if (!identity) continue;

        const cells = projectColumns(flat, spec.columns, source.defaultColumns);
        summary.matches += 1;
        yield {
          kind: "match",
          row: { identity, cells, raw: record },
        };
      }

      yield {
        kind: "progress",
        scopeUnitsTotal: summary.scopeUnitsTotal,
        scopeUnitsDone: summary.scopeUnitsDone,
        recordsScanned: summary.recordsScanned,
        matches: summary.matches,
      };

      // Top up the in-flight pool now that we have headroom.
      while (
        nextIndex < scopeUnits.length &&
        inflight.size < concurrency &&
        !signal.aborted
      ) {
        launchOne(nextIndex++);
      }
    }
  }

  // Persist observed schema once at the end of the scan. (Per-batch
  // saves would spam localStorage during a long scan.)
  saveObservedSchema(observed);

  yield doneEvent(summary);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ScopeUnitResult {
  unit: ScopeUnit;
  records: DeepRecord[];
  errors: { message: string }[];
  fromCache: boolean;
}

interface FetchOneScopeUnitParams {
  unit: ScopeUnit;
  source: ReturnType<typeof getSource>;
  spec: DeepQuerySpec;
  scopeKind: string;
  scopeId: string;
  signal: AbortSignal;
}

async function fetchOneScopeUnit(
  params: FetchOneScopeUnitParams
): Promise<ScopeUnitResult> {
  const { unit, source, spec, scopeKind, scopeId, signal } = params;

  // Cache hit short-circuits.
  if (!spec.forceRefresh) {
    const cached = cacheGet({
      source: source.id,
      scopeKind,
      scopeId,
      scopeUnitId: unit.envId,
    });
    if (cached) {
      return {
        unit,
        records: cached.records,
        errors: cached.errors,
        fromCache: true,
      };
    }
  }

  const records: DeepRecord[] = [];
  const errors: { message: string }[] = [];

  try {
    for await (const page of source.fetch(unit, signal)) {
      if (signal.aborted) break;
      records.push(...page.records);
      if (page.isLast) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ message });
  }

  if (!signal.aborted) {
    // Only cache when the scan completed for this unit — partial
    // results from a cancelled scan would mislead a later replay.
    cacheSet({
      source: source.id,
      scopeKind,
      scopeId,
      scopeUnitId: unit.envId,
      records,
      errors,
    });
  }

  return { unit, records, errors, fromCache: false };
}

function matchesAllFilters(
  flat: FlatPayload,
  filters: ReadonlyArray<DeepFilterClause>
): boolean {
  if (filters.length === 0) return true;
  for (const clause of filters) {
    if (!evaluateFilter(flat, clause)) return false;
  }
  return true;
}

function projectColumns(
  flat: FlatPayload,
  columns: ReadonlyArray<string>,
  defaultColumns: ReadonlyArray<string> | undefined
): DeepScanRow["cells"] {
  const cells: DeepScanRow["cells"] = {};
  const paths = columns.length > 0 ? columns : (defaultColumns ?? []);
  for (const p of paths) {
    const leaf = flat.get(p);
    cells[p] = leaf?.value ?? null;
  }
  return cells;
}

function doneEvent(summary: ScanSummary): ScanEvent {
  return { kind: "done", summary };
}
