/**
 * Type system for the deep-inventory ("tenant scan") catalog.
 *
 * The catalog is hybrid:
 *
 *  - **Curated** entries are hand-written `DeepProperty` rows that ship
 *    in code. They give us friendly labels, validated filter UI hints,
 *    and grouping. Examples: `embeddedApp.type` → "Embedded app type"
 *    with an enum filter.
 *
 *  - **Observed** entries are auto-discovered from real connector
 *    responses by the introspector. They give us forward-compat — when
 *    Microsoft adds a new admin field, you can scan against it the
 *    next day, without a code change, by referencing its raw path.
 *
 *  - The two streams are unioned by `merge.ts` into a single
 *    `PropertyCatalog` map keyed by `path`. Curated entries win when
 *    the same path is present in both.
 *
 * Everything in this file is pure types. No runtime code lives here so
 * the file is safe to import from the data layer, the UI, and tests
 * alike with zero cost.
 */

// ---------------------------------------------------------------------------
// Source discriminator
// ---------------------------------------------------------------------------

/** Stable identifier for a deep-inventory *source* — i.e. a fetcher that
 *  returns a bag of rich payload records for a scope unit. v1 ships
 *  only `admin-apps`. Future sources (flows, connections, websites)
 *  add new string literals here. */
export type DeepSourceId = "admin-apps";

// ---------------------------------------------------------------------------
// Filter specification
// ---------------------------------------------------------------------------

/** Per-property filter UI hint. Tells the FilterBuilder which control
 *  to render and the runner how to coerce the value before comparing.
 *
 *  Each kind carries any data the UI needs to render the right control
 *  (e.g. `enum.values` for a dropdown). Curated entries supply known
 *  enum values upfront; observed entries leave `values` undefined and
 *  the UI uses the introspected `observedValues` from
 *  `ObservedProperty` instead. */
export type FilterSpec =
  /** Categorical. UI: multi-select dropdown. */
  | { kind: "enum"; values?: (string | null)[] }
  /** True / false / not-set. UI: tri-state dropdown. */
  | { kind: "boolean" }
  /** Free-text contains / equals. UI: input + op picker. */
  | { kind: "string" }
  /** Numeric range. UI: two inputs + op picker. */
  | { kind: "number" }
  /** ISO timestamp range. UI: date pickers. */
  | { kind: "date" }
  /** Truthiness / null / missing. UI: tri-state dropdown. */
  | { kind: "exists" };

/** Comparison operators. The runner evaluates `actual op value`.
 *  Not every operator is valid for every `FilterSpec.kind`; the UI
 *  enforces that. */
export type FilterOp =
  | "eq"
  | "ne"
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "notExists";

// ---------------------------------------------------------------------------
// Property definitions
// ---------------------------------------------------------------------------

/** A property the user can filter against and / or display as a result
 *  column. Curated entries are written by hand and shipped in code. */
export interface CuratedProperty {
  /** Stable id for persistence (saved queries). Kept short and code-y
   *  even when the label is long. */
  id: string;
  /** Friendly label shown in pickers, table headers, filter chips. */
  label: string;
  /** Dotted path into the source's payload object. The flattener uses
   *  the same notation so the catalog and observed schema can be
   *  joined trivially. */
  path: string;
  /** Optional UI grouping (e.g. "Embedded app", "Licensing"). Drives
   *  the section headings in the property picker. */
  group?: string;
  /** Filter UI / coercion hint. See `FilterSpec`. */
  filter: FilterSpec;
  /** Which source produces this property. Drives which fetcher the
   *  runner invokes and lets the picker filter by selected source. */
  source: DeepSourceId;
  /** ISO date the entry was added. Used by drift reports to flag
   *  long-stale entries the connector may have dropped. */
  addedIn: string;
  /** Optional ISO date of the last manual review. Drift detector
   *  surfaces curated entries that haven't been verified in a while
   *  AND that are missing from recent scans. */
  lastVerified?: string;
  /** Optional one-line help shown in the picker tooltip. Use this for
   *  fields whose meaning is not obvious from the label alone. */
  helpText?: string;
}

/** A property *observed* in live scan responses. Built by the
 *  introspector by flattening payloads and accumulating statistics.
 *
 *  Observed entries have no friendly label or curated filter; the UI
 *  uses the raw `path` as the label and infers a reasonable filter
 *  kind from `inferredType` + `observedValues`. */
export interface ObservedProperty {
  /** Same path notation as `CuratedProperty.path`. */
  path: string;
  /** Best-effort inferred type from observed values. `object` and
   *  `array` are present but normally hidden from the picker — only
   *  leaf paths are queryable. */
  inferredType:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "null"
    | "unknown";
  /** Up to N distinct values observed (string-coerced). Empty when
   *  the inferred type is non-categorical (number/date) or when the
   *  observed cardinality exceeded the cap. */
  observedValues?: string[];
  /** Set to true when the introspector dropped the value set because
   *  it exceeded the cap. Tells the UI to render as free-form input
   *  instead of a multi-select. */
  tooManyValues?: boolean;
  /** Percentage of records (across the rolling window) where this
   *  path was present and not `null` / `undefined`. 0-100. Helps the
   *  drift detector spot curated paths that just disappeared. */
  presentInPct: number;
  /** ISO timestamp of the most recent observation. */
  lastSeen: string;
  /** Source that produced this observation. */
  source: DeepSourceId;
}

/** The merged catalog produced by `merge.ts`. Discriminated by
 *  `origin` so the UI can render curated and discovered properties
 *  differently (badge, grouping, etc). */
