import { PP_API_Wrapper_FlowService } from "../generated/services/PP_API_Wrapper_FlowService";
import { formatApiError, isJsonObject } from "./api-explorer/schema";

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
  download?: { filename: string; bytes: Uint8Array<ArrayBuffer>; contentType: string };
}

export type ApiResult =
  | { ok: true; data: ApiResponse }
  | { ok: false; error: string; data?: ApiResponse };

function parseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function normalizeFlowResponse(raw: string, downloadFileName?: string): ApiResult {
  const parsed = parseBody(raw);
  const response: ApiResponse = { body: parsed, raw };
  if (isJsonObject(parsed) && typeof parsed.statusCode === "number") {
    if (Object.hasOwn(parsed, "body")) response.body = typeof parsed.body === "string" ? parseBody(parsed.body) : parsed.body;
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
  if (downloadFileName !== undefined) {
    try {
      if (!isJsonObject(response.body) || typeof response.body.$content !== "string") {
        throw new Error("The flow did not preserve the gzip file as a base64 $content object. Update PP-API-Wrapper-Flow to return the HTTP outputs without converting binary content to text.");
      }
      const decoded = atob(response.body.$content);
      const bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) {
        throw new Error("The returned file is not gzip data. Inspect the raw flow response; no download was created.");
      }
      response.download = {
        filename: Array.from(downloadFileName, (character) =>
          character.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(character) ? "_" : character).join("") || "licensing-report.csv.gz",
        bytes, contentType: "application/gzip",
      };
    } catch (error) {
      return { ok: false, error: `Report download failed: ${formatApiError(error)}`, data: response };
    }
  }
  return { ok: true, data: response };
}

export async function executePowerPlatformRequest(
  request: FlowHttpRequest, confirmedWrite = false, downloadFileName?: string,
): Promise<ApiResult> {
  try {
    const url = new URL(request.url);
    if (url.origin !== "https://api.powerplatform.com" || url.username || url.password || url.hash) {
      throw new Error("Only the Power Platform API host is allowed.");
    }
    if (!["GET", "HEAD"].includes(request.method) && !confirmedWrite) {
      return { ok: false, error: "Review and confirm this exact request before making tenant changes." };
    }
    const result = await PP_API_Wrapper_FlowService.Run({
      text: request.method, text_1: request.url, text_2: request.body,
    });
    if (!result.success) return { ok: false, error: formatApiError(result.error) };
    if (typeof result.data?.response !== "string") {
      return { ok: false, error: "PP-API-Wrapper-Flow did not return its expected response text. Check the flow's response action and run history." };
    }
    return normalizeFlowResponse(result.data.response, downloadFileName);
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  }
}
