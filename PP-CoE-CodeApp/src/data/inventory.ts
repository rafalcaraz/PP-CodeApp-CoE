/**
 * Inventory data layer — thin, typed helpers over the generated
 * Power Platform for Admins V2 connector's `QueryResources` action.
 *
 * Targets the `PowerPlatformResources` Azure Resource Graph table.
 * Docs: https://learn.microsoft.com/power-platform/admin/inventory-api
 *       https://learn.microsoft.com/power-platform/admin/inventory-schema
 */

import { PowerPlatformforAdminsV2Service } from "../generated";
import type {
  Clause,
  ResourceItem,
  ResourceQueryRequest,
  ResourceQueryRequestOptions,
} from "../generated/models/PowerPlatformforAdminsV2Model";

const API_VERSION = "2024-10-01";
const TABLE = "PowerPlatformResources";

export const ResourceType = {
  CanvasApp: "microsoft.powerapps/canvasapps",
  ModelDrivenApp: "microsoft.powerapps/modeldrivenapps",
  CodeApp: "microsoft.powerapps/codeapps",
  AppBuilderApp: "microsoft.powerapps/apps",
  CloudFlow: "microsoft.powerautomate/cloudflows",
  AgentFlow: "microsoft.powerautomate/agentflows",
  WorkflowAgentFlow: "microsoft.powerautomate/m365agentflows",
  CopilotStudioAgent: "microsoft.copilotstudio/agents",
  Environment: "microsoft.powerplatform/environments",
  EnvironmentGroup: "microsoft.powerplatform/environmentgroups",
} as const;

export type ResourceTypeValue = (typeof ResourceType)[keyof typeof ResourceType];

export type DataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Clause builders. The OpenAPI generator emits a base `Clause` carrying only
// `$type`; the concrete clause shapes live as siblings. We assemble plain
// objects and coerce at the boundary.
// ---------------------------------------------------------------------------

const asClause = (c: unknown): Clause => c as Clause;

export const where = (FieldName: string, Operator: string, Values: string[]): Clause =>
  asClause({ $type: "where", FieldName, Operator, Values });

export const project = (FieldList: string[]): Clause =>
  asClause({ $type: "project", FieldList });

export const extend = (FieldName: string, Expression: string): Clause =>
  asClause({ $type: "extend", FieldName, Expression });

export const orderBy = (FieldNamesAscDesc: Record<string, "asc" | "desc">): Clause =>
  asClause({ $type: "orderby", FieldNamesAscDesc });

export const take = (TakeCount: number): Clause =>
  asClause({ $type: "take", TakeCount });

export const summarize = (
  OperatorName: "count" | "argmax",
  OperatorFieldName: string,
  FieldList: string[]
): Clause =>
  asClause({
    $type: "summarize",
    SummarizeClauseExpression: { OperatorName, OperatorFieldName, FieldList },
  });

// ---------------------------------------------------------------------------
// Core executor
// ---------------------------------------------------------------------------

/** Best-effort extraction of a human-readable message from anything thrown
 *  by the @microsoft/power-apps runtime. It may surface a real `Error`,
 *  a `PowerDataRuntimeHttpError` ({ message, status, requestId }), or a
 *  free-form object from the underlying connector. */
function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (typeof e.requestId === "string" && e.requestId) parts.push(`requestId ${e.requestId}`);
    if (parts.length > 0) return parts.join(" — ");
    // Fall back to JSON so we never render "[object Object]".
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Throttling: concurrency limiter + TTL cache + 429 retry. Wraps every call
// to the underlying admin connector so high-tile-count dashboards stop
// blowing past the per-tenant rate limit (24 parallel KPI fetches → 429).
//
// All three pieces live at the `runQuery` boundary so they apply uniformly
// to KPI tiles, table tiles, chart aggregates, time-series, dashboard
// templates, and any future caller — no per-call opt-in needed.
// ---------------------------------------------------------------------------

/** Max concurrent in-flight requests to QueryResources. Anything above
 *  this is queued in FIFO order. Sized to stay well under the connector's
 *  default ~6 req/s/tenant limit while still draining a 24-tile dashboard
 *  in ~6 serial waves of 4. */
const MAX_CONCURRENT_QUERIES = 4;

/** Default TTL for the in-memory query cache. Inventory data changes on
 *  human-edit timescales, so 60s is comfortably under "noticeably stale"
 *  while killing per-navigation re-fetches. Errors are never cached.
 *  Individual callers may pass a longer TTL via `RunQueryOpts.cacheTtlMs`. */
const QUERY_CACHE_TTL_MS = 60_000;

/** Suggested TTL for expensive aggregate/dashboard queries. They run in
 *  batches of 20+, the underlying data changes on minutes-to-hours
 *  timescales, and users have a Refresh button to bust on demand. */
export const DASHBOARD_CACHE_TTL_MS = 5 * 60_000;

/** Cap on cache entries. Prevents unbounded growth in long sessions with
 *  many distinct queries (each Top/Skip/SkipToken combination is a
 *  distinct key). Oldest entry evicted on overflow (insertion-order LRU). */
const QUERY_CACHE_MAX_ENTRIES = 200;

/** Per-call knobs. Today: cache TTL override + cache bypass. Plumbed
 *  through `runRawQuery` / `runAggregateCount` / `runTimeSeriesAggregate`
 *  so dashboard tiles and any other "expensive aggregate" caller can opt
 *  into longer warmth without affecting list/detail freshness. */
export interface RunQueryOpts {
  /** Override the default cache TTL. Useful for expensive aggregates. */
  cacheTtlMs?: number;
  /** Skip the cache lookup and refetch. The fresh result is still cached
   *  using `cacheTtlMs` (or the default) for subsequent reads. */
  forceFresh?: boolean;
}

let __runQueryInFlight = 0;
const __runQueryWaiters: Array<() => void> = [];

