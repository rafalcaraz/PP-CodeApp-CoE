/**
 * Catalog merger.
 *
 * Joins the curated registry (hand-written, ships in code) with the
 * observed schema (auto-discovered from real responses) into a single
 * `PropertyCatalog` map keyed by dotted path.
 *
 * Conflict policy: **curated entries always win.** When the same path
 * appears in both lists, the curated entry is emitted with
 * `origin: "curated"` and the observed entry is dropped. This way a
 * later-curated label / filter never gets quietly overridden by an
 * older introspection.
 *
 * Order is also preserved deterministically so the UI can render
 * "curated first, observed second" groupings without re-sorting:
 *
 *  1. Curated entries in the order their group appears in the input.
 *     Within a group, the order they were written.
 *  2. Observed entries that aren't already curated, sorted by path
 *     (alphabetical) for stability across reloads.
 *
 * A few hidden paths (object-only nodes, deep `tags.*` rotation noise)
 * are filtered out — see `shouldHideObservedPath`.
 */

import type {
  CuratedProperty,
  ObservedProperty,
  ObservedSchema,
  PropertyCatalog,
  PropertyCatalogEntry,
} from "./types";

/** Threshold below which an observed path is treated as too sparse to
 *  show in the picker by default. Sparse paths are still in the
 *  catalog (drift report needs them) but the UI groups them under a
 *  "Rarely observed" affordance. */
export const SPARSE_PRESENCE_THRESHOLD_PCT = 5;

/** Group label used for observed (non-curated) properties in the UI. */
export const OBSERVED_GROUP = "Discovered fields";

/** Sentinel entry rendered when the observed group exists but has no
 *  entries yet (e.g. before the first scan). The UI displays it as a
 *  disabled help option so users understand the section will populate
 *  once introspection has data. Sentinel paths start with `__` so
 *  they can't collide with a real path. */
export const OBSERVED_EMPTY_SENTINEL_PATH = "__observed_empty__";

export interface MergeOptions {
  /** When true, observed entries with `inferredType === "object"` or
   *  `"array"` are excluded entirely. The picker can't usefully
   *  filter on object/array nodes (only on their leaves), so we
   *  hide them by default. Set to false in the diagnostics panel
   *  if you want to see every observed path. */
  hideContainerPaths?: boolean;
  /** Path prefixes to hide from the catalog. Useful for fields whose
   *  values rotate per-record (SAS-signed URIs, build numbers) and
   *  would dominate the observed catalog without ever being useful
   *  to filter on. */
  hidePrefixes?: string[];
}

/** Default exclusion list for the `admin-apps` source. Hides paths
 *  whose values rotate every save (auto-generated tags, signed URIs),
 *  so they don't dominate the picker. */
export const ADMIN_APPS_HIDE_PREFIXES: string[] = [
  "properties.appUris",
  "properties.appPlayUri",
  "properties.appPlayEmbeddedUri",
  "properties.appPlayTeamsUri",
  "properties.appOpenUri",
  "properties.appOpenProtocolUri",
  "properties.backgroundImageUri",
  "tags.sienaVersion",
  "tags.publisherVersion",
  "tags.minimumRequiredApiVersion",
];

function shouldHideObservedPath(
  prop: ObservedProperty,
  options: MergeOptions
): boolean {
  const hideContainers = options.hideContainerPaths !== false; // default true
  if (hideContainers) {
    if (prop.inferredType === "object" || prop.inferredType === "array") {
      return true;
    }
  }
  const prefixes = options.hidePrefixes ?? [];
  for (const p of prefixes) {
    if (prop.path === p || prop.path.startsWith(p + ".")) return true;
  }
  return false;
}

/**
 * Merge curated + observed into a single catalog.
 *
 * The output is keyed by path; iteration order is:
 *  1. all curated entries (in input order)
 *  2. observed entries with `presentInPct >= SPARSE_PRESENCE_THRESHOLD_PCT`
 *     not already in (1), sorted alphabetically by path
 *  3. observed entries with `presentInPct <  SPARSE_PRESENCE_THRESHOLD_PCT`
 *     not already in (1) or (2), sorted alphabetically by path
 */
