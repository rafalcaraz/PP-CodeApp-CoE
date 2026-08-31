/**
 * Connectors feature — data layer.
 *
 * Re-exports the shared connector-catalog primitives so the view can
 * consume them via the feature's `./data` barrel (per the codebase's
 * feature-slice convention — see `.github/copilot-instructions.md`).
 *
 * The actual fetcher + classifier live in
 * `src/shared/connector-catalog/` because other features (apps, flows)
 * also need to classify connector references; a feature can't import
 * from a sibling feature.
 */
export {
  loadCatalog,
  useConnectorCatalog,
} from "../../shared/connector-catalog";

export type {
  ConnectorEntry,
  ConnectorCatalog,
  Classification,
  CatalogStatus,
} from "../../shared/connector-catalog";

import {
  ALL_APP_TYPES,
  ALL_FLOW_TYPES,
  CONNECTOR_FIELD,
  ResourceType,
  backfillEnvironmentNames,
  buildClausesFromSpec,
  normalizeConnectorId,
  runAggregateCount,
  runRawQuery,
  shortResourceType,
  toAgentRow,
  toAppRow,
  toFlowRow,
  type AgentRow,
  type AppRow,
  type DataResult,
  type FlowRow,
  type QuerySpec,
  type ResourceTypeValue,
} from "../../data/inventory";
import {
  loadCatalog,
  type CatalogSource,
  type ConnectorEntry,
} from "../../shared/connector-catalog";

export { shortResourceType };
export type { AgentRow, AppRow, FlowRow };

export type ConnectorUsageKind = "apps" | "flows" | "agents";

export type ConnectorUsageRecord =
  | { kind: "apps"; row: AppRow }
  | { kind: "flows"; row: FlowRow }
  | { kind: "agents"; row: AgentRow };

export interface ConnectorUsagePage {
  records: ConnectorUsageRecord[];
  nextSkipToken?: string;
  totalRecords: number;
  pagingWarning?: string;
}

export interface ConnectorUsageSummary {
  total: number;
  apps: number;
  flows: number;
  agents: number;
  environments: number;
}

export interface ConnectorDetailData {
  entry: ConnectorEntry;
  source: CatalogSource;
  complete: boolean;
}

const AGENT_TYPES: ResourceTypeValue[] = [ResourceType.CopilotStudioAgent];
const ALL_USAGE_TYPES: ResourceTypeValue[] = [
  ...ALL_APP_TYPES,
  ...ALL_FLOW_TYPES,
  ...AGENT_TYPES,
];
const EXPORT_PAGE_SIZE = 500;
const EXPORT_PAGE_CAP = 25;

function normalizedSlug(connectorId: string): string {
  return normalizeConnectorId(connectorId).trim().toLowerCase();
}

export function connectorIdVariants(connectorId: string): string[] {
  const slug = normalizedSlug(connectorId);
  if (!slug) return [];
  const alternate = slug.startsWith("shared_")
    ? slug.slice("shared_".length)
    : `shared_${slug}`;
  return alternate && alternate !== slug ? [slug, alternate] : [slug];
}

function findCatalogEntry(
  entries: Map<string, ConnectorEntry>,
  connectorId: string,
): ConnectorEntry | undefined {
  for (const variant of connectorIdVariants(connectorId)) {
    const entry = entries.get(variant);
    if (entry) return entry;
  }
  return undefined;
}

export async function getConnectorDetail(
  connectorId: string,
): Promise<DataResult<ConnectorDetailData | null>> {
  const catalogResult = await loadCatalog();
  if (!catalogResult.ok) return catalogResult;
  const entry = findCatalogEntry(catalogResult.data.entries, connectorId);
  return {
    ok: true,
    data: entry
      ? {
          entry,
          source: catalogResult.data.source,
          complete: catalogResult.data.complete,
        }
      : null,
  };
}

function typesForKind(kind: ConnectorUsageKind): ResourceTypeValue[] {
  switch (kind) {
    case "apps":
      return ALL_APP_TYPES;
    case "flows":
      return ALL_FLOW_TYPES;
    case "agents":
      return AGENT_TYPES;
  }
}

function usageSpec(
  connectorId: string,
  resourceTypes: ResourceTypeValue[],
  kind?: ConnectorUsageKind,
): QuerySpec {
  return {
    resourceTypes,
    filters: [
      {
        field: CONNECTOR_FIELD,
        op: "in~",
        value: connectorIdVariants(connectorId).join(","),
      },
    ],
    orderField:
      kind === "agents"
        ? "properties.lastPublishedAt"
        : "properties.lastModifiedAt",
    orderDirection: "desc",
    limit: 500,
  };
}

