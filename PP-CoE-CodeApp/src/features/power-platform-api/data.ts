import { PP_API_Wrapper_FlowService } from "../../generated/services/PP_API_Wrapper_FlowService";
import { invalidateInventoryCache } from "../../data/inventory";
import { formatApiError, isJsonObject } from "../../shared/api-explorer/schema";
import { buildApiRequest, getOperation, isReadOnly } from "./catalog";
import type { ApiRequestInputs, ApiResponse, ApiResult } from "./types";

function parseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function normalizeFlowResponse(raw: string): ApiResult {
  const parsed = parseBody(raw);
  const response: ApiResponse = { body: parsed, raw };
  if (isJsonObject(parsed) && typeof parsed.statusCode === "number" && Object.hasOwn(parsed, "body")) {
    response.body = typeof parsed.body === "string" ? parseBody(parsed.body) : parsed.body;
    response.status = parsed.statusCode;
    response.headers = parsed.headers;
  }
  const bodyError = isJsonObject(response.body) ? response.body.error : undefined;
  if (bodyError !== undefined && bodyError !== null) {
    return { ok: false, error: formatApiError(bodyError), data: response };
  }
  if (response.status !== undefined && (response.status < 200 || response.status >= 300)) {
    return { ok: false, error: `HTTP ${response.status}: ${formatApiError(response.body)}`, data: response };
  }
  return { ok: true, data: response };
}

export async function executeApiRequest(inputs: ApiRequestInputs, confirmedWrite = false): Promise<ApiResult> {
  let attemptedWrite = false;
  try {
    const operation = getOperation(inputs.operationId);
    const request = buildApiRequest(inputs);
    if (!isReadOnly(operation) && !confirmedWrite) {
      return { ok: false, error: "Review and confirm this exact request before making tenant changes." };
    }
    attemptedWrite = !isReadOnly(operation);
    const result = await PP_API_Wrapper_FlowService.Run({
      text: request.method,
      text_1: request.url,
      text_2: request.body,
    });
    if (!result.success) return { ok: false, error: formatApiError(result.error) };
    if (typeof result.data?.response !== "string") {
      return { ok: false, error: "PP-API-Wrapper-Flow did not return its expected response text. Check the flow's response action and run history." };
    }
    return normalizeFlowResponse(result.data.response);
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  } finally {
    if (attemptedWrite) invalidateInventoryCache();
  }
}
