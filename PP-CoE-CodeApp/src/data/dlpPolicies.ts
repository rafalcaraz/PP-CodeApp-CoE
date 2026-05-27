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
  ManagedPolicyV2,
  PolicyV2,
  ResourceArray_PolicyV2,
} from "../generated/models/PowerPlatformforAdminsModel";
import type {
  Policy,
} from "../generated/models/PowerPlatformforAdminsV2Model";
import { getEnvironmentGroupEffectivePolicies } from "./adminEnrichment";

/** Power Platform admin center host for inline DLP deep-links. Kept
 *  here (not in the `PortalActions/registry.ts`) because DLP coverage
 *  shows policies inline in a card list, not as a single-entity detail
 *  page where the `PortalActionsBar` would be the right home. If a DLP
 *  detail page is ever added, hoist this into the registry instead. */
const PPAC_BASE = "https://admin.powerplatform.microsoft.com";

/** Build a deep-link into the PPAC DLP policy editor for the given
 *  policy GUID (`PolicyV2.name`). Used by the DLP coverage card and
 *  evaluation trace to give admins one-click handoff to "open this
 *  policy in PPAC". */
export function ppacDlpPolicyUrl(policyId: string): string {
  return `${PPAC_BASE}/security/dataprotection/dlp/policy/${encodeURIComponent(policyId)}`;
}

/** Build a deep-link into the PPAC environment-group details page.
 *
 *  Note: `PortalActions/registry.ts` has a separate env-group URL
 *  (`.../manage/envgroups/{id}/details`) used by the per-page action
 *  bar. This helper uses the current `.../manage/environmentGroups/{id}`
 *  shape PPAC ships today — verified live in May 2026. The registry
 *  entry should be reconciled to this same URL whenever someone next
 *  touches it; doing both atomically is out of scope for this DLP work. */
export function ppacEnvironmentGroupUrl(groupId: string): string {
  return `${PPAC_BASE}/manage/environmentGroups/${encodeURIComponent(groupId)}`;
}
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
// Create / duplicate
// ---------------------------------------------------------------------------

/**
 * Create a new DLP policy.
 *
 * Backed by the legacy connector's `CreatePolicyV2` operation. The body
 * is a `ManagedPolicyV2` — the write-shape sibling of `PolicyV2`. On
 * success returns the freshly-created `PolicyV2` (with its server-issued
 * `name` GUID, `createdBy`, timestamps, etc.).
 *
 * Used today by the DLP Duplicator page. Callers that want to mirror an
 * existing policy should use `buildDuplicatePolicyBody` to construct the
 * request payload rather than hand-rolling it — that helper centralizes
 * the field-copy rules so the same shape rolls out the door every time.
 */