function __acquireQuerySlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    const tryAcquire = () => {
      if (__runQueryInFlight < MAX_CONCURRENT_QUERIES) {
        __runQueryInFlight++;
        resolve();
      } else {
        __runQueryWaiters.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function __releaseQuerySlot(): void {
  __runQueryInFlight--;
  const next = __runQueryWaiters.shift();
  if (next) next();
}

type RunQueryResult = DataResult<{
  items: ResourceItem[];
  totalRecords: number;
  skipToken?: string;
}>;

interface CacheEntry {
  value: RunQueryResult;
  expiresAt: number;
}

const __runQueryCache = new Map<string, CacheEntry>();

function __cacheGet(key: string): RunQueryResult | undefined {
  const entry = __runQueryCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    __runQueryCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function __cacheSet(key: string, value: RunQueryResult, ttlMs: number): void {
  // Insertion-order LRU: if at cap, evict the oldest key first. Setting
  // an existing key would already refresh insertion order, so handle
  // overflow only when we're adding a brand-new key.
  if (!__runQueryCache.has(key) && __runQueryCache.size >= QUERY_CACHE_MAX_ENTRIES) {
    const oldest = __runQueryCache.keys().next().value;
    if (oldest !== undefined) __runQueryCache.delete(oldest);
  }
  __runQueryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/** Clear the in-memory query cache. Wire this to a UI "Refresh" action
 *  when the user explicitly wants to bypass cached results (e.g. after
 *  a change they made in the Power Platform admin center). Also clears
 *  the cached environment-id → display-name map. */
export function invalidateInventoryCache(): void {
  __runQueryCache.clear();
  __envNameMap = null;
  __envNameMapExpiresAt = 0;
}

/** Best-effort 429 detection. The runtime surfaces rate limits as either a
 *  thrown object with `status === 429`, or a `result.error` whose message
 *  embeds the status code / "rate limit" / "throttle". */
function __isRateLimit(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.status === "number" && e.status === 429) return true;
    const msg =
      typeof e.message === "string"
        ? e.message
        : typeof e === "string"
          ? e
          : "";
    if (msg && /(\b429\b|rate ?limit|throttle|too many requests)/i.test(msg)) {
      return true;
    }
  }
  if (typeof err === "string") {
    return /(\b429\b|rate ?limit|throttle|too many requests)/i.test(err);
  }
  return false;
}

function __sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Single shot at the underlying connector. Separated from the throttling
 *  layer so the retry loop in `runQuery` can call it twice cleanly. */
async function __invokeQueryOnce(
  body: ResourceQueryRequest
): Promise<RunQueryResult> {
  try {
    const result = await PowerPlatformforAdminsV2Service.QueryResources(
      API_VERSION,
      body
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    return {
      ok: true,
      data: {
        items: result.data?.data ?? [],
        totalRecords: result.data?.totalRecords ?? 0,
        skipToken: result.data?.skipToken || undefined,
      },
    };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

async function runQuery(
  clauses: Clause[],
  options?: ResourceQueryRequestOptions,
  cacheOpts?: RunQueryOpts
): Promise<RunQueryResult> {
  const body: ResourceQueryRequest = {
    TableName: TABLE,
    Clauses: clauses,
    Options: { Top: 500, Skip: 0, SkipToken: "", ...options },
  };

  const ttlMs = cacheOpts?.cacheTtlMs ?? QUERY_CACHE_TTL_MS;
  const cacheKey = JSON.stringify(body);
  if (!cacheOpts?.forceFresh) {
    const cached = __cacheGet(cacheKey);
    if (cached) return cached;
  }

  await __acquireQuerySlot();
  try {
    let result = await __invokeQueryOnce(body);

    // One retry on 429. The connector's per-tenant limit recovers quickly,
    // so a short jittered backoff is enough to clear transient throttling.
    if (!result.ok && __isRateLimit(result.error)) {
      await __sleep(500 + Math.random() * 500);
      result = await __invokeQueryOnce(body);
    }

    // Cache successes only — never cache an error, or every retry would
    // get the same stale failure for the full TTL.
    if (result.ok) __cacheSet(cacheKey, result, ttlMs);

    return result;
  } finally {
    __releaseQuerySlot();
  }
}

/** Run a query and follow skipToken to exhaustion, capped at `pageCap` pages. */
async function runQueryAllPages(
  clauses: Clause[],
  pageSize = 500,
  pageCap = 25
): Promise<DataResult<ResourceItem[]>> {
  const all: ResourceItem[] = [];
  let skipToken = "";
  let previousToken: string | undefined;
  for (let page = 0; page < pageCap; page++) {
    const res = await runQuery(clauses, { Top: pageSize, Skip: 0, SkipToken: skipToken });
    if (!res.ok) return res;
    all.push(...res.data.items);
    if (!res.data.skipToken) break;
    // Defensive guard: if the backend returns the SAME skipToken twice
    // in a row, pagination is stuck and we'd otherwise loop until pageCap
    // accumulating duplicates (was the root cause of inflated env counts
    // like "7300 managed envs" on 730-env tenants).
    if (res.data.skipToken === previousToken) break;
    previousToken = skipToken;
    skipToken = res.data.skipToken;
  }
  // Second-line defense: dedupe by `name` (which is the resource id in
  // the Admin V2 schema). Cheap O(n) pass; only re-allocates when there
  // *is* a duplicate to remove. Protects all `list*` callers uniformly
  // from any future pagination weirdness — if the backend behaves
  // correctly, this is a no-op.
  const byId = new Map<string, ResourceItem>();
  for (const item of all) {
    const key = item.name ?? "";
    if (!key) continue;
    if (!byId.has(key)) byId.set(key, item);
  }
  return {
    ok: true,
    data: byId.size === all.length ? all : Array.from(byId.values()),
  };
}

/** Run a query and call `onPage` as each page arrives. Caller can render
 *  progressively. Returns when skipToken is exhausted or pageCap is reached.
 *  If `isCancelled` becomes true between pages the stream stops without error. */
async function runQueryStreaming(
  clauses: Clause[],
  onPage: (items: ResourceItem[], pageIndex: number, isLast: boolean) => void,
  opts: {
    pageSize?: number;
    pageCap?: number;
    isCancelled?: () => boolean;
  } = {}
): Promise<DataResult<void>> {
  const pageSize = opts.pageSize ?? 500;
  const pageCap = opts.pageCap ?? 25;
  let skipToken = "";
  for (let page = 0; page < pageCap; page++) {
    if (opts.isCancelled?.()) return { ok: true, data: undefined };
    const res = await runQuery(clauses, { Top: pageSize, Skip: 0, SkipToken: skipToken });
    if (!res.ok) return res;
    if (opts.isCancelled?.()) return { ok: true, data: undefined };
    const isLast = !res.data.skipToken;
    onPage(res.data.items, page, isLast);
    if (isLast) return { ok: true, data: undefined };
    skipToken = res.data.skipToken!;
  }
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface EnvironmentGroupRow {
  id: string;
  displayName: string;
  description: string;
  createdAt: string;
  createdBy: string;
  location: string;
}

export interface EnvironmentRow {
  id: string;
  displayName: string;
  environmentType: string;
  region: string;
  isManaged: boolean;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  environmentGroupId: string;
  environmentGroup: string;
}

export interface ResourceRow {
  id: string;
  type: string;
  displayName: string;
  ownerId: string;
  createdAt: string;
  lastModifiedAt: string;
  environmentId: string;
  isQuarantined: boolean;
}

export interface ResourceCountRow {
  type: string;
  count: number;
}

export interface ResourceConnectorOperation {
  operationId: string;
  usedAs?: string;
  whenCanBeUsed?: string;
  connectionProvider?: string;
  requiresEndUserConsent?: boolean;
  isEnabled?: boolean;
  connectionIdSharedByMaker?: string;
  createdBy?: string;
}

export interface ResourceConnector {
  connectorId: string;
  displayName: string;
  /** "invoker" for app-builder apps that just declare connector references. */
  connectionType?: string;
  operations: ResourceConnectorOperation[];
}

export interface AppRow {
  id: string;
  type: string;
  displayName: string;
  environmentId: string;
  environmentName: string;
  ownerId: string;
  ownerDisplayName: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  lastLaunchedAt: string;
  appType: string;
  subType: string;
  region: string;
  tenantId: string;
  isFeatured: boolean;
  bypassConsent: boolean;
  isQuarantined: boolean;
  sharedUsersCount: number;
  sharedGroupsCount: number;
  // Model-driven-specific (Dataverse cross-reference IDs)
  logicalName: string;
  appModuleId: string;
  connectors: ResourceConnector[];
}

export interface AppFilters {
  types?: ResourceTypeValue[];
  environmentId?: string;
  nameContains?: string;
}

export const ALL_APP_TYPES: ResourceTypeValue[] = [
  ResourceType.CanvasApp,
  ResourceType.ModelDrivenApp,
  ResourceType.CodeApp,
  ResourceType.AppBuilderApp,
];

export interface FlowTrigger {
  operationId: string;
  connectorId: string;
  connectorDisplayName: string;
  operationDisplayName: string;
}

export interface FlowRow {
  id: string;
  type: string;
  displayName: string;
  environmentId: string;
  environmentName: string;
  ownerId: string;
  ownerDisplayName: string;
  state: string;
  status: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  region: string;
  tenantId: string;
  flowTriggerType: string;
  trigger: FlowTrigger | null;
  workflowEntityId: string;
  connectors: ResourceConnector[];
}

export interface FlowFilters {
  types?: ResourceTypeValue[];
  environmentId?: string;
  status?: string;
  flowTriggerType?: string;
  nameContains?: string;
}

export const ALL_FLOW_TYPES: ResourceTypeValue[] = [
  ResourceType.CloudFlow,
  ResourceType.AgentFlow,
  ResourceType.WorkflowAgentFlow,
];

export interface AgentSharingCounts {
  userCount: number;
  groupCount: number;
  entireTenant: boolean;
}

export interface AgentRow {
  id: string;
  type: string;
  displayName: string;
  schemaName: string;
  environmentId: string;
  environmentName: string;
  ownerId: string;
  ownerDisplayName: string;
  createdAt: string;
  createdBy: string;
  // Note: the inventory API does NOT return `lastModifiedAt`,
  // `lastModifiedBy`, `publishState`, or `state` for
  // `microsoft.copilotstudio/agents` (verified against real payloads).
  // `lastPublishedAt` is the only lifecycle timestamp we get for agents.
  lastPublishedAt: string;
  region: string;
  tenantId: string;
  // Identity / wiring
  entraAppId: string;
  titleId: string;
  createdIn: string;
  authentication: string;
  // Behavior
  orchestration: string;
  model: string;
  instructionsCharactersCount: number;
  isWebSearchEnabledForKnowledge: boolean;
  // Distribution
  channels: string[];
  sharedWithEditors: AgentSharingCounts;
  sharedWithViewers: AgentSharingCounts;
  // Governance
  isManaged: boolean;
  isQuarantined: boolean;
  // Roll-up counts
  distinctConnectors: number;
  distinctConnectorOperations: number;
  connectors: ResourceConnector[];
}

export interface AgentFilters {
  environmentId?: string;
  nameContains?: string;
}

function propStr(item: ResourceItem, key: string): string {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const val = props[key];
  return typeof val === "string" ? val : "";
}

function propBool(item: ResourceItem, key: string): boolean {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  return Boolean(props[key]);
}

function propNum(item: ResourceItem, key: string): number {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const v = props[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

/** Read a nested string field from properties, e.g. `properties.owner.displayName`. */
function propNestedStr(item: ResourceItem, key: string, subKey: string): string {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const obj = props[key];
  if (obj && typeof obj === "object") {
    const v = (obj as Record<string, unknown>)[subKey];
    if (typeof v === "string") return v;
  }
  return "";
}

/** Best-effort owner display name across the variations the inventory schema exposes. */
function ownerDisplayName(item: ResourceItem): string {
  return (
    propStr(item, "ownerDisplayName") ||
    propNestedStr(item, "owner", "displayName") ||
    propNestedStr(item, "owner", "email") ||
    propNestedStr(item, "createdBy", "displayName") ||
    propStr(item, "ownerId")
  );
}

/** A small lookup of common Power Platform connectors to friendly names.
 *  Anything not in the table falls through to a slug-prettifier. */
export const KNOWN_CONNECTORS: Record<string, string> = {
  shared_office365: "Office 365 Outlook",
  shared_office365users: "Office 365 Users",
  shared_office365groups: "Office 365 Groups",
  shared_sharepointonline: "SharePoint",
  shared_onedriveforbusiness: "OneDrive for Business",
  shared_excelonlinebusiness: "Excel Online (Business)",
  shared_planner: "Planner",
  shared_teams: "Microsoft Teams",
  shared_outlook: "Outlook.com",
  shared_logicflows: "Logic Flows",
  shared_powerappsforadmins: "Power Apps for Admins",
  shared_powerplatformforadmins: "Power Platform for Admins",
  shared_powerplatformadminv2: "Power Platform for Admins V2",
  shared_commondataserviceforapps: "Microsoft Dataverse (legacy)",
  shared_commondataservice: "Microsoft Dataverse",
  shared_approvals: "Approvals",
  shared_flowmanagement: "Flow management",
  shared_sql: "SQL Server",
  shared_azureblob: "Azure Blob Storage",
  shared_azuread: "Azure AD",
  shared_microsoftgraph: "Microsoft Graph",
  shared_msnweather: "MSN Weather",
};

export function friendlyConnectorName(connectorId: string): string {
  if (!connectorId) return "";
  // Try exact match first.
  if (KNOWN_CONNECTORS[connectorId]) return KNOWN_CONNECTORS[connectorId];
  // Flows often drop the `shared_` prefix (e.g. `commondataserviceforapps`).
  // Try with the prefix added.
  const withShared = connectorId.startsWith("shared_")
    ? connectorId
    : `shared_${connectorId}`;
  if (KNOWN_CONNECTORS[withShared]) return KNOWN_CONNECTORS[withShared];
  // Strip the common `shared_` prefix and prettify the slug.
  const slug = connectorId.replace(/^shared_/i, "");
  if (!slug) return connectorId;
  return slug
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(^|[\s_-])(\w)/g, (_, sep, ch) => `${sep === "_" || sep === "-" ? " " : sep}${ch.toUpperCase()}`)
    .trim();
}

/** Strip an ARM-style `.../apis/<connectorSlug>` path down to just `<connectorSlug>`
 *  so the friendly-name lookup works regardless of which shape the inventory
 *  payload uses (app-builder apps publish full ARM IDs). */
function normalizeConnectorId(id: string): string {
  if (!id) return "";
  const idx = id.lastIndexOf("/");
  return idx >= 0 ? id.substring(idx + 1) : id;
}

/** Extract the connectors a resource declares it uses, with their operation IDs
 *  and (when present) per-operation metadata like `usedAs`, `isEnabled`,
 *  `connectionProvider`, etc. (Agents in particular publish richer op data.) */
function readConnectors(item: ResourceItem): ResourceConnector[] {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const raw = props.powerPlatformConnectors ?? props.connectors;
  if (!Array.isArray(raw)) return [];
  const out: ResourceConnector[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const rawId =
      typeof e.connectorId === "string"
        ? e.connectorId
        : typeof e.id === "string"
        ? e.id
        : "";
    if (!rawId) continue;
    const connectorId = normalizeConnectorId(rawId);
    const connectionType =
      typeof e.connectionType === "string" ? e.connectionType : undefined;
    const operations: ResourceConnectorOperation[] = [];
    const ops = e.operations;
    if (Array.isArray(ops)) {
      for (const op of ops) {
        if (op && typeof op === "object") {
          const o = op as Record<string, unknown>;
          operations.push({
            operationId: typeof o.operationId === "string" ? o.operationId : "",
            usedAs: typeof o.usedAs === "string" ? o.usedAs : undefined,
            whenCanBeUsed:
              typeof o.whenCanBeUsed === "string" ? o.whenCanBeUsed : undefined,
            connectionProvider:
              typeof o.connectionProvider === "string" ? o.connectionProvider : undefined,
            requiresEndUserConsent:
              typeof o.requiresEndUserConsent === "boolean"
                ? o.requiresEndUserConsent
                : undefined,
            isEnabled: typeof o.isEnabled === "boolean" ? o.isEnabled : undefined,
            connectionIdSharedByMaker:
              typeof o.connectionIdSharedByMaker === "string"
                ? o.connectionIdSharedByMaker
                : undefined,
            createdBy: typeof o.createdBy === "string" ? o.createdBy : undefined,
          });
        } else if (typeof op === "string") {
          operations.push({ operationId: op });
        }
      }
    }
    out.push({
      connectorId,
      displayName: friendlyConnectorName(connectorId),
      connectionType,
      operations,
    });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Read a string-array property like `properties.channels`. */
function propStrArray(item: ResourceItem, key: string): string[] {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const v = props[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Read a nested numeric field, e.g. `properties.sharedWithViewers.userCount`. */
function propNestedNum(item: ResourceItem, key: string, subKey: string): number {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const obj = props[key];
  if (obj && typeof obj === "object") {
    const v = (obj as Record<string, unknown>)[subKey];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

/** Read a nested boolean field. */
function propNestedBool(item: ResourceItem, key: string, subKey: string): boolean {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const obj = props[key];
  if (obj && typeof obj === "object") {
    return Boolean((obj as Record<string, unknown>)[subKey]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export async function listEnvironmentGroups(): Promise<DataResult<EnvironmentGroupRow[]>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.EnvironmentGroup}'`]),
    orderBy({ "tostring(properties.createdAt)": "desc" }),
  ];
  const res = await runQueryAllPages(clauses);
  if (!res.ok) return res;

  return {
    ok: true,
    data: res.data.map((item) => ({
      id: item.name ?? "",
      displayName: propStr(item, "displayName"),
      description: propStr(item, "description"),
      createdAt: propStr(item, "createdAt"),
      createdBy: propStr(item, "createdBy"),
      location: item.location ?? "",
    })),
  };
}

export async function getEnvironmentGroup(
  groupId: string
): Promise<DataResult<{ row: EnvironmentGroupRow; raw: ResourceItem } | null>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.EnvironmentGroup}'`]),
    where("name", "==", [`'${groupId}'`]),
    take(1),
  ];
  const res = await runQuery(clauses, { Top: 1, Skip: 0, SkipToken: "" });
  if (!res.ok) return res;
  const item = res.data.items[0];
  if (!item) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      row: {
        id: item.name ?? "",
        displayName: propStr(item, "displayName"),
        description: propStr(item, "description"),
        createdAt: propStr(item, "createdAt"),
        createdBy: propStr(item, "createdBy"),
        location: item.location ?? "",
      },
      raw: item,
    },
  };
}

export async function listEnvironmentsInGroup(groupId: string): Promise<DataResult<EnvironmentRow[]>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.Environment}'`]),
    where("properties.environmentGroupId", "==", [`'${groupId}'`]),
    orderBy({ "tostring(properties.displayName)": "asc" }),
  ];
  const res = await runQueryAllPages(clauses);
  if (!res.ok) return res;

  return {
    ok: true,
    data: res.data.map(toEnvironmentRow),
  };
}

export async function listEnvironments(): Promise<DataResult<EnvironmentRow[]>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.Environment}'`]),
    orderBy({ "tostring(properties.displayName)": "asc" }),
  ];
  const res = await runQueryAllPages(clauses);
  if (!res.ok) return res;
  return { ok: true, data: res.data.map(toEnvironmentRow) };
}

// ---------------------------------------------------------------------------
// Environment-id → display-name resolver.
//
// The Copilot Studio agent payload only carries `environmentId` (a GUID)
// in its properties — there's no `environmentName` like Apps/Flows have.
// Resolve GUIDs to friendly names on the client by caching the env list
// and looking up by id. Environment list is small (tens to low hundreds
// per tenant) and changes rarely → 5-minute freshness is comfortable,
// and concurrent callers share one in-flight promise.
// ---------------------------------------------------------------------------

const ENV_NAME_MAP_TTL_MS = 5 * 60_000;
let __envNameMap: Map<string, string> | null = null;
let __envNameMapExpiresAt = 0;
let __envNameMapPromise: Promise<Map<string, string>> | null = null;

async function loadEnvNameMap(): Promise<Map<string, string>> {
  const res = await listEnvironments();
  const map = new Map<string, string>();
  if (res.ok) {
    for (const env of res.data) {
      if (env.id && env.displayName) map.set(env.id, env.displayName);
    }
  }
  return map;
}

/** Returns a cached id → displayName map for environments. Concurrent
 *  callers within the same fetch window share one in-flight request. */
export async function getEnvironmentNameMap(): Promise<Map<string, string>> {
  if (__envNameMap && Date.now() < __envNameMapExpiresAt) return __envNameMap;
  if (__envNameMapPromise) return __envNameMapPromise;
  __envNameMapPromise = (async () => {
    try {
      const map = await loadEnvNameMap();
      __envNameMap = map;
      __envNameMapExpiresAt = Date.now() + ENV_NAME_MAP_TTL_MS;
      return map;
    } finally {
      __envNameMapPromise = null;
    }
  })();
  return __envNameMapPromise;
}

/** Mutates rows in place to backfill `environmentName` from the cached
 *  env map when the resource payload didn't include one (e.g. agents).
 *  No-op on rows that already have a name. */
async function backfillEnvironmentNames<T extends { environmentId?: string; environmentName?: string }>(
  rows: T[]
): Promise<void> {
  if (!rows.some((r) => r.environmentId && !r.environmentName)) return;
  const map = await getEnvironmentNameMap();
  for (const row of rows) {
    if (row.environmentId && !row.environmentName) {
      const name = map.get(row.environmentId);
      if (name) row.environmentName = name;
    }
  }
}

/** Streaming variant — fires `onPage` per page so the UI can render rows
 *  as they arrive instead of waiting for full pagination. */
export async function listEnvironmentsStreaming(
  onPage: (rows: EnvironmentRow[], pageIndex: number, isLast: boolean) => void,
  isCancelled?: () => boolean
): Promise<DataResult<void>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.Environment}'`]),
    orderBy({ "tostring(properties.displayName)": "asc" }),
  ];
  return runQueryStreaming(
    clauses,
    (items, pageIndex, isLast) => onPage(items.map(toEnvironmentRow), pageIndex, isLast),
    { isCancelled }
  );
}

