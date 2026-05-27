/**
 * Observed-schema introspector.
 *
 * Given a stream of records from a source, builds and incrementally
 * updates an `ObservedSchema` — the set of leaf paths the connector
 * has been seen to return, along with rolling statistics about each
 * path (inferred type, observed enum values, "present in X% of
 * records").
 *
 * The schema is the "what's actually there" half of the hybrid
 * catalog. Curated registries cover the fields we deliberately want
 * to surface; the observed schema fills in everything else so users
 * can ad-hoc query on fields we haven't curated yet — and so the
 * drift detector can flag curated paths that disappeared from real
 * responses (i.e. a connector schema change).
 *
 * **Window semantics.** The schema is computed over a rolling window
 * of the most recent N records (default 500). When the window is
 * full, each new record bumps the oldest out. This keeps the stats
 * relevant — when Microsoft starts rolling out a new field, the
 * observed schema reflects that change within one or two scans
 * rather than averaging it over the lifetime of the install.
 *
 * **Value cardinality cap.** For each path, we keep up to 50 distinct
 * observed values for `enum`-style filter UI. When a path goes over
 * the cap we drop the set entirely and mark `tooManyValues: true` —
 * better to render free-form input than to lie about cardinality.
 *
 * **Persistence.** `loadObservedSchema` / `saveObservedSchema` use
 * `localStorage` under `deep-inventory:observed:<sourceId>:v1`. Bumps
 * to `v1` whenever the on-disk shape evolves; older keys are silently
 * ignored on read.
 */

import type {
  DeepSourceId,
  ObservedProperty,
  ObservedSchema,
} from "./types";
import { flatten, type FlattenOptions, type FlatPayload } from "./flatten";

/** Default number of records to keep in the rolling window. */
const DEFAULT_WINDOW_SIZE = 500;
/** Max distinct values to retain per path before we mark
 *  `tooManyValues` and stop tracking the set. */
const VALUE_SET_CAP = 50;
/** localStorage key shape. The trailing `:v1` lets us evolve the
 *  on-disk shape without poisoning existing installs. */
const STORAGE_KEY = (source: DeepSourceId) =>
  `deep-inventory:observed:${source}:v1`;

/** Create a fresh, empty schema for a source. The runner / UI calls
 *  this when nothing is in storage yet (first scan, or after a
 *  user-initiated clear). */
