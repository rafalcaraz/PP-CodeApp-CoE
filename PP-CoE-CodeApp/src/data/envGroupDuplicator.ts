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
  RuleSetDto,
} from "../generated/models/PowerPlatformforAdminsV2Model";
import type { DataResult } from "./inventory";
import { getEnvironmentGroupRulesets } from "./adminEnrichment";

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

/** RFC 4122 v4 UUID. Uses `crypto.randomUUID()` (available in every
 *  evergreen browser the Power Apps player ships in) and falls back to
 *  a `Math.random`-backed shim only when running in an exotic test
 *  environment that doesn't expose `crypto`. Pinned standalone so we
 *  can stub it deterministically in builder tests. */
export function newRuleSetId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback — never hit in the player, but keeps SSR-style test
  // runners that strip globals from blowing up.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

/** PUT a ruleset by id. Backed by `UpdateRuleSet`, which is a REST
 *  upsert (`PUT /governance/ruleSets/{ruleSetId}`) — passing a fresh
 *  GUID for `ruleSetId` creates a new ruleset.
 *
 *  Wrapped so the orchestrator and any future "edit ruleset" UI share
 *  the same error normalization. */
export async function putRuleSet(
  ruleSetId: string,
  body: RuleSetDto,
): Promise<DataResult<RuleSetDto>> {
  if (!ruleSetId) {
    return { ok: false, error: "ruleSetId is required." };
  }
  try {
    const result = await PowerPlatformforAdminsV2Service.UpdateRuleSet(
      ruleSetId,
      API_VERSION,
      body,
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    return { ok: true, data: result.data ?? ({} as RuleSetDto) };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pure: build the `RuleSetDto` body to PUT for a cloned ruleset.
 *
 * What gets copied verbatim:
 *   - `parameters[]` — the full bucket/value structure that drives the
 *     governance rules. Deep-cloned so caller mutations can't poison
 *     the source.
 *   - `environmentFilter.type` — preserves Include / Exclude semantics.
 *
 * What gets overridden:
 *   - `id` — must be the new ruleSetId the caller minted (matches the
 *     path parameter on the PUT).
 *   - `environmentFilter.values[]` — replaced with a single
 *     `{ id: <newGroupId>, type: "EnvironmentGroup" }` entry. Any
 *     `Environment`-typed entries on the source are dropped — env-group
 *     duplication is by design scoped to the new group, not the same
 *     individual envs the source happened to reference.
 *   - `lastModified` — server-managed; we omit it so the server picks
 *     the timestamp.
 */
export function buildDuplicateRuleSetBody(
  source: RuleSetDto,
  newGroupId: string,
  newRuleSetId: string,
): RuleSetDto {
  if (!newGroupId) throw new Error("newGroupId is required.");
  if (!newRuleSetId) throw new Error("newRuleSetId is required.");
  // Deep-clone parameters via JSON round-trip — flat data, no
  // functions, no dates.
  const parameters = source.parameters
    ? (JSON.parse(JSON.stringify(source.parameters)) as RuleSetDto["parameters"])
    : [];
  const filterType = source.environmentFilter?.type ?? "Include";
  return {
    id: newRuleSetId,
    environmentFilter: {
      type: filterType,
      values: [{ id: newGroupId, type: "EnvironmentGroup" }],
    },
    parameters,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** Outcome of cloning a single ruleset. Captures both success and
 *  failure paths so the UI can render a partial-success summary
 *  ("3 of 4 rulesets cloned") without losing the per-failure detail. */
export interface ClonedRuleSetOutcome {
  /** The ruleset id on the source group, for cross-referencing. */
  sourceRuleSetId: string;
  /** The new ruleset id we PUT. */
  newRuleSetId: string;
  ok: boolean;
  error?: string;
}

/** Outcome of the whole `duplicateEnvironmentGroup` operation. The
 *  outer result is `ok: true` whenever the new group itself was
 *  created — ruleset failures are reported per-item. */
export interface DuplicateEnvironmentGroupResult {
  /** The newly-created env group (server-shaped, with its new id). */
  newGroup: EnvironmentGroup;
  /** One outcome per source ruleset, in source order. */
  rulesets: ClonedRuleSetOutcome[];
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
 *      detail page uses).
 *   2. Create the new env group.
 *   3. For each source ruleset, mint a fresh GUID and PUT it via
 *      `UpdateRuleSet` (REST upsert) rewired to the new group.
 *
 * Step 1 failures bail before any writes happen — we can't clone what
 * we can't read. Step 2 failures bail before any rulesets are written
 * — orphan rulesets would be worse than the failed group. Step 3
 * failures are per-item and reported in the result.
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

  // 1. Read source rulesets first. If this fails we want to fail
  // before creating the new group — no orphan groups from a
  // mid-flight bail.
  const rulesetsResult = await getEnvironmentGroupRulesets(input.sourceGroupId);
  if (!rulesetsResult.ok) {
    return {
      ok: false,
      error: `Couldn't read source group rulesets: ${rulesetsResult.error}`,
    };
  }
  const sourceRulesets = rulesetsResult.data.matching.value ?? [];

  // 2. Create the new env group.
  const createResult = await createEnvironmentGroup({
    displayName,
    description: input.description?.trim() || undefined,
  });
  if (!createResult.ok) return createResult;
  const newGroup = createResult.data;
  if (!newGroup.id) {
    return {
      ok: false,
      error: "Group was created but the connector returned no id.",
    };
  }

  // 3. Per-ruleset PUTs. Sequential (not parallel) so a malformed
  // ruleset doesn't get drowned out by a wave of parallel failures,
  // and so the server-side change log on the new group reads in a
  // sensible order. Source rulesets are typically small in count
  // (1–3) so this isn't a perf concern.
  const outcomes: ClonedRuleSetOutcome[] = [];
  for (const source of sourceRulesets) {
    const sourceRuleSetId = source.id ?? "";
    const id = newRuleSetId();
    try {
      const body = buildDuplicateRuleSetBody(source, newGroup.id, id);
      const r = await putRuleSet(id, body);
      outcomes.push({
        sourceRuleSetId,
        newRuleSetId: id,
        ok: r.ok,
        error: r.ok ? undefined : r.error,
      });
    } catch (err) {
      outcomes.push({
        sourceRuleSetId,
        newRuleSetId: id,
        ok: false,
        error: formatError(err),
      });
    }
  }

  return { ok: true, data: { newGroup, rulesets: outcomes } };
}
