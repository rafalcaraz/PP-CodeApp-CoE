import snapshotJson from "./catalog.generated.json";
import { createSchemaTools } from "../../shared/api-explorer/schema";
import type { ApiCatalog, ApiOperation, ApiParameter, ApiRequestInputs, FlowHttpRequest } from "./types";

export const apiCatalog = snapshotJson as ApiCatalog;
export const schemaTools = createSchemaTools(apiCatalog.definitions);
export const apiOperations = [...apiCatalog.operations].sort((a, b) =>
  `${a.section} ${a.group} ${a.title}`.localeCompare(`${b.section} ${b.group} ${b.title}`),
);
export const API_ORIGIN = "https://api.powerplatform.com";
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

export function getOperation(id: string): ApiOperation {
  const operation = apiOperations.find((entry) => entry.id === id);
  if (!operation) throw new Error("Select an operation from the documented API catalog.");
  return operation;
}

export function parameterKey(parameter: ApiParameter): string {
  return `${parameter.in}:${parameter.name}`;
}

export function initialApiInputs(operation: ApiOperation): ApiRequestInputs {
  return {
    operationId: operation.id,
    parameters: Object.fromEntries(operation.parameters.map((parameter) => {
      const value = schemaTools.resolveSchema(parameter.schema).default;
      return [parameterKey(parameter), value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)];
    })),
    body: "",
  };
}

export function isReadOnly(operation: ApiOperation): boolean {
  return operation.method === "GET" || operation.method === "HEAD";
}

export function unsupportedReason(operation: ApiOperation): string | undefined {
  const requiredHeaders = operation.parameters.filter((parameter) => parameter.in === "header" && parameter.required);
  if (requiredHeaders.length) {
    return `This operation requires headers (${requiredHeaders.map((parameter) => parameter.name).join(", ")}). PP-API-Wrapper-Flow currently accepts only Method, URL, and Body; extend the flow before running this operation.`;
  }
  if (!METHODS.has(operation.method)) return `The wrapper does not support the documented HTTP method ${operation.method}.`;
  const unsupportedParameters = operation.parameters.filter((parameter) => !["path", "query", "header"].includes(parameter.in));
  if (unsupportedParameters.length) return "This operation needs a transport not supported by the flow's Method, URL, and JSON Body contract.";
  return undefined;
}

function parseParameter(parameter: ApiParameter, raw: string): unknown {
  const schema = schemaTools.resolveSchema(parameter.schema);
  let value: unknown = raw;
  if (schema.type && schema.type !== "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`${parameter.name}: enter valid ${schema.type === "array" ? "JSON array" : schema.type}.`);
    }
  }
  schemaTools.validateValue(value, schema, parameter.name);
  return value;
}

export function buildApiRequest(inputs: ApiRequestInputs): FlowHttpRequest {
  const operation = getOperation(inputs.operationId);
  const blocked = unsupportedReason(operation);
  if (blocked) throw new Error(blocked);
  for (const key of Object.keys(inputs.parameters)) {
    if (!operation.parameters.some((parameter) => parameterKey(parameter) === key)) throw new Error(`Unknown input: ${key}.`);
  }
  let path = operation.path;
  const query = new URLSearchParams();
  for (const parameter of operation.parameters) {
    const raw = inputs.parameters[parameterKey(parameter)] ?? "";
    if (parameter.in === "header") {
      if (raw.trim()) throw new Error(`${parameter.name}: this flow cannot forward custom headers.`);
      continue;
    }
    if (!raw.trim()) {
      if (parameter.required) throw new Error(`${parameter.name} is required.`);
      continue;
    }
    const value = parseParameter(parameter, raw);
    if (parameter.in === "path") {
      if (raw === "." || raw === "..") throw new Error(`${parameter.name}: path traversal segments are not allowed.`);
      path = path.replaceAll(`{${parameter.name}}`, encodeURIComponent(raw));
    } else if (Array.isArray(value)) {
      const separator = parameter.collectionFormat === "ssv" ? " " : parameter.collectionFormat === "pipes" ? "|" : ",";
      if (parameter.collectionFormat === "multi") value.forEach((item) => query.append(parameter.name, String(item)));
      else query.set(parameter.name, value.map(String).join(separator));
    } else {
      query.set(parameter.name, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  if (!path.startsWith("/") || path.startsWith("//") || /[{}?#\\]/.test(path)) {
    throw new Error("The documented path has unresolved or unsupported URL components.");
  }
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error("Only the documented Power Platform API host is allowed.");
  url.search = query.toString();
  if (operation.body) {
    if (!inputs.body.trim()) {
      if (operation.body.required) throw new Error("Request body is required.");
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(inputs.body);
      } catch {
        throw new Error("Request body must be valid JSON.");
      }
      schemaTools.validateValue(parsed, operation.body.schema, "body");
    }
  } else if (inputs.body.trim()) {
    throw new Error("This operation does not document a request body.");
  }
  return { method: operation.method, url: url.toString(), body: inputs.body.trim() ? inputs.body : "" };
}
