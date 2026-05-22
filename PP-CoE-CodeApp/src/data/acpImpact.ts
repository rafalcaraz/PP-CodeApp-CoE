/**
 * ACP (Application Control Policy) Impact — "if I removed connector X
 * from the ACP allow-list on environment group G, which apps / flows /
 * agents in that group would lose access?"
 *
 * Companion to `dlpImpact.ts`. They share the inventory query loop
 * (`runImpactQuery`) but the **scope source differs**:
 *
 *   - DLP impact scopes via `policy.environments[]` and the policy's
 *     `environmentType` (`AllEnvironments` / `OnlyEnvironments` /
 *     `ExceptEnvironments` / `SingleEnvironment`).
 *   - ACP impact scopes via **environment-group membership**: every
 *     environment whose `properties.environmentGroupId` matches the
 *     selected group. There's no `AllEnvironments` equivalent — an
 *     ACP only enforces on its group's envs.
 *
 * V1 framing matches the user's mental model: "what would lose access
 * if I removed connector X from this group's ACP allow-list?" Same
 * result shape as DLP impact (rows + summary), just with `ranAgainst`
 * carrying group identity instead of DLP policy scope.
 *
 * Pure helpers + one connector-call wrapper. No React.
 */

import {
  listEnvironmentsInGroup,
  friendlyConnectorName,
  type DataResult,
} from "./inventory";
import {
  runImpactQuery,
  type DlpImpactRow,
  type DlpImpactSummary,
} from "./dlpImpact";

/** Diagnostic metadata for an ACP impact run. Mirrors
 *  `DlpImpactResult.ranAgainst` but pivots the scope description from
 *  "policy environmentType" to "env group + membership count". */
export interface AcpImpactRanAgainst {
  /** Lowercased connector slug as queried. */
  connectorSlug: string;
  /** Friendly label (`friendlyConnectorName`). */
  connectorDisplayName: string;
  /** Env group GUID that scoped the query. */
  groupId: string;
  /** Best-effort group display name (caller passes it in). */
  groupDisplayName: string;
  /** Number of environments in the group (= number of envs the query
   *  was actually scoped to). */
  effectiveEnvCount: number;
}

export interface AcpImpactResult {
  rows: DlpImpactRow[];
  summary: DlpImpactSummary;
  ranAgainst: AcpImpactRanAgainst;
}

/**
 * Run the ACP impact query. Fetches every environment in the group via
 * `listEnvironmentsInGroup`, then calls the shared `runImpactQuery`
 * with those env ids as a hard inclusion filter.
 *
 * Empty groups (no envs) short-circuit to a zero-result success — the
 * UI can render "no environments in this group" explicitly rather than
 * a misleading "no impact".
 */
export async function queryAcpImpact(
  groupId: string,
  groupDisplayName: string,
  connectorSlug: string
): Promise<DataResult<AcpImpactResult>> {
  const slug = connectorSlug.trim().toLowerCase();
  if (!slug) {
    return { ok: false, error: "Connector slug is required." };
  }
  if (!groupId) {
    return { ok: false, error: "Environment group id is required." };
  }

  // Pull the group's envs. This is a cheap aggregate-style query (a
  // single `QueryResources` call typically returns within a page).
  const envsRes = await listEnvironmentsInGroup(groupId);
  if (!envsRes.ok) return { ok: false, error: envsRes.error };
  const envIds = envsRes.data.map((e) => e.id.toLowerCase()).filter((id) => id.length > 0);

  // Zero envs in the group = nothing for the ACP to impact. Skip the
  // round-trip entirely.
  if (envIds.length === 0) {
    return {
      ok: true,
      data: {
        rows: [],
        summary: {
          totalResources: 0,
          byType: {},
          environmentCount: 0,
          ownerCount: 0,
        },
        ranAgainst: {
          connectorSlug: slug,
          connectorDisplayName: friendlyConnectorName(slug) || slug,
          groupId,
          groupDisplayName: groupDisplayName || groupId,
          effectiveEnvCount: 0,
        },
      },
    };
  }

  const queryRes = await runImpactQuery({
    envIds,
    mode: "include",
    connectorSlug: slug,
  });
  if (!queryRes.ok) return queryRes;

  return {
    ok: true,
    data: {
      rows: queryRes.data.rows,
      summary: queryRes.data.summary,
      ranAgainst: {
        connectorSlug: slug,
        connectorDisplayName: friendlyConnectorName(slug) || slug,
        groupId,
        groupDisplayName: groupDisplayName || groupId,
        effectiveEnvCount: envIds.length,
      },
    },
  };
}
