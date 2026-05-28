/**
 * Shared data source for **computed dashboard tiles**.
 *
 * Computed tiles need the FULL agent population (with their nested
 * `powerPlatformConnectors[].operations[]` arrays intact) so client-side
 * aggregators can walk the arrays and produce rollups the connector's
 * KQL whitelist can't compute server-side (no `mv-expand`).
 *
 * Implementation notes (re-learned the hard way):
 *
 * 1. **Use the agentScope `extend → !startswith` pattern, NOT
 *    `where properties.schemaName !startswith`.** The latter goes through
 *    `buildListClauses` in `inventory.ts`, which can silently degrade to
 *    client-side filtering — and then the 10k-row pagination budget gets
 *    eaten by msdyn_ first-party agents. The alias-based pattern is the
 *    proven server-side filter (it's what the Phase 1 Estate template
 *    uses everywhere).
 *
 * 2. **Don't sort by `lastPublishedAt`.** That's the default in
 *    `listAgentsPage` and it pushes never-published agents to the bottom
 *    of the page set, where pagination may never reach them. Customer
 *    agents that are draft-only (no `lastPublishedAt`) are exactly the
 *    rows we care about for several Phase 2 metrics, so we sort by
 *    `createdAt desc` instead — every agent has a `createdAt`.
 *
 * 3. **Always send both `Skip` and `SkipToken`.** Per the Inventory API
 *    quirk note in `docs/inventory-schema-samples.md`.
 */
import type { Clause } from "../generated/models/PowerPlatformforAdminsV2Model";
import {
  DASHBOARD_CACHE_TTL_MS,
  ResourceType,
  extend,
  orderBy,
  runRawQuery,
  toAgentRow,
  where,
  type AgentFilters,
  type AgentRow,
  type DataResult,
} from "./inventory";

interface CacheEntry {
  ts: number;
  data: AgentRow[];
}

const cache = new Map<string, CacheEntry>();

/** Reset the in-memory cache. Useful in tests and as a hook from the
 *  dashboard's "Refresh" flow if we ever wire it explicitly. */
export function clearDashboardAgentCache(): void {
  cache.clear();
}

interface FetchOpts {
  cacheTtlMs?: number;
  forceFresh?: boolean;
  /** Defensive cap on total pages to fetch — guards against a runaway
   *  skipToken loop on a misbehaving backend. The Copilot Studio agent
   *  population (customer-authored only) is typically hundreds-to-low-
   *  thousands; 40 pages × 500/page = 20k rows is more than any real
   *  tenant after msdyn_ exclusion. */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 40;

const AGENT_TYPE = `'${ResourceType.CopilotStudioAgent}'`;

/** Server-side scope clause set for customer-authored Copilot Studio
 *  agents (msdyn_ first-party agents excluded). Mirrors the proven
 *  `agentScope()` pattern in the Phase 1 Estate template — extend an
 *  alias column off `tostring(properties.schemaName)` then `!startswith`
 *  on the alias. Direct `where properties.schemaName !startswith` may
 *  silently fall back to client-side filtering through some code paths,
 *  which on a real tenant wastes the pagination budget on msdyn_ rows. */
function customerAgentScope(): Clause[] {
  return [
    where("type", "==", [AGENT_TYPE]),
    extend("__sn", "tostring(properties.schemaName)"),
    where("__sn", "!startswith", ["'msdyn_'"]),
  ];
}

/** Fetch every customer-authored Copilot Studio agent in the tenant.
 *  Result is memoized per filter shape; pass `forceFresh: true` to bypass
 *  on a manual refresh. */
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

  // Build the clause list once. Order is:
  //   1. type filter
  //   2. extend __sn = tostring(schemaName)
  //   3. !startswith 'msdyn_' on __sn  (server-side filter — see notes above)
  //   4. optional environmentId filter
  //   5. orderBy createdAt desc       (every agent has createdAt; lastPublishedAt
  //                                    would bury never-published agents off the end)
  const baseClauses = customerAgentScope();
  if (filters.environmentId) {
    baseClauses.push(
      where("properties.environmentId", "==", [`'${filters.environmentId}'`])
    );
  }
  baseClauses.push(orderBy({ "tostring(properties.createdAt)": "desc" }));

  const all: AgentRow[] = [];
  const seenIds = new Set<string>();
  let skipToken: string | undefined;
  let skip = 0;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < maxPages; page++) {
    const res = await runRawQuery(baseClauses, {
      Top: DEFAULT_PAGE_SIZE,
      Skip: skip,
      SkipToken: skipToken ?? "",
    });
    if (!res.ok) return res;
    for (const item of res.data.items) {
      const row = toAgentRow(item);
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
    skip += res.data.items.length;
  }

  cache.set(key, { ts: now, data: all });
  return { ok: true, data: all };
}
