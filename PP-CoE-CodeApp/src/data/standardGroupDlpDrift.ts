/**
 * Drift calculation for a Standard custom group linked to a DLP policy.
 *
 * Pure functions only — no React, no IO. Lives in `data/` because:
 *
 *   1. It depends on `policyAppliesToEnvironment` from `dlpPolicies.ts`
 *      and on `EnvironmentRow` from `inventory.ts`. Keeping it under
 *      `data/` matches the existing layering rules (data may depend on
 *      data; UI may depend on either).
 *   2. The math is the most testable and most likely-to-break part of
 *      the linked-DLP feature — it deserves a dedicated unit test
 *      suite rather than only being exercised via component renders.
 *
 * The drift summary answers two questions:
 *
 *   - Which envs in the group are NOT covered by the linked policy?
 *     ("uncoveredInGroup") — actionable for the admin in PPAC.
 *   - Which envs are covered by the policy but NOT in the group?
 *     ("inPolicyNotInGroup") — only meaningful for
 *     `OnlyEnvironments` / `SingleEnvironment` scopes, where the
 *     policy enumerates its targets. For `AllEnvironments` and
 *     `ExceptEnvironments` the "in-scope" set is effectively the
 *     whole tenant; enumerating it as a per-env list would be noise
 *     so we skip it (callers should also hide the row in that case).
 */

import {
  policyAppliesToEnvironment,
  policyEnvEntryId,
} from "./dlpPolicies";
import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";
import type { EnvironmentRow } from "./inventory";

export interface StandardGroupDlpDrift {
  /** Envs in the group AND covered by the policy. */
  coveredInGroup: EnvironmentRow[];
  /** Envs in the group but NOT covered by the policy. */
  uncoveredInGroup: EnvironmentRow[];
  /**
   * Envs covered by the policy but NOT in the group. Only populated
   * for `OnlyEnvironments` / `SingleEnvironment` scopes; always `[]`
   * for `AllEnvironments` / `ExceptEnvironments` because enumerating
   * the in-scope set is unbounded for those.
   */
  inPolicyNotInGroup: EnvironmentRow[];
  /**
   * True when the policy's scope is broad enough that
   * `inPolicyNotInGroup` is intentionally empty
   * (`AllEnvironments`, `ExceptEnvironments`). Callers use this to
   * decide whether to render the "in-policy-not-in-group" row at all.
   */
  scopeIsBroad: boolean;
}

/**
 * Compute the drift between a Standard custom group's env membership
 * and the linked DLP policy's actual environment scope.
 *
 * `allEnvs` is needed to translate policy env ids back into rows so
 * the UI can render display names; envs the policy references but
 * that don't exist in inventory are silently dropped (they're either
 * deleted in PPAC or in a workspace the caller can't see).
 */
export function computeStandardGroupDlpDrift(
  policy: PolicyV2,
  envsInGroup: EnvironmentRow[],
  allEnvs: EnvironmentRow[],
): StandardGroupDlpDrift {
  const scope = policy.environmentType || "AllEnvironments";
  const scopeIsBroad =
    scope === "AllEnvironments" || scope === "ExceptEnvironments";

  const coveredInGroup: EnvironmentRow[] = [];
  const uncoveredInGroup: EnvironmentRow[] = [];
  for (const env of envsInGroup) {
    const match = policyAppliesToEnvironment(policy, env.id);
    (match.applies ? coveredInGroup : uncoveredInGroup).push(env);
  }

  let inPolicyNotInGroup: EnvironmentRow[] = [];
  if (!scopeIsBroad) {
    const groupSet = new Set(envsInGroup.map((e) => e.id.toLowerCase()));
    const allEnvById = new Map(
      allEnvs.map((e) => [e.id.toLowerCase(), e] as const),
    );
    const policyIds = (policy.environments ?? [])
      .map(policyEnvEntryId)
      .filter((id) => id.length > 0);
    for (const pid of policyIds) {
      if (!groupSet.has(pid)) {
        const row = allEnvById.get(pid);
        if (row) inPolicyNotInGroup.push(row);
      }
    }
    inPolicyNotInGroup = inPolicyNotInGroup.sort((a, b) =>
      (a.displayName || a.id).localeCompare(b.displayName || b.id),
    );
  }

  return {
    coveredInGroup,
    uncoveredInGroup,
    inPolicyNotInGroup,
    scopeIsBroad,
  };
}