/** A single page of environments. Pass the previous response's `skipToken`
 *  to continue paging. We also send `Skip` as a safety net: some connector
 *  paths in this tenant don't honor `SkipToken` reliably for the Environment
 *  table and silently re-return page 1, so the explicit offset keeps paging
 *  advancing even when the cursor is ignored. */
export async function listEnvironmentsPage(
  skipToken?: string,
  pageSize = 500,
  skip = 0
): Promise<DataResult<{ rows: EnvironmentRow[]; skipToken?: string; totalRecords: number }>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.Environment}'`]),
    orderBy({ "tostring(properties.displayName)": "asc" }),
  ];
  const res = await runQuery(clauses, {
    Top: pageSize,
    Skip: skip,
    SkipToken: skipToken ?? "",
  });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      rows: res.data.items.map(toEnvironmentRow),
      skipToken: res.data.skipToken,
      totalRecords: res.data.totalRecords,
    },
  };
}

export async function getEnvironment(
  envId: string
): Promise<DataResult<{ row: EnvironmentRow; raw: ResourceItem } | null>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.Environment}'`]),
    where("name", "==", [`'${envId}'`]),
    take(1),
  ];
  const res = await runQuery(clauses, { Top: 1, Skip: 0, SkipToken: "" });
  if (!res.ok) return res;
  const item = res.data.items[0];
  return { ok: true, data: item ? { row: toEnvironmentRow(item), raw: item } : null };
}

