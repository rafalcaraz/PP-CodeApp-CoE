import {
  listAgentsPage,
  listAppsPage,
  listFlowsPage,
  type DataResult,
} from "../../data/inventory";

export interface ZoneUsageResource {
  id: string;
  displayName: string;
  environmentId: string;
  environmentName: string;
  tenantId: string;
}

type PageResult<T> = {
  rows: T[];
  skipToken?: string;
  totalRecords: number;
};

type PageLoader<TFilters, TRow> = (
  filters: TFilters,
  skipToken?: string,
  pageSize?: number,
  skip?: number,
) => Promise<DataResult<PageResult<TRow>>>;

type AgentPageFilters = Parameters<typeof listAgentsPage>[0];
type AppPageFilters = Parameters<typeof listAppsPage>[0];
type FlowPageFilters = Parameters<typeof listFlowsPage>[0];

const PAGE_SIZE = 500;
const MAX_PAGES_PER_ENV = 100;

export async function listZoneAgents(envIds: string[]): Promise<DataResult<ZoneUsageResource[]>> {
  return listResourcesByEnv(
    envIds,
    (envId): AgentPageFilters => ({
      environmentId: envId,
      schemaPrefix: { mode: "exclude", value: "msdyn_" },
    }),
    listAgentsPage,
    (row) =>
      row.id
        ? {
            id: row.id,
            displayName: row.displayName || row.id,
            environmentId: row.environmentId,
            environmentName: row.environmentName || row.environmentId,
            tenantId: row.tenantId,
          }
        : null,
  );
}

export async function listZoneFlows(envIds: string[]): Promise<DataResult<ZoneUsageResource[]>> {
  return listResourcesByEnv(
    envIds,
    (envId): FlowPageFilters => ({ environmentId: envId }),
    listFlowsPage,
    (row) =>
      row.id
        ? {
            id: row.id,
            displayName: row.displayName || row.id,
            environmentId: row.environmentId,
            environmentName: row.environmentName || row.environmentId,
            tenantId: row.tenantId,
          }
        : null,
  );
}

export async function listZoneApps(envIds: string[]): Promise<DataResult<ZoneUsageResource[]>> {
  return listResourcesByEnv(
    envIds,
    (envId): AppPageFilters => ({ environmentId: envId }),
    listAppsPage,
    (row) =>
      row.id
        ? {
            id: row.id,
            displayName: row.displayName || row.id,
            environmentId: row.environmentId,
            environmentName: row.environmentName || row.environmentId,
            tenantId: row.tenantId,
          }
        : null,
  );
}

async function listResourcesByEnv<TFilters, TRow>(
  envIds: string[],
  buildFilters: (envId: string) => TFilters,
  loader: PageLoader<TFilters, TRow>,
  mapRow: (row: TRow) => ZoneUsageResource | null,
): Promise<DataResult<ZoneUsageResource[]>> {
  const envList = [...new Set(envIds.filter((envId) => !!envId))];
  if (envList.length === 0) return { ok: true, data: [] };

  const deduped = new Map<string, ZoneUsageResource>();
  for (const envId of envList) {
    const filters = buildFilters(envId);
    let skipToken = "";
    let previousSkipToken: string | undefined;
    let skip = 0;

    for (let page = 0; page < MAX_PAGES_PER_ENV; page++) {
      const res = await loader(filters, skipToken, PAGE_SIZE, skip);
      if (!res.ok) return res;

      for (const row of res.data.rows) {
        const mapped = mapRow(row);
        if (!mapped) continue;
        const key = `${mapped.environmentId}::${mapped.id}`;
        if (!deduped.has(key)) {
          deduped.set(key, mapped);
        }
      }

      if (!res.data.skipToken || res.data.skipToken === previousSkipToken) {
        break;
      }
      previousSkipToken = skipToken;
      skipToken = res.data.skipToken;
      skip += res.data.rows.length;
    }
  }

  return { ok: true, data: [...deduped.values()] };
}
