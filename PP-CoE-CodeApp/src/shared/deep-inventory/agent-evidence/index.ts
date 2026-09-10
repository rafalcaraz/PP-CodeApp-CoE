export {
  AGENT_CAPABILITY_REGISTRY,
  detectCapabilities,
} from "./capabilities";
export {
  normalizeComponents,
  type ComponentNormalizationResult,
} from "./components";
export {
  decodeBotConfiguration,
  type ConfigurationDecodeResult,
} from "./configuration";
export { normalizeAgentEvidence } from "./normalize";
export type {
  AgentEvidenceCapabilities,
  AgentEvidenceComponents,
  AgentEvidenceDiagnostic,
  AgentEvidenceDiagnosticCode,
  AgentEvidenceDiagnostics,
  CapabilityContext,
  CapabilityDetection,
  CapabilityDetector,
  NormalizeAgentEvidenceInput,
  NormalizeAgentEvidenceOptions,
  NormalizedAgentEvidence,
  OpenRecord,
  ParsedComponentEvidence,
} from "./types";
