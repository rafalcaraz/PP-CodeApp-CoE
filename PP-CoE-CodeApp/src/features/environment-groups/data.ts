/**
 * Environment-groups feature — data layer.
 *
 * Thin wrapper that re-exports just the relevant pieces of the shared
 * inventory data layer. Views in this folder MUST import from `./data`
 * (or its barrel), never directly from `../../data/inventory`, so that:
 *
 *  1. The view layer only sees feature-shaped types.
 *  2. When `data/inventory.ts` is later carved into
 *     `shared/inventory-core/`, only this file needs to change.
 *  3. ESLint boundary rules can pin this folder's views to this
 *     module as the single inventory entry point.
 */
export {
  listEnvironmentGroups,
  getEnvironmentGroup,
  listEnvironmentsInGroup,
  countResourcesByTypeForGroup,
  friendlyResourceType,
} from "../../data/inventory";

export type {
  EnvironmentGroupRow,
  EnvironmentRow,
  ResourceCountRow,
} from "../../data/inventory";