function toEnvironmentRow(item: ResourceItem): EnvironmentRow {
  return {
    id: item.name ?? "",
    displayName: propStr(item, "displayName"),
    environmentType: propStr(item, "environmentType"),
    region: item.location ?? "",
    isManaged: propBool(item, "isManaged"),
    createdAt: propStr(item, "createdAt"),
    createdBy: propStr(item, "createdBy"),
    lastModifiedAt: propStr(item, "lastModifiedAt"),
    environmentGroupId: propStr(item, "environmentGroupId"),
    environmentGroup: propStr(item, "environmentGroup"),
  };
}

function toResourceRow(item: ResourceItem): ResourceRow {
  return {
    id: item.name ?? "",
    type: item.type ?? "",
    displayName: propStr(item, "displayName"),
    ownerId: propStr(item, "ownerId"),
    createdAt: propStr(item, "createdAt"),
    lastModifiedAt: propStr(item, "lastModifiedAt"),
    environmentId: propStr(item, "environmentId"),
    isQuarantined: propBool(item, "isQuarantined"),
  };
}

/** All resources (apps, flows, agents) inside a specific environment. */
export async function listResourcesInEnvironment(envId: string): Promise<DataResult<ResourceRow[]>> {
  const resourceTypes = [
    ResourceType.CanvasApp,
    ResourceType.ModelDrivenApp,
    ResourceType.CodeApp,
    ResourceType.AppBuilderApp,
    ResourceType.CloudFlow,
    ResourceType.AgentFlow,
    ResourceType.WorkflowAgentFlow,
    ResourceType.CopilotStudioAgent,
  ].map((t) => `'${t}'`);

  const clauses: Clause[] = [
    where("type", "in~", resourceTypes),
    where("properties.environmentId", "==", [`'${envId}'`]),
    orderBy({ "tostring(properties.lastModifiedAt)": "desc" }),
  ];

  const res = await runQueryAllPages(clauses);
  if (!res.ok) return res;
  return { ok: true, data: res.data.map(toResourceRow) };
}

/** Count of each resource type living inside a specific environment. */
export async function countResourcesByTypeForEnvironment(
  envId: string
): Promise<DataResult<ResourceCountRow[]>> {
  const resourceTypes = [
    ResourceType.CanvasApp,
    ResourceType.ModelDrivenApp,
    ResourceType.CodeApp,
    ResourceType.AppBuilderApp,
    ResourceType.CloudFlow,
    ResourceType.AgentFlow,
    ResourceType.WorkflowAgentFlow,
    ResourceType.CopilotStudioAgent,
  ].map((t) => `'${t}'`);

  const clauses: Clause[] = [
    where("type", "in~", resourceTypes),
    where("properties.environmentId", "==", [`'${envId}'`]),
    summarize("count", "resourceCount", ["type"]),
    orderBy({ resourceCount: "desc" }),
  ];

  const res = await runQueryAllPages(clauses);
  if (!res.ok) return res;

  return {
    ok: true,
    data: res.data.map((item) => {
      const raw = item as unknown as Record<string, unknown>;
      const props = (item.properties ?? {}) as Record<string, unknown>;
      const countVal = raw.resourceCount ?? props.resourceCount ?? 0;
      return {
        type: (raw.type as string) ?? (props.type as string) ?? "",
        count: typeof countVal === "number" ? countVal : Number(countVal) || 0,
      };
    }),
  };
}

/**
 * For a given environment group, returns the count of each resource type
 * across all environments in that group. Uses an inner-join against the
 * environments table to scope by `environmentGroupId`, then summarizes by
 * `type`.
 */
