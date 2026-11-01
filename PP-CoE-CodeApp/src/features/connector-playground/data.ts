import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../../.power/schemas/appschemas/dataSourcesInfo";
import { invalidateInventoryCache, type DataResult } from "../../data/inventory";
import { connectorActions, validateParameters } from "./catalog";

export interface PlaygroundRequest {
  actionId: string;
  parameters: Record<string, unknown>;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? "The connector returned an unknown error.";
}

export async function executeAction(
  request: PlaygroundRequest,
  confirmedWrite = false,
): Promise<DataResult<unknown>> {
  const action = connectorActions.find((entry) => entry.id === request.actionId);
  if (!action) return { ok: false, error: "This action is not registered in the app's connector metadata." };
  if (!action.readOnly && !confirmedWrite) return { ok: false, error: "Confirm the action and inputs before making tenant changes." };
  let attemptedWrite = false;
  try {
    validateParameters(action, request.parameters);
    attemptedWrite = !action.readOnly;
    // The SDK metadata includes newer actions not yet emitted by the generated service.
    const result = await getClient(dataSourcesInfo).executeAsync<Record<string, unknown>, unknown>({
      connectorOperation: {
        tableName: "powerplatformadminv2",
        operationName: action.id,
        parameters: request.parameters,
      },
    });
    if (!result.success) return { ok: false, error: errorText(result.error) };
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  } finally {
    if (attemptedWrite) invalidateInventoryCache();
  }
}
