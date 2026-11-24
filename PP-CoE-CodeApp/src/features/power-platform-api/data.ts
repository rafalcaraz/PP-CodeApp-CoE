import { invalidateInventoryCache } from "../../data/inventory";
import { formatApiError } from "../../shared/api-explorer/schema";
import { executePowerPlatformRequest } from "../../shared/power-platform-api";
import { buildApiRequest, getOperation, isReadOnly } from "./catalog";
import type { ApiRequestInputs, ApiResult } from "./types";
export { normalizeFlowResponse } from "../../shared/power-platform-api";

export async function executeApiRequest(inputs: ApiRequestInputs, confirmedWrite = false): Promise<ApiResult> {
  let attemptedWrite = false;
  try {
    const operation = getOperation(inputs.operationId);
    const request = buildApiRequest(inputs);
    if (!isReadOnly(operation) && !confirmedWrite) {
      return { ok: false, error: "Review and confirm this exact request before making tenant changes." };
    }
    attemptedWrite = !isReadOnly(operation);
    const downloadsGzip = operation.responses.some((response) =>
      response.status.startsWith("200") && response.mediaTypes?.includes("application/gzip"));
    return await executePowerPlatformRequest(request, confirmedWrite, downloadsGzip ? inputs.parameters["path:FileName"] : undefined);
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  } finally {
    if (attemptedWrite) invalidateInventoryCache();
  }
}
