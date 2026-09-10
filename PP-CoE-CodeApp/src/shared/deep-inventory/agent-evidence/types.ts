export type OpenRecord = Record<string, unknown>;

export type AgentEvidenceDiagnosticCode =
  | "configuration.invalid-json"
  | "configuration.max-depth"
  | "configuration.unexpected-value"
  | "component.invalid-yaml"
  | "component.yaml-warning"
  | "component.unexpected-root";

export interface AgentEvidenceDiagnostic {
  code: AgentEvidenceDiagnosticCode;
  message: string;
  section: "configuration" | "components";
  componentIndex?: number;
  componentId?: string;
  componentName?: string;
}

export interface ParsedComponentEvidence {
  index: number;
  record: OpenRecord;
  roots: OpenRecord[];
  componentType?: unknown;
  name?: string;
  schemaName?: string;
}

export interface CapabilityDetection {
  detected: boolean;
  evidence: string[];
}

export interface CapabilityContext {
  configuration: OpenRecord;
  components: readonly ParsedComponentEvidence[];
}

export interface CapabilityDetector {
  id: string;
  detect(context: CapabilityContext): CapabilityDetection;
}

export interface AgentEvidenceCapabilities extends OpenRecord {
  memoryEnabled: boolean;
  externalTrigger: boolean;
  recurrenceTrigger: boolean;
  evidence: Record<string, string[]>;
}

export interface AgentEvidenceComponents extends OpenRecord {
  componentCount: number;
  /** Original selected Dataverse rows retained for evidence inspection. */
  records: OpenRecord[];
  types: unknown[];
  names: string[];
  schemaNames: string[];
  kinds: string[];
  any: Record<string, unknown[]>;
}

export interface AgentEvidenceDiagnostics extends OpenRecord {
  hasIssues: boolean;
  count: number;
  items: AgentEvidenceDiagnostic[];
}

export interface NormalizedAgentEvidence extends OpenRecord {
  inventory: OpenRecord;
  bot: OpenRecord;
  configuration: OpenRecord;
  components: AgentEvidenceComponents;
  capabilities: AgentEvidenceCapabilities;
  diagnostics: AgentEvidenceDiagnostics;
}

export interface NormalizeAgentEvidenceInput {
  inventory: OpenRecord;
  bot?: OpenRecord | null;
  components?: readonly OpenRecord[] | null;
}

export interface NormalizeAgentEvidenceOptions {
  configurationDecodeLimit?: number;
  capabilityRegistry?: readonly CapabilityDetector[];
}