export function emptyObservedSchema(
  source: DeepSourceId,
  windowSize: number = DEFAULT_WINDOW_SIZE
): ObservedSchema {
  return {
    source,
    windowRecords: 0,
    windowSize,
    paths: new Map(),
    updatedAt: new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Per-path running stats (internal: not exported on ObservedProperty so the
// public shape stays clean).
// ---------------------------------------------------------------------------

interface PathStats {
  /** Count of window records where the path was present and not
   *  null / undefined. */
  presentCount: number;
  /** Set of distinct string-coerced values observed within the cap. */
  values?: Set<string>;
  /** Set to true once we exceeded `VALUE_SET_CAP`. */
  tooManyValues: boolean;
}

function statsFromObserved(p: ObservedProperty, windowRecords: number): PathStats {
  // Reconstruct internal counters from the public shape on schema
  // load. presentInPct → presentCount approximation; values → Set.
  const presentCount = Math.round((p.presentInPct / 100) * windowRecords);
  let values: Set<string> | undefined;
  if (p.observedValues && !p.tooManyValues) {
    values = new Set(p.observedValues);
  }
  return {
    presentCount,
    values,
    tooManyValues: !!p.tooManyValues,
  };
}

// ---------------------------------------------------------------------------
// Public API: update / save / load
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  /** Forwarded to the flattener. Sources can pass a stable list of
   *  noisy prefixes to skip so they never pollute the schema. */
  flattenOptions?: FlattenOptions;
}

/**
 * Fold a batch of records into the schema, returning a *new* schema
 * value (the input is not mutated). Apply repeatedly as the runner
 * yields per-env results.
 *
 * Implementation notes:
 *  - `windowRecords` is capped at `windowSize`; once full, new
 *    records implicitly displace the oldest in the rolling estimate.
 *    Rather than maintain a true LRU queue (memory cost grows with
 *    distinct paths × window size), we adjust the per-path
 *    `presentCount` by `presentCount * windowSize / (windowSize + 1)`
 *    when adding a record to a full window — an exponential decay
 *    approximation that converges to the true rolling-window mean
 *    within ~3 window-lengths. Cheap (one float multiply per path) and
 *    bounded.
 *  - Value sets are unioned, then trimmed to `VALUE_SET_CAP`. Once
 *    over the cap, the set is dropped and `tooManyValues` is set
 *    permanently — even if the cardinality later collapses, the path
 *    stays in free-form mode (filter UI consistency over time).
 */
export function updateObservedSchema(
  schema: ObservedSchema,
  records: ReadonlyArray<unknown>,
  options: UpdateOptions = {}
): ObservedSchema {
  if (records.length === 0) return schema;

  // Materialize the internal stats from the input schema's public
  // shape so subsequent batches see the accumulated counts.
  const stats = new Map<string, PathStats>();
  for (const [path, prop] of schema.paths.entries()) {
    stats.set(path, statsFromObserved(prop, schema.windowRecords));
  }

  // Track the path → kind history to keep `inferredType` stable. If
  // a path mixes types (string sometimes, null sometimes), we keep
  // the first non-null kind we saw and bump null observations into
  // the `presentCount` bookkeeping only.
  const kinds = new Map<string, ObservedProperty["inferredType"]>();
  for (const [path, prop] of schema.paths.entries()) {
    kinds.set(path, prop.inferredType);
  }

  let windowRecords = schema.windowRecords;

  for (const record of records) {
    const flat = flatten(record, options.flattenOptions);
    // Bump window. Decay every existing stat when at cap.
    if (windowRecords < schema.windowSize) {
      windowRecords += 1;
    } else {
      const decay = schema.windowSize / (schema.windowSize + 1);
      for (const s of stats.values()) {
        s.presentCount = s.presentCount * decay;
      }
    }

    // Walk flattened leaves and update per-path stats. Anything not
    // touched on this record implicitly decays for the next pass.
    const touchedKinds = new Map<string, ObservedProperty["inferredType"]>();
    accumulatePresent(flat, stats, touchedKinds);
    for (const [path, kind] of touchedKinds.entries()) {
      if (!kinds.has(path)) kinds.set(path, kind);
    }
  }

  // Project stats + kinds back into the public ObservedProperty shape.
  const now = new Date().toISOString();
  const paths = new Map<string, ObservedProperty>();
  for (const [path, s] of stats.entries()) {
    const kind = kinds.get(path) ?? "unknown";
    const presentInPct =
      windowRecords > 0
        ? Math.min(100, Math.max(0, (s.presentCount / windowRecords) * 100))
        : 0;
    const observedValues = s.tooManyValues
      ? undefined
      : s.values
        ? Array.from(s.values).sort()
        : undefined;
    paths.set(path, {
      path,
      inferredType: kind,
      observedValues,
      tooManyValues: s.tooManyValues || undefined,
      presentInPct,
      lastSeen: now,
      source: schema.source,
    });
  }

  return {
    source: schema.source,
    windowRecords,
    windowSize: schema.windowSize,
    paths,
    updatedAt: now,
  };
}

/** Iterate the flat leaves of one record and update stats. Extracted
 *  so the outer loop stays tractable. */
function accumulatePresent(
  flat: FlatPayload,
  stats: Map<string, PathStats>,
  touchedKinds: Map<string, ObservedProperty["inferredType"]>
): void {
  for (const [path, leaf] of flat.entries()) {
    if (!path) continue; // skip the root entry for primitive payloads
    let s = stats.get(path);
    if (!s) {
      s = { presentCount: 0, values: new Set<string>(), tooManyValues: false };
      stats.set(path, s);
    }
    // "Present" means we saw a non-null value.
    if (leaf.kind !== "null") {
      s.presentCount += 1;
      touchedKinds.set(path, leafKindToInferred(leaf.kind));

      // Track distinct values only for scalar-ish kinds.
      if (leaf.kind === "string" || leaf.kind === "boolean" || leaf.kind === "number") {
        if (!s.tooManyValues && s.values) {
          s.values.add(String(leaf.value));
          if (s.values.size > VALUE_SET_CAP) {
            s.tooManyValues = true;
            s.values = undefined;
          }
        }
      }
    } else {
      // Null observation — record the kind as "null" only if we've
      // never seen anything else.
      if (!touchedKinds.has(path)) touchedKinds.set(path, "null");
    }
  }
}

function leafKindToInferred(kind: string): ObservedProperty["inferredType"] {
  switch (kind) {
    case "string":
    case "number":
    case "boolean":
    case "object":
    case "array":
    case "null":
      return kind;
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface SerializedObservedSchema {
  source: DeepSourceId;
  windowRecords: number;
  windowSize: number;
  updatedAt: string;
  paths: ObservedProperty[];
}

/** Persist the schema to localStorage. Silent on quota / privacy-mode
 *  errors — losing the cache is annoying but never fatal. */
export function saveObservedSchema(schema: ObservedSchema): void {
  try {
    if (typeof localStorage === "undefined") return;
    const serial: SerializedObservedSchema = {
      source: schema.source,
      windowRecords: schema.windowRecords,
      windowSize: schema.windowSize,
      updatedAt: schema.updatedAt,
      paths: Array.from(schema.paths.values()),
    };
    localStorage.setItem(STORAGE_KEY(schema.source), JSON.stringify(serial));
  } catch {
    /* ignore */
  }
}

/** Load the persisted schema for a source. Returns an empty schema
 *  when nothing was found or the stored value was malformed. */
export function loadObservedSchema(
  source: DeepSourceId,
  windowSize: number = DEFAULT_WINDOW_SIZE
): ObservedSchema {
  try {
    if (typeof localStorage === "undefined") {
      return emptyObservedSchema(source, windowSize);
    }
    const raw = localStorage.getItem(STORAGE_KEY(source));
    if (!raw) return emptyObservedSchema(source, windowSize);
    const parsed = JSON.parse(raw) as Partial<SerializedObservedSchema>;
    if (!parsed || parsed.source !== source || !Array.isArray(parsed.paths)) {
      return emptyObservedSchema(source, windowSize);
    }
    const paths = new Map<string, ObservedProperty>();
    for (const p of parsed.paths) {
      if (!p || typeof p.path !== "string") continue;
      paths.set(p.path, {
        path: p.path,
        inferredType: p.inferredType ?? "unknown",
        observedValues: p.observedValues,
        tooManyValues: p.tooManyValues,
        presentInPct: typeof p.presentInPct === "number" ? p.presentInPct : 0,
        lastSeen: p.lastSeen ?? new Date(0).toISOString(),
        source,
      });
    }
    return {
      source,
      windowRecords:
        typeof parsed.windowRecords === "number" ? parsed.windowRecords : 0,
      windowSize:
        typeof parsed.windowSize === "number" ? parsed.windowSize : windowSize,
      paths,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return emptyObservedSchema(source, windowSize);
  }
}

/** Drop the persisted schema for a source. Wire to a "Reset observed
 *  schema" link in the diagnostics panel when one exists. */
export function clearObservedSchema(source: DeepSourceId): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY(source));
  } catch {
    /* ignore */
  }
}
