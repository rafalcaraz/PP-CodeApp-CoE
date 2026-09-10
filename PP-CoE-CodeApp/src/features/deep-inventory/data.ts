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
  listAgentsPage,
  ResourceType,
  type AgentRow,
  type EnvironmentRow,
  type QueryFilterOp,
} from "../../data/inventory";
import {
  getFieldSuggestions,
  type InventoryFieldKind,
} from "../../data/inventory.fields";
import {
  listSavedQueries,
  type SavedQuery,
} from "../../data/savedQueries";
import type {
  CandidateResolver,
  CuratedProperty,
  DeepFilterClause,
  DeepRecord,
  DeepQuerySpec,
  ScopeUnit,
  ScopeResolver,
} from "../../shared/deep-inventory";
import {
  evaluateFilter,
  flatten,
  getPath,
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

const AGENT_PAGE_SIZE = 500;
const MAX_AGENT_PAGES_PER_ENV = 200;
const CANDIDATE_PREVIEW_SAMPLE_SIZE = 20;
const CANDIDATE_PREVIEW_CONCURRENCY = 4;

const UNSUPPORTED_AGENT_CANDIDATE_PATHS = new Set([
  "__connector",
  "properties.triggers",
  "properties.flows",
  "properties.powerPlatformConnectors",
]);

const AGENT_ROW_PATH_OVERRIDES: Record<string, string> = {
  name: "id",
  location: "region",
  "properties.capabilitiesCounts.distinctPowerPlatformConnectors":
    "distinctConnectors",
  "properties.capabilitiesCounts.distinctPowerPlatformConnectorsOperations":
    "distinctConnectorOperations",
  "properties.capabilitiesCounts.distinctFlows": "distinctFlows",
};

/** Candidate fields derived from the same agent catalog used by Queries. */
export function getAgentCandidateCatalog(): CuratedProperty[] {
  return getFieldSuggestions([ResourceType.CopilotStudioAgent], "filter")
    .filter((field) => !UNSUPPORTED_AGENT_CANDIDATE_PATHS.has(field.path))
    .map((field) => ({
      id: `candidate-${field.path.replace(/[^a-zA-Z0-9]+/g, "-")}`,
      label: field.label,
      path: agentRowPath(field.path),
      group: field.group,
      filter: { kind: candidateFilterKind(field.kind) },
      source: "copilot-agents-dataverse" as const,
      addedIn: "2026-09-10",
      helpText: field.help,
    }));
}

export interface SavedCandidateQuery {
  id: string;
  name: string;
  description: string;
  filters: DeepFilterClause[];
  error?: string;
}

/** Saved visual agent queries that can be reused as candidate prefilters. */
export function listSavedAgentCandidateQueries(): SavedCandidateQuery[] {
  return listSavedQueries()
    .filter(
      (query) =>
        query.source === "builder" &&
        query.spec?.resourceTypes.includes(ResourceType.CopilotStudioAgent),
    )
    .map(toSavedCandidateQuery);
}

function toSavedCandidateQuery(query: SavedQuery): SavedCandidateQuery {
  const converted: DeepFilterClause[] = [];
  for (const filter of query.spec?.filters ?? []) {
    const next = convertSavedFilter(filter.field, filter.op, filter.value);
    if (!next) {
      return {
        id: query.id,
        name: query.name,
        description: query.description,
        filters: [],
        error: `The '${filter.op}' filter on '${filter.field}' is not supported as a scan candidate filter.`,
      };
    }
    converted.push(next);
  }
  return {
    id: query.id,
    name: query.name,
    description: query.description,
    filters: converted,
  };
}

function convertSavedFilter(
  field: string,
  op: QueryFilterOp,
  value: string,
): DeepFilterClause | null {
  if (UNSUPPORTED_AGENT_CANDIDATE_PATHS.has(field)) return null;
  const mappedOp = SAVED_OPS[op];
  if (!mappedOp) return null;
  const path = agentRowPath(field);
  const catalogEntry = getAgentCandidateCatalog().find(
    (entry) => entry.path === path,
  );
  if (!catalogEntry) return null;

  let convertedValue: unknown = value;
  if (catalogEntry.filter.kind === "boolean") {
    convertedValue = value.trim().toLowerCase() === "true";
  } else if (catalogEntry.filter.kind === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    convertedValue = numeric;
  } else if (mappedOp === "in" || mappedOp === "notIn") {
    convertedValue = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return { path, op: mappedOp, value: convertedValue };
}

const SAVED_OPS: Partial<Record<QueryFilterOp, DeepFilterClause["op"]>> = {
  "==": "eq",
  "!=": "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  contains: "contains",
  "!contains": "notContains",
  startswith: "startsWith",
  "!startswith": "notStartsWith",
  endswith: "endsWith",
  "!endswith": "notEndsWith",
  "in~": "in",
};

function agentRowPath(path: string): string {
  return (
    AGENT_ROW_PATH_OVERRIDES[path] ??
    (path.startsWith("properties.") ? path.slice("properties.".length) : path)
  );
}

function candidateFilterKind(
  kind: InventoryFieldKind,
): "string" | "boolean" | "number" | "date" {
  if (kind === "boolean" || kind === "number" || kind === "date") return kind;
  return "string";
}

/** Resolve Inventory API agents and prune them before Dataverse enrichment. */
export const resolveAgentCandidates: CandidateResolver = async (
  spec,
  scopeUnit,
  signal
): Promise<DeepRecord[]> => {
  const rows: AgentRow[] = [];
  let skipToken: string | undefined;
  let skip = 0;
  let completed = false;

  for (let page = 0; page < MAX_AGENT_PAGES_PER_ENV; page++) {
    if (signal.aborted) return [];
    const res = await listAgentsPage(
      { environmentId: scopeUnit.envId },
      skipToken,
      AGENT_PAGE_SIZE,
      skip
    );
    if (!res.ok) {
      throw new Error(`Couldn't load agent candidates: ${res.error}`);
    }

    rows.push(...res.data.rows);
    skip += res.data.rows.length;
    const nextToken = res.data.skipToken;
    if (!nextToken || nextToken === skipToken || res.data.rows.length === 0) {
      completed = true;
      break;
    }
    skipToken = nextToken;
  }

  if (!completed && !signal.aborted) {
    throw new Error(
      `Agent candidate paging exceeded ${MAX_AGENT_PAGES_PER_ENV} pages`
    );
  }

  const filters = spec.candidateFilters ?? [];
  return rows
    .filter((row) => matchesCandidateFilters(row, filters))
    .map((row) => row as unknown as DeepRecord);
};

export interface AgentCandidatePreviewItem {
  id: string;
  displayName: string;
  environmentId: string;
  environmentName: string;
}

export interface AgentCandidatePreview {
  count: number;
  countBeforeFilters: number;
  environmentsScanned: number;
  environmentsTotal: number;
  sample: AgentCandidatePreviewItem[];
  errors: Array<{ environmentId: string; environmentName: string; error: string }>;
  filterDiagnostics: Array<{
    path: string;
    matched: number;
    observedValues: Record<string, number>;
  }>;
}

/** Run only the Inventory API stage so operators can validate scan scope. */
export async function previewAgentCandidates(
  spec: DeepQuerySpec,
  signal: AbortSignal,
): Promise<AgentCandidatePreview> {
  const scopeUnits = await resolveScope(spec);
  let nextIndex = 0;
  let count = 0;
  let countBeforeFilters = 0;
  let environmentsScanned = 0;
  const sample: AgentCandidatePreviewItem[] = [];
  const errors: AgentCandidatePreview["errors"] = [];
  const filterDiagnostics: AgentCandidatePreview["filterDiagnostics"] = (
    spec.candidateFilters ?? []
  ).map((filter) => ({
    path: filter.path,
    matched: 0,
    observedValues: {},
  }));

  const worker = async (): Promise<void> => {
    while (!signal.aborted) {
      const index = nextIndex++;
      const scopeUnit = scopeUnits[index];
      if (!scopeUnit) return;
      try {
        const allCandidates = await resolveAgentCandidates(
          { ...spec, candidateFilters: [] },
          scopeUnit,
          signal,
        );
        if (signal.aborted) return;
        countBeforeFilters += allCandidates.length;
        for (const candidate of allCandidates) {
          const flat = flatten(candidate);
          for (let filterIndex = 0; filterIndex < filterDiagnostics.length; filterIndex++) {
            const filter = spec.candidateFilters?.[filterIndex];
            const diagnostic = filterDiagnostics[filterIndex];
            if (!filter || !diagnostic) continue;
            if (evaluateFilter(flat, filter)) diagnostic.matched += 1;
            const actual = getPath(flat, filter.path);
            const valueLabel =
              actual === undefined || actual === null
                ? "(missing)"
                : String(actual);
            diagnostic.observedValues[valueLabel] =
              (diagnostic.observedValues[valueLabel] ?? 0) + 1;
          }
        }
        const candidates = allCandidates.filter((candidate) =>
          matchesCandidateFilters(candidate, spec.candidateFilters ?? []),
        );
        count += candidates.length;
        environmentsScanned += 1;
        for (const candidate of candidates) {
          if (sample.length >= CANDIDATE_PREVIEW_SAMPLE_SIZE) break;
          sample.push({
            id: readPreviewString(candidate, "id"),
            displayName:
              readPreviewString(candidate, "displayName") ||
              readPreviewString(candidate, "id"),
            environmentId:
              readPreviewString(candidate, "environmentId") || scopeUnit.envId,
            environmentName:
              readPreviewString(candidate, "environmentName") ||
              scopeUnit.envName ||
              scopeUnit.envId,
          });
        }
      } catch (error) {
        environmentsScanned += 1;
        errors.push({
          environmentId: scopeUnit.envId,
          environmentName: scopeUnit.envName || scopeUnit.envId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          CANDIDATE_PREVIEW_CONCURRENCY,
          Math.max(scopeUnits.length, 1),
        ),
      },
      () => worker(),
    ),
  );

  return {
    count,
    countBeforeFilters,
    environmentsScanned,
    environmentsTotal: scopeUnits.length,
    sample,
    errors,
    filterDiagnostics,
  };
}

function readPreviewString(
  record: DeepRecord,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function matchesCandidateFilters(
  row: unknown,
  filters: ReadonlyArray<DeepFilterClause>
): boolean {
  if (filters.length === 0) return true;
  const flat = flatten(row);
  return filters.every((filter) => evaluateFilter(flat, filter));
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
  CandidateResolver,
} from "../../shared/deep-inventory";

export {
  runDeepScan,
  CURATED_ADMIN_APPS,
  CURATED_AGENT_CANDIDATES,
  CURATED_COPILOT_AGENTS,
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
  COPILOT_AGENT_OBSERVED_HIDE_PREFIXES,
  subscribeToScan,
  getScanSnapshot,
  startScan,
  cancelScan,
  resetScan,
  isScanRunning,
  type ScanSnapshot,
} from "../../shared/deep-inventory";
