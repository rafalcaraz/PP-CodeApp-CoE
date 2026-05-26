/**
 * ACP (Application Control Policy) Impact — "if I removed connector X
 * from the ACP allow-list on environment group G, which apps / flows /
 * agents in that group would lose access?"
 *
 * Optionally: "which resources use *operation Z* on connector X in that
 * group?" (action-level drill-down).
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
  /** When filtering by operation, the operationId that was applied. */
  operationId?: string;
}

/** Extended row that includes agent-specific operation metadata. */
export interface AcpImpactRow extends DlpImpactRow {
  /** For agents: how the operation is used (Tool, Knowledge, Topic Tool).
   *  Empty for non-agent rows or when not filtering by operation. */
  usedAs: string;
}

export interface AcpImpactResult {
  rows: AcpImpactRow[];
  summary: DlpImpactSummary;
  ranAgainst: AcpImpactRanAgainst;
}

/**
 * Run the ACP impact query. Fetches every environment in the group via
 * `listEnvironmentsInGroup`, then calls the shared `runImpactQuery`
 * with those env ids as a hard inclusion filter.
 *
 * When `operationId` is provided, results are client-filtered to only
 * resources that declare that specific operation on the target connector.
 * Agent rows are additionally enriched with `usedAs` metadata.
 *
 * Empty groups (no envs) short-circuit to a zero-result success — the
 * UI can render "no environments in this group" explicitly rather than
 * a misleading "no impact".
 */
export async function queryAcpImpact(
  groupId: string,
  groupDisplayName: string,
  connectorSlug: string,
  operationId?: string
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
          operationId: operationId || undefined,
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

  // Enrich rows with usedAs metadata and optionally filter by operation.
  const enrichedRows = enrichWithOperationMetadata(
    queryRes.data.rows,
    slug,
    operationId
  );

  // Recompute summary after operation-level filtering.
  const summary = computeSummary(enrichedRows);

  return {
    ok: true,
    data: {
      rows: enrichedRows,
      summary,
      ranAgainst: {
        connectorSlug: slug,
        connectorDisplayName: friendlyConnectorName(slug) || slug,
        groupId,
        groupDisplayName: groupDisplayName || groupId,
        effectiveEnvCount: envIds.length,
        operationId: operationId || undefined,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Operation-level enrichment and filtering
// ---------------------------------------------------------------------------

/** Matches a connector slug allowing for `shared_` prefix differences. */
function slugMatches(published: string, target: string): boolean {
  const normalize = (s: string) => {
    const lc = s.trim().toLowerCase();
    return lc.startsWith("shared_") ? lc.substring("shared_".length) : lc;
  };
  return normalize(published) === normalize(target);
}

/**
 * For each DlpImpactRow, look up the original resource's connector
 * operations to find `usedAs` metadata. When `operationId` is provided,
 * filter to only rows whose connector payload includes that operation.
 *
 * This function works off the `_rawConnectors` stash that
 * `runImpactQuery` preserves on each row (as a non-enumerable property)
 * for downstream enrichment — if it's not present, we fall back to
 * treating every row as matching (preserving the V1 behavior).
 */
function enrichWithOperationMetadata(
  rows: DlpImpactRow[],
  connectorSlug: string,
  operationId?: string
): AcpImpactRow[] {
  const result: AcpImpactRow[] = [];

  for (const row of rows) {
    // Access the raw connector payload stashed by runImpactQuery.
    const raw = (row as unknown as { _rawConnectors?: unknown[] })._rawConnectors;
    let usedAs = "";
    let hasOperation = !operationId; // If no filter, all rows pass.

    if (raw && Array.isArray(raw)) {
      for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const cId = typeof e.connectorId === "string" ? e.connectorId : "";
        // Extract slug from ARM path.
        const entrySlug = cId.includes("/")
          ? cId.substring(cId.lastIndexOf("/") + 1)
          : cId;
        if (!slugMatches(entrySlug, connectorSlug)) continue;

        // Check operations on this connector entry.
        const ops = Array.isArray(e.operations) ? e.operations : [];
        for (const op of ops) {
          if (!op || typeof op !== "object") continue;
          const o = op as Record<string, unknown>;
          const opId = typeof o.operationId === "string" ? o.operationId : "";
          const opUsedAs = typeof o.usedAs === "string" ? o.usedAs : "";

          if (operationId && opId.toLowerCase() === operationId.toLowerCase()) {
            hasOperation = true;
            if (opUsedAs) usedAs = opUsedAs;
          }
          // If no operation filter, grab first usedAs we find.
          if (!operationId && opUsedAs && !usedAs) {
            usedAs = opUsedAs;
          }
        }
        // Connector-only (no operations listed) — Knowledge sources often
        // have no operationId. If filtering by op, skip these.
        if (ops.length === 0 && !operationId) {
          const entryUsedAs = typeof e.usedAs === "string" ? e.usedAs : "";
          if (entryUsedAs && !usedAs) usedAs = entryUsedAs;
        }
      }
    } else {
      // No raw data — can't filter by operation, pass everything through.
      hasOperation = true;
    }

    if (hasOperation) {
      result.push({ ...row, usedAs });
    }
  }

  return result;
}

function computeSummary(rows: AcpImpactRow[]): DlpImpactSummary {
  const byType: Partial<Record<string, number>> = {};
  const envs = new Set<string>();
  const owners = new Set<string>();
  for (const r of rows) {
    byType[r.type] = ((byType[r.type] as number) ?? 0) + 1;
    if (r.environmentId) envs.add(r.environmentId);
    const ownerKey = r.ownerId || r.ownerDisplayName;
    if (ownerKey) owners.add(ownerKey);
  }
  return {
    totalResources: rows.length,
    byType: byType as DlpImpactSummary["byType"],
    environmentCount: envs.size,
    ownerCount: owners.size,
  };
}
