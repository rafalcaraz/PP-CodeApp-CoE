/**
 * Supplemental admin enrichments — per-record, on-demand admin-scope calls.
 *
 * **What this module is.** A thin, typed wrapper around the
 * Power Platform for Admins V2 connector's *per-record* `Get_*` / `List_*`
 * operations (single environment, single app, role assignments, etc.).
 *
 * **What this module is NOT.** The bulk inventory path. That lives in
 * `./inventory.ts` and uses the connector's `QueryResources` action against
 * the Azure Resource Graph. Inventory powers list views, dashboards, and
 * counts; enrichment powers "tell me everything about THIS one thing"
 * actions on detail pages.
 *
 * **The rule.** Every function here is invoked **only** when a user clicks
 * an explicit "Load admin details" / "Fetch role assignments" / etc.
 * button on a detail page. Never auto-prefetched on mount, never part of
 * the bulk inventory load. See
 * `PP-CoE-CodeApp/docs/admin-connector-inventory.md` for the rationale.
 *
 * **No caching, no throttling here.** Per-record clicks are low-fanout,
 * and the user clicking "Refresh" expects a fresh call. If a future
 * enrichment fans out (e.g. "load role assignments for all 50 envs") we'll
 * add the same kind of slot limiter + TTL cache that `inventory.ts`
 * already uses — but keep it opt-in, not the default for every call.
 */

import { PowerPlatformforAdminsV2Service } from "../generated";
import type {
  EnvironmentGroup,
  EnvironmentResponse,
  MgGovODataResponse,
  Policy,
  PowerApp,
  RoleAssignmentResponse,
  RuleAssignmentsResponse,
} from "../generated/models/PowerPlatformforAdminsV2Model";
import type { DataResult } from "./inventory";

const API_VERSION = "2024-10-01";

/** Best-effort extraction of a human-readable message from anything the
 *  `@microsoft/power-apps` runtime can throw. Mirrors the helper in
 *  `inventory.ts`; intentionally not extracted (yet) to keep this module
 *  self-contained while the enrichment pattern is still being shaped. */
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
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Result of an environment admin-details enrichment.
 *  - `data` is the typed `EnvironmentResponse` shape from the generated model.
 *  - `raw` is the same payload as a plain `unknown` so callers can hand it
 *    straight to `<RawJsonAccordion>` without retyping. The connector's
 *    payload occasionally carries fields the generated model doesn't yet
 *    enumerate; surfacing the raw blob keeps that data accessible. */
export interface EnvironmentAdminDetails {
  data: EnvironmentResponse;
  raw: unknown;
}

/**
 * Fetch the admin-scope detail payload for a single environment.
 *
 * Backed by the connector's `GetEnvironmentByIdForUser` operation. Returns
 * fields not present on the inventory graph row — `state`, `adminMode`,
 * `backgroundOperationsState`, `protectionLevel`, `version`, `url`,
 * `domainName`, `azureRegion`, `dataverseId`, `deletedDateTime`,
 * `retentionDetails`, etc.
 *
 * **On-demand only.** Wire this behind an explicit user action, not a
 * `useEffect`.
 */
