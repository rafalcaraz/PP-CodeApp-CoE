/**
 * DLP (Data Loss Prevention) policies — narrow wrapper over the legacy
 * Power Platform for Admins connector.
 *
 * **Scope.** Just the two read operations needed today for the DLP
 * Comparator / DLP Analysis mini-apps:
 *   - `listDlpPolicies`   → `ListPoliciesV2`
 *   - `getDlpPolicy(id)`  → `GetPolicyV2`
 *
 * Nothing else is wrapped on purpose. Add more here only when a UI
 * feature actually needs it.
 *
 * **Why a wrapper.** The generated `PowerPlatformforAdminsService` works
 * but is verbose at the call site (raw `IOperationResult` unwrap, opaque
 * error shape). The wrapper:
 *   - returns the same `DataResult<T>` shape every other module here uses
 *   - normalizes connector errors into readable strings
 *   - drains `nextLink` paging so callers always get the full list
 *
 * **Generator note.** The legacy connector's generated TS ships with
 * invalid syntax (hyphenated `api-version` parameter names) and is
 * auto-healed by `scripts/fixup-generated-connectors.mjs` via the
 * `postinstall` hook. See `docs/connector-generator-fixup.md`.
 */

import { PowerPlatformforAdminsService } from "../generated";
import type {
  PolicyV2,
  ResourceArray_PolicyV2,
} from "../generated/models/PowerPlatformforAdminsModel";
import type {
  Policy,
} from "../generated/models/PowerPlatformforAdminsV2Model";
import { getEnvironmentGroupEffectivePolicies } from "./adminEnrichment";
import type { DataResult } from "./inventory";

/** Best-effort error normalization. Mirrors the helper in
 *  `adminEnrichment.ts`; kept local to avoid a circular import while the
 *  shape is still settling. */
function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (typeof e.requestId === "string" && e.requestId)
      parts.push(`requestId ${e.requestId}`);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Pull a `$skiptoken` value out of a `nextLink` URL the connector returns.
 *  The connector emits absolute URLs whose query string carries the token
 *  the next request needs. Anything else (no query, no token) ends paging. */