export async function countResourcesByTypeForGroup(
  groupId: string
): Promise<DataResult<ResourceCountRow[]>> {
  const resourceTypes = [
    ResourceType.CanvasApp,
    ResourceType.ModelDrivenApp,
    ResourceType.CodeApp,
    ResourceType.CloudFlow,
    ResourceType.AgentFlow,
    ResourceType.CopilotStudioAgent,
  ].map((t) => `'${t}'`);

  const clauses: Clause[] = [
    where("type", "in~", resourceTypes),
    extend("joinKey", "tolower(tostring(properties.environmentId))"),
    asClause({
      $type: "join",
      JoinKind: "inner",
      LeftColumnName: "joinKey",
      RightColumnName: "joinKey",
      RightTable: {
        TableName: TABLE,
        Clauses: [
          where("type", "==", [`'${ResourceType.Environment}'`]),
          where("properties.environmentGroupId", "==", [`'${groupId}'`]),
          project(["joinKey = tolower(name)"]),
        ],
      },
    }),
    summarize("count", "resourceCount", ["type"]),
    orderBy({ resourceCount: "desc" }),
  ];

  const res = await runQueryAllPages(clauses);
  if (!res.ok) return res;

  // Summarize results come back as records whose grouping fields land on
  // the row itself; `resourceCount` may show up at the top level or inside
  // `properties`. Read both, tolerantly.
  return {
    ok: true,
    data: res.data.map((item) => {
      const raw = item as unknown as Record<string, unknown>;
      const props = (item.properties ?? {}) as Record<string, unknown>;
      const countVal = raw.resourceCount ?? props.resourceCount ?? 0;
      return {
        type: (raw.type as string) ?? (props.type as string) ?? "",
        count: typeof countVal === "number" ? countVal : Number(countVal) || 0,
      };
    }),
  };
}

/** Map a raw inventory type string to a friendly label. */
export function friendlyResourceType(type: string): string {
  switch (type) {
    case ResourceType.CanvasApp:
      return "Canvas apps";
    case ResourceType.ModelDrivenApp:
      return "Model-driven apps";
    case ResourceType.CodeApp:
      return "Code apps";
    case ResourceType.AppBuilderApp:
      return "App Builder apps";
    case ResourceType.CloudFlow:
      return "Cloud flows";
    case ResourceType.AgentFlow:
      return "Agent flows";
    case ResourceType.WorkflowAgentFlow:
      return "Workflow agent flows";
    case ResourceType.CopilotStudioAgent:
      return "Copilot Studio agents";
    case ResourceType.Environment:
      return "Environments";
    case ResourceType.EnvironmentGroup:
      return "Environment groups";
    default:
      return type;
  }
}

/** Short label for inline use (e.g. table cells). */
export function shortResourceType(type: string): string {
  switch (type) {
    case ResourceType.CanvasApp:
      return "Canvas app";
    case ResourceType.ModelDrivenApp:
      return "Model-driven app";
    case ResourceType.CodeApp:
      return "Code app";
    case ResourceType.AppBuilderApp:
      return "App";
    case ResourceType.CloudFlow:
      return "Cloud flow";
    case ResourceType.AgentFlow:
      return "Agent flow";
    case ResourceType.WorkflowAgentFlow:
      return "Workflow agent flow";
    case ResourceType.CopilotStudioAgent:
      return "Copilot Studio agent";
    default:
      return type;
  }
}

// ---------------------------------------------------------------------------
// Apps / Flows / Agents — server-paginated, server-filtered
// ---------------------------------------------------------------------------

function toAppRow(item: ResourceItem): AppRow {
  const raw = item as unknown as Record<string, unknown>;
  return {
    id: item.name ?? "",
    type: item.type ?? "",
    displayName: propStr(item, "displayName"),
    environmentId: propStr(item, "environmentId"),
    environmentName: propStr(item, "environmentName"),
    ownerId: propStr(item, "ownerId") || propNestedStr(item, "owner", "id"),
    ownerDisplayName: ownerDisplayName(item),
    createdAt: propStr(item, "createdAt"),
    createdBy: propStr(item, "createdBy") || propNestedStr(item, "createdBy", "displayName"),
    lastModifiedAt: propStr(item, "lastModifiedAt"),
    lastModifiedBy:
      propStr(item, "lastModifiedBy") || propNestedStr(item, "lastModifiedBy", "displayName"),
    lastLaunchedAt: propStr(item, "lastLaunchedTime") || propStr(item, "lastLaunchedAt"),
    appType: propStr(item, "appType"),
    subType: propStr(item, "subType"),
    region: item.location ?? "",
    tenantId: (raw.tenantId as string) ?? "",
    isFeatured: propBool(item, "isFeaturedApp") || propBool(item, "isFeatured"),
    bypassConsent: propBool(item, "bypassConsent"),
    isQuarantined: propBool(item, "isQuarantined"),
    sharedUsersCount: propNum(item, "sharedUsersCount"),
    sharedGroupsCount: propNum(item, "sharedGroupsCount"),
    logicalName: propStr(item, "logicalName"),
    appModuleId: propStr(item, "appModuleId"),
    connectors: readConnectors(item),
  };
}

function toFlowRow(item: ResourceItem): FlowRow {
  const raw = item as unknown as Record<string, unknown>;
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const triggerObj = props.trigger;
  let trigger: FlowTrigger | null = null;
  if (triggerObj && typeof triggerObj === "object") {
    const t = triggerObj as Record<string, unknown>;
    trigger = {
      operationId: typeof t.operationId === "string" ? t.operationId : "",
      connectorId: typeof t.connectorId === "string" ? t.connectorId : "",
      connectorDisplayName:
        typeof t.connectorDisplayName === "string" ? t.connectorDisplayName : "",
      operationDisplayName:
        typeof t.operationDisplayName === "string" ? t.operationDisplayName : "",
    };
  }
  // `status` is the canonical flow run-state field in the inventory schema.
  // `state` / `flowState` are older or alternate names — kept as fallback.
  const status =
    propStr(item, "status") || propStr(item, "state") || propStr(item, "flowState");
  return {
    id: item.name ?? "",
    type: item.type ?? "",
    displayName: propStr(item, "displayName"),
    environmentId: propStr(item, "environmentId"),
    environmentName: propStr(item, "environmentName"),
    ownerId: propStr(item, "ownerId") || propNestedStr(item, "owner", "id"),
    ownerDisplayName: ownerDisplayName(item),
    state: status,
    status,
    createdAt: propStr(item, "createdAt"),
    createdBy: propStr(item, "createdBy") || propNestedStr(item, "createdBy", "displayName"),
    lastModifiedAt: propStr(item, "lastModifiedAt"),
    lastModifiedBy:
      propStr(item, "lastModifiedBy") || propNestedStr(item, "lastModifiedBy", "displayName"),
    region: item.location ?? "",
    tenantId: (raw.tenantId as string) ?? "",
    flowTriggerType: propStr(item, "flowTriggerType"),
    trigger,
    workflowEntityId: propStr(item, "workflowEntityId"),
    connectors: readConnectors(item),
  };
}

function toAgentRow(item: ResourceItem): AgentRow {
  const raw = item as unknown as Record<string, unknown>;
  return {
    id: item.name ?? "",
    type: item.type ?? "",
    displayName: propStr(item, "displayName"),
    schemaName: propStr(item, "schemaName"),
    environmentId: propStr(item, "environmentId"),
    environmentName: propStr(item, "environmentName"),
    ownerId: propStr(item, "ownerId") || propNestedStr(item, "owner", "id"),
    ownerDisplayName: ownerDisplayName(item),
    createdAt: propStr(item, "createdAt"),
    createdBy: propStr(item, "createdBy") || propNestedStr(item, "createdBy", "displayName"),
    lastPublishedAt: propStr(item, "lastPublishedAt"),
    region: item.location ?? "",
    tenantId: (raw.tenantId as string) ?? "",
    // Identity / wiring
    entraAppId: propStr(item, "entraAppId"),
    titleId: propStr(item, "titleId"),
    createdIn: propStr(item, "createdIn"),
    authentication: propStr(item, "authentication"),
    // Behavior
    orchestration: propStr(item, "orchestration"),
    model: propStr(item, "model"),
    instructionsCharactersCount: propNum(item, "instructionsCharactersCount"),
    isWebSearchEnabledForKnowledge: propBool(item, "isWebSearchEnabledForKnowledge"),
    // Distribution
    channels: propStrArray(item, "channels"),
    sharedWithEditors: {
      userCount: propNestedNum(item, "sharedWithEditors", "userCount"),
      groupCount: propNestedNum(item, "sharedWithEditors", "groupCount"),
      entireTenant: propNestedBool(item, "sharedWithEditors", "entireTenant"),
    },
    sharedWithViewers: {
      userCount: propNestedNum(item, "sharedWithViewers", "userCount"),
      groupCount: propNestedNum(item, "sharedWithViewers", "groupCount"),
      entireTenant: propNestedBool(item, "sharedWithViewers", "entireTenant"),
    },
    // Governance
    isManaged: propBool(item, "isManaged"),
    isQuarantined: propBool(item, "isQuarantined"),
    // Roll-up counts (capabilitiesCounts is a nested object)
    distinctConnectors: propNestedNum(item, "capabilitiesCounts", "distinctPowerPlatformConnectors"),
    distinctConnectorOperations: propNestedNum(
      item,
      "capabilitiesCounts",
      "distinctPowerPlatformConnectorsOperations"
    ),
    connectors: readConnectors(item),
  };
}

