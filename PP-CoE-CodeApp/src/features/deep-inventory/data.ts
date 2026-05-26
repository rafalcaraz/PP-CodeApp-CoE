/**
 * Deep-inventory feature data layer.
 *
 * Re-exports the deep-inventory shared API and wires up the scope
 * resolver — the one piece that bridges between the runner (which
 * lives in `shared/` and can't import from `data/inventory`) and the
 * legacy inventory module. By centralizing the resolver here, the
 * runner stays decoupled and the boundary rule is satisfied.
 */

import {
  listEnvironments,
  listEnvironmentsInGroup,
  type EnvironmentRow,
} from "../../data/inventory";
import type {
  DeepQuerySpec,
  ScopeUnit,
  ScopeResolver,
} from "../../shared/deep-inventory";

/** Resolve a `DeepQuerySpec.scope` into the flat list of envs the
 *  runner will fan out against.
 *
 *  - `tenant` → `listEnvironments()`
 *  - `envGroup(groupId)` → `listEnvironmentsInGroup(groupId)`
 *  - `env(envId)` → returns a single placeholder ScopeUnit. We don't
 *    re-fetch the env display name here because the picker already
 *    selected from a labeled list — passing back the id is enough
 *    for the runner's per-unit reporting (the name slot stays empty
 *    and the UI falls back to the id).
 *
 *  Throws when the underlying inventory call fails so the runner
 *  surfaces it as a single top-level error event. */
export const resolveScope: ScopeResolver = async (
  spec: DeepQuerySpec
): Promise<ScopeUnit[]> => {
  switch (spec.scope.kind) {
    case "tenant": {
      const res = await listEnvironments();
      if (!res.ok) throw new Error(`Couldn't load environments: ${res.error}`);
      return res.data.map(toScopeUnit);
    }
    case "envGroup": {
      const res = await listEnvironmentsInGroup(spec.scope.groupId);
      if (!res.ok)
        throw new Error(
          `Couldn't load environments for group ${spec.scope.groupId}: ${res.error}`
        );
      return res.data.map(toScopeUnit);
    }
    case "env": {
      return [{ envId: spec.scope.envId }];
    }
  }
};

function toScopeUnit(env: EnvironmentRow): ScopeUnit {
  return {
    envId: env.id,
    envName: env.displayName || env.id,
  };
}

// Re-export everything the views need so they import from `./data`
// rather than reaching into `../../shared/deep-inventory` directly.
// Keeps the feature surface small and the shared barrel as the
// single seam to refactor when the public API evolves.
export type {
  DeepFilterClause,
  DeepQuerySpec,
  DeepRecord,
  DeepRecordIdentity,
  DeepScanRow,
  DeepScanScope,
  DeepScanScopeError,
  DeepSourceId,
  FilterOp,
  FilterSpec,
  ObservedSchema,
  PropertyCatalog,
  PropertyCatalogEntry,
  ScanEvent,
  ScanSummary,
  ScopeUnit,
} from "../../shared/deep-inventory";

export {
  runDeepScan,
  CURATED_ADMIN_APPS,
  mergePropertyCatalog,
  groupCatalog,
  type CatalogGroup,
  loadObservedSchema,
  clearObservedSchema,
  detectDrift,
  type DriftWarning,
  SOURCES,
  getSource,
  cacheClear,
  cacheClearSource,
  flatten,
  getPath,
  OBSERVED_GROUP,
  OBSERVED_EMPTY_SENTINEL_PATH,
  ADMIN_APPS_EXCLUDE_PREFIXES,
} from "../../shared/deep-inventory";
