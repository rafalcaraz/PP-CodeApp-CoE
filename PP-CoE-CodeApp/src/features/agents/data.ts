/**
 * Agents feature — data layer.
 *
 * Thin wrapper that re-exports just the agent-relevant pieces of the
 * shared inventory data layer. Views in this folder MUST import from
 * `./data` (or its barrel), never directly from `../../data/inventory`,
 * so that:
 *
 *  1. The view layer only sees agent-shaped types — no temptation to
 *     drift into other resource types.
 *  2. When `data/inventory.ts` is eventually carved into
 *     `shared/inventory-core/`, only this file needs to change.
 *  3. ESLint boundary rules can pin `features/agents/**` to this
 *     module as the single inventory entry point.
 */
export {
  listAgentsPage,
  getAgent,
  shortResourceType,
} from "../../data/inventory";

/**
 * Per-record admin enrichment used by the Skills download fallback to resolve
 * an environment's Dataverse org URL (`EnvironmentResponse.url`). Kept behind
 * this feature barrel so views never deep-import `../../data/adminEnrichment`.
 */
export { getEnvironmentAdminDetails } from "../../data/adminEnrichment";

export type {
  AgentRow,
  AgentFilters,
  AgentFilterMode,
  AgentValueFilter,
  AgentSharingCounts,
} from "../../data/inventory";