/** Build common where/orderBy clauses for a resource listing.
 *  - typeList: which `type` values to include (single or multiple). Required.
 *  - environmentId: optional scope to one environment.
 *  - extraWhere: e.g. state filter for flows.
 *  - nameContains: server-side substring match on properties.displayName.
 */
function buildListClauses(opts: {
  typeList: ResourceTypeValue[];
  environmentId?: string;
  nameContains?: string;
  extraWhere?: Clause[];
  orderField?: string; // default tostring(properties.lastModifiedAt) desc
}): Clause[] {
  const clauses: Clause[] = [];

  if (opts.typeList.length === 1) {
    clauses.push(where("type", "==", [`'${opts.typeList[0]}'`]));
  } else {
    clauses.push(where("type", "in~", opts.typeList.map((t) => `'${t}'`)));
  }

  if (opts.environmentId) {
    clauses.push(where("properties.environmentId", "==", [`'${opts.environmentId}'`]));
  }

  if (opts.extraWhere?.length) {
    clauses.push(...opts.extraWhere);
  }

  if (opts.nameContains && opts.nameContains.trim() !== "") {
    // `contains` is case-insensitive substring. The value MUST be wrapped in
    // single quotes — without them ARG tries to resolve the bare token as a
    // column name and fails with `Operator_FailedToResolveEntity`. Embedded
    // single-quotes are escaped per KQL convention (double them).
    const escaped = opts.nameContains.trim().replace(/'/g, "''");
    clauses.push(where("properties.displayName", "contains", [`'${escaped}'`]));
  }

  const orderField = opts.orderField ?? "tostring(properties.lastModifiedAt)";
  clauses.push(orderBy({ [orderField]: "desc" }));

  return clauses;
}

/** A single page of apps under the given filters. Pass `skip` = number of
 *  rows already loaded as a safety net for connectors that don't honor
 *  `SkipToken` reliably (we've seen page 1 silently re-returned otherwise). */
export async function listAppsPage(
  filters: AppFilters,
  skipToken?: string,
  pageSize = 500,
  skip = 0
): Promise<DataResult<{ rows: AppRow[]; skipToken?: string; totalRecords: number }>> {
  const typeList = filters.types && filters.types.length > 0 ? filters.types : ALL_APP_TYPES;
  const clauses = buildListClauses({
    typeList,
    environmentId: filters.environmentId,
    nameContains: filters.nameContains,
  });
  const res = await runQuery(clauses, { Top: pageSize, Skip: skip, SkipToken: skipToken ?? "" });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      rows: res.data.items.map(toAppRow),
      skipToken: res.data.skipToken,
      totalRecords: res.data.totalRecords,
    },
  };
}

export async function getApp(appId: string): Promise<DataResult<{ row: AppRow; raw: ResourceItem } | null>> {
  const clauses: Clause[] = [
    where("type", "in~", ALL_APP_TYPES.map((t) => `'${t}'`)),
    where("name", "==", [`'${appId}'`]),
    take(1),
  ];
  const res = await runQuery(clauses, { Top: 1, Skip: 0, SkipToken: "" });
  if (!res.ok) return res;
  const item = res.data.items[0];
  return { ok: true, data: item ? { row: toAppRow(item), raw: item } : null };
}

/** A single page of flows under the given filters. Pass `skip` = number of
 *  rows already loaded as a safety net for connectors that don't honor
 *  `SkipToken` reliably. */
export async function listFlowsPage(
  filters: FlowFilters,
  skipToken?: string,
  pageSize = 500,
  skip = 0
): Promise<DataResult<{ rows: FlowRow[]; skipToken?: string; totalRecords: number }>> {
  const typeList = filters.types && filters.types.length > 0 ? filters.types : ALL_FLOW_TYPES;
  const extraWhere: Clause[] = [];
  if (filters.status) {
    // Inventory uses `properties.status` for cloud flows ("Activated", "Suspended", …).
    extraWhere.push(where("properties.status", "==", [`'${filters.status}'`]));
  }
  if (filters.flowTriggerType) {
    extraWhere.push(
      where("properties.flowTriggerType", "==", [`'${filters.flowTriggerType}'`])
    );
  }
  const clauses = buildListClauses({
    typeList,
    environmentId: filters.environmentId,
    nameContains: filters.nameContains,
    extraWhere,
  });
  const res = await runQuery(clauses, { Top: pageSize, Skip: skip, SkipToken: skipToken ?? "" });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      rows: res.data.items.map(toFlowRow),
      skipToken: res.data.skipToken,
      totalRecords: res.data.totalRecords,
    },
  };
}

export async function getFlow(flowId: string): Promise<DataResult<{ row: FlowRow; raw: ResourceItem } | null>> {
  const clauses: Clause[] = [
    where("type", "in~", ALL_FLOW_TYPES.map((t) => `'${t}'`)),
    where("name", "==", [`'${flowId}'`]),
    take(1),
  ];
  const res = await runQuery(clauses, { Top: 1, Skip: 0, SkipToken: "" });
  if (!res.ok) return res;
  const item = res.data.items[0];
  return { ok: true, data: item ? { row: toFlowRow(item), raw: item } : null };
}

/** A single page of Copilot Studio agents under the given filters. Pass
 *  `skip` = number of rows already loaded so paging keeps advancing even
 *  when the connector ignores `SkipToken`. */
export async function listAgentsPage(
  filters: AgentFilters,
  skipToken?: string,
  pageSize = 500,
  skip = 0
): Promise<DataResult<{ rows: AgentRow[]; skipToken?: string; totalRecords: number }>> {
  const clauses = buildListClauses({
    typeList: [ResourceType.CopilotStudioAgent],
    environmentId: filters.environmentId,
    nameContains: filters.nameContains,
    // Agents don't carry `lastModifiedAt`; use `lastPublishedAt` so the
    // default sort actually means something. Falls back to nulls last in KQL.
    orderField: "tostring(properties.lastPublishedAt)",
  });
  const res = await runQuery(clauses, { Top: pageSize, Skip: skip, SkipToken: skipToken ?? "" });
  if (!res.ok) return res;
  const rows = res.data.items.map(toAgentRow);
  await backfillEnvironmentNames(rows);
  return {
    ok: true,
    data: {
      rows,
      skipToken: res.data.skipToken,
      totalRecords: res.data.totalRecords,
    },
  };
}

export async function getAgent(agentId: string): Promise<DataResult<{ row: AgentRow; raw: ResourceItem } | null>> {
  const clauses: Clause[] = [
    where("type", "==", [`'${ResourceType.CopilotStudioAgent}'`]),
    where("name", "==", [`'${agentId}'`]),
    take(1),
  ];
  const res = await runQuery(clauses, { Top: 1, Skip: 0, SkipToken: "" });
  if (!res.ok) return res;
  const item = res.data.items[0];
  if (!item) return { ok: true, data: null };
  const row = toAgentRow(item);
  await backfillEnvironmentNames([row]);
  return { ok: true, data: { row, raw: item } };
}

// ---------------------------------------------------------------------------
// Custom query builder
//
// The connector consumes a structured `Clauses[]` payload (not free-form KQL
// text). This section exposes the primitives the Queries view uses to let
// users assemble queries visually, plus a curated set of starter templates.
// ---------------------------------------------------------------------------

export type QueryFilterOp =
  | "=="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "contains"
  | "startswith"
  | "endswith"
  | "in~"
  | "has"
  | "has_any"
  | "lastNdays";

export interface QueryFilter {
  field: string;
  op: QueryFilterOp;
  value: string;
}

export interface QuerySpec {
  resourceTypes: ResourceTypeValue[];
  filters: QueryFilter[];
  orderField: string;
  orderDirection: "asc" | "desc";
  limit: number;
}

export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  spec: QuerySpec;
}

