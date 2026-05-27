/**
 * Environment-group duplication — orchestrator + pure helpers.
 *
 * **What it does.** Given a source env group id, a new name, and a new
 * description: creates a brand-new env group, then re-creates every
 * Model A ruleset that was effective on the source group, rewired so
 * its `environmentFilter.values[]` points at the new group instead.
 *
 * **Why not a single connector call.** The connector exposes neither a
 * "duplicate env group" wrap nor a group-scoped "create ruleset" wrap.
 * The only writable ruleset endpoint is `UpdateRuleSet(ruleSetId, body)`
 * which is a `PUT /governance/ruleSets/{ruleSetId}` — i.e. a REST
 * upsert. So we mint a fresh GUID per cloned ruleset and PUT each one
 * after the new group is created.
 *
 * **What's NOT cloned.** Model B rule-based policies are scoped via
 * separate `policyAssignment` records that don't have a writable
 * "create on group" connector wrap. Surfaced as a UI warning so the
 * admin re-applies them in PPAC if needed.
 *
 * **Failure model.** Group creation is fail-fast — if it doesn't
 * succeed we can't clone rules. Per-ruleset PUTs are best-effort:
 * each is tracked individually so a single failed ruleset doesn't
 * orphan the new group. The orchestrator returns a per-ruleset
 * outcome list so the UI can show "3 of 4 rulesets cloned".
 */

import { PowerPlatformforAdminsV2Service } from "../generated";
import type {
  EnvironmentGroup,
  Policy,
  PolicyAssignmentRequest,
  PolicyRequest,
  RuleAssignment,
  RuleSetDto,
} from "../generated/models/PowerPlatformforAdminsV2Model";
import type { DataResult } from "./inventory";
import {
  getEnvironmentGroupEffectivePolicies,
  getEnvironmentGroupRulesets,
} from "./adminEnrichment";

const API_VERSION = "2024-10-01";

/** Best-effort error normalization. Mirrors the helper in
 *  `adminEnrichment.ts` / `dlpPolicies.ts`; kept local to avoid
 *  pulling a circular dep while these wrappers stabilize. */
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

// ---------------------------------------------------------------------------
// Thin connector wrappers (creation paths)
// ---------------------------------------------------------------------------

