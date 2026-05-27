/**
 * Connectors feature — data layer.
 *
 * Re-exports the shared connector-catalog primitives so the view can
 * consume them via the feature's `./data` barrel (per the codebase's
 * feature-slice convention — see `.github/copilot-instructions.md`).
 *
 * The actual fetcher + classifier live in
 * `src/shared/connector-catalog/` because other features (apps, flows)
 * also need to classify connector references; a feature can't import
 * from a sibling feature.
 */
export {
  loadCatalog,
  useConnectorCatalog,
} from "../../shared/connector-catalog";

export type {
  ConnectorEntry,
  ConnectorCatalog,
  Classification,
  CatalogStatus,
} from "../../shared/connector-catalog";
