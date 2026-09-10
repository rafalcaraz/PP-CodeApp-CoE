import type {
  AgentEvidenceCapabilities,
  CapabilityContext,
  CapabilityDetection,
  CapabilityDetector,
  OpenRecord,
  ParsedComponentEvidence,
} from "./types";

function isOpenRecord(value: unknown): value is OpenRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function componentLabel(component: ParsedComponentEvidence): string {
  return component.name ? ` (${component.name})` : "";
}

function externalTriggerRoots(component: ParsedComponentEvidence): OpenRecord[] {
  return component.roots.filter(
    (root) => root.kind === "ExternalTriggerConfiguration",
  );
}

const memoryEnabledDetector: CapabilityDetector = {
  id: "memoryEnabled",
  detect({ configuration }): CapabilityDetection {
    const settings = configuration.agentSettings;
    const detected =
      isOpenRecord(settings) && settings.enableMemory === true;
    return {
      detected,
      evidence: detected
        ? ["configuration.agentSettings.enableMemory=true"]
        : [],
    };
  },
};

const externalTriggerDetector: CapabilityDetector = {
  id: "externalTrigger",
  detect({ components }): CapabilityDetection {
    const evidence: string[] = [];
    for (const component of components) {
      if (externalTriggerRoots(component).length > 0) {
        evidence.push(
          `kind=ExternalTriggerConfiguration${componentLabel(component)}`,
        );
      }
    }
    return { detected: evidence.length > 0, evidence: [...new Set(evidence)] };
  },
};

const recurrenceTriggerDetector: CapabilityDetector = {
  id: "recurrenceTrigger",
  detect({ components }): CapabilityDetection {
    const evidence: string[] = [];
    for (const component of components) {
      for (const root of externalTriggerRoots(component)) {
        const source = root.externalTriggerSource;
        if (
          isOpenRecord(source) &&
          source.kind === "AgentRecurrenceTrigger"
        ) {
          evidence.push(
            `externalTriggerSource.kind=AgentRecurrenceTrigger${componentLabel(component)}`,
          );
        }
      }
    }
    return { detected: evidence.length > 0, evidence: [...new Set(evidence)] };
  },
};

/** Initial registry; callers can supply an extended registry to normalization. */
export const AGENT_CAPABILITY_REGISTRY: readonly CapabilityDetector[] = [
  memoryEnabledDetector,
  externalTriggerDetector,
  recurrenceTriggerDetector,
];

export function detectCapabilities(
  context: CapabilityContext,
  registry: readonly CapabilityDetector[] = AGENT_CAPABILITY_REGISTRY,
): AgentEvidenceCapabilities {
  const capabilities: OpenRecord = {};
  const evidence: Record<string, string[]> = {};

  for (const detector of registry) {
    const detection = detector.detect(context);
    capabilities[detector.id] = detection.detected;
    evidence[detector.id] = [...new Set(detection.evidence)];
  }

  capabilities.memoryEnabled ??= false;
  capabilities.externalTrigger ??= false;
  capabilities.recurrenceTrigger ??= false;

  return {
    ...capabilities,
    memoryEnabled: capabilities.memoryEnabled === true,
    externalTrigger: capabilities.externalTrigger === true,
    recurrenceTrigger: capabilities.recurrenceTrigger === true,
    evidence,
  };
}