export async function getEnvironmentAdminDetails(
  envId: string
): Promise<DataResult<EnvironmentAdminDetails>> {
  if (!envId) return { ok: false, error: "Environment ID is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.GetEnvironmentByIdForUser(
      envId,
      API_VERSION
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const data = result.data ?? {};
    return { ok: true, data: { data, raw: data } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Result of an app admin-details enrichment.
 *  See `EnvironmentAdminDetails` for the rationale on the typed/raw split. */
export interface AppAdminDetails {
  data: PowerApp;
  raw: unknown;
}

/** Resource types for which `Get_AdminApp` is meaningful. The classic
 *  PowerApps admin endpoint covers canvas apps, code apps (canvas under
 *  the hood), and the unified app-builder ("apps") surface. Model-driven
 *  apps live in Dataverse and have no equivalent on this connector — UI
 *  should hide the enrichment card for that type entirely. */
const APP_ADMIN_SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  "microsoft.powerapps/canvasapps",
  "microsoft.powerapps/codeapps",
  "microsoft.powerapps/apps",
]);

/** Whether the given inventory resource type can be enriched by
 *  `getAppAdminDetails`. Lets the UI gate the button without leaking the
 *  list of supported types into every detail page. */
export function isAppAdminDetailsSupported(resourceType: string | undefined): boolean {
  return !!resourceType && APP_ADMIN_SUPPORTED_TYPES.has(resourceType);
}

/**
 * Fetch the admin-scope detail payload for a single Power App.
 *
 * Backed by the connector's `Get_AdminApp` operation. Returns the rich
 * `PowerApp` shape — owner principal, version, launch URI, document URI,
 * device targeting tags, Siena/publisher versions, etc.
 *
 * **Scope.** Only meaningful for canvas / code / app-builder apps; see
 * `isAppAdminDetailsSupported`. Callers should guard *before* calling so
 * model-driven apps don't trigger a hopeless API request.
 *
 * **On-demand only.** Same rule as `getEnvironmentAdminDetails` —
 * wire behind a user click, not a `useEffect`.
 */
export async function getAppAdminDetails(
  environmentId: string,
  appId: string
): Promise<DataResult<AppAdminDetails>> {
  if (!environmentId) return { ok: false, error: "Environment ID is required." };
  if (!appId) return { ok: false, error: "App ID is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.Get_AdminApp(
      environmentId,
      appId,
      API_VERSION
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const data = result.data ?? {};
    return { ok: true, data: { data, raw: data } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

// ─── Environment group enrichments ────────────────────────────────────────
// All four functions below back the four supplemental cards on
// `views/EnvironmentGroupDetail.tsx`. They share the same on-demand
// rule as the env / app enrichments above.

/** Result of `getEnvironmentGroupDetails`. */
export interface EnvironmentGroupAdminDetails {
  data: EnvironmentGroup;
  raw: unknown;
}

/** Result of `getEnvironmentGroupRoleAssignments`. */
export interface EnvironmentGroupRoleAssignmentsResult {
  data: RoleAssignmentResponse;
  raw: unknown;
}

/** Result of `getEnvironmentGroupRulesets` (Model A — `parameters`-bucket
 *  rulesets). The connector has no direct "rulesets for this env group
 *  only" wrap (its `GetRuleSet(envId, groupId)` builds an env-scoped
 *  URL that returns 404 RouteNotFound when used for a group-only
 *  scope). We fall back to `GetRuleSetListForTenant()` and filter
 *  client-side on each ruleset's `environmentFilter.values[]` matching
 *  this group id.
 *
 *  Tenant-wide call is small in practice — most tenants have a handful
 *  of rulesets total. If a tenant shows up where this is slow we can
 *  add server-side `$filter` if the connector supports it. */
export interface EnvironmentGroupRulesetsResult {
  /** Rulesets whose `environmentFilter` mentions this group. */
  matching: MgGovODataResponse;
  /** The complete tenant-wide response. Useful for auditing /
   *  troubleshooting "why isn't ruleset X showing up here?" */
  all: MgGovODataResponse;
  /** Total rulesets returned by the tenant-wide call (before filtering). */
  totalInTenant: number;
  raw: unknown;
}

/** Result of `getEnvironmentGroupEffectivePolicies` (Model B).
 *
 *  The connector has no direct "list policies effective on this env
 *  group" wrap, so this helper fans out internally:
 *
 *  1. `ListRuleAssignmentsByEnvironmentGroupId(groupId, true)` to find
 *     which policy ids apply.
 *  2. `GetRuleBasedPolicyByID(policyId)` per unique policy id, in
 *     parallel.
 *
 *  Result carries both halves so callers can render assignments
 *  alongside policy bodies (e.g. show `ruleSetCount` from the
 *  assignment next to the policy name). Any per-policy fetch errors
 *  are stashed in `policyErrors` keyed by policy id; the overall
 *  result is still `ok: true` as long as the assignment list itself
 *  succeeded. */
export interface EnvironmentGroupEffectivePoliciesResult {
  assignments: RuleAssignmentsResponse;
  policies: Policy[];
  policyErrors: Record<string, string>;
  raw: {
    assignments: unknown;
    policies: Record<string, unknown>;
  };
}

/** Fetch the admin-scope basics for a single env group. Backed by
 *  `GetEnvironmentGroup`. */
export async function getEnvironmentGroupDetails(
  groupId: string
): Promise<DataResult<EnvironmentGroupAdminDetails>> {
  if (!groupId) return { ok: false, error: "Environment group ID is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.GetEnvironmentGroup(
      groupId,
      API_VERSION
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const data = result.data ?? {};
    return { ok: true, data: { data, raw: data } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Fetch the role assignments on an env group. Backed by
 *  `ListEnvironmentGroupRoleAssignments`. */
export async function getEnvironmentGroupRoleAssignments(
  groupId: string
): Promise<DataResult<EnvironmentGroupRoleAssignmentsResult>> {
  if (!groupId) return { ok: false, error: "Environment group ID is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.ListEnvironmentGroupRoleAssignments(
      groupId,
      API_VERSION
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const data = result.data ?? {};
    return { ok: true, data: { data, raw: data } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Fetch the **Model A** (`parameters`-bucket) rulesets effective on an
 *  env group.
 *
 *  **Why the indirect path.** The connector exposes `GetRuleSet(envId,
 *  groupId)` which builds an env-scoped URL
 *  (`/governance/environments/{envId}/environmentGroups/{groupId}/ruleSets`)
 *  — and that URL returns 404 RouteNotFound. The real group-only URL
 *  (`/governance/environmentGroups/{groupId}/ruleSets`) has no direct
 *  connector wrap.
 *
 *  So we use `GetRuleSetListForTenant()` (tenant-wide) and filter
 *  client-side by `environmentFilter.values[]` containing
 *  `{ id: groupId, type: "EnvironmentGroup" }`. Cheap in practice — most
 *  tenants have only a handful of rulesets total.
 *
 *  See `docs/admin-payload-samples.md` for the response shape. */
export async function getEnvironmentGroupRulesets(
  groupId: string
): Promise<DataResult<EnvironmentGroupRulesetsResult>> {
  if (!groupId) return { ok: false, error: "Environment group ID is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.GetRuleSetListForTenant(API_VERSION);
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const all: MgGovODataResponse = result.data ?? {};
    const allRulesets = all.value ?? [];
    const matchingRulesets = allRulesets.filter((rs) => {
      const values = rs.environmentFilter?.values ?? [];
      return values.some((v) => v.id === groupId && v.type === "EnvironmentGroup");
    });
    return {
      ok: true,
      data: {
        matching: { value: matchingRulesets, "@odata.nextLink": all["@odata.nextLink"] },
        all,
        totalInTenant: allRulesets.length,
        raw: all,
      },
    };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Combined result of `getEnvironmentGroupGovernance` — both governance
 *  models in one payload so callers can render a unified "View all
 *  rules" surface.
 *
 *  Each half is its own `DataResult` so a failure in one model doesn't
 *  hide the other. The outer call is `ok: true` whenever we have
 *  *anything* to show; per-section errors render inline alongside the
 *  successful data. */
export interface EnvironmentGroupGovernanceResult {
  rulesets: DataResult<EnvironmentGroupRulesetsResult>;
  policies: DataResult<EnvironmentGroupEffectivePoliciesResult>;
}

/** Fetch both Model A (`getEnvironmentGroupRulesets`) and Model B
 *  (`getEnvironmentGroupEffectivePolicies`) in parallel. */
export async function getEnvironmentGroupGovernance(
  groupId: string
): Promise<DataResult<EnvironmentGroupGovernanceResult>> {
  if (!groupId) return { ok: false, error: "Environment group ID is required." };
  const [rulesets, policies] = await Promise.all([
    getEnvironmentGroupRulesets(groupId),
    getEnvironmentGroupEffectivePolicies(groupId),
  ]);
  // Always `ok: true` at the outer level — per-half failures are
  // surfaced inline so the user sees whatever did succeed.
  return { ok: true, data: { rulesets, policies } };
}

/** Fetch the **Model B** rule-based policies effective on an env group.
 *  No direct connector wrap exists; this fans out internally (see
 *  `EnvironmentGroupEffectivePoliciesResult` doc). */
export async function getEnvironmentGroupEffectivePolicies(
  groupId: string
): Promise<DataResult<EnvironmentGroupEffectivePoliciesResult>> {
  if (!groupId) return { ok: false, error: "Environment group ID is required." };
  try {
    const assignmentsResult =
      await PowerPlatformforAdminsV2Service.ListRuleAssignmentsByEnvironmentGroupId(
        groupId,
        true,
        API_VERSION
      );
    if (!assignmentsResult.success) {
      return { ok: false, error: formatError(assignmentsResult.error) };
    }
    const assignments: RuleAssignmentsResponse = assignmentsResult.data ?? {};
    const policyIds = Array.from(
      new Set(
        (assignments.value ?? [])
          .map((a) => a.policyId)
          .filter((id): id is string => !!id)
      )
    );

    // Parallel per-policy fetch. Few policies per group in practice (1–3
    // is typical for the env-group governance surface), so we're not
    // pulling out the inventory throttle limiter for this. If a tenant
    // shows up with dozens of policies on one group we'll revisit.
    const policyResults = await Promise.all(
      policyIds.map(async (id) => {
        try {
          const r = await PowerPlatformforAdminsV2Service.GetRuleBasedPolicyByID(
            id,
            API_VERSION
          );
          if (!r.success) {
            return { id, ok: false as const, error: formatError(r.error) };
          }
          return { id, ok: true as const, data: r.data ?? ({} as Policy) };
        } catch (err) {
          return { id, ok: false as const, error: formatError(err) };
        }
      })
    );

    const policies: Policy[] = [];
    const policyErrors: Record<string, string> = {};
    const rawPolicies: Record<string, unknown> = {};
    for (const r of policyResults) {
      if (r.ok) {
        policies.push(r.data);
        rawPolicies[r.id] = r.data;
      } else {
        policyErrors[r.id] = r.error;
      }
    }

    return {
      ok: true,
      data: {
        assignments,
        policies,
        policyErrors,
        raw: { assignments, policies: rawPolicies },
      },
    };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