export async function createDlpPolicy(
  body: ManagedPolicyV2
): Promise<DataResult<PolicyV2>> {
  try {
    const result = await PowerPlatformforAdminsService.CreatePolicyV2(body);
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
 * Pure: build the `ManagedPolicyV2` body for duplicating an existing
 * `PolicyV2` into a new policy scoped to a specific list of environments.
 *
 * What gets copied verbatim:
 *   - `defaultConnectorsClassification` — the catch-all bucket
 *   - `connectorGroups[]` — the full bucket → connector mapping, including
 *     each entry's `_type` (the connector kind discriminator the connector
 *     round-trips)
 *
 * What gets overridden:
 *   - `displayName` — the new policy's name (caller picks)
 *   - `environmentType` — forced to `OnlyEnvironments` for Stage 1. The
 *     UI does not yet expose the `AllEnvironments` / `ExceptEnvironments` /
 *     `SingleEnvironment` modes; we keep the contract narrow so the page
 *     can guarantee scope safety (no accidental tenant-wide policies from
 *     a "copy" action).
 *   - `environments[]` — set to the caller-provided list of env GUIDs.
 *     Each entry is shaped the way the connector expects: bare GUID in
 *     `name`, ARM-style URI in `id`, fixed `_type` discriminator. This
 *     mirrors the read-shape we see come back on `GetPolicyV2`.
 *
 * Returned object is safe to pass directly to `createDlpPolicy`.
 */
export function buildDuplicatePolicyBody(
  source: PolicyV2,
  opts: { displayName: string; environmentIds: string[] }
): ManagedPolicyV2 {
  const displayName = opts.displayName.trim();
  if (!displayName) {
    throw new Error("displayName is required.");
  }
  const envIds = (opts.environmentIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id));
  if (envIds.length === 0) {
    throw new Error("At least one environment is required.");
  }

  // Deep-clone the connector groups so callers can mutate the result
  // without poisoning the source object. JSON round-trip is enough — the
  // shape is flat data, no functions, no dates.
  const connectorGroups = source.connectorGroups
    ? (JSON.parse(JSON.stringify(source.connectorGroups)) as ManagedPolicyV2["connectorGroups"])
    : [];

  return {
    displayName,
    defaultConnectorsClassification: (source.defaultConnectorsClassification ||
      "General") as ManagedPolicyV2["defaultConnectorsClassification"],
    connectorGroups,
    environmentType: "OnlyEnvironments",
    environments: envIds.map((envId) => ({
      id: `/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/${envId}`,
      name: envId,
      _type: "Microsoft.BusinessAppPlatform/scopes/environments",
    })),
  };
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
 * Normalize an environment id for comparison.
 *
 * The connector's `PolicyV2.environments[]` entries return **two**
 * fields that look like ids — and the right one to compare against
 * inventory is non-obvious. Captured from a real PPAC payload (see
 * `docs/admin-payload-samples.md`):
 *
 *   {
 *     "id":   "/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/0fdcb4b5-…",
 *     "name": "0fdcb4b5-…",
 *     "type": "Microsoft.BusinessAppPlatform/scopes/environments"
 *   }
 *
 * Inventory's `EnvironmentRow.id` is always the **bare GUID** from
 * `QueryResources`. So:
 *
 *   - The right field to compare against is `e.name` when present.
 *   - This helper exists as a defensive fallback for when only the
 *     ARM-style `e.id` is available, or for unknown future shapes
 *     (URN, encoded slashes, mixed case): strip everything before the
 *     last `/`, trim, lowercase.
 *
 * `policyAppliesToEnvironment` prefers `e.name`, then falls back to
 * `normalizeEnvIdForScope(e.id)`. This combination has matched every
 * shape we've seen the platform emit.
 */
export function normalizeEnvIdForScope(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const idx = trimmed.lastIndexOf("/");
  const tail = idx >= 0 ? trimmed.substring(idx + 1) : trimmed;
  return tail.toLowerCase();
}

/** Pick the canonical env GUID out of one `policy.environments[]`
 *  entry. Prefers `name` (the bare GUID per the captured payload),
 *  falls back to extracting the trailing segment of `id`. Always
 *  returned lowercased so callers can compare without re-normalizing.
 *
 *  Exported so `dlpImpact.ts` (and any future consumer) uses the same
 *  resolution rule the coverage predicate does. Mismatch between
 *  the two would cause DLP Impact to find zero resources in
 *  OnlyEnvironments-scoped policies. */
export function policyEnvEntryId(e: { id?: string; name?: string }): string {
  if (e.name && e.name.trim()) return e.name.trim().toLowerCase();
  return normalizeEnvIdForScope(e.id ?? "");
}

/**
 * Pure predicate: does `policy` apply to the environment with id
 * `envId`? Kept free of any IO so it can be reused in tests, in the
 * DLP Impact picker, and in any future coverage UI.
 *
 * Treats unknown / missing `environmentType` as `AllEnvironments`
 * (the connector default), matching how PPAC interprets a blank
 * scope field.
 *
 * Comparison is case-insensitive on the bare GUID. See
 * `normalizeEnvIdForScope` and `policyEnvEntryId` for the id-shape
 * gymnastics this paper over (connector returns ARM-path in `id`,
 * bare GUID in `name`; inventory returns bare GUID).
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
  const target = normalizeEnvIdForScope(envId);
  const ids = new Set(
    (policy.environments ?? [])
      .map(policyEnvEntryId)
      .filter((id) => id.length > 0)
  );
  if (type === "OnlyEnvironments" || type === "SingleEnvironment") {
    return ids.has(target)
      ? { applies: true, reason: "included" }
      : { applies: false, reason: "none" };
  }
  if (type === "ExceptEnvironments") {
    return ids.has(target)
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

/** Full evaluation entry — emitted for **every** policy in the tenant,
 *  not just matches. Powers the "Show evaluation details" debugging
 *  surface so admins can answer "why doesn't policy X apply to my
 *  env Y?" without instrumenting the codebase.
 *
 *  All the diagnostic fields (raw vs. normalized ids on both sides)
 *  are stable shapes safe to dump straight to JSON or render in a
 *  small table. */
export interface DlpPolicyEvaluation {
  policyId: string;
  displayName: string;
  environmentType: string;
  applies: boolean;
  reason: DlpScopeMatchReason;
  /** The target env id we evaluated against (post-normalization). */
  targetEnvIdNormalized: string;
  /** The target env id we evaluated against (as passed in). */
  targetEnvIdRaw: string;
  /** Every env id on the policy, raw form (as the connector returned). */
  policyEnvIdsRaw: string[];
  /** Every env id on the policy, normalized — what the predicate
   *  actually compared against. Diff this against the raw list to
   *  spot ARM-prefix / case-mismatch bugs. */
  policyEnvIdsNormalized: string[];
}

/** Pure: evaluate every policy in the supplied list against `envId`
 *  and return a full per-policy trace. The trace is sorted matches-
 *  first (so users see the relevant rows up top) then alphabetically
 *  by displayName. */
export function evaluateDlpCoverage(
  policies: PolicyV2[],
  envId: string
): DlpPolicyEvaluation[] {
  const target = normalizeEnvIdForScope(envId);
  const out: DlpPolicyEvaluation[] = policies.map((p) => {
    const m = policyAppliesToEnvironment(p, envId);
    const rawIds = (p.environments ?? [])
      .map((e) => e.id)
      .filter((id): id is string => Boolean(id));
    // Normalized list uses the same `name`-preferring resolver the
    // predicate uses, so what you see here is *exactly* what the
    // predicate compared against.
    const normalized = (p.environments ?? [])
      .map(policyEnvEntryId)
      .filter((id) => id.length > 0);
    return {
      policyId: p.name,
      displayName: p.displayName || p.name,
      environmentType: p.environmentType || "AllEnvironments",
      applies: m.applies,
      reason: m.reason,
      targetEnvIdRaw: envId,
      targetEnvIdNormalized: target,
      policyEnvIdsRaw: rawIds,
      policyEnvIdsNormalized: normalized,
    };
  });
  out.sort((a, b) => {
    if (a.applies !== b.applies) return a.applies ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return out;
}

/**
 * Returns every DLP policy that targets the given environment, with
 * the reason it matched, AND a full evaluation trace for every policy
 * in the tenant (matched + unmatched). The trace powers the debugging
 * expander on the env detail page so admins can diagnose "this policy
 * SHOULD cover this env but doesn't" without instrumenting the code.
 *
 * Drains `listDlpPolicies` once and filters client-side — there is no
 * per-env query on the connector.
 *
 * On-demand only: this is meant to back a "Load DLP policy coverage"
 * button on the environment detail page, not be called as part of
 * inventory boot.
 */
export async function getApplicableDlpPolicies(
  envId: string
): Promise<
  DataResult<{ coverage: DlpPolicyCoverage[]; trace: DlpPolicyEvaluation[] }>
> {
  if (!envId) {
    return { ok: false, error: "Environment id is required." };
  }
  const all = await listDlpPolicies();
  if (!all.ok) return all;
  const trace = evaluateDlpCoverage(all.data, envId);
  const coverage: DlpPolicyCoverage[] = [];
  for (const t of trace) {
    if (!t.applies) continue;
    const policy = all.data.find((p) => p.name === t.policyId);
    if (policy) coverage.push({ policy, reason: t.reason });
  }
  coverage.sort((a, b) =>
    (a.policy.displayName || "").localeCompare(b.policy.displayName || "")
  );
  return { ok: true, data: { coverage, trace } };
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

/** Rule id for the "Advanced connector policies only" rule that, when
 *  present AND enabled on an env group, signals ACP-only mode (DLPs
 *  are ignored on this group, only the ACP allow-list enforces).
 *
 *  Confirmed schema from a captured tenant payload (see
 *  `docs/admin-payload-samples.md` and `docs/governance-rules-catalog.md`):
 *
 *    {
 *      "id": "AdvancedConnectorPoliciesOnly",
 *      "version": "1.0",
 *      "inputs": { "EnableAdvancedConnectorPoliciesOnly": true }
 *    }
 *
 *  The flag matters — a tenant can have the rule attached but disabled,
 *  in which case ACPs do NOT override DLPs. We check both id and flag. */
const ACP_ONLY_RULE_ID_KNOWN = "AdvancedConnectorPoliciesOnly";
const ACP_ONLY_ENABLE_FLAG = "EnableAdvancedConnectorPoliciesOnly";

/** Heuristic fallbacks for ACP-only detection. Kept around so that if
 *  Microsoft ever adds a sibling rule id or moves the flag onto
 *  `ConnectorManagement.inputs`, we still pick it up. The exact match
 *  on `ACP_ONLY_RULE_ID_KNOWN` is checked first; these are last-resort. */
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
   *  Tightened to a confirmed schema (exact rule id +
   *  `EnableAdvancedConnectorPoliciesOnly === true`); see
   *  `ACP_ONLY_RULE_ID_KNOWN` and `ACP_ONLY_ENABLE_FLAG`. */
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

/** Scan one rule's `inputs` for an "ACP-only" boolean flag. Heuristic
 *  fallback — exact-id detection is preferred and handled separately. */
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
        // Heuristic fallback only — kept in case the platform ever
        // moves the toggle onto ConnectorManagement.inputs directly.
        if (inputsImplyAcpOnly(inputs)) only = true;
      } else if (id === ACP_ONLY_RULE_ID_KNOWN) {
        // Confirmed rule. Toggle is `inputs.EnableAdvancedConnectorPoliciesOnly`
        // — a tenant can have the rule attached but disabled, so we
        // require the flag to be truthy before flipping `only`.
        const inputs = (rule.inputs ?? {}) as Record<string, unknown>;
        if (inputs[ACP_ONLY_ENABLE_FLAG] === true) only = true;
      } else if (ACP_ONLY_RULE_ID_PATTERN.test(id)) {
        // Last-resort heuristic. Useful only if Microsoft renames the
        // rule or ships a sibling. Treat presence as the signal since
        // we don't know the flag schema for hypothetical variants.
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
  /** Full per-policy evaluation trace (matched + unmatched), surfaced
   *  in the UI behind a "Show evaluation details" expander for
   *  debugging scope mismatches. */
  trace: DlpPolicyEvaluation[];
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
  // Devtools breadcrumb. Useful when an admin pings about
  // "policy X should cover env Y but doesn't" — the per-policy trace
  // lands in the console without them needing to expand the UI.
  console.info("[DLP coverage] evaluation", {
    envId: env.id,
    isManaged: env.isManaged,
    environmentGroupId: env.environmentGroupId,
    appliedCount: coverage.data.coverage.length,
    totalPolicies: coverage.data.trace.length,
    trace: coverage.data.trace,
  });
  return {
    ok: true,
    data: {
      coverage: coverage.data.coverage,
      trace: coverage.data.trace,
      acp: acpField,
    },
  };
}
