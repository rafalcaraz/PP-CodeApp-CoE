/**
 * Shared types and interfaces for deep-inventory sources.
 *
 * A *source* is a strategy that, given a scope unit (e.g. one
 * environment id), yields one or more bags of rich payload records.
 * The runner consumes the source via the async-iterable contract so
 * paged fetchers can stream pages as they arrive instead of buffering
 * the whole env's response in memory.
 */

import type {
  DeepRecord,
  DeepRecordIdentity,
  DeepSourceId,
} from "../catalog/types";
import type { FlattenOptions } from "../catalog/flatten";

/** Scope unit — the atom over which a source fans out. For every
 *  source we ship today, scope unit = one environment, so the type
 *  carries `{ envId, envName }`. The runner reuses this shape for
 *  per-scope-unit progress + error reporting. */
export interface ScopeUnit {
  envId: string;
  /** Human-readable name when available. Falls back to envId in the UI. */
  envName?: string;
}

/** One page of records yielded by a source. */
export interface SourcePage {
  records: DeepRecord[];
  /** When true, this is the last page for the scope unit. */
  isLast: boolean;
}

/** Source contract. v1 wires `admin-apps`; future sources for flows /
 *  connections / websites implement the same shape. */
export interface DeepSource {
  id: DeepSourceId;
  /** Human-readable name for the picker. */
  label: string;
  /** Default flatten options applied by the introspector. Lets each
   *  source tune the depth cap and prune its own noisy URI bags
   *  without polluting the global flattener defaults. */
  flattenOptions?: FlattenOptions;
  /**
   * Fetch one scope unit. Sources are responsible for paging, error
   * normalization, and unwrapping the connector's envelope (`value` /
   * `data`) before yielding records.
   *
   * The async iterable must respect `signal.aborted` between pages so
   * a user-initiated cancel takes effect promptly. Throwing from the
   * iterable is allowed; the runner converts it to a per-scope-unit
   * error event and continues with the next scope unit.
   */
  fetch(scopeUnit: ScopeUnit, signal: AbortSignal): AsyncIterable<SourcePage>;
  /**
   * Extract canonical identity from a record. Lets the result table
   * link rows back to the existing detail pages without forcing every
   * source to flatten its payload in the same way.
   *
   * Should return `null` for records the source can't identify (e.g.
   * a stub returned by an error) so the runner can drop them.
   */
  identify(record: DeepRecord, scopeUnit: ScopeUnit): DeepRecordIdentity | null;
  /**
   * Optional default column set. The UI uses this when the user
   * hasn't picked any columns. Source-defined defaults keep
   * "blank scan" output meaningful per source.
   */
  defaultColumns?: string[];
}