/** Create a new env group. Backed by `CreateEnvironmentGroup`. */
export async function createEnvironmentGroup(
  body: EnvironmentGroup,
): Promise<DataResult<EnvironmentGroup>> {
  const name = (body.displayName ?? "").trim();
  if (!name) {
    return { ok: false, error: "Display name is required." };
  }
  try {
    const result = await PowerPlatformforAdminsV2Service.CreateEnvironmentGroup(
      API_VERSION,
      body,
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    if (!result.data) {
      return { ok: false, error: "Connector returned no group data." };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Create a new ruleset via the env-group-scoped POST endpoint.
 *
 *  Backed by `CreateRuleSet`, which is
 *  `POST /governance/environments/{environmentId}/environmentGroups/{groupId}/ruleSets`.
 *  The path requires both an environment id and a group id even though
 *  the ruleset itself is conceptually group-scoped — the body's
 *  `environmentFilter.values[]` is what actually scopes it server-side.
 *  We pass the same `groupId` for both path params; the server keys
 *  off the body, not the URL.
 *
 *  Note: the older companion `UpdateRuleSet` (PUT
 *  `/governance/ruleSets/{ruleSetId}`) is **not** an upsert — it does
 *  a strict update and 404s on unknown ids (verified live: Cosmos
 *  `ItemNotFound`). So creates must go through CreateRuleSet, not
 *  through a PUT to a fresh GUID.
 *
 *  The server assigns the ruleset id; we ignore any id on the body.
 *  The returned `RuleSetDto` carries the server-assigned id. */
export async function createRuleSet(
  groupId: string,
  body: RuleSetDto,
): Promise<DataResult<RuleSetDto>> {
  if (!groupId) {
    return { ok: false, error: "groupId is required." };
  }
  try {
    const result = await PowerPlatformforAdminsV2Service.CreateRuleSet(
      groupId,
      groupId,
      API_VERSION,
      body,
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    return { ok: true, data: (result.data as RuleSetDto) ?? ({} as RuleSetDto) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Create a new rule-based policy (Model B). Backed by
 *  `CreateRuleBasedPolicy`. The connector handles ID assignment —
 *  callers pass just `name` + `ruleSets`. */
export async function createRuleBasedPolicy(
  body: PolicyRequest,
): Promise<DataResult<Policy>> {
  const name = (body.name ?? "").trim();
  if (!name) return { ok: false, error: "Policy name is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.CreateRuleBasedPolicy(
      API_VERSION,
      body,
    );
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

/** Assign an existing rule-based policy to an env group. Backed by
 *  `CreateEnviornmentGroupRuleBasedAssignment` (note: typo on the
 *  connector side — `Enviornment` not `Environment` — we preserve
 *  the connector's operation name and shield callers from it).
 *
 *  Wire body shape: `{ policyId, tenantId, resourceId }` — the
 *  connector's declared `PolicyAssignmentRequest` type only exposes
 *  `assignmentOverrides[]`, but the actual API requires the policy/
 *  tenant/resource triple in the body for the assignment to succeed.
 *  Verified live (Power Automate reference flow uses the same body).
 *  Without these fields the call appears to succeed but the policy
 *  is never actually applied to the group. */
export async function assignRuleBasedPolicyToGroup(
  policyId: string,
  groupId: string,
  tenantId: string,
): Promise<DataResult<RuleAssignment>> {
  if (!policyId) return { ok: false, error: "policyId is required." };
  if (!groupId) return { ok: false, error: "groupId is required." };
  if (!tenantId) return { ok: false, error: "tenantId is required." };
  // The connector type is too narrow (declares only `assignmentOverrides`);
  // cast through `unknown` so we can send the wire-required triple.
  const body = {
    policyId,
    tenantId,
    resourceId: groupId,
  } as unknown as PolicyAssignmentRequest;
  try {
    const result =
      await PowerPlatformforAdminsV2Service.CreateEnviornmentGroupRuleBasedAssignment(
        policyId,
        groupId,
        API_VERSION,
        body,
      );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    return { ok: true, data: result.data ?? ({} as RuleAssignment) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pure: build the `RuleSetDto` body to POST for a cloned ruleset.
 *
 * What gets copied verbatim:
 *   - `parameters[]` — the full bucket/value structure that drives the
 *     governance rules. Deep-cloned so caller mutations can't poison
 *     the source.
 *   - `environmentFilter.type` — preserves Include / Exclude semantics.
 *
 * What gets overridden:
 *   - `environmentFilter.values[]` — replaced with a single
 *     `{ id: <newGroupId>, type: "EnvironmentGroup" }` entry. Any
 *     `Environment`-typed entries on the source are dropped — env-group
 *     duplication is by design scoped to the new group, not the same
 *     individual envs the source happened to reference.
 *
 * What gets added:
 *   - `hasStagedChanges: true` — REQUIRED on every ruleset body for the
 *     server to actually *apply* the ruleset to the group. Without this
 *     flag the create succeeds (HTTP 200) but the rules silently never
 *     take effect — the group looks empty in PPAC. Verified live: the
 *     Power Automate flow that does the same operation has to inject
 *     this via `addProperty(item(), 'hasStagedChanges', true)` before
 *     POSTing each ruleset. The official connector schema does not
 *     declare the field, so we cast through `unknown` to satisfy the
 *     too-narrow generated type.
 *
 * What's omitted:
 *   - `id` — server-assigned on CreateRuleSet, ignored on the body.
 *   - `lastModified` — server-managed.
 */
export function buildDuplicateRuleSetBody(
  source: RuleSetDto,
  newGroupId: string,
): RuleSetDto {
  if (!newGroupId) throw new Error("newGroupId is required.");
  // Deep-clone parameters via JSON round-trip — flat data, no
  // functions, no dates.
  const parameters = source.parameters
    ? (JSON.parse(JSON.stringify(source.parameters)) as RuleSetDto["parameters"])
    : [];
  const filterType = source.environmentFilter?.type ?? "Include";
  return {
    environmentFilter: {
      type: filterType,
      values: [{ id: newGroupId, type: "EnvironmentGroup" }],
    },
    parameters,
    // Wire-required flag not declared on the connector's RuleSetDto;
    // see doc comment above. Cast keeps the public return type aligned
    // with the generated TS.
    ...({ hasStagedChanges: true } as object),
  } as RuleSetDto;
}

/**
 * Pure: build the `PolicyRequest` body for cloning a Model B
 * rule-based policy.
 *
 * What gets copied:
 *   - `name` — kept verbatim. The connector allows duplicate names;
 *     no "(Copy)" suffix is added by default. Caller can override if
 *     they want.
 *   - `ruleSets[]` — the full rule body (e.g. `ConnectorManagement`
 *     with the `AllowedConnectorList` allow-list). Deep-cloned to
 *     prevent source mutation.
 *
 * What gets dropped:
 *   - `id`, `tenantId`, `lastModified`, `lastModifiedOffset`,
 *     `ruleSetCount` — server-managed.
 */
export function buildDuplicatePolicyRequest(
  source: Policy,
  opts: { name?: string } = {},
): PolicyRequest {
  const name = (opts.name ?? source.name ?? "").trim();
  if (!name) {
    throw new Error("Policy name is required.");
  }
  const ruleSets = source.ruleSets
    ? (JSON.parse(JSON.stringify(source.ruleSets)) as PolicyRequest["ruleSets"])
    : [];
  return { name, ruleSets };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** Outcome of cloning a single ruleset. Captures both success and
 *  failure paths so the UI can render a partial-success summary
 *  ("3 of 4 rulesets cloned") without losing the per-failure detail.
 *
 *  `newRuleSetId` is server-assigned on success (CreateRuleSet returns
 *  the new id in the response body) and undefined on failure. */
export interface ClonedRuleSetOutcome {
  /** The ruleset id on the source group, for cross-referencing. */
  sourceRuleSetId: string;
  /** The new ruleset id the server assigned. Only set when `ok`. */
  newRuleSetId?: string;
  ok: boolean;
  error?: string;
}

/** Outcome of cloning a single Model B rule-based policy.
 *
 *  `assigned` tracks the second leg (assignment to the new group)
 *  separately from `created` (the policy creation itself), so the UI
 *  can surface partial failures — e.g. "policy created OK but
 *  assignment failed, here is the orphan policy id". */
export interface ClonedPolicyOutcome {
  sourcePolicyId: string;
  sourcePolicyName: string;
  /** The newly-created policy id (only set when `created` is true). */
  newPolicyId?: string;
  created: boolean;
  createError?: string;
  assigned: boolean;
  assignError?: string;
}

/** Outcome of the whole `duplicateEnvironmentGroup` operation. The
 *  outer result is `ok: true` whenever the new group itself was
 *  created — ruleset and policy failures are reported per-item. */
export interface DuplicateEnvironmentGroupResult {
  /** The newly-created env group (server-shaped, with its new id). */
  newGroup: EnvironmentGroup;
  /** One outcome per source ruleset (Model A), in source order. */
  rulesets: ClonedRuleSetOutcome[];
  /** One outcome per source rule-based policy (Model B), in source order. */
  policies: ClonedPolicyOutcome[];
}

export interface DuplicateEnvironmentGroupInput {
  sourceGroupId: string;
  displayName: string;
  description?: string;
}

/**
 * Duplicate an env group end-to-end:
 *   1. Resolve the source group's Model A rulesets (via the existing
 *      `GetRuleSetListForTenant` filter — the same path the env-group
 *      detail page uses) AND Model B effective rule-based policies.
 *   2. Create the new env group.
 *   3. For each source ruleset, POST a new ruleset via `CreateRuleSet`
 *      against the new group. The connector's POST path requires both
 *      env id and group id; we pass the new group id for both (the
 *      body's `environmentFilter` is what actually scopes the
 *      ruleset server-side). NOTE: we do **not** use `UpdateRuleSet`
 *      to create — that PUT is strict-update only and 404s on unknown
 *      ids (Cosmos ItemNotFound), it is not an upsert.
 *   4. For each source Model B policy, create a brand-new tenant-wide
 *      rule-based policy with the same name + ruleSets, then assign
 *      it to the new group.
 *
 * Step 1 failures bail before any writes happen — we can't clone what
 * we can't read. Step 2 failures bail before any rulesets or policies
 * are written. Step 3 and step 4 failures are per-item and reported
 * in the result.
 */
export async function duplicateEnvironmentGroup(
  input: DuplicateEnvironmentGroupInput,
): Promise<DataResult<DuplicateEnvironmentGroupResult>> {
  const displayName = (input.displayName ?? "").trim();
  if (!input.sourceGroupId) {
    return { ok: false, error: "Source group id is required." };
  }
  if (!displayName) {
    return { ok: false, error: "Display name is required." };
  }

  // 1. Read source rulesets AND policies first. If either fails we want
  // to fail before creating the new group — no orphan groups from a
  // mid-flight bail.
  const [rulesetsResult, policiesResult] = await Promise.all([
    getEnvironmentGroupRulesets(input.sourceGroupId),
    getEnvironmentGroupEffectivePolicies(input.sourceGroupId),
  ]);
  if (!rulesetsResult.ok) {
    return {
      ok: false,
      error: `Couldn't read source group rulesets: ${rulesetsResult.error}`,
    };
  }
  if (!policiesResult.ok) {
    return {
      ok: false,
      error: `Couldn't read source group policies: ${policiesResult.error}`,
    };
  }
  const sourceRulesets = rulesetsResult.data.matching.value ?? [];
  const sourcePolicies = policiesResult.data.policies ?? [];

  // 2. Create the new env group. The API requires a non-empty
  // `description` even though the connector schema marks it optional —
  // submitting without one returns HTTP 400 "You must provide a display
  // name and description for the environment group." Fall back to a
  // sensible default derived from the displayName when the caller
  // doesn't provide one.
  const description =
    input.description?.trim() || `Duplicated from ${displayName}`;
  const createResult = await createEnvironmentGroup({
    displayName,
    description,
  });
  if (!createResult.ok) return createResult;
  const newGroup = createResult.data;
  if (!newGroup.id) {
    return {
      ok: false,
      error: "Group was created but the connector returned no id.",
    };
  }

  // 3. Per-ruleset POSTs via CreateRuleSet. Sequential (not parallel)
  // so a malformed ruleset doesn't get drowned out by a wave of
  // parallel failures, and so the server-side change log on the new
  // group reads in a sensible order. Source rulesets are typically
  // small in count (1–3) so this isn't a perf concern.
  const rulesetOutcomes: ClonedRuleSetOutcome[] = [];
  for (const source of sourceRulesets) {
    const sourceRuleSetId = source.id ?? "";
    try {
      const body = buildDuplicateRuleSetBody(source, newGroup.id);
      const r = await createRuleSet(newGroup.id, body);
      rulesetOutcomes.push({
        sourceRuleSetId,
        newRuleSetId: r.ok ? r.data.id : undefined,
        ok: r.ok,
        error: r.ok ? undefined : r.error,
      });
    } catch (err) {
      rulesetOutcomes.push({
        sourceRuleSetId,
        ok: false,
        error: formatError(err),
      });
    }
  }

  // 4. Per-policy clone + assign. Each policy is a two-step:
  // CreateRuleBasedPolicy gets us a new tenant-wide policy id, then
  // CreateEnviornmentGroupRuleBasedAssignment wires it onto the new
  // group. If create fails, skip assign (no point assigning a
  // non-existent policy). If assign fails the policy still exists as
  // an orphan — surfaced with its id so an admin can clean up.
  //
  // tenantId for the assignment body comes from the source policy
  // (every Model B policy carries a `tenantId` field). All source
  // policies share the same tenantId since they're tenant-scoped.
  const policyOutcomes: ClonedPolicyOutcome[] = [];
  for (const source of sourcePolicies) {
    const sourcePolicyId = source.id ?? "";
    const sourcePolicyName = source.name ?? "";
    const tenantId = source.tenantId ?? "";
    let outcome: ClonedPolicyOutcome = {
      sourcePolicyId,
      sourcePolicyName,
      created: false,
      assigned: false,
    };
    try {
      const body = buildDuplicatePolicyRequest(source);
      const createRes = await createRuleBasedPolicy(body);
      if (!createRes.ok) {
        outcome = { ...outcome, createError: createRes.error };
      } else {
        const newId = createRes.data.id ?? "";
        outcome = { ...outcome, created: true, newPolicyId: newId };
        if (!newId) {
          outcome.assignError =
            "Policy created but the connector returned no id; cannot assign.";
        } else if (!tenantId) {
          outcome.assignError =
            "Source policy is missing tenantId; cannot build the assignment body.";
        } else {
          const assignRes = await assignRuleBasedPolicyToGroup(
            newId,
            newGroup.id,
            tenantId,
          );
          if (!assignRes.ok) {
            outcome.assignError = assignRes.error;
          } else {
            outcome.assigned = true;
          }
        }
      }
    } catch (err) {
      outcome.createError = formatError(err);
    }
    policyOutcomes.push(outcome);
  }

  return {
    ok: true,
    data: {
      newGroup,
      rulesets: rulesetOutcomes,
      policies: policyOutcomes,
    },
  };
}