export function mergePropertyCatalog(
  curated: ReadonlyArray<CuratedProperty>,
  observed: ObservedSchema | undefined,
  options: MergeOptions = {}
): PropertyCatalog {
  const catalog: PropertyCatalog = new Map();
  const curatedPaths = new Set<string>();

  for (const c of curated) {
    if (curatedPaths.has(c.path)) {
      // Duplicate curated path — keep the first definition, skip the
      // rest. This shouldn't happen but stays defensive.
      continue;
    }
    curatedPaths.add(c.path);
    catalog.set(c.path, { ...c, origin: "curated" });
  }

  if (!observed) return catalog;

  const observedEntries: ObservedProperty[] = [];
  for (const prop of observed.paths.values()) {
    if (curatedPaths.has(prop.path)) continue;
    if (shouldHideObservedPath(prop, options)) continue;
    observedEntries.push(prop);
  }

  const dense = observedEntries.filter(
    (p) => p.presentInPct >= SPARSE_PRESENCE_THRESHOLD_PCT
  );
  const sparse = observedEntries.filter(
    (p) => p.presentInPct < SPARSE_PRESENCE_THRESHOLD_PCT
  );
  dense.sort(byPath);
  sparse.sort(byPath);

  for (const p of dense) {
    catalog.set(p.path, { ...p, origin: "observed" });
  }
  for (const p of sparse) {
    catalog.set(p.path, { ...p, origin: "observed" });
  }

  return catalog;
}

function byPath(a: ObservedProperty, b: ObservedProperty): number {
  return a.path.localeCompare(b.path);
}

// ---------------------------------------------------------------------------
// UI grouping helpers
// ---------------------------------------------------------------------------

export interface CatalogGroup {
  /** Group label shown above the entries. */
  label: string;
  entries: PropertyCatalogEntry[];
}

/**
 * Bucket the catalog into UI-renderable groups. Curated entries are
 * grouped by their `group` field; entries without a group land in
 * "Other curated". Observed entries land under one shared
 * `OBSERVED_GROUP` heading.
 *
 * Group order:
 *  1. Curated groups in the order they're first encountered in the
 *     input catalog.
 *  2. "Other curated" if any ungrouped curated entries exist.
 *  3. `OBSERVED_GROUP`. Always emitted as long as the introspector
 *     has *seen* anything for this source — when the source has been
 *     scanned but produced zero non-curated discovered paths the
 *     section is empty; before any scan has run, the section is
 *     omitted unless `alwaysIncludeObservedGroup` is set. The UI
 *     uses this flag to render an empty-state hint inside the group
 *     so users discover that the section exists.
 */
export function groupCatalog(
  catalog: PropertyCatalog,
  options: { alwaysIncludeObservedGroup?: boolean } = {}
): CatalogGroup[] {
  const curatedGroups = new Map<string, PropertyCatalogEntry[]>();
  const otherCurated: PropertyCatalogEntry[] = [];
  const observed: PropertyCatalogEntry[] = [];
  const groupOrder: string[] = [];

  for (const entry of catalog.values()) {
    if (entry.origin === "observed") {
      observed.push(entry);
      continue;
    }
    const label = entry.group?.trim();
    if (!label) {
      otherCurated.push(entry);
      continue;
    }
    let bucket = curatedGroups.get(label);
    if (!bucket) {
      bucket = [];
      curatedGroups.set(label, bucket);
      groupOrder.push(label);
    }
    bucket.push(entry);
  }

  const out: CatalogGroup[] = [];
  for (const label of groupOrder) {
    out.push({ label, entries: curatedGroups.get(label) ?? [] });
  }
  if (otherCurated.length > 0) {
    out.push({ label: "Other curated", entries: otherCurated });
  }
  if (observed.length > 0 || options.alwaysIncludeObservedGroup) {
    out.push({ label: OBSERVED_GROUP, entries: observed });
  }
  return out;
}
