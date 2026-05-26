/**
 * Schema drift detector.
 *
 * Cross-checks the curated registry against the latest observed
 * schema. The goal is to catch the case where Microsoft renames or
 * removes a connector field and a curated entry is silently returning
 * `undefined` for every record — the deep-scan would just return zero
 * matches, leaving an admin to wonder why their saved query went
 * empty.
 *
 * Two signals:
 *
 *  - **Missing**: the curated path is not present in the observed
 *    schema at all, or its presence rate is below the threshold
 *    (default 5%) AND the schema has seen at least
 *    `MIN_WINDOW_RECORDS_FOR_DRIFT` records (so single-tenant scans
 *    don't spam false positives).
 *
 *  - **Type-shift**: the curated `filter.kind` no longer matches the
 *    inferred type of the observed value (e.g. a `boolean` curated
 *    field is now seen as `string`). Hints at a schema migration.
 *
 * The detector returns warnings — the UI is responsible for surfacing
 * them via a yellow banner on the deep-scan page.
 */

import type {
  CuratedProperty,
  ObservedSchema,
  FilterSpec,
} from "./types";

/** Minimum records the observed schema must have seen before drift
 *  warnings are emitted. Avoids screaming "missing!" after a single
 *  tiny test scan. */
const MIN_WINDOW_RECORDS_FOR_DRIFT = 25;
/** Default presence threshold (in percent). Below this, a curated
 *  path is treated as effectively missing. */
const DEFAULT_PRESENCE_THRESHOLD_PCT = 5;

export type DriftWarningKind = "missing" | "presence-low" | "type-shift";

export interface DriftWarning {
  kind: DriftWarningKind;
  property: CuratedProperty;
  /** When `kind === "presence-low"`, the observed presence rate
   *  (0-100). When `kind === "missing"`, omitted. When
   *  `kind === "type-shift"`, omitted. */
  observedPresentInPct?: number;
  /** When `kind === "type-shift"`, the inferred type from observation. */
  observedInferredType?: string;
  /** When `kind === "type-shift"`, the curated filter kind. */
  curatedFilterKind?: FilterSpec["kind"];
  /** Human-readable summary the UI can show directly. */
  message: string;
}

export interface DetectDriftOptions {
  /** Override the presence threshold (in percent). */
  presenceThresholdPct?: number;
  /** Override the minimum window-records gate. */
  minWindowRecordsForDrift?: number;
}

/** Map a curated `FilterSpec.kind` to the set of inferred types that
 *  are compatible with it. Used to decide whether observed type drift
 *  represents an actual contract change. */
function compatibleInferredTypes(
  kind: FilterSpec["kind"]
): ReadonlySet<string> {
  switch (kind) {
    case "boolean":
      return new Set(["boolean"]);
    case "number":
      return new Set(["number"]);
    case "date":
      return new Set(["string"]); // ISO timestamps come back as strings
    case "string":
    case "enum":
      return new Set(["string"]);
    case "exists":
      // Existence-only filter is type-agnostic — any inferred type is fine.
      return new Set(["string", "number", "boolean", "object", "array", "null", "unknown"]);
  }
}

/**
 * Walk the curated registry and emit a warning per curated entry
 * whose path either (a) doesn't appear in the observed schema with
 * meaningful presence, or (b) appears with an inferred type that
 * contradicts the curated filter kind.
 *
 * Returns an empty array when:
 *  - the observed schema has fewer than `minWindowRecordsForDrift`
 *    records (not enough signal),
 *  - the observed schema is undefined,
 *  - or every curated path looks healthy.
 *
 * Order: missing first, presence-low next, type-shift last. Within
 * each kind, curated entries appear in their original order.
 */
export function detectDrift(
  curated: ReadonlyArray<CuratedProperty>,
  observed: ObservedSchema | undefined,
  options: DetectDriftOptions = {}
): DriftWarning[] {
  if (!observed) return [];
  const minRecords =
    options.minWindowRecordsForDrift ?? MIN_WINDOW_RECORDS_FOR_DRIFT;
  if (observed.windowRecords < minRecords) return [];
  const threshold =
    options.presenceThresholdPct ?? DEFAULT_PRESENCE_THRESHOLD_PCT;

  const missing: DriftWarning[] = [];
  const sparse: DriftWarning[] = [];
  const typeShift: DriftWarning[] = [];

  for (const c of curated) {
    const obs = observed.paths.get(c.path);
    if (!obs) {
      missing.push({
        kind: "missing",
        property: c,
        message:
          `Curated property "${c.label}" (${c.path}) was not observed in the ` +
          `last ${observed.windowRecords} records. The connector may have ` +
          `renamed or removed this field.`,
      });
      continue;
    }
    if (obs.presentInPct < threshold) {
      sparse.push({
        kind: "presence-low",
        property: c,
        observedPresentInPct: obs.presentInPct,
        message:
          `Curated property "${c.label}" (${c.path}) was present in only ` +
          `${obs.presentInPct.toFixed(1)}% of the last ${observed.windowRecords} ` +
          `records (below ${threshold}%). This may be expected for ` +
          `conditionally-populated fields, but check that the path is still ` +
          `valid in the connector response.`,
      });
    }
    const compatible = compatibleInferredTypes(c.filter.kind);
    // Type-shift only fires when we observed a concrete non-null type.
    if (
      obs.inferredType !== "null" &&
      obs.inferredType !== "unknown" &&
      !compatible.has(obs.inferredType)
    ) {
      typeShift.push({
        kind: "type-shift",
        property: c,
        observedInferredType: obs.inferredType,
        curatedFilterKind: c.filter.kind,
        message:
          `Curated property "${c.label}" (${c.path}) is declared as ` +
          `filter kind "${c.filter.kind}" but observed as ` +
          `"${obs.inferredType}". The filter UI may render incorrectly — ` +
          `consider updating the curated entry.`,
      });
    }
  }

  return [...missing, ...sparse, ...typeShift];
}
