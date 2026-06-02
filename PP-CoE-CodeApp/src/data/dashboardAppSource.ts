/**
 * Shared data source for **computed dashboard tiles that aggregate apps**.
 *
 * Mirrors `dashboardAgentSource.ts` for the Power Apps estate templates.
 * Pulls the full customer-built app population (canvas / model-driven /
 * code / app-builder) so client-side aggregators can fold over connector
 * arrays, sharing fan-out, lifecycle timestamps, and per-environment
 * cohorts — same plumbing as agents, different shape per row.
 *
 * Why the system-owned exclusion matters: every Dataverse environment
 * ships first-party Microsoft model-driven apps (Customer Service Hub,
 * Sales Hub, Field Service, …) with `createdBy = 00000000-…` — the
 * Dataverse system user GUID. Without filtering them out, KPIs like
 * "total apps" or "top creators" are dominated by first-party apps and
 * the real customer signal is buried. This is the Power Apps analogue
 * of the `msdyn_` schema-name filter we apply to Copilot Studio agents.
 *
 * Re-learned-the-hard-way notes carried over from `dashboardAgentSource`:
 *
 * 1. **Use the alias `extend → where` pattern, NOT a direct
 *    `where startswith(...)` clause.** Going through `buildListClauses`
 *    in `inventory.ts` with function-call FieldNames can silently
 *    degrade to client-side filtering, eating the pagination budget on
 *    first-party rows. The alias pattern keeps the predicate server-side.
 *
 * 2. **Sort by `createdAt desc`** — every app row has a `createdAt`. Don't
 *    sort by `lastLaunchedTime` (canvas-only and often empty for drafts)
 *    or `lastModifiedAt` (always present but biases the page set in ways
 *    that hide brand-new apps).
 *
 * 3. **Always send both `Skip` and `SkipToken`.** Per the Inventory API
 *    quirk in `docs/inventory-schema-samples.md`.
 */
import type { Clause } from "../generated/models/PowerPlatformforAdminsV2Model";
import {
  ALL_APP_TYPES,
  DASHBOARD_CACHE_TTL_MS,
  extend,
  orderBy,
  runRawQuery,
  toAppRow,
  where,
  type AppFilters,
  type AppRow,
  type DataResult,
  type ResourceTypeValue,
} from "./inventory";

interface CacheEntry {
  ts: number;
  data: AppRow[];
}

const cache = new Map<string, CacheEntry>();

/** Reset the in-memory cache. Useful in tests and as a hook from the
 *  dashboard's "Refresh" flow if we ever wire it explicitly. */
export function clearDashboardAppCache(): void {
  cache.clear();
}

interface FetchOpts {
  cacheTtlMs?: number;
  forceFresh?: boolean;
  /** Defensive cap on total pages to fetch — guards against a runaway
   *  skipToken loop on a misbehaving backend. The customer-built Power
   *  Apps population on most tenants is in the hundreds-to-low-thousands
   *  range; 40 pages × 500/page = 20k rows is more than realistic after
   *  system-owned MDA exclusion. */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 40;

/** Server-side scope clauses for customer-built Power Apps. Always
 *  filters by the supplied `types`, then excludes any row whose
 *  `createdBy` starts with the Dataverse system-user prefix
 *  (`00000000-`). Returns the clause prefix; the caller appends any
 *  environment filter and the `orderBy`. */
function customerAppScope(types: ResourceTypeValue[]): Clause[] {
  const clauses: Clause[] = [];
  if (types.length === 1) {
    clauses.push(where("type", "==", [`'${types[0]}'`]));
  } else {
    clauses.push(
      where(
        "type",
        "in~",
        types.map((t) => `'${t}'`)
      )
    );
  }
  // Alias the string then use `!startswith` as a `where` OPERATOR. KQL
  // does not accept `startswith()` as a function inside `extend` (the
  // Inventory API's whitelist surfaces it only as an operator). Same
  // shape the agent template uses for the `msdyn_` exclusion.
  clauses.push(extend("__cb", "tostring(properties.createdBy)"));
  clauses.push(where("__cb", "!startswith", ["'00000000-'"]));
  return clauses;
}

/** Fetch every customer-built Power Apps row of the requested types in
 *  the tenant. Result is memoized per (types + filter) key; pass
 *  `forceFresh: true` to bypass on a manual refresh.
 *
 *  `types` defaults to all four Power Apps shapes (canvas, model-driven,
 *  code, app-builder). Pass a narrower list (e.g. just canvas + MDA, or
 *  just code + app-builder) for templates that want a tighter universe. */
export async function fetchAllCustomerApps(
  types: ResourceTypeValue[] = ALL_APP_TYPES,
  filters: AppFilters = {},
  opts: FetchOpts = {}
): Promise<DataResult<AppRow[]>> {
  const key = JSON.stringify({ types: [...types].sort(), filters });
  const ttl = opts.cacheTtlMs ?? DASHBOARD_CACHE_TTL_MS;
  const now = Date.now();
  if (!opts.forceFresh) {
    const hit = cache.get(key);
    if (hit && now - hit.ts < ttl) {
      return { ok: true, data: hit.data };
    }
  }

  const baseClauses = customerAppScope(types);
  if (filters.environmentId) {
    baseClauses.push(
      where("properties.environmentId", "==", [`'${filters.environmentId}'`])
    );
  }
  baseClauses.push(orderBy({ "tostring(properties.createdAt)": "desc" }));

  const all: AppRow[] = [];
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
      const row = toAppRow(item);
      // Env-namespaced dedup key — same defensive pattern we use for
      // agents (botId is reused across envs, and at least one Power
      // Apps modality has been observed to repeat `name` across envs
      // for solution-deployed apps).
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
