import type {
  AgentEvidenceDiagnostic,
  OpenRecord,
} from "./types";

const DEFAULT_DECODE_LIMIT = 4;

function isOpenRecord(value: unknown): value is OpenRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeJsonError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ConfigurationDecodeResult {
  configuration: OpenRecord;
  diagnostics: AgentEvidenceDiagnostic[];
}

/**
 * Decode Dataverse bot.configuration without allowing an unbounded chain of
 * JSON-encoded strings. Dataverse can return either an object, JSON text, or
 * JSON text whose decoded value is another escaped JSON string.
 */
export function decodeBotConfiguration(
  value: unknown,
  decodeLimit = DEFAULT_DECODE_LIMIT,
): ConfigurationDecodeResult {
  const diagnostics: AgentEvidenceDiagnostic[] = [];

  if (value === undefined || value === null || value === "") {
    return { configuration: {}, diagnostics };
  }

  let current: unknown = value;
  const boundedLimit =
    Number.isInteger(decodeLimit) && decodeLimit > 0
      ? decodeLimit
      : DEFAULT_DECODE_LIMIT;

  for (let depth = 0; depth < boundedLimit && typeof current === "string"; depth += 1) {
    try {
      current = JSON.parse(current) as unknown;
    } catch (error) {
      diagnostics.push({
        code: "configuration.invalid-json",
        section: "configuration",
        message: `bot.configuration JSON decode failed at layer ${depth + 1}: ${describeJsonError(error)}`,
      });
      return { configuration: {}, diagnostics };
    }
  }

  if (typeof current === "string") {
    diagnostics.push({
      code: "configuration.max-depth",
      section: "configuration",
      message: `bot.configuration remained encoded after ${boundedLimit} JSON decode layers`,
    });
    return { configuration: {}, diagnostics };
  }

  if (!isOpenRecord(current)) {
    diagnostics.push({
      code: "configuration.unexpected-value",
      section: "configuration",
      message: `bot.configuration decoded to ${current === null ? "null" : Array.isArray(current) ? "an array" : typeof current}, expected an object`,
    });
    return { configuration: {}, diagnostics };
  }

  return { configuration: current, diagnostics };
}
