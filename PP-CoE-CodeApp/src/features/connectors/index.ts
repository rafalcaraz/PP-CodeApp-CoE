/**
 * Public API for the connectors feature.
 *
 * Other code (`src/App.tsx`, route tests) MUST import from this barrel.
 * Deep imports past this file are forbidden by the feature-slice
 * boundary rules; see `.github/copilot-instructions.md`.
 */
export { connectorsRoutes } from "./routes";
export {
  loadCatalog,
  useConnectorCatalog,
} from "../../shared/connector-catalog";
export type {
  ConnectorEntry,
  ConnectorCatalog,
  Classification,
} from "../../shared/connector-catalog";
