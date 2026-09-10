import { parseAllDocuments } from "yaml";

import type {
  AgentEvidenceComponents,
  AgentEvidenceDiagnostic,
  OpenRecord,
  ParsedComponentEvidence,
} from "./types";

function isOpenRecord(value: unknown): value is OpenRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(record: OpenRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readComponentType(record: OpenRecord): unknown {
  return record.componenttype ?? record.componentType;
}

function primitiveKey(value: unknown): string {
  if (value === null) return "null";
  return `${typeof value}:${String(value)}`;
}

function pushDistinct(target: unknown[], value: unknown): void {
  const key = primitiveKey(value);
  if (!target.some((existing) => primitiveKey(existing) === key)) {
    target.push(value);
  }
}

function collectPrimitiveLeaves(
  value: unknown,
  path: string,
  leaves: Map<string, unknown[]>,
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (!path) return;
    const values = leaves.get(path) ?? [];
    pushDistinct(values, value);
    leaves.set(path, values);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPrimitiveLeaves(item, path, leaves);
    return;
  }

  if (!isOpenRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectPrimitiveLeaves(child, path ? `${path}.${key}` : key, leaves);
  }
}

function componentDiagnosticContext(
  record: OpenRecord,
  index: number,
): Pick<
  AgentEvidenceDiagnostic,
  "componentIndex" | "componentId" | "componentName"
> {
  return {
    componentIndex: index,
    componentId: readString(record, "botcomponentid", "id"),
    componentName: readString(record, "name"),
  };
}

function parseComponent(
  record: OpenRecord,
  index: number,
  diagnostics: AgentEvidenceDiagnostic[],
): ParsedComponentEvidence {
  const name = readString(record, "name");
  const schemaName = readString(record, "schemaname", "schemaName");
  const data = record.data;
  const roots: OpenRecord[] = [];

  if (typeof data === "string" && data.trim().length > 0) {
    let documents: ReturnType<typeof parseAllDocuments>;
    try {
      documents = parseAllDocuments(data, { prettyErrors: false });
    } catch (error) {
      diagnostics.push({
        code: "component.invalid-yaml",
        section: "components",
        message: `botcomponent.data YAML parse failed: ${error instanceof Error ? error.message : String(error)}`,
        ...componentDiagnosticContext(record, index),
      });
      return {
        index,
        record,
        roots,
        componentType: readComponentType(record),
        name,
        schemaName,
      };
    }

    for (const document of documents) {
      for (const error of document.errors) {
        diagnostics.push({
          code: "component.invalid-yaml",
          section: "components",
          message: `botcomponent.data YAML parse failed: ${error.message}`,
          ...componentDiagnosticContext(record, index),
        });
      }
      for (const warning of document.warnings) {
        diagnostics.push({
          code: "component.yaml-warning",
          section: "components",
          message: `botcomponent.data YAML warning: ${warning.message}`,
          ...componentDiagnosticContext(record, index),
        });
      }
      if (document.errors.length > 0) continue;

      let parsed: unknown;
      try {
        parsed = document.toJS({ maxAliasCount: 100 }) as unknown;
      } catch (error) {
        diagnostics.push({
          code: "component.invalid-yaml",
          section: "components",
          message: `botcomponent.data YAML conversion failed: ${error instanceof Error ? error.message : String(error)}`,
          ...componentDiagnosticContext(record, index),
        });
        continue;
      }

      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (isOpenRecord(candidate)) {
          roots.push(candidate);
        } else if (candidate !== undefined && candidate !== null) {
          diagnostics.push({
            code: "component.unexpected-root",
            section: "components",
            message: `botcomponent.data decoded to ${Array.isArray(candidate) ? "an array" : typeof candidate}, expected an object`,
            ...componentDiagnosticContext(record, index),
          });
        }
      }
    }
  } else if (data !== undefined && data !== null && data !== "") {
    diagnostics.push({
      code: "component.unexpected-root",
      section: "components",
      message: `botcomponent.data is ${typeof data}, expected YAML text`,
      ...componentDiagnosticContext(record, index),
    });
  }

  return {
    index,
    record,
    roots,
    componentType: readComponentType(record),
    name,
    schemaName,
  };
}

export interface ComponentNormalizationResult {
  components: AgentEvidenceComponents;
  parsedComponents: ParsedComponentEvidence[];
  diagnostics: AgentEvidenceDiagnostic[];
}

export function normalizeComponents(
  records: readonly OpenRecord[],
): ComponentNormalizationResult {
  const diagnostics: AgentEvidenceDiagnostic[] = [];
  const parsedComponents = records.map((record, index) =>
    parseComponent(record, index, diagnostics),
  );
  const types: unknown[] = [];
  const names: string[] = [];
  const schemaNames: string[] = [];
  const kinds: string[] = [];
  const leaves = new Map<string, unknown[]>();

  for (const component of parsedComponents) {
    if (component.componentType !== undefined && component.componentType !== null) {
      pushDistinct(types, component.componentType);
    }
    if (component.name) pushDistinct(names, component.name);
    if (component.schemaName) pushDistinct(schemaNames, component.schemaName);

    for (const root of component.roots) {
      if (typeof root.kind === "string" && root.kind.length > 0) {
        pushDistinct(kinds, root.kind);
      }
      collectPrimitiveLeaves(root, "", leaves);
    }
  }

  return {
    components: {
      componentCount: records.length,
      records: records.map((record) => ({ ...record })),
      types,
      names,
      schemaNames,
      kinds,
      any: Object.fromEntries(leaves),
    },
    parsedComponents,
    diagnostics,
  };
}
