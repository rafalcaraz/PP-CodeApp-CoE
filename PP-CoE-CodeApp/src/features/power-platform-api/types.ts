import type { JsonSchema } from "../../shared/api-explorer/schema";

export interface ApiParameter {
  name: string;
  in: string;
  required: boolean;
  description: string;
  schema: JsonSchema;
  collectionFormat?: string;
}

export interface ApiOperation {
  id: string;
  section: string;
  group: string;
  title: string;
  description: string;
  method: string;
  path: string;
  docUrl: string;
  sourceRevision: string;
  warnings: string[];
  parameters: ApiParameter[];
  body?: { required: boolean; description: string; schema: JsonSchema };
  responses: { status: string; description: string; schema?: JsonSchema }[];
}

export interface ApiCatalog {
  source: {
    url: string;
    revision: string;
    generatedAt: string;
    license: string;
    operationCount: number;
    contentHash: string;
  };
  operations: ApiOperation[];
  definitions: Record<string, JsonSchema>;
}

export interface ApiRequestInputs {
  operationId: string;
  parameters: Record<string, string>;
  body: string;
}

export interface FlowHttpRequest {
  method: string;
  url: string;
  body: string;
}

export interface ApiResponse {
  body: unknown;
  raw: string;
  status?: number;
  headers?: unknown;
}

export type ApiResult =
  | { ok: true; data: ApiResponse }
  | { ok: false; error: string; data?: ApiResponse };
