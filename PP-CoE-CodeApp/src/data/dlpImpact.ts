/**
 * DLP Impact — "if I blocked connector X under policy P today, which
 * apps / flows / agents would break?"
 *
 * Pure data layer (no React). Powers `src/views/DlpImpact.tsx`. Companion
 * to `dlpDiff.ts`, but instead of comparing two policies, this module
 * crosses a single policy against the live inventory.
 *
 * Pipeline:
 *   1. `extractNonBlockedConnectors(policy)` — derive the picker options
 *      from `policy.connectorGroups`. Blocked entries are dropped (the
 *      whole point is to *simulate* blocking something that isn't blocked
 *      today). Custom connectors are dropped for V1 — see the V2 parking
 *      lot in `docs/roadmap.md`.
 *   2. `resolveDlpScope(policy)` — turn the policy's
 *      `environmentType` + `environments[]` into a concrete plan: do we
 *      include, exclude, or hit-all-environments?
 *   3. `queryDlpImpact(policy, connectorSlug)` — run one
 *      `runRawQuery` call (drained across pages) with:
 *        - the eight resource types (apps + flows + agents)
 *        - the `CONNECTOR_FIELD` sentinel filtering by the slug
 *        - the env clause derived from the policy scope
 *      then enrich rows with env display names and detail-page hrefs.
 *
 * No new admin-connector wiring — the existing Power Platform for Admins
 * V2 (`QueryResources`) consent already covers everything here.
 */

import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";
import { policyEnvEntryId } from "./dlpPolicies";
import {
  ALL_RESOURCE_TYPES,
  CONNECTOR_FIELD,
  ResourceType,
  buildClausesFromSpec,
  friendlyConnectorName,
  getEnvironmentNameMap,
  runRawQuery,
  type DataResult,
  type QuerySpec,
  type ResourceTypeValue,
} from "./inventory";
import type {
  Clause,
  ResourceItem,
} from "../generated/models/PowerPlatformforAdminsV2Model";

// ---------------------------------------------------------------------------
// Connector picker
// ---------------------------------------------------------------------------

/** A single connector option for the "what would I block?" picker.
 *
 *  Two shapes:
 *  - `source: "explicit"` — extracted from `policy.connectorGroups` by
 *    `extractNonBlockedConnectors`. Classification is whatever bucket
 *    the policy puts it in (Confidential or General — Blocked entries
 *    are filtered out).
 *  - `source: "default"` — synthesized by
 *    `synthesizeFreeformConnectorOption` for connectors the user types
 *    by hand that aren't explicitly listed. Classification falls
 *    through to the policy's `defaultConnectorsClassification`
 *    (Confidential | General | Blocked). Lets users simulate blocking
 *    *any* connector, not just the ones the policy bothered to
 *    mention by name. */
export interface DlpConnectorOption {
  /** Inventory-shaped slug used by `QueryResources` (e.g. `shared_sql`). */
  id: string;
  /** Friendly label, e.g. "SQL Server". */
  name: string;
  /** Original ARM-path id from the policy
   *  (e.g. `/providers/Microsoft.PowerApps/apis/shared_sql`). Empty for
   *  freeform / default-classified entries. */
  rawId: string;
  /** Current bucket the connector lives in — drives the "before → after" UI. */
  classification: "Confidential" | "General" | "Blocked";
  /** Connector type as reported by the policy. Today: "Microsoft" /
   *  "Custom" / sometimes empty. We exclude Custom from V1; see note. */
  type: string;
  /** Where the classification came from:
   *  - `"explicit"` — listed in `policy.connectorGroups`.
   *  - `"default"` — synthesized from `policy.defaultConnectorsClassification`
   *    because the user typed a slug that isn't explicitly listed. */
  source: "explicit" | "default";
}

/** Strip an ARM-style `.../apis/<connectorSlug>` path down to just
 *  `<connectorSlug>`, matching `inventory.ts#normalizeConnectorId`. Keep
 *  this private and duplicated rather than exporting from inventory — it
 *  is one tiny function and the inventory copy is intentionally internal. */
function normalizeConnectorSlug(rawId: string): string {
  if (!rawId) return "";
  const idx = rawId.lastIndexOf("/");
  return idx >= 0 ? rawId.substring(idx + 1) : rawId;
}

