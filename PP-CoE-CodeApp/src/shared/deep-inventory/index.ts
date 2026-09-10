/**
 * Deep-inventory public API.
 *
 * Everything the feature layer needs to build a deep-scan UI is
 * exported here. Internal modules (cache internals, source factory
 * helpers, etc.) are intentionally NOT re-exported — keep them
 * private so refactors inside `shared/deep-inventory/` don't ripple
 * into the feature surface.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  CuratedProperty,
  ObservedProperty,
  ObservedSchema,
  PropertyCatalogEntry,
  PropertyCatalog,
  DeepSourceId,
  FilterSpec,
  FilterOp,
  DeepFilterClause,
  DeepQuerySpec,
  DeepScanScope,
  DeepRecord,
  DeepRecordIdentity,
  DeepScanRow,
  DeepScanScopeError,
  ScanEvent,
  ScanSummary,
} from "./catalog/types";
export type {
  CandidateResolver,
  ScopeUnit,
  SourceFetchContext,
} from "./sources";

// ── Catalog ──────────────────────────────────────────────────────────
export { CURATED_ADMIN_APPS } from "./catalog/curated.apps";
export {
  CURATED_AGENT_CANDIDATES,
  CURATED_COPILOT_AGENTS,
} from "./catalog/curated.agents";
export {
  mergePropertyCatalog,
  groupCatalog,
  type CatalogGroup,
  ADMIN_APPS_HIDE_PREFIXES,
  OBSERVED_GROUP,
  OBSERVED_EMPTY_SENTINEL_PATH,
} from "./catalog/merge";
export {
  emptyObservedSchema,
  loadObservedSchema,
  saveObservedSchema,
  clearObservedSchema,
  updateObservedSchema,
} from "./catalog/introspect";
export { detectDrift, type DriftWarning } from "./catalog/drift";
export {
  flatten,
  getPath,
  readPath,
  type FlatPayload,
  type FlatLeaf,
  type FlattenOptions,
} from "./catalog/flatten";

// ── Runner / sources / cache ─────────────────────────────────────────
export {
  runDeepScan,
  type RunDeepScanOptions,
  type ScopeResolver,
  MAX_CONCURRENT_SCOPE_UNITS,
} from "./runner";
export { SOURCES, getSource, ADMIN_APPS_EXCLUDE_PREFIXES } from "./sources";
export { COPILOT_AGENT_OBSERVED_HIDE_PREFIXES } from "./sources/copilotAgentsDataverse";
export {
  subscribeToScan,
  getScanSnapshot,
  startScan,
  cancelScan,
  resetScan,
  isScanRunning,
  type ScanSnapshot,
} from "./scanStore";
export {
  cacheClear,
  cacheClearSource,
  DEFAULT_CACHE_TTL_MS,
} from "./cache";

// ── Filter eval (mostly used internally; exposed so tests + advanced
//    callers can evaluate clauses without the runner) ────────────────
export { evaluateFilter } from "./filter";

// ── Copilot Studio agent evidence normalization ─────────────────────
export {
  AGENT_CAPABILITY_REGISTRY,
  decodeBotConfiguration,
  detectCapabilities,
  normalizeAgentEvidence,
  normalizeComponents,
} from "./agent-evidence";
export type {
  AgentEvidenceCapabilities,
  AgentEvidenceComponents,
  AgentEvidenceDiagnostic,
  AgentEvidenceDiagnostics,
  CapabilityDetection,
  CapabilityDetector,
  NormalizeAgentEvidenceInput,
  NormalizedAgentEvidence,
  OpenRecord,
  ParsedComponentEvidence,
} from "./agent-evidence";