// ---------------------------------------------------------------------------
// Sentinel field paths for "smart" filters.
//
// Inventory declares connector usage in three different shapes (see
// docs/inventory-schema-samples.md):
//   - canvas / cloud-flow / agent: properties.powerPlatformConnectors[].connectorId
//   - app-builder apps:            properties.connectors[].connectorId   (ARM path)
//   - cloud-flow trigger:          properties.trigger.connectorId
//
// Each is an array of objects (or a nested object). Naïve `==` won't work;
// `mv-expand` isn't in the Clause builder; so the helper below extends a
// flattened string column once per query and emits a tokenised `has`
// against it. That single clause covers all four locations.
// ---------------------------------------------------------------------------

/** Sentinel field path that triggers the "any-location connector" filter. */
export const CONNECTOR_FIELD = "__connector";
/** Sentinel field path that triggers the "any-location operation" filter. */
export const OPERATION_FIELD = "__operation";
/** Name of the synthesised KQL column the sentinel filters search against. */
const CONNECTOR_BAG_FIELD = "__connectorBag";

/** True if `field` is one of the smart-filter sentinels above. */
export function isSentinelField(field: string): boolean {
  return field === CONNECTOR_FIELD || field === OPERATION_FIELD;
}

/** Friendly label for sentinel field paths; passes other values through. */
export function friendlyFilterField(field: string): string {
  if (field === CONNECTOR_FIELD)
    return "Connector (any location)";
  if (field === OPERATION_FIELD)
    return "Operation (any location)";
  return field;
}

/** Smart value formatter:
 *  - `true` / `false` → KQL bool literal (unquoted).
 *  - Numeric strings → number literal (unquoted).
 *  - Everything else → single-quoted string; embedded quotes doubled. */
function quoteSmart(v: string): string {
  const trimmed = v.trim();
  if (!trimmed) return "";
  if (trimmed === "true" || trimmed === "false") return trimmed;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}

function formatFilterValues(value: string, op: QueryFilterOp): string[] {
  if (op === "in~" || op === "has_any") {
    return value
      .split(",")
      .map((s) => quoteSmart(s))
      .filter((s) => s.length > 0);
  }
  const q = quoteSmart(value);
  return q ? [q] : [];
}

/** Translate a single user-facing filter into 0..2 connector clauses.
 *  Sentinel fields (CONNECTOR_FIELD / OPERATION_FIELD) expand into an
 *  `extend` shim plus a `has` against the synthesised string column; we
 *  emit the shim at most once per query by tracking `emittedExtends`.
 *
 *  Operator translation for sentinel fields:
 *    `==`  → `has`     (tokenised; respects word boundaries)
 *    `!=`  → `!has`
 *    `in~` → `has_any` (value is split on commas)
 *  Anything else (`contains`, `startswith`, `endswith`, `has`, `has_any`)
 *  passes through unchanged.
 */
function translateFilter(
  f: QueryFilter,
  emittedExtends: Set<string>
): Clause[] {
  const field = f.field.trim();
  if (!field) return [];

  // "in last N days" is special: emit a raw KQL `ago(Nd)` on the right side.
  if (f.op === "lastNdays") {
    const n = Math.max(1, Math.floor(Number(f.value) || 0));
    if (!n) return [];
    return [where(field, ">", [`ago(${n}d)`])];
  }

  if (isSentinelField(field)) {
    const vals = formatFilterValues(f.value, f.op);
    if (vals.length === 0) return [];

    const op =
      f.op === "==" ? "has" :
      f.op === "!=" ? "!has" :
      f.op === "in~" ? "has_any" :
      f.op;

    const out: Clause[] = [];
    if (!emittedExtends.has(CONNECTOR_BAG_FIELD)) {
      emittedExtends.add(CONNECTOR_BAG_FIELD);
      out.push(
        extend(
          CONNECTOR_BAG_FIELD,
          // Concatenate every place connector / op IDs can live so a single
          // `has` finds them whether the resource is a canvas app, flow,
          // agent, or app-builder app.
          "strcat(tostring(properties.powerPlatformConnectors),'|'," +
            "tostring(properties.connectors),'|'," +
            "tostring(properties.trigger))"
        )
      );
    }
    out.push(where(CONNECTOR_BAG_FIELD, op, vals));
    return out;
  }

  const vals = formatFilterValues(f.value, f.op);
  if (vals.length === 0) return [];
  return [where(field, f.op, vals)];
}

/** Translate a user-facing QuerySpec into the connector's `Clauses[]` shape. */
export function buildClausesFromSpec(spec: QuerySpec): Clause[] {
  const clauses: Clause[] = [];

  if (spec.resourceTypes.length === 1) {
    clauses.push(where("type", "==", [`'${spec.resourceTypes[0]}'`]));
  } else if (spec.resourceTypes.length > 1) {
    clauses.push(
      where(
        "type",
        "in~",
        spec.resourceTypes.map((t) => `'${t}'`)
      )
    );
  }

  const emittedExtends = new Set<string>();
  for (const f of spec.filters) {
    for (const c of translateFilter(f, emittedExtends)) {
      clauses.push(c);
    }
  }

  if (spec.orderField.trim()) {
    const field = spec.orderField.trim();
    // ARG rejects orderby on dynamic columns (`properties.*`) without an
    // explicit cast. tostring works for the common string/datetime cases.
    const key = field.startsWith("properties.") ? `tostring(${field})` : field;
    clauses.push(orderBy({ [key]: spec.orderDirection }));
  }

  // NOTE: We intentionally do NOT push a `take(limit)` clause here.
  // `spec.limit` is the *page size* (Top), used by the runRawQuery options.
  // Adding `take` truncates the result set inside the query, which also
  // caps `totalRecords` to that number — so the UI lies about the real
  // tenant-wide total. Leaving `take` off means totalRecords reflects the
  // full count and the user can `Load more` past the first page.

  return clauses;
}

/** Run an arbitrary `Clauses[]` payload. Thin public wrapper around the
 *  internal `runQuery`, exposed for the Queries view. */
export async function runRawQuery(
  clauses: Clause[],
  options?: { Top?: number; Skip?: number; SkipToken?: string },
  cacheOpts?: RunQueryOpts
): Promise<
  DataResult<{ items: ResourceItem[]; totalRecords: number; skipToken?: string }>
> {
  return runQuery(
    clauses,
    {
      Top: options?.Top ?? 100,
      Skip: options?.Skip ?? 0,
      SkipToken: options?.SkipToken ?? "",
    },
    cacheOpts
  );
}

/** Curated starter queries. Each populates the builder; the user can tweak
 *  the spec and re-run. */
export const QUERY_TEMPLATES: QueryTemplate[] = [
  {
    id: "recent-canvas",
    name: "Recently modified Canvas apps",
    description: "Most-recently touched canvas apps across all environments.",
    spec: {
      resourceTypes: [ResourceType.CanvasApp],
      filters: [],
      orderField: "properties.lastModifiedAt",
      orderDirection: "desc",
      limit: 50,
    },
  },
  {
    id: "quarantined-apps",
    name: "Quarantined apps",
    description: "Any app type flagged isQuarantined = true.",
    spec: {
      resourceTypes: [
        ResourceType.CanvasApp,
        ResourceType.ModelDrivenApp,
        ResourceType.CodeApp,
        ResourceType.AppBuilderApp,
      ],
      filters: [{ field: "properties.isQuarantined", op: "==", value: "true" }],
      orderField: "properties.lastModifiedAt",
      orderDirection: "desc",
      limit: 100,
    },
  },
  {
    id: "active-flows",
    name: "Active cloud flows",
    description: "Cloud flows with status = Activated.",
    spec: {
      resourceTypes: [ResourceType.CloudFlow],
      filters: [{ field: "properties.status", op: "==", value: "Activated" }],
      orderField: "properties.lastModifiedAt",
      orderDirection: "desc",
      limit: 100,
    },
  },
  {
    id: "managed-envs",
    name: "Managed environments",
    description: "Environments enrolled in Managed Environments.",
    spec: {
      resourceTypes: [ResourceType.Environment],
      filters: [{ field: "properties.isManaged", op: "==", value: "true" }],
      orderField: "properties.displayName",
      orderDirection: "asc",
      limit: 200,
    },
  },
  {
    id: "agents-by-model",
    name: "Copilot Studio agents by model",
    description: "All agents sorted by their underlying model.",
    spec: {
      resourceTypes: [ResourceType.CopilotStudioAgent],
      filters: [],
      orderField: "properties.model",
      orderDirection: "asc",
      limit: 100,
    },
  },
  {
    id: "instant-flows",
    name: "Instant cloud flows",
    description: "Cloud flows triggered on-demand (Instant trigger).",
    spec: {
      resourceTypes: [ResourceType.CloudFlow],
      filters: [{ field: "properties.flowTriggerType", op: "==", value: "Instant" }],
      orderField: "properties.lastModifiedAt",
      orderDirection: "desc",
      limit: 100,
    },
  },
];

