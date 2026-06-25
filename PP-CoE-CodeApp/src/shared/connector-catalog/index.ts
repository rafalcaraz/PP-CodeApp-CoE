/**
 * Public API for the connector catalog. See `catalog.ts` for the why.
 *
 * Other code MUST import from this barrel; `__resetCatalogForTests` is
 * intentionally not re-exported.
 */
export {
  loadCatalog,
  classify,
  anyConnectorPremium,
  getCatalog,
  getCatalogStatus,
  subscribeCatalog,
  useConnectorCatalog,
} from "./catalog";

export type {
  ConnectorEntry,
  ConnectorCatalog,
  CatalogDiagnostics,
  Classification,
  CatalogStatus,
} from "./catalog";
