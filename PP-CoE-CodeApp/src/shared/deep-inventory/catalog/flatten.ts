/**
 * Payload flattener for deep-inventory.
 *
 * Walks an arbitrary nested record and emits a flat map of
 * `dotted.path` → leaf value. The output drives two things:
 *
 *  1. **Filter evaluation.** The runner reads `flat.get(filter.path)`
 *     to compare against the filter value, instead of re-walking the
 *     payload per filter clause.
 *  2. **Schema introspection.** Every leaf path becomes a candidate
 *     for the observed-schema entry, so a user can later filter or
 *     project against it.
 *
 * Design choices:
 *
 *  - **Depth cap (default 6).** Beyond that, the value is stored as a
 *    JSON-stringified blob under the parent path. Six is enough for
 *    every admin-payload field we care about today
 *    (`properties.executionRestrictions.dataLossPreventionEvaluationResult.status`
 *    is depth 4) but bounds the catalog size when the connector ships
 *    a deeply-nested debug bag.
 *
 *  - **Excluded prefixes.** Sources can pass a list of path prefixes
 *    to skip. Use this for SAS-signed blob URI bags
 *    (`properties.appUris`, `tags.sienaVersion` rotates per save) and
 *    other noise that would dominate the catalog without ever being
 *    useful as a filter.
 *
 *  - **Arrays of primitives** are kept whole — they're useful as a
 *    single filter target (e.g. "contains 'shared_sharepointonline'").
 *    **Arrays of objects** are NOT recursed; the path is recorded as
 *    `array` with a `length` annotation so the picker can still show
 *    them. (A future revision could index `array[*].field` paths but
 *    that's not in v1.)
 *
 *  - **Null vs missing.** `null` and `undefined` are both stored as
 *    `null` (the introspector treats both as "not present" when
 *    computing `presentInPct`). The two are distinguishable in the
 *    raw payload but the connector mixes them inconsistently — for
 *    scan filtering they're equivalent.
 */

/** Inferred type for a leaf. Mirrors the values used by
 *  `ObservedProperty.inferredType`. */
export type LeafKind =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "unknown";

/** One flattened leaf. The `value` is the raw JS value (preserved so
 *  callers don't have to re-parse coerced strings); `kind` is the
 *  inferred type used by the introspector. */
export interface FlatLeaf {
  value: unknown;
  kind: LeafKind;
  /** For `array` leaves, the number of items. Lets the picker show
   *  "(array, 7 items)" without re-reading the value. */
  length?: number;
}

/** Map of dotted-path → leaf. Map (not plain object) so iteration
 *  preserves insertion order and so paths containing dots / brackets
 *  never collide with prototype methods. */
export type FlatPayload = Map<string, FlatLeaf>;

export interface FlattenOptions {
  /** Max recursion depth into nested objects. Defaults to 6. */
  maxDepth?: number;
  /** Path prefixes (in dotted notation) to skip entirely. The match
   *  is `path === prefix || path.startsWith(prefix + ".")`. */
  excludePrefixes?: string[];
}

const DEFAULT_MAX_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function classify(value: unknown): LeafKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

function isExcluded(path: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (path === p) return true;
    if (path.startsWith(p + ".")) return true;
  }
  return false;
}

/**
 * Flatten an arbitrary record into a map of leaf paths.
 *
 * The walker:
 *  - emits one entry per leaf (primitive, null, or array)
 *  - emits one entry per object-too-deep with its JSON-stringified body
 *  - skips any subtree whose path matches one of `excludePrefixes`
 *  - is **resilient to non-plain-object inputs** — primitives,
 *    arrays, and `null` all flatten to a single root entry under
 *    the empty path. This lets a source yield records of any shape
 *    without breaking the runner.
 */
export function flatten(
  payload: unknown,
  options: FlattenOptions = {}
): FlatPayload {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const excludePrefixes = options.excludePrefixes ?? [];
  const out: FlatPayload = new Map();

  const walk = (value: unknown, path: string, depth: number): void => {
    if (path && isExcluded(path, excludePrefixes)) return;

    const kind = classify(value);

    if (kind === "null") {
      out.set(path, { value: null, kind: "null" });
      return;
    }

    if (kind === "array") {
      const arr = value as unknown[];
      out.set(path, { value: arr, kind: "array", length: arr.length });
      return;
    }

    if (kind === "object") {
      if (!isPlainObject(value)) {
        // Non-plain objects (Date, Map, etc.) — keep whole.
        out.set(path, { value, kind: "object" });
        return;
      }
      const entries = Object.entries(value);
      if (entries.length === 0) {
        out.set(path, { value: {}, kind: "object" });
        return;
      }
      if (depth >= maxDepth) {
        // Past the depth cap — emit the JSON body so the value isn't
        // lost, then stop recursing.
        out.set(path, {
          value: safeJsonStringify(value),
          kind: "object",
        });
        return;
      }
      for (const [key, child] of entries) {
        const childPath = path ? `${path}.${key}` : key;
        walk(child, childPath, depth + 1);
      }
      return;
    }

    // Primitive leaf.
    out.set(path, { value, kind });
  };

  walk(payload, "", 0);
  return out;
}

/** JSON-stringify guarded against cycles. Returns the literal string
 *  `"[unserializable]"` instead of throwing — never crashes a scan
 *  over one weird record. */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Read a value out of a flat payload by dotted path. Returns `undefined`
 * when the path was not present (either truly missing or excluded by
 * the flattener).
 *
 * This is the canonical way the runner reads field values for filter
 * evaluation and column projection. Callers should NOT re-walk the
 * raw payload — using this helper means new exclusion rules apply
 * uniformly.
 */
export function getPath(flat: FlatPayload, path: string): unknown {
  const leaf = flat.get(path);
  return leaf?.value;
}

/**
 * Convenience: flatten then read a single path. Useful in tests and
 * one-off projections where the payload is small.
 */
export function readPath(payload: unknown, path: string, options?: FlattenOptions): unknown {
  return getPath(flatten(payload, options), path);
}