/** Common field paths shown as suggestions in the field combobox. Users can
 *  still type any path freely (e.g. `properties.subType`).
 *
 *  The first two entries (`CONNECTOR_FIELD`, `OPERATION_FIELD`) are sentinels
 *  that the clause builder expands into a cross-shape `has` filter — see
 *  `translateFilter`. The trailing `properties.powerPlatformConnectors` /
 *  `properties.connectors` paths are exposed as escape hatches for power
 *  users who want to write the raw clause themselves with `has` / `contains`. */
export const COMMON_FIELD_SUGGESTIONS: string[] = [
  CONNECTOR_FIELD,
  OPERATION_FIELD,
  "type",
  "name",
  "location",
  "properties.displayName",
  "properties.environmentId",
  "properties.ownerId",
  "properties.createdAt",
  "properties.createdBy",
  "properties.lastModifiedAt",
  "properties.lastModifiedBy",
  "properties.isQuarantined",
  "properties.isManaged",
  "properties.status",
  "properties.flowTriggerType",
  "properties.appType",
  "properties.subType",
  "properties.publishState",
  "properties.model",
  "properties.orchestration",
  "properties.environmentType",
  "properties.environmentGroup",
  "properties.environmentGroupId",
  "properties.powerPlatformConnectors",
  "properties.connectors",
  "properties.trigger.connectorId",
];

/** All resource types, useful for the multi-select. */
export const ALL_RESOURCE_TYPES: ResourceTypeValue[] = [
  ResourceType.EnvironmentGroup,
  ResourceType.Environment,
  ResourceType.CanvasApp,
  ResourceType.ModelDrivenApp,
  ResourceType.CodeApp,
  ResourceType.AppBuilderApp,
  ResourceType.CloudFlow,
  ResourceType.AgentFlow,
  ResourceType.WorkflowAgentFlow,
  ResourceType.CopilotStudioAgent,
];

/** Friendly short labels for the resource-type chip. */
export function resourceTypeShort(t: ResourceTypeValue): string {
  switch (t) {
    case ResourceType.EnvironmentGroup:
      return "Env group";
    case ResourceType.Environment:
      return "Environment";
    case ResourceType.CanvasApp:
      return "Canvas app";
    case ResourceType.ModelDrivenApp:
      return "Model-driven";
    case ResourceType.CodeApp:
      return "Code app";
    case ResourceType.AppBuilderApp:
      return "App Builder";
    case ResourceType.CloudFlow:
      return "Cloud flow";
    case ResourceType.AgentFlow:
      return "Agent flow";
    case ResourceType.WorkflowAgentFlow:
      return "Workflow agent flow";
    case ResourceType.CopilotStudioAgent:
      return "Copilot Studio agent";
    default:
      return t;
  }
}

/** Server-side group-by-and-count.
 *
 *  Builds: where(spec.types) → where(spec.filters) → extend(g_field) [for dynamic]
 *          → summarize count() by g_field → orderby resourceCount desc → take(topN).
 *
 *  Returns one row per category, regardless of how many resources match
 *  (a tenant with 50,000 canvas apps still only returns 1 row per type bucket).
 *
 *  For dynamic `properties.*` paths the field is first cast/aliased to a
 *  top-level column so KQL can group on it.
 */
export async function runAggregateCount(
  spec: QuerySpec,
  groupBy: string,
  opts: { topN?: number } = {},
  cacheOpts?: RunQueryOpts
): Promise<DataResult<{ name: string; value: number }[]>> {
  if (!groupBy.trim()) {
    return { ok: true, data: [] };
  }
  const clauses: Clause[] = [];

  if (spec.resourceTypes.length === 1) {
    clauses.push(where("type", "==", [`'${spec.resourceTypes[0]}'`]));
  } else if (spec.resourceTypes.length > 1) {
    clauses.push(
      where(
        "type",
        "in~",
        spec.resourceTypes.map((t) => `'${t}'`)
      )
    );
  }

  const emittedAggExtends = new Set<string>();
  for (const f of spec.filters) {
    for (const c of translateFilter(f, emittedAggExtends)) {
      clauses.push(c);
    }
  }

  // For dynamic `properties.*` group keys, extend to a flat alias.
  let groupKey = groupBy.trim();
  if (groupKey.startsWith("properties.")) {
    const alias = "g_" + groupKey.replace(/\./g, "_");
    clauses.push(extend(alias, `tostring(${groupKey})`));
    groupKey = alias;
  }

  clauses.push(summarize("count", "resourceCount", [groupKey]));
  clauses.push(orderBy({ resourceCount: "desc" }));
  if (opts.topN && opts.topN > 0) {
    clauses.push(take(opts.topN));
  }

  const res = await runQuery(clauses, { Top: 500, Skip: 0, SkipToken: "" }, cacheOpts);
  if (!res.ok) return res;

  return {
    ok: true,
    data: res.data.items.map((item) => {
      const raw = item as unknown as Record<string, unknown>;
      const props = (item.properties ?? {}) as Record<string, unknown>;
      const rawName = raw[groupKey] ?? props[groupKey];
      const cv = raw.resourceCount ?? props.resourceCount ?? 0;
      const value = typeof cv === "number" ? cv : Number(cv) || 0;
      const name =
        rawName === undefined || rawName === null || rawName === ""
          ? "(empty)"
          : String(rawName);
      return { name, value };
    }),
  };
}

/** Date fields that show up as suggestions for line-chart tiles. */
export const DATE_FIELD_SUGGESTIONS: string[] = [
  "properties.createdAt",
  "properties.lastModifiedAt",
];

/** Server-side time-series aggregate for trend (line chart) tiles.
 *
 *  Builds: where(spec.types) → where(spec.filters) → where(dateField > ago(Nd))
 *          → extend bucket = startof{day|week|month}(dateField)
 *          → summarize count() by bucket → orderby bucket asc.
 *
 *  Returns one row per bucket present in the lookback window, oldest first.
 *  Empty buckets (no resources in that period) are NOT filled — the renderer
 *  can choose to draw a continuous line by interpolating missing buckets if
 *  desired.
 */
export async function runTimeSeriesAggregate(
  spec: QuerySpec,
  dateField: string,
  bucket: "day" | "week" | "month",
  lookbackDays: number,
  cacheOpts?: RunQueryOpts
): Promise<DataResult<{ date: string; value: number }[]>> {
  const field = dateField.trim();
  if (!field) {
    return { ok: true, data: [] };
  }
  const lookback = Math.max(1, Math.floor(lookbackDays || 90));

  const clauses: Clause[] = [];

  if (spec.resourceTypes.length === 1) {
    clauses.push(where("type", "==", [`'${spec.resourceTypes[0]}'`]));
  } else if (spec.resourceTypes.length > 1) {
    clauses.push(
      where(
        "type",
        "in~",
        spec.resourceTypes.map((t) => `'${t}'`)
      )
    );
  }

  const emittedTrendExtends = new Set<string>();
  for (const f of spec.filters) {
    for (const c of translateFilter(f, emittedTrendExtends)) {
      clauses.push(c);
    }
  }

  // Lookback filter on the date field (raw KQL expression, not quoted).
  clauses.push(where(field, ">", [`ago(${lookback}d)`]));

  // Compute the bucket alias. startofday/week/month coerce to datetime first.
  const bucketFn =
    bucket === "day" ? "startofday" : bucket === "month" ? "startofmonth" : "startofweek";
  const alias = "t_bucket";
  clauses.push(extend(alias, `${bucketFn}(todatetime(${field}))`));

  clauses.push(summarize("count", "resourceCount", [alias]));
  clauses.push(orderBy({ [alias]: "asc" }));

  const res = await runQuery(clauses, { Top: 500, Skip: 0, SkipToken: "" }, cacheOpts);
  if (!res.ok) return res;

  return {
    ok: true,
    data: res.data.items.map((item) => {
      const raw = item as unknown as Record<string, unknown>;
      const props = (item.properties ?? {}) as Record<string, unknown>;
      const rawDate = raw[alias] ?? props[alias];
      const cv = raw.resourceCount ?? props.resourceCount ?? 0;
      const value = typeof cv === "number" ? cv : Number(cv) || 0;
      const date =
        rawDate === undefined || rawDate === null || rawDate === ""
          ? ""
          : String(rawDate);
      return { date, value };
    }),
  };
}
