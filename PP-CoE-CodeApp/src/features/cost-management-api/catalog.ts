import connectorSchema from "../../../.power/schemas/msftcsa-5fcostcontrosl-2dcustomconn-5f55e4fbc80e016c41/msftcsa_5fcostcontrosl_2dcustomconn_5f55e4fbc80e016c41.Schema.json";
import { dataSourcesInfo } from "../../../.power/schemas/appschemas/dataSourcesInfo";
import {
  createSchemaTools, isJsonObject, type JsonSchema,
} from "../../shared/api-explorer/schema";
import { validateCostBody } from "../../shared/cost-controls/validation";
import { validateWave2Parameters } from "../../shared/cost-controls/wave2";

export interface ActionParameter extends Omit<JsonSchema, "required"> {
  name: string;
  in: string;
  required?: boolean;
  schema?: JsonSchema;
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  externalDocs?: { url: string };
  parameters?: (ActionParameter | { $ref: string })[];
  responses?: Record<string, { description?: string; schema?: JsonSchema; headers?: Record<string, JsonSchema>; $ref?: string }>;
}

const swagger: {
  paths: Record<string, Record<string, Operation>>;
  parameters: Record<string, ActionParameter>;
  definitions: Record<string, JsonSchema>;
  responses: Record<string, { description?: string; schema?: JsonSchema; headers?: Record<string, JsonSchema> }>;
} = connectorSchema.properties.swagger;

export const costDataSourceName = "msftcsa_5fcostcontrosl_2dcustomconn_5f55e4fbc80e016c41";
export const schemaTools = createSchemaTools(swagger.definitions);
const registered = new Set(Object.keys(dataSourcesInfo[costDataSourceName].apis));
export const graphRoot = "https://graph.microsoft.com/beta/copilot/costManagement";

function resolveParameter(input: ActionParameter | { $ref: string }): ActionParameter {
  if ("name" in input) return input;
  const name = input.$ref.replace("#/parameters/", "");
  const parameter = swagger.parameters[name];
  if (!input.$ref.startsWith("#/parameters/") || !parameter) throw new Error(`Unknown connector parameter: ${input.$ref}`);
  return parameter;
}

export const costActions = Object.entries(swagger.paths).flatMap(([path, methods]) =>
  Object.entries(methods).flatMap(([method, operation]) => {
    if (!operation.operationId) return [];
    return [{
      id: operation.operationId,
      title: operation.summary ?? operation.operationId,
      description: operation.description ?? "",
      method: method.toUpperCase(),
      path: path.replace("/{connectionId}", ""),
      group: operation.tags?.[0] ?? "Other",
      readOnly: method === "get",
      registered: registered.has(operation.operationId),
      docUrl: operation.externalDocs?.url,
      parameters: (operation.parameters ?? []).map(resolveParameter).filter((p) => p.name !== "connectionId"),
      responses: Object.entries(operation.responses ?? {}).map(([status, value]) => {
        const response = value.$ref ? swagger.responses[value.$ref.replace("#/responses/", "")] : value;
        if (!response) throw new Error(`Unknown connector response: ${value.$ref}`);
        return { status, ...response };
      }),
    }];
  }),
).sort((a, b) => a.title.localeCompare(b.title));

export type CostAction = typeof costActions[number];

export function parameterSchema(parameter: ActionParameter): JsonSchema {
  return parameter.schema ?? { ...parameter, required: undefined };
}

export function initialInputs(action: CostAction): Record<string, string> {
  return Object.fromEntries(action.parameters.map((p) => [p.name, ""]));
}

export function validateParameters(action: CostAction, parameters: Record<string, unknown>): void {
  for (const name of Object.keys(parameters)) {
    if (!action.parameters.some((p) => p.name === name)) throw new Error(`Unknown parameter: ${name}.`);
  }
  for (const parameter of action.parameters) {
    const value = parameters[parameter.name];
    if (value === undefined) {
      if (parameter.required) throw new Error(`${parameter.name} is required.`);
      continue;
    }
    if (typeof value === "string" && !value.trim() && parameter.required) throw new Error(`${parameter.name} is required.`);
    schemaTools.validateValue(value, parameterSchema(parameter), parameter.name);
    if (parameter.name === "If-Match" && (value === "*" || typeof value !== "string" || /[\r\n]/.test(value))) {
      throw new Error("If-Match must be the current parent policy ETag, not a wildcard or a multiline value.");
    }
    if (parameter.in === "body") {
      validateCostBody(value);
      if (isJsonObject(value) && typeof value.displayName === "string" && !/^[\p{L}\p{N} ]+$/u.test(value.displayName)) {
        throw new Error("body.displayName: use letters, digits and spaces only.");
      }
    }
  }
  validateWave2Parameters(action.id, parameters);
}

export function parseInputs(action: CostAction, inputs: Record<string, string>): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const p of action.parameters) {
    const raw = inputs[p.name] ?? "";
    if (!raw.trim()) continue;
    if (p.in === "body" || schemaTools.resolveSchema(parameterSchema(p)).type !== "string") {
      try {
        parameters[p.name] = JSON.parse(raw);
      } catch {
        throw new Error(`${p.name}: enter valid JSON.`);
      }
    } else parameters[p.name] = raw;
  }
  validateParameters(action, parameters);
  return parameters;
}

export interface CostRequest {
  actionId: string;
  parameters: Record<string, unknown>;
}

export function requestPreview(action: CostAction, parameters: Record<string, unknown>) {
  validateParameters(action, parameters);
  let path = action.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};
  let body: unknown;
  for (const p of action.parameters) {
    const value = parameters[p.name];
    if (value === undefined) continue;
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)));
    if (p.in === "query") query.set(p.name, String(value));
    if (p.in === "header") headers[p.name] = String(value);
    if (p.in === "body") {
      body = value;
      headers["Content-Type"] = "application/json";
    }
  }
  return {
    method: action.method,
    url: `${graphRoot}${path}${query.size ? `?${query}` : ""}`,
    headers,
    ...(body === undefined ? {} : { body }),
  };
}