function toUsageRecord(
  kind: ConnectorUsageKind,
  item: Parameters<typeof toAppRow>[0],
): ConnectorUsageRecord {
  switch (kind) {
    case "apps":
      return { kind, row: toAppRow(item) };
    case "flows":
      return { kind, row: toFlowRow(item) };
    case "agents":
      return { kind, row: toAgentRow(item) };
  }
}

export async function listConnectorUsagePage(
  kind: ConnectorUsageKind,
  connectorId: string,
  skipToken?: string,
  pageSize = 15,
  skip = 0,
): Promise<DataResult<ConnectorUsagePage>> {
  const variants = connectorIdVariants(connectorId);
  if (variants.length === 0) {
    return { ok: false, error: "A connector ID is required." };
  }

  const clauses = buildClausesFromSpec(
    usageSpec(connectorId, typesForKind(kind), kind),
  );
  const result = await runRawQuery(clauses, {
    Top: pageSize,
    Skip: skip,
    SkipToken: skipToken ?? "",
  });
  if (!result.ok) return result;

  const records = result.data.items.map((item) => toUsageRecord(kind, item));
  await backfillEnvironmentNames(records.map((record) => record.row));

  const repeatedToken =
    Boolean(result.data.skipToken) && result.data.skipToken === skipToken;
  return {
    ok: true,
    data: {
      records,
      nextSkipToken:
        records.length > 0 && !repeatedToken
          ? result.data.skipToken
          : undefined,
      totalRecords: result.data.totalRecords,
      pagingWarning: repeatedToken
        ? "Inventory returned the same continuation token twice. Paging stopped to avoid duplicate rows."
        : undefined,
    },
  };
}

export async function loadConnectorUsageSummary(
  connectorId: string,
): Promise<DataResult<ConnectorUsageSummary>> {
  if (connectorIdVariants(connectorId).length === 0) {
    return { ok: false, error: "A connector ID is required." };
  }

  const spec = usageSpec(connectorId, ALL_USAGE_TYPES);
  const [typeResult, environmentResult] = await Promise.all([
    runAggregateCount(spec, "type"),
    runAggregateCount(spec, "properties.environmentId"),
  ]);
  if (!typeResult.ok) return typeResult;
  if (!environmentResult.ok) return environmentResult;

  const counts = new Map(
    typeResult.data.map(({ name, value }) => [name.toLowerCase(), value]),
  );
  const sum = (types: ResourceTypeValue[]) =>
    types.reduce((total, type) => total + (counts.get(type) ?? 0), 0);
  const apps = sum(ALL_APP_TYPES);
  const flows = sum(ALL_FLOW_TYPES);
  const agents = sum(AGENT_TYPES);

  return {
    ok: true,
    data: {
      total: apps + flows + agents,
      apps,
      flows,
      agents,
      environments: environmentResult.data.filter(
        ({ name, value }) => name !== "(empty)" && value > 0,
      ).length,
    },
  };
}

function usageRecordKey(record: ConnectorUsageRecord): string {
  return `${record.kind}|${record.row.environmentId}|${record.row.id}`;
}

export async function exportConnectorUsage(
  scope: ConnectorUsageKind | "all",
  connectorId: string,
): Promise<DataResult<ConnectorUsageRecord[]>> {
  const kinds: ConnectorUsageKind[] =
    scope === "all" ? ["apps", "flows", "agents"] : [scope];
  const records: ConnectorUsageRecord[] = [];
  const seen = new Set<string>();

  for (const kind of kinds) {
    let skipToken: string | undefined;
    let skip = 0;
    let exhausted = false;

    for (let page = 0; page < EXPORT_PAGE_CAP; page++) {
      const result = await listConnectorUsagePage(
        kind,
        connectorId,
        skipToken,
        EXPORT_PAGE_SIZE,
        skip,
      );
      if (!result.ok) return result;
      if (result.data.pagingWarning) {
        return {
          ok: false,
          error: `${result.data.pagingWarning} Export was cancelled because the result could be incomplete.`,
        };
      }

      for (const record of result.data.records) {
        const key = usageRecordKey(record);
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(record);
      }
      skip += result.data.records.length;

      if (!result.data.nextSkipToken || result.data.records.length === 0) {
        exhausted = true;
        break;
      }
      skipToken = result.data.nextSkipToken;
    }

    if (!exhausted) {
      return {
        ok: false,
        error: `Export reached the ${EXPORT_PAGE_CAP}-page safety limit for ${kind}. Refine the scope before exporting again.`,
      };
    }
  }

  return { ok: true, data: records };
}
