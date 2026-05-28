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
 *  shape; pass `forceFresh: true` to bypass on a manual refresh.
 *
 *  **Important:** the `msdyn_` exclusion is pushed to the SERVER via
 *  `schemaPrefix: { mode: "exclude", value: "msdyn_" }`. Excluding it
 *  client-side after the fact would waste the pagination budget on
 *  first-party Dynamics agents — on a real tenant first-party agents
 *  often outnumber customer agents 10:1, so a 10k-row budget could be
 *  fully consumed before reaching the customer agents we actually want. */
export async function fetchAllCustomerAgents(
  filters: AgentFilters = {},
  opts: FetchOpts = {}
): Promise<DataResult<AgentRow[]>> {
  // Push the msdyn_ exclusion server-side. If the caller already specified
  // a schemaPrefix filter (e.g. a different prefix scope), respect their
  // choice and skip our default — they know what they're filtering for.
  const effectiveFilters: AgentFilters = {
    ...filters,
    schemaPrefix:
      filters.schemaPrefix ?? { mode: "exclude", value: "msdyn_" },
  };
  const key = JSON.stringify(effectiveFilters);
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
    const res = await listAgentsPage(effectiveFilters, skipToken, DEFAULT_PAGE_SIZE, skip);
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

  // Defensive belt-and-suspenders: if the server fell back to client-side
  // filtering for the schemaPrefix (see listAgentsPage's degradation chain
  // in inventory.ts), some msdyn_ agents could still slip through. Drop
  // anything that survived.
  const customerAgents = all.filter(
    (a) => !(a.schemaName ?? "").toLowerCase().startsWith("msdyn_")
  );

  cache.set(key, { ts: now, data: customerAgents });
  return { ok: true, data: customerAgents };
}
