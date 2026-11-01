import connectorSchema from "../../../.power/schemas/powerplatformadminv2/powerplatformadminv2.Schema.json";
import { dataSourcesInfo } from "../../../.power/schemas/appschemas/dataSourcesInfo";
import { createSchemaTools, type JsonSchema } from "../../shared/api-explorer/schema";
export type { JsonSchema } from "../../shared/api-explorer/schema";

export interface ActionParameter extends Omit<JsonSchema, "required"> {
  name: string;
  in: string;
  required?: boolean;
  schema?: JsonSchema;
}

export interface ConnectorAction {
  id: string;
  title: string;
  description: string;
  method: string;
  path: string;
  group: string;
  readOnly: boolean;
  parameters: ActionParameter[];
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ActionParameter[];
}

const swagger: {
  paths: Record<string, Record<string, Operation>>;
  definitions: Record<string, JsonSchema>;
} = connectorSchema.properties.swagger;

const registeredOperations = new Set(Object.keys(dataSourcesInfo.powerplatformadminv2.apis));

export const connectorActions: ConnectorAction[] = Object.entries(swagger.paths)
  .flatMap(([path, methods]) =>
    Object.entries(methods).flatMap(([method, operation]) => {
      if (!operation.operationId || !registeredOperations.has(operation.operationId)) return [];
      return [{
        id: operation.operationId,
        title: operation.summary ?? operation.operationId,
        description: operation.description ?? "",
        method: method.toUpperCase(),
        path: path.replace("/{connectionId}", ""),
        group: operation.tags?.[0] ?? "Other",
        // POST is not assumed safe, including the general-purpose MCP actions.
        readOnly: method === "get" || operation.operationId === "QueryResources",
        parameters: (operation.parameters ?? []).filter((p) => p.name !== "connectionId"),
      }];
    }),
  )
  .sort((a, b) => a.title.localeCompare(b.title));

export const { resolveSchema, schemaDocument, schemaTemplate, validateValue } = createSchemaTools(swagger.definitions);

export function parameterSchema(parameter: ActionParameter): JsonSchema {
  return parameter.schema ?? { ...parameter, required: undefined };
}

export function initialInputs(action: ConnectorAction): Record<string, string> {
  return Object.fromEntries(action.parameters.map((parameter) => {
    const schema = parameterSchema(parameter);
    const value = parameter.default ?? schema.default;
    return [
      parameter.name,
      value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value),
    ];
  }));
}

export function parseInputs(action: ConnectorAction, inputs: Record<string, string>): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const parameter of action.parameters) {
    const raw = inputs[parameter.name] ?? "";
    if (!raw.trim()) {
      if (parameter.required) throw new Error(`${parameter.name} is required.`);
      continue;
    }
    const schema = resolveSchema(parameterSchema(parameter));
    let value: unknown = raw;
    if (schema.type !== "string" || parameter.in === "body") {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(`${parameter.name}: enter valid JSON${schema.type ? ` (${schema.type})` : ""}.`);
      }
    }
    validateValue(value, schema, parameter.name);
    parameters[parameter.name] = value;
  }
  return parameters;
}

export function validateParameters(action: ConnectorAction, parameters: Record<string, unknown>): void {
  for (const name of Object.keys(parameters)) {
    if (!action.parameters.some((parameter) => parameter.name === name)) {
      throw new Error(`Unknown parameter: ${name}.`);
    }
  }
  for (const parameter of action.parameters) {
    const value = parameters[parameter.name];
    if (value === undefined) {
      if (parameter.required) throw new Error(`${parameter.name} is required.`);
      continue;
    }
    if (parameter.required && typeof value === "string" && !value.trim()) {
      throw new Error(`${parameter.name} is required.`);
    }
    validateValue(value, parameterSchema(parameter), parameter.name);
  }
}
