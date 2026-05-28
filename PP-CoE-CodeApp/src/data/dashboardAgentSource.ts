/**
 * Shared data source for **computed dashboard tiles**.
 *
 * Computed tiles need the FULL agent population (with their nested
 * `powerPlatformConnectors[].operations[]` arrays intact) so client-side
 * aggregators can walk the arrays and produce rollups the connector's
 * KQL whitelist can't compute server-side (no `mv-expand`).
 *
 * This module:
 *   1. Pages through `listAgentsPage` until every agent is fetched.
 *   2. Filters out first-party Dynamics agents (`schemaName` starts with
 *      `msdyn_`) — same default exclusion the Phase 1 Estate template
 *      applies, so customer counts aren't drowned by 10× msdyn noise.
 *   3. Caches the assembled `AgentRow[]` per filter key so multiple
 *      computed tiles on the same dashboard share one fetch.
 *
 * Pagination quirk: the connector returns `totalRecords` AND `skipToken`,
 * and `skipToken` is the authoritative "more pages exist" signal (see
 * `shared/inventory-core` notes). We loop until `skipToken` is empty.
 */
import {
  DASHBOARD_CACHE_TTL_MS,
  listAgentsPage,
  type AgentFilters,
  type AgentRow,
  type DataResult,
} from "./inventory";

interface CacheEntry {
  ts: number;
  data: AgentRow[];
}

const cache = new Map<string, CacheEntry>();

/** Reset the in-memory cache. Called by the dashboard's "Refresh" button
 *  flow via `invalidateInventoryCache` — we register a hook below to
 *  hear about that, but exposing this lets tests reset state explicitly. */
export function clearDashboardAgentCache(): void {
  cache.clear();
}

interface FetchOpts {
  cacheTtlMs?: number;
  forceFresh?: boolean;
  /** Defensive cap on total pages to fetch — guards against a runaway
   *  skipToken loop on a misbehaving backend. The Copilot Studio agent
   *  population is hundreds-to-low-thousands; 20 pages × 500/page = 10k
   *  rows is more than any real tenant. */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 20;

/** Fetch every customer-authored Copilot Studio agent in the tenant
 *  (first-party `msdyn_*` agents excluded). Result is memoized per filter
 *  shape; pass `forceFresh: true` to bypass on a manual refresh. */
export async function fetchAllCustomerAgents(
  filters: AgentFilters = {},
  opts: FetchOpts = {}
): Promise<DataResult<AgentRow[]>> {
  const key = JSON.stringify(filters);
  const ttl = opts.cacheTtlMs ?? DASHBOARD_CACHE_TTL_MS;
  const now = Date.now();
  if (!opts.forceFresh) {
    const hit = cache.get(key);
    if (hit && now - hit.ts < ttl) {
      return { ok: true, data: hit.data };
    }
  }

  const all: AgentRow[] = [];
  const seenIds = new Set<string>();
  let skipToken: string | undefined;
  let skip = 0;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < maxPages; page++) {
    const res = await listAgentsPage(filters, skipToken, DEFAULT_PAGE_SIZE, skip);
    if (!res.ok) return res;
    for (const row of res.data.rows) {
      // De-dupe defensively — agents have a non-tenant-unique `id`
      // (botId is reused across envs), so the env-namespaced key is the
      // only safe dedup hash. See AGENTS.md "Agent row keys" note.
      const k = `${row.environmentId}::${row.id}`;
      if (!seenIds.has(k)) {
        seenIds.add(k);
        all.push(row);
      }
    }
    if (!res.data.skipToken) break;
    skipToken = res.data.skipToken;
    skip += res.data.rows.length;
  }

  // Apply the Phase 1 default exclusion of first-party Dynamics agents.
  // Done client-side because `schemaName` filter shape via the connector
  // can be inconsistent across pages, and the resulting set is small.
  const customerAgents = all.filter(
    (a) => !(a.schemaName ?? "").toLowerCase().startsWith("msdyn_")
  );

  cache.set(key, { ts: now, data: customerAgents });
  return { ok: true, data: customerAgents };
}