function extractSkipToken(nextLink: string | undefined): string | undefined {
  if (!nextLink) return undefined;
  try {
    const url = new URL(nextLink);
    return url.searchParams.get("$skiptoken") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch a single DLP policy by id.
 *
 * Backed by the legacy connector's `GetPolicyV2` operation. The `policy`
 * argument is the policy GUID (the `name` field on `PolicyV2`).
 *
 * The returned `PolicyV2` includes:
 *   - `defaultConnectorsClassification` — catch-all bucket for connectors
 *     not explicitly listed (`"Confidential" | "General" | "Blocked"`)
 *   - `connectorGroups[]` — explicit per-bucket connector membership
 *   - `environmentType` + `environments[]` — scoping (`AllEnvironments`,
 *     `OnlyEnvironments`, `ExceptEnvironments`, `SingleEnvironment`)
 *   - `isLegacySchemaVersion` — true for old-shape policies that don't
 *     surface rule-based-policy data
 */
export async function getDlpPolicy(
  policyId: string
): Promise<DataResult<PolicyV2>> {
  if (!policyId) return { ok: false, error: "Policy id is required." };
  try {
    const result = await PowerPlatformforAdminsService.GetPolicyV2(policyId);
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    if (!result.data) {
      return { ok: false, error: "Connector returned no policy data." };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/**
 * Fetch *all* DLP policies the caller can access, draining `nextLink`
 * pages from the connector. Use this for the DLP Comparator picker /
 * inventory-style screens where you need the full set; if you ever need
 * a single page (e.g. infinite-scroll UI), expose `listDlpPoliciesPage`
 * separately rather than overloading this function.
 *
 * `top` is forwarded to the connector as `$top` per page and defaults to
 * the connector's own default when omitted.
 */
export async function listDlpPolicies(
  opts: { top?: number } = {}
): Promise<DataResult<PolicyV2[]>> {
  const acc: PolicyV2[] = [];
  let skiptoken: string | undefined;
  try {
    do {
      const result = await PowerPlatformforAdminsService.ListPoliciesV2(
        undefined,
        skiptoken,
        opts.top
      );
      if (!result.success) {
        return { ok: false, error: formatError(result.error) };
      }
      const page: ResourceArray_PolicyV2 = result.data ?? {};
      if (page.value?.length) acc.push(...page.value);
      skiptoken = extractSkipToken(page.nextLink);
    } while (skiptoken);
    return { ok: true, data: acc };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

// ---------------------------------------------------------------------------
// Scope predicate + per-environment coverage
// ---------------------------------------------------------------------------

/** Why a policy applies (or doesn't) to a specific environment.
 *
 *  - `all`          → policy targets every environment in the tenant
 *                     (`environmentType === "AllEnvironments"`).
 *  - `included`     → policy's `environments[]` explicitly lists this
 *                     env (`OnlyEnvironments` or `SingleEnvironment`).
 *  - `not-excluded` → policy is `ExceptEnvironments` and this env is
 *                     **not** in the excluded list, so it still applies.
 *  - `none`         → policy does not apply. */
export type DlpScopeMatchReason =
  | "all"
  | "included"
  | "not-excluded"
  | "none";

export interface DlpScopeMatch {
  applies: boolean;
  reason: DlpScopeMatchReason;
}

/**
 * Pure predicate: does `policy` apply to the environment with id
 * `envId`? Kept free of any IO so it can be reused in tests, in the
 * DLP Impact picker, and in any future coverage UI.
 *
 * Treats unknown / missing `environmentType` as `AllEnvironments`
 * (the connector default), matching how PPAC interprets a blank
 * scope field.
 */
export function policyAppliesToEnvironment(
  policy: PolicyV2,
  envId: string
): DlpScopeMatch {
  if (!envId) return { applies: false, reason: "none" };
  const type = policy.environmentType || "AllEnvironments";
  if (type === "AllEnvironments") {
    return { applies: true, reason: "all" };
  }
  const ids = new Set(
    (policy.environments ?? [])
      .map((e) => e.id)
      .filter((id): id is string => Boolean(id))
  );
  if (type === "OnlyEnvironments" || type === "SingleEnvironment") {
    return ids.has(envId)
      ? { applies: true, reason: "included" }
      : { applies: false, reason: "none" };
  }
  if (type === "ExceptEnvironments") {
    return ids.has(envId)
      ? { applies: false, reason: "none" }
      : { applies: true, reason: "not-excluded" };
  }
  // Unknown / future scope type — be conservative and say it does not
  // apply rather than fabricate coverage.
  return { applies: false, reason: "none" };
}

/** One row in the per-environment DLP coverage list. */
export interface DlpPolicyCoverage {
  policy: PolicyV2;
  reason: DlpScopeMatchReason;
}

/**
 * Returns every DLP policy that targets the given environment, with
 * the reason it matched. Drains `listDlpPolicies` once and filters
 * client-side — there is no per-env query on the connector. Result is
 * sorted by display name for stable rendering.
 *
 * On-demand only: this is meant to back a "Load DLP policy coverage"
 * button on the environment detail page, not be called as part of
 * inventory boot.
 */
export async function getApplicableDlpPolicies(
  envId: string
): Promise<DataResult<DlpPolicyCoverage[]>> {
  if (!envId) {
    return { ok: false, error: "Environment id is required." };
  }
  const all = await listDlpPolicies();
  if (!all.ok) return all;
  const rows: DlpPolicyCoverage[] = [];
  for (const policy of all.data) {
    const m = policyAppliesToEnvironment(policy, envId);
    if (m.applies) rows.push({ policy, reason: m.reason });
  }
  rows.sort((a, b) =>
    (a.policy.displayName || "").localeCompare(b.policy.displayName || "")
  );
  return { ok: true, data: rows };
}

// ---------------------------------------------------------------------------
// Application Control Policy (ACP) detection on an environment group
// ---------------------------------------------------------------------------

/** Rule id for the "Advanced connector policies" rule that, when
 *  present on an env group, signals ACPs are configured. See
 *  `docs/governance-rules-catalog.md` → `ConnectorManagement`. The
 *  rule's `inputs.AllowedConnectorList[]` carries the per-connector
 *  config. */
const ACP_RULE_ID_KNOWN = "ConnectorManagement";

/** Heuristic rule id for the "Advanced connector policies only"
 *  preview rule that signals ACP-only mode (DLPs are ignored on this
 *  group). The exact id is **not yet confirmed** — `governance-rules-catalog.md`
 *  speculates it may be a sibling rule with this name or a flag inside
 *  `ConnectorManagement.inputs`. We check both:
 *
 *  - a sibling rule whose id matches a small regex of likely names, AND
 *  - any boolean flag inside `ConnectorManagement.inputs` whose key
 *    looks like an "only / exclusive / override DLP" toggle.
 *
 *  When we see `ConnectorManagement` present but no ACP-only signal,
 *  we leave `acp.only = false`. If we ever confirm the real schema we
 *  just tighten this code; everything downstream stays the same. */
const ACP_ONLY_RULE_ID_PATTERN =
  /^(?:advanced)?connectorpolicies?only|^onlyconnectorpolicies?$/i;
const ACP_ONLY_INPUT_FLAG_PATTERN =
  /^(?:isonlymode|onlymode|exclusivemode|isexclusive|overridedlp|disabledlp)$/i;

/** Summary of how ACPs apply to an environment group. */
export interface EnvironmentGroupAcpStatus {
  /** At least one `ConnectorManagement` rule is configured on the
   *  group's effective policies. */
  configured: boolean;
  /** ACPs override DLPs (a.k.a. "Advanced connector policies only").
   *  Best-effort — see the comment on `ACP_ONLY_RULE_ID_PATTERN`. */
  only: boolean;
  /** Total connectors listed across every `ConnectorManagement` rule's
   *  `AllowedConnectorList`. Useful for one-line summaries. */
  allowedConnectorCount: number;
  /** Distinct rule ids encountered across all effective policies.
   *  Surfaced for debugging / future renderer wiring. */
  ruleIds: string[];
  /** Raw policies behind the summary, for callers that want to render
   *  the full ACP details inline (e.g. a future "Open ACP rules" pane). */
  policies: Policy[];
}

/** Scan one rule's `inputs` for an "ACP-only" boolean flag. */
function inputsImplyAcpOnly(inputs: unknown): boolean {
  if (!inputs || typeof inputs !== "object") return false;
  for (const [k, v] of Object.entries(inputs as Record<string, unknown>)) {
    if (v === true && ACP_ONLY_INPUT_FLAG_PATTERN.test(k)) return true;
  }
  return false;
}

/** Flatten + summarize the rule surface of an env group's effective
 *  policies into the `EnvironmentGroupAcpStatus` shape above.
 *
 *  Pure / side-effect-free so it's trivial to test against captured
 *  payloads — pass in the already-fetched `Policy[]` and assert on the
 *  returned summary. */
export function summarizeAcpStatus(
  policies: Policy[]
): EnvironmentGroupAcpStatus {
  let configured = false;
  let only = false;
  let allowedConnectorCount = 0;
  const ruleIds = new Set<string>();

  for (const p of policies) {
    for (const rule of p.ruleSets ?? []) {
      const id = rule.id ?? "";
      if (id) ruleIds.add(id);
      if (id === ACP_RULE_ID_KNOWN) {
        configured = true;
        const inputs = (rule.inputs ?? {}) as Record<string, unknown>;
        const list = inputs.AllowedConnectorList;
        if (Array.isArray(list)) allowedConnectorCount += list.length;
        if (inputsImplyAcpOnly(inputs)) only = true;
      } else if (ACP_ONLY_RULE_ID_PATTERN.test(id)) {
        // Sibling rule whose id matches one of our best-guess names.
        // Treat presence as a positive ACP-only signal regardless of
        // its `inputs` (we don't know that schema yet).
        only = true;
      }
    }
  }

  return {
    configured,
    only,
    allowedConnectorCount,
    ruleIds: Array.from(ruleIds).sort(),
    policies,
  };
}

/** Light wrapper that fetches the group's effective policies and runs
 *  the summary. Returns `null` when the env-group id is empty. */
export async function getEnvironmentGroupAcpStatus(
  groupId: string
): Promise<DataResult<EnvironmentGroupAcpStatus>> {
  if (!groupId) {
    return { ok: false, error: "Environment group id is required." };
  }
  const res = await getEnvironmentGroupEffectivePolicies(groupId);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: summarizeAcpStatus(res.data.policies) };
}

// ---------------------------------------------------------------------------
// Composite: DLP coverage + (when applicable) env-group ACP status
// ---------------------------------------------------------------------------

/** Combined output of "what governs this environment?" — both DLP
 *  scoping and (when relevant) the parent env-group's ACP posture.
 *
 *  `acp` is `null` whenever it would be uninformative:
 *    - the env isn't managed (no env group can apply ACPs to it), or
 *    - the env isn't in a group at all.
 *
 *  When `acp` is non-null but the call failed, it carries `{ error }`
 *  so the UI can surface a partial result rather than hiding the DLP
 *  coverage entirely. */
export interface DlpAndAcpStatus {
  coverage: DlpPolicyCoverage[];
  acp:
    | EnvironmentGroupAcpStatus
    | { error: string }
    | null;
}

/** Minimal env shape this helper needs — kept loose so any
 *  `EnvironmentRow`-ish object can be passed without coupling to the
 *  inventory module's full row. */
export interface DlpAndAcpEnvInput {
  id: string;
  isManaged: boolean;
  environmentGroupId: string;
}

/**
 * Fetch DLP coverage and ACP status in parallel.
 *
 * - DLP coverage always runs (it's the primary question).
 * - ACP status only runs when the env is **managed AND in a group**;
 *   otherwise `acp` is `null`. ACPs only exist as a feature of
 *   Managed Environments and are enforced through env groups, so
 *   asking the group rules API for any other env shape is wasted IO.
 *
 * Errors in the ACP half are demoted to `{ error }` inside `acp` so
 * the user still sees DLP coverage. Errors in the DLP half propagate
 * to the outer `DataResult`.
 */
export async function getEnvironmentDlpAndAcpStatus(
  env: DlpAndAcpEnvInput
): Promise<DataResult<DlpAndAcpStatus>> {
  const shouldCheckAcp = Boolean(env.isManaged && env.environmentGroupId);
  const [coverage, acp] = await Promise.all([
    getApplicableDlpPolicies(env.id),
    shouldCheckAcp
      ? getEnvironmentGroupAcpStatus(env.environmentGroupId)
      : Promise.resolve(null as null),
  ]);
  if (!coverage.ok) return { ok: false, error: coverage.error };
  let acpField: DlpAndAcpStatus["acp"] = null;
  if (acp) {
    acpField = acp.ok ? acp.data : { error: acp.error };
  }
  return {
    ok: true,
    data: { coverage: coverage.data, acp: acpField },
  };
}