/** True when a connector entry should be treated as custom. The policy
 *  payload exposes `_type` as `"Microsoft"` for first-party and
 *  `"Custom"` for custom connectors; older payloads sometimes ship blank
 *  for first-party, so we only filter when the type is explicitly Custom. */
function isCustomConnector(rawType: string | undefined): boolean {
  return (rawType ?? "").toLowerCase() === "custom";
}

/**
 * Extract picker options from a `PolicyV2`. Returns only first-party
 * connectors that the policy currently classifies as **Confidential**
 * or **General** — i.e. connectors where "block this" is actually a
 * change in posture. Already-Blocked entries and Custom connectors are
 * filtered out. The result is sorted: Confidential first, then General,
 * each group alphabetical by friendly name.
 *
 * The picker still needs to communicate that "everything else" (any
 * connector not explicitly listed) falls through to
 * `defaultConnectorsClassification` — the UI uses
 * `policy.defaultConnectorsClassification` separately for that note.
 */
export function extractNonBlockedConnectors(
  policy: PolicyV2
): DlpConnectorOption[] {
  const out: DlpConnectorOption[] = [];
  const seen = new Set<string>();
  for (const group of policy.connectorGroups ?? []) {
    const classification = group.classification;
    if (classification !== "Confidential" && classification !== "General") {
      continue;
    }
    for (const c of group.connectors ?? []) {
      if (!c.id) continue;
      if (isCustomConnector(c._type)) continue;
      const slug = normalizeConnectorSlug(c.id);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        id: slug,
        name: c.name || friendlyConnectorName(slug),
        rawId: c.id,
        classification,
        type: c._type ?? "",
        source: "explicit",
      });
    }
  }
  out.sort((a, b) => {
    if (a.classification !== b.classification) {
      // Confidential before General — same order Comparator uses visually.
      return a.classification === "Confidential" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Count of connectors in the policy that we exclude from the picker.
 * Used by the UI to render an honest "N hidden" affordance — the user
 * shouldn't wonder why a Blocked connector they see in PPAC isn't in
 * the list.
 */
export interface DlpConnectorExclusionCounts {
  /** Already Blocked — would be a no-op to simulate blocking. */
  blocked: number;
  /** Custom connectors — V1 doesn't match these against inventory. */
  custom: number;
}

export function countExcludedConnectors(
  policy: PolicyV2
): DlpConnectorExclusionCounts {
  let blocked = 0;
  let custom = 0;
  for (const group of policy.connectorGroups ?? []) {
    const isBlocked = group.classification === "Blocked";
    for (const c of group.connectors ?? []) {
      if (!c.id) continue;
      if (isCustomConnector(c._type)) {
        custom++;
        continue;
      }
      if (isBlocked) blocked++;
    }
  }
  return { blocked, custom };
}

/** Reason an entry is hidden from the picker — used to badge each row
 *  in the collapsible "Hidden connectors" panel. A single connector can
 *  only have one reason (Custom takes precedence over Blocked because
 *  the V1 limitation is the more useful explanation). */
export type DlpHiddenReason = "blocked" | "custom";

export interface DlpHiddenConnector {
  /** Inventory slug (e.g. `shared_sql`) or the raw ARM-path tail for
   *  custom connectors that may not normalize cleanly. Always
   *  non-empty. */
  id: string;
  name: string;
  /** Original ARM-path id from the policy. */
  rawId: string;
  /** Why we excluded it. */
  reason: DlpHiddenReason;
  /** Classification bucket the policy currently has the connector in.
   *  Useful when the reason is "custom" — a custom connector can sit
   *  in Confidential/General/Blocked. */
  classification: string;
  /** Raw `_type` from the policy. */
  type: string;
}

/**
 * Return the connectors that `extractNonBlockedConnectors` filters out,
 * with the reason. Sorted blocked-first (more common case), then by
 * name. The two helpers are kept independent so the picker code can
 * stay simple — counts vs. expandable list have different callers.
 */
export function extractHiddenConnectors(
  policy: PolicyV2
): DlpHiddenConnector[] {
  const out: DlpHiddenConnector[] = [];
  const seen = new Set<string>();
  for (const group of policy.connectorGroups ?? []) {
    const classification = group.classification;
    const isBlocked = classification === "Blocked";
    for (const c of group.connectors ?? []) {
      if (!c.id) continue;
      const slug = normalizeConnectorSlug(c.id);
      const key = slug || c.id;
      if (seen.has(key)) continue;
      const custom = isCustomConnector(c._type);
      // Only emit rows we actually hide.
      if (!isBlocked && !custom) continue;
      seen.add(key);
      out.push({
        id: slug || c.id,
        name: c.name || friendlyConnectorName(slug),
        rawId: c.id,
        // Custom wins — it's the more actionable label ("V1 doesn't
        // match this yet" vs "you already blocked this").
        reason: custom ? "custom" : "blocked",
        classification,
        type: c._type ?? "",
      });
    }
  }
  out.sort((a, b) => {
    if (a.reason !== b.reason) {
      return a.reason === "blocked" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Synthesize a `DlpConnectorOption` for a connector the user typed into
 * the picker that isn't explicitly listed in `policy.connectorGroups`.
 *
 * Such a connector falls through to `policy.defaultConnectorsClassification`
 * — that becomes the option's "before" bucket, driving the before → after
 * UI in the result view. Lets users simulate blocking *any* connector,
 * not just the ones the policy bothered to list by name (which matters
 * a lot for policies like `default = General` that only enumerate the
 * Blocked exceptions).
 *
 * The `name` is best-effort: `friendlyConnectorName` for known slugs,
 * the raw slug as a fallback. `rawId` is empty (the policy never
 * mentioned it). `source` is `"default"` so the UI can label the
 * before-bucket as `(default)` to make the inheritance clear.
 */
export function synthesizeFreeformConnectorOption(
  policy: PolicyV2,
  slug: string
): DlpConnectorOption {
  const cls = (policy.defaultConnectorsClassification ?? "General") as
    | "Confidential"
    | "General"
    | "Blocked";
  return {
    id: slug,
    name: friendlyConnectorName(slug) || slug,
    rawId: "",
    classification: cls,
    type: "",
    source: "default",
  };
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/** How we should filter the inventory query for this policy's scope. */
export type DlpScopeMode =
  /** Don't filter on environmentId — every environment is in scope. */
  | "all"
  /** Include only the listed environment ids. */
  | "include"
  /** Include everything *except* the listed environment ids
   *  (applied client-side after the fetch). */
  | "exclude";

export interface DlpResolvedScope {
  mode: DlpScopeMode;
  /** The raw `environments[]` from the policy. May be empty when
   *  `mode === "all"`. */
  envIds: string[];
  /** Original `environmentType` from the policy, preserved for the
   *  scope card so the UI can show "ExceptEnvironments • 3 envs". */
  rawType: string;
}

/**
 * Translate a `PolicyV2.environmentType` (one of `AllEnvironments`,
 * `OnlyEnvironments`, `ExceptEnvironments`, `SingleEnvironment`) into a
 * concrete query strategy.
 *
 * Notes:
 * - `SingleEnvironment` is treated the same as `OnlyEnvironments` with a
 *   one-element list — the connector accepts either shape and the UI
 *   doesn't need to care.
 * - `ExceptEnvironments` is handled client-side. The connector's
 *   query-builder doesn't expose `!in~` through the typed `QueryFilterOp`
 *   union we use elsewhere, and writing a raw clause that may or may not
 *   be honoured by the KQL endpoint is a footgun. Client-side filtering
 *   is straightforward because the query is already narrowed by
 *   connector+type to a small result set.
 *
 * **Env-id normalization**: every entry in `policy.environments[]` is
 * resolved through `policyEnvEntryId` (prefers `name`, falls back to
 * the trailing segment of `id`). This is the same resolver
 * `policyAppliesToEnvironment` uses for the env detail card —
 * required because the connector returns `id` as an ARM path
 * (`/providers/…/environments/<guid>`) but inventory queries match
 * against the bare GUID stored in `properties.environmentId`. Without
 * the normalization, `OnlyEnvironments` policies returned zero
 * impacted resources and `ExceptEnvironments` policies excluded
 * nothing — both silently false.
 */
export function resolveDlpScope(policy: PolicyV2): DlpResolvedScope {
  const rawType = policy.environmentType ?? "AllEnvironments";
  const envIds = (policy.environments ?? [])
    .map(policyEnvEntryId)
    .filter((id) => id.length > 0);

  if (rawType === "AllEnvironments") {
    return { mode: "all", envIds: [], rawType };
  }
  if (rawType === "ExceptEnvironments") {
    return { mode: "exclude", envIds, rawType };
  }
  // OnlyEnvironments | SingleEnvironment
  return { mode: "include", envIds, rawType };
}

// ---------------------------------------------------------------------------
// Query + result shape
// ---------------------------------------------------------------------------

/** Resource types we surface as "potentially impacted" — every app,
 *  flow, and agent shape that can declare a connector reference. We
 *  intentionally exclude `Environment` and `EnvironmentGroup`. */
const IMPACT_RESOURCE_TYPES: ResourceTypeValue[] = ALL_RESOURCE_TYPES.filter(
  (t) => t !== ResourceType.Environment && t !== ResourceType.EnvironmentGroup
);

export interface DlpImpactRow {
  /** Inventory `name` field (resource GUID). */
  id: string;
  /** Inventory `type` field — one of the values in IMPACT_RESOURCE_TYPES. */
  type: ResourceTypeValue;
  displayName: string;
  environmentId: string;
  /** Best-effort display name, resolved through the env-name cache. */
  environmentName: string;
  ownerId: string;
  ownerDisplayName: string;
  lastModifiedAt: string;
  /** Where the row should link to. App-builder, model-driven, canvas and
   *  code apps all share the `/apps/:id` detail page. */
  detailHref: string;
}

export interface DlpImpactSummary {
  totalResources: number;
  byType: Partial<Record<ResourceTypeValue, number>>;
  environmentCount: number;
  ownerCount: number;
}

export interface DlpImpactResult {
  rows: DlpImpactRow[];
  summary: DlpImpactSummary;
  /** Diagnostics. The view shows the connector slug + the resolved env
   *  count so the user can sanity-check the query that just ran. */
  ranAgainst: {
    connectorSlug: string;
    connectorDisplayName: string;
    scope: DlpResolvedScope;
    /** Effective env-id count after applying the scope mode: number of
     *  envs we actually checked. For `mode === "all"` this is "every
     *  environment in the tenant" — surfaced as -1 here so the UI can
     *  show "all". */
    effectiveEnvCount: number;
  };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function readStr(item: ResourceItem, key: string): string {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const v = props[key];
  return typeof v === "string" ? v : "";
}

function readNestedStr(
  item: ResourceItem,
  key: string,
  subKey: string
): string {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const obj = props[key];
  if (obj && typeof obj === "object") {
    const v = (obj as Record<string, unknown>)[subKey];
    if (typeof v === "string") return v;
  }
  return "";
}

function ownerDisplayName(item: ResourceItem): string {
  return (
    readStr(item, "ownerDisplayName") ||
    readNestedStr(item, "owner", "displayName") ||
    readNestedStr(item, "owner", "email") ||
    readNestedStr(item, "createdBy", "displayName") ||
    readStr(item, "ownerId")
  );
}

function detailHrefFor(type: string, id: string): string {
  const safeId = encodeURIComponent(id);
  switch (type) {
    case ResourceType.CanvasApp:
    case ResourceType.ModelDrivenApp:
    case ResourceType.CodeApp:
    case ResourceType.AppBuilderApp:
      return `/apps/${safeId}`;
    case ResourceType.CloudFlow:
    case ResourceType.AgentFlow:
    case ResourceType.WorkflowAgentFlow:
      return `/flows/${safeId}`;
    case ResourceType.CopilotStudioAgent:
      return `/agents/${safeId}`;
    default:
      // Unknown types still render in the table but link nowhere.
      return "";
  }
}

function toImpactRow(item: ResourceItem): DlpImpactRow {
  const type = (item.type ?? "") as ResourceTypeValue;
  const id = item.name ?? "";
  // Agents typically use `lastPublishedAt` instead of `lastModifiedAt`.
  const modified =
    readStr(item, "lastModifiedAt") || readStr(item, "lastPublishedAt");
  return {
    id,
    type,
    displayName: readStr(item, "displayName"),
    environmentId: readStr(item, "environmentId"),
    environmentName: readStr(item, "environmentName"),
    ownerId: readStr(item, "ownerId"),
    ownerDisplayName: ownerDisplayName(item),
    lastModifiedAt: modified,
    detailHref: detailHrefFor(type, id),
  };
}

// ---------------------------------------------------------------------------
// Public query
// ---------------------------------------------------------------------------

/** Page-cap matches `runQueryAllPages` (`25` pages × `500` rows = 12.5k
 *  rows max). A connector + scope filter should never come close to
 *  that, but keeps us defensive against pathological tenants. */
const PAGE_CAP = 25;
const PAGE_SIZE = 500;

/**
 * Run the impact query for a single policy + connector slug. Drains
 * `skipToken` pages, applies the `ExceptEnvironments` filter
 * client-side when needed, backfills env display names, and returns a
 * sorted result with a precomputed summary.
 *
 * Errors propagate as `{ ok: false, error }` — same shape as everything
 * else in `inventory.ts`.
 */
export async function queryDlpImpact(
  policy: PolicyV2,
  connectorSlug: string
): Promise<DataResult<DlpImpactResult>> {
  const slug = connectorSlug.trim();
  if (!slug) {
    return { ok: false, error: "Connector slug is required." };
  }

  const scope = resolveDlpScope(policy);

  // Build the QuerySpec — `buildClausesFromSpec` handles the
  // `CONNECTOR_FIELD` sentinel and the multi-type `in~` filter for us.
  const filters: QuerySpec["filters"] = [];
  if (scope.mode === "include" && scope.envIds.length > 0) {
    filters.push({
      field: "properties.environmentId",
      op: "in~",
      value: scope.envIds.join(","),
    });
  }
  filters.push({ field: CONNECTOR_FIELD, op: "==", value: slug });

  const spec: QuerySpec = {
    resourceTypes: IMPACT_RESOURCE_TYPES,
    filters,
    orderField: "properties.lastModifiedAt",
    orderDirection: "desc",
    limit: PAGE_SIZE,
  };
  const clauses: Clause[] = buildClausesFromSpec(spec);

  // Drain skipToken pages.
  const items: ResourceItem[] = [];
  let skipToken: string | undefined;
  let skip = 0;
  for (let page = 0; page < PAGE_CAP; page++) {
    const res = await runRawQuery(clauses, {
      Top: PAGE_SIZE,
      Skip: skip,
      SkipToken: skipToken ?? "",
    });
    if (!res.ok) return { ok: false, error: res.error };
    items.push(...res.data.items);
    if (!res.data.skipToken) break;
    skipToken = res.data.skipToken;
    skip += res.data.items.length;
  }

  // Apply ExceptEnvironments client-side. `scope.envIds` is already
  // lowercased by `policyEnvEntryId`; lowercase the inventory side too
  // so case-only differences don't sneak past the exclusion.
  let filtered = items;
  if (scope.mode === "exclude" && scope.envIds.length > 0) {
    const excluded = new Set(scope.envIds);
    filtered = items.filter((it) => {
      const envId = readStr(it, "environmentId").toLowerCase();
      return envId && !excluded.has(envId);
    });
  }

  const rows = filtered.map(toImpactRow);

  // Backfill env display names in one shot (the inventory map is cached
  // for 5 minutes, so this is essentially free on repeat runs).
  const needsEnvNames = rows.some(
    (r) => r.environmentId && !r.environmentName
  );
  if (needsEnvNames) {
    const envMap = await getEnvironmentNameMap();
    for (const r of rows) {
      if (r.environmentId && !r.environmentName) {
        const n = envMap.get(r.environmentId);
        if (n) r.environmentName = n;
      }
    }
  }

  rows.sort((a, b) => {
    // Newest-first by lastModifiedAt; tiebreak by displayName for stability.
    if (a.lastModifiedAt !== b.lastModifiedAt) {
      return a.lastModifiedAt < b.lastModifiedAt ? 1 : -1;
    }
    return a.displayName.localeCompare(b.displayName);
  });

  const byType: Partial<Record<ResourceTypeValue, number>> = {};
  const envs = new Set<string>();
  const owners = new Set<string>();
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    if (r.environmentId) envs.add(r.environmentId);
    const ownerKey = r.ownerId || r.ownerDisplayName;
    if (ownerKey) owners.add(ownerKey);
  }

  const summary: DlpImpactSummary = {
    totalResources: rows.length,
    byType,
    environmentCount: envs.size,
    ownerCount: owners.size,
  };

  return {
    ok: true,
    data: {
      rows,
      summary,
      ranAgainst: {
        connectorSlug: slug,
        connectorDisplayName: friendlyConnectorName(slug),
        scope,
        effectiveEnvCount:
          scope.mode === "all" ? -1 : scope.envIds.length,
      },
    },
  };
}