export type PropertyCatalogEntry =
  | (CuratedProperty & { origin: "curated" })
  | (ObservedProperty & { origin: "observed" });

/** Catalog map: path → entry. Map (not plain object) so iteration
 *  order is insertion order, which we control to keep curated
 *  entries on top of their group. */
export type PropertyCatalog = Map<string, PropertyCatalogEntry>;

// ---------------------------------------------------------------------------
// Observed schema (introspector output, persisted to localStorage)
// ---------------------------------------------------------------------------

/** Rolling-window statistics about a source's payloads. Updated by
 *  the introspector on every batch processed by the runner. */
export interface ObservedSchema {
  source: DeepSourceId;
  /** Number of records considered in the current rolling window
   *  (capped at `windowSize`, typically 500). */
  windowRecords: number;
  /** Max records in the rolling window. */
  windowSize: number;
  /** Observed leaf paths. */
  paths: Map<string, ObservedProperty>;
  /** Last update timestamp (ISO). */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Query specification (what the runner consumes, what saved-queries persist)
// ---------------------------------------------------------------------------

/** Scope describes *which* environments the runner will fan out to.
 *  All three variants resolve to a flat list of env ids before the
 *  fetcher is called. */
export type DeepScanScope =
  | { kind: "tenant" }
  | { kind: "envGroup"; groupId: string }
  | { kind: "env"; envId: string };

/** A single filter clause in a deep scan. The runner evaluates each
 *  fetched record against every clause with AND semantics. */
export interface DeepFilterClause {
  /** Path the clause targets. Must exist in the merged catalog
   *  (curated or observed); unknown paths are evaluated against the
   *  raw payload anyway, but the UI prevents the user from authoring
   *  them. */
  path: string;
  op: FilterOp;
  /** Comparison RHS. Type matches the underlying `FilterSpec`:
   *   - `boolean` → `boolean | "unset"`
   *   - `enum` / `string` → `string | string[]`
   *   - `number` → `number`
   *   - `date` → ISO string
   *   - `exists` / `notExists` → ignored
   */
  value?: unknown;
}

/** Self-contained scan definition. Serializes cleanly into the saved
 *  queries store; the runner reconstitutes everything from this
 *  shape alone (plus the catalog, which is rebuilt at module load). */
export interface DeepQuerySpec {
  /** Which source to fan out against. */
  source: DeepSourceId;
  /** Where to scan. */
  scope: DeepScanScope;
  /** Filter clauses (AND). Empty array → "match everything in scope". */
  filters: DeepFilterClause[];
  /** Ordered list of property ids (or paths) to include in result rows.
   *  Empty → use the source's default column set. */
  columns: string[];
  /** Optional sort. Applied after all matches are collected (client-side). */
  sort?: { path: string; dir: "asc" | "desc" };
  /** When true, the runner bypasses the per-source LRU cache and
   *  refetches every scope unit. */
  forceRefresh?: boolean;
}

// ---------------------------------------------------------------------------
// Runner output
// ---------------------------------------------------------------------------

/** A single payload returned by a source for one scope unit. Shape is
 *  the connector's raw response — sources are responsible for
 *  unwrapping the top-level `value` / `data` envelope before yielding
 *  individual records. */
export type DeepRecord = Record<string, unknown>;

/** Canonical identity carried alongside every record so the result
 *  table can link back to existing detail pages without re-deriving
 *  the linking shape per source. */
export interface DeepRecordIdentity {
  /** Resource id (the GUID under `properties.id` or `name`). */
  id: string;
  /** Environment GUID the record belongs to. */
  environmentId: string;
  /** Human-readable label for the table. */
  displayName: string;
  /** The base inventory `ResourceType` value, when meaningful. Drives
   *  which feature page the row links to. */
  resourceType?: string;
}

/** A matched record projected through the user's column selection,
 *  ready for the result table. */
export interface DeepScanRow {
  identity: DeepRecordIdentity;
  /** path → primitive (display-coerced) for every column in the scan
   *  spec. */
  cells: Record<string, unknown>;
  /** The full raw record, kept so the row's "View JSON" affordance
   *  can show the original payload. */
  raw: DeepRecord;
}

/** Errors surfaced per scope unit. Runner continues past these so a
 *  single bad env doesn't kill the whole scan. */
export interface DeepScanScopeError {
  /** Which scope unit failed. For `admin-apps` this is an env id. */
  scopeUnitId: string;
  /** Display name for the scope unit (env name) when known. */
  scopeUnitName?: string;
  message: string;
}

/** Streaming events yielded by the runner. UI subscribes via
 *  `for await` and updates incrementally. */
export type ScanEvent =
  | {
      kind: "progress";
      scopeUnitsTotal: number;
      scopeUnitsDone: number;
      recordsScanned: number;
      matches: number;
    }
  | {
      kind: "scopeUnitError";
      error: DeepScanScopeError;
    }
  | {
      kind: "match";
      row: DeepScanRow;
    }
  | {
      kind: "done";
      summary: ScanSummary;
    };

/** Final summary delivered as the last event. */
export interface ScanSummary {
  scopeUnitsTotal: number;
  scopeUnitsDone: number;
  scopeUnitsErrored: number;
  recordsScanned: number;
  matches: number;
  errors: DeepScanScopeError[];
  /** When true, the user cancelled the scan via the abort signal. */
  cancelled: boolean;
  /** Snapshot of the observed schema state at scan completion. The
   *  drift detector consumes this to surface curated paths missing
   *  from the latest scan. */
  observedAfter: ObservedSchema;
}
