import { CostControsl_CustomConnService as service } from "../../generated/services/CostControsl_CustomConnService";
import type {
  CreateServiceSetting, CreateSpendingPolicy, GroupReference, UpdateAlertSetting,
  UpdateServiceSetting, UpdateSpendingPolicy, UserReference,
} from "../../generated/models/CostControsl_CustomConnModel";
import { invalidateInventoryCache } from "../../data/inventory";
import { formatApiError } from "../../shared/api-explorer/schema";
import { costActions, schemaTools, validateParameters, type CostRequest } from "./catalog";

type Parameters = Record<string, unknown>;

function text(p: Parameters, name: string): string {
  const value = p[name];
  if (typeof value !== "string") throw new Error(`${name}: expected text.`);
  return value;
}

function optionalText(p: Parameters, name: string): string | undefined {
  return p[name] === undefined ? undefined : text(p, name);
}

function top(p: Parameters): number | undefined {
  if (p.$top === undefined) return undefined;
  if (typeof p.$top !== "number") throw new Error("$top: expected a number.");
  return p.$top;
}

function count(p: Parameters): boolean | undefined {
  if (p.$count === undefined) return undefined;
  if (typeof p.$count !== "boolean") throw new Error("$count: expected a boolean.");
  return p.$count;
}

function expand(p: Parameters): "serviceBalances" | undefined {
  if (p.$expand === undefined || p.$expand === "serviceBalances") return p.$expand;
  throw new Error("$expand: only serviceBalances is supported.");
}

function body<T>(p: Parameters, definition: string): T {
  schemaTools.validateValue(p.body, { $ref: `#/definitions/${definition}` }, "body");
  // The generated model and runtime schema come from the same registered connector.
  return p.body as T;
}

export const costDispatch = {
  GetTenantCreditBalance: () => service.GetTenantCreditBalance(),
  ListSpendingPolicies: (p: Parameters) => service.ListSpendingPolicies(optionalText(p, "$select"), top(p), count(p), optionalText(p, "$filter"), optionalText(p, "$orderby")),
  CreateSpendingPolicy: (p: Parameters) => service.CreateSpendingPolicy(body<CreateSpendingPolicy>(p, "CreateSpendingPolicy")),
  GetSpendingPolicy: (p: Parameters) => service.GetSpendingPolicy(text(p, "id"), optionalText(p, "$select")),
  UpdateSpendingPolicy: (p: Parameters) => service.UpdateSpendingPolicy(text(p, "id"), text(p, "If-Match"), body<UpdateSpendingPolicy>(p, "UpdateSpendingPolicy")),
  DeleteSpendingPolicy: (p: Parameters) => service.DeleteSpendingPolicy(text(p, "id"), text(p, "If-Match")),
  ListAssignedGroups: (p: Parameters) => service.ListAssignedGroups(text(p, "id")),
  ListAssignedGroupReferences: (p: Parameters) => service.ListAssignedGroupReferences(text(p, "id")),
  AddAssignedGroup: (p: Parameters) => service.AddAssignedGroup(text(p, "id"), text(p, "If-Match"), body<GroupReference>(p, "GroupReference")),
  RemoveAssignedGroup: (p: Parameters) => service.RemoveAssignedGroup(text(p, "id"), text(p, "groupId"), text(p, "If-Match")),
  ListServiceSettings: (p: Parameters) => service.ListServiceSettings(text(p, "id"), optionalText(p, "$select")),
  CreateServiceSetting: (p: Parameters) => service.CreateServiceSetting(text(p, "id"), text(p, "If-Match"), body<CreateServiceSetting>(p, "CreateServiceSetting")),
  GetServiceSetting: (p: Parameters) => service.GetServiceSetting(text(p, "id"), text(p, "serviceId"), optionalText(p, "$select")),
  UpdateServiceSetting: (p: Parameters) => service.UpdateServiceSetting(text(p, "id"), text(p, "serviceId"), text(p, "If-Match"), body<UpdateServiceSetting>(p, "UpdateServiceSetting")),
  GetAlertSetting: (p: Parameters) => service.GetAlertSetting(text(p, "id"), optionalText(p, "$select")),
  UpdateAlertSetting: (p: Parameters) => service.UpdateAlertSetting(text(p, "id"), text(p, "If-Match"), body<UpdateAlertSetting>(p, "UpdateAlertSetting")),
  DeleteAlertSetting: (p: Parameters) => service.DeleteAlertSetting(text(p, "id"), text(p, "If-Match")),
  ListRecipients: (p: Parameters) => service.ListRecipients(text(p, "id")),
  ListRecipientReferences: (p: Parameters) => service.ListRecipientReferences(text(p, "id")),
  AddRecipient: (p: Parameters) => service.AddRecipient(text(p, "id"), text(p, "If-Match"), body<UserReference>(p, "UserReference")),
  RemoveRecipient: (p: Parameters) => service.RemoveRecipient(text(p, "id"), text(p, "userId"), text(p, "If-Match")),
  GetUserBalance: (p: Parameters) => service.GetUserBalance(text(p, "userId"), optionalText(p, "$select"), expand(p)),
  ListUserServiceBalances: (p: Parameters) => service.ListUserServiceBalances(text(p, "userId"), optionalText(p, "$select"), top(p), count(p), optionalText(p, "$filter"), optionalText(p, "$orderby")),
  GetUserServiceBalance: (p: Parameters) => service.GetUserServiceBalance(text(p, "userId"), text(p, "serviceId"), optionalText(p, "$select")),
};

function hasDispatch(id: string): id is keyof typeof costDispatch {
  return Object.hasOwn(costDispatch, id);
}

export function unsupportedReason(id: string): string | undefined {
  if (!costActions.find((action) => action.id === id)?.registered) return "This action is not registered in the app connection metadata.";
  if (!hasDispatch(id)) return "This action has no generated service dispatch. Refresh the connector SDK before using it.";
  return undefined;
}

export type CostResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown };

export async function executeCostRequest(request: CostRequest, confirmedWrite = false): Promise<CostResult> {
  const action = costActions.find((entry) => entry.id === request.actionId);
  const unavailable = unsupportedReason(request.actionId);
  if (!action || unavailable || !hasDispatch(request.actionId)) return { ok: false, error: unavailable ?? "Unknown Cost Management action." };
  if (!action.readOnly && !confirmedWrite) return { ok: false, error: "Review and confirm this exact request before making tenant changes." };
  let attemptedWrite = false;
  try {
    validateParameters(action, request.parameters);
    attemptedWrite = !action.readOnly;
    const result = await costDispatch[request.actionId](request.parameters);
    if (!result.success) return { ok: false, error: formatApiError(result.error), data: result };
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: formatApiError(error), data: error };
  } finally {
    if (attemptedWrite) invalidateInventoryCache();
  }
}
