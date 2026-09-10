import { detectCapabilities } from "./capabilities";
import { normalizeComponents } from "./components";
import { decodeBotConfiguration } from "./configuration";
import type {
  NormalizeAgentEvidenceInput,
  NormalizeAgentEvidenceOptions,
  NormalizedAgentEvidence,
  OpenRecord,
} from "./types";

function botWithoutConfiguration(bot: OpenRecord | null | undefined): OpenRecord {
  if (!bot) return {};
  const rest: OpenRecord = {};
  for (const [key, value] of Object.entries(bot)) {
    if (key === "configuration" || key.includes("@")) continue;
    rest[key] = value;
  }
  return rest;
}

/**
 * Join the cheap inventory candidate with optional Dataverse evidence into a
 * stable, flattener-friendly record. A malformed evidence field is isolated to
 * diagnostics so one bad agent never aborts a tenant scan.
 */
export function normalizeAgentEvidence(
  input: NormalizeAgentEvidenceInput,
  options: NormalizeAgentEvidenceOptions = {},
): NormalizedAgentEvidence {
  const configurationResult = decodeBotConfiguration(
    input.bot?.configuration,
    options.configurationDecodeLimit,
  );
  const componentResult = normalizeComponents(input.components ?? []);
  const capabilities = detectCapabilities(
    {
      configuration: configurationResult.configuration,
      components: componentResult.parsedComponents,
    },
    options.capabilityRegistry,
  );
  const items = [
    ...configurationResult.diagnostics,
    ...componentResult.diagnostics,
  ];

  return {
    inventory: { ...input.inventory },
    bot: botWithoutConfiguration(input.bot),
    configuration: configurationResult.configuration,
    components: componentResult.components,
    capabilities,
    diagnostics: {
      hasIssues: items.length > 0,
      count: items.length,
      items,
    },
  };
}
