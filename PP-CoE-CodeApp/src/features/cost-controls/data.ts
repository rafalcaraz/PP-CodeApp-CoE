import type { IOperationResult } from "@microsoft/power-apps/data";
import { CostControsl_CustomConnService as service } from "../../generated/services/CostControsl_CustomConnService";
import type {
  AlertSetting, CreateSpendingPolicy, GroupCollection, ServiceSettingCollection, SpendingPolicy,
  UpdateAlertSetting, UpdateSpendingPolicy, UserBalance, UserCollection,
} from "../../generated/models/CostControsl_CustomConnModel";
import { formatApiError, isJsonObject } from "../../shared/api-explorer/schema";
import { validateCostBody } from "../../shared/cost-controls/validation";
import { invalidateInventoryCache } from "../../data/inventory";

export type Result<T> = { ok: true; data: T; raw: unknown } | { ok: false; error: string; raw?: unknown };

export async function call<T>(run: () => Promise<IOperationResult<T>>, expectBody = false): Promise<Result<T>> {
  try {
    const raw = await run();
    if (!raw.success) return { ok: false, error: formatApiError(raw.error), raw };
    if (isJsonObject(raw.data) && raw.data.error !== undefined) return { ok: false, error: formatApiError(raw.data.error), raw };
    if (expectBody && !isJsonObject(raw.data)) return { ok: false, error: "The connector returned no usable response body. Inspect the SDK response and connector response contract.", raw };
    return { ok: true, data: raw.data, raw };
  } catch (error) {
    return { ok: false, error: formatApiError(error), raw: error };
  }
}

export const getTenantBalance = () => call(() => service.GetTenantCreditBalance(), true);
export const getUserBalance = (userId: string) => {
  if (!userId.trim()) return Promise.resolve<Result<UserBalance>>({ ok: false, error: "Enter a directory user ID." });
  return call(() => service.GetUserBalance(userId.trim(), undefined, "serviceBalances"), true);
};
export const listPolicies = () => call(() => service.ListSpendingPolicies(), true);

export interface PolicyContext {
  id: string;
  policy: Result<SpendingPolicy>;
  services: Result<ServiceSettingCollection>;
  groups: Result<GroupCollection> | null;
  alerts: Result<AlertSetting>;
  recipients: Result<UserCollection>;
}

export async function loadPolicy(id: string): Promise<PolicyContext> {
  const [policy, services, alerts, recipients] = await Promise.all([
    call(() => service.GetSpendingPolicy(id), true),
    call(() => service.ListServiceSettings(id), true),
    call(() => service.GetAlertSetting(id), true),
    call(() => service.ListRecipients(id), true),
  ]);
  const groups = policy.ok && policy.data["@odata.type"] === "#microsoft.graph.selectedGroupsSpendingPolicy"
    ? await call(() => service.ListAssignedGroups(id), true) : null;
  return { id, policy, services, groups, alerts, recipients };
}

function headerEtag(raw: unknown): string | undefined {
  if (!isJsonObject(raw) || !isJsonObject(raw.headers)) return undefined;
  const key = Object.keys(raw.headers).find((name) => name.toLowerCase() === "etag");
  return key && typeof raw.headers[key] === "string" ? raw.headers[key] : undefined;
}

export function concurrency(context: PolicyContext): { etag?: string; blocked?: string } {
  if (!context.policy.ok) return { blocked: "Policy details could not be read. Refresh and check your Graph permissions and directory role." };
  if (!["enabled", "disabled"].includes(context.policy.data.status ?? "")) {
    return { blocked: `This policy is not editable in its current state (${context.policy.data.status ?? "unknown"}). Refresh after provisioning completes.` };
  }
  if (context.services.ok && context.services.data.value?.some((setting) =>
    setting.parentStatus !== undefined && !["enabled", "disabled"].includes(setting.parentStatus))) {
    return { blocked: "Service settings report a noneditable parent state. Refresh after provisioning completes." };
  }
  const tokens: string[] = [];
  const header = headerEtag(context.policy.raw);
  if (header) tokens.push(header);
  const annotation = context.policy.data["@odata.etag"];
  if (annotation) tokens.push(annotation);
  if (context.services.ok) {
    tokens.push(...(context.services.data.value ?? []).flatMap((setting) => setting.parentEtag ? [setting.parentEtag] : []));
  }
  const unique = [...new Set(tokens)];
  if (unique.length > 1) return { blocked: "The parent ETags disagree, possibly because the policy changed during loading. Refresh before reviewing a change." };
  const etag = unique[0];
  if (!etag || !/^(?:W\/)?"[^"\r\n]+"$/.test(etag)) return {
    blocked: "No usable parent ETag was exposed by the connector. Refresh policy details and service settings. If parentEtag and policy ETag headers remain unavailable, update the connector/SDK response contract before making changes. Wildcard or manual ETag bypasses are not allowed.",
  };
  return { etag };
}

export type PolicyChange =
  | { kind: "updatePolicy"; body: UpdateSpendingPolicy }
  | { kind: "deletePolicy" }
  | { kind: "addGroup"; groupId: string }
  | { kind: "removeGroup"; groupId: string }
  | { kind: "addService"; serviceId: string; state: "enabled" | "disabled" }
  | { kind: "updateService"; serviceId: string; state: "enabled" | "disabled" }
  | { kind: "updateAlert"; body: UpdateAlertSetting }
  | { kind: "deleteAlert" }
  | { kind: "addRecipient"; userId: string }
  | { kind: "removeRecipient"; userId: string };

export function validateChange(change: PolicyChange, context?: PolicyContext): void {
  if ("body" in change) validateCostBody(change.body);
  if (change.kind === "updatePolicy") {
    const name = change.body.displayName;
    if (name !== undefined && (name.length < 10 || name.length > 64 || !/^[\p{L}\p{N} ]+$/u.test(name))) {
      throw new Error("Policy name must be 10-64 characters using letters, digits and spaces.");
    }
  }
  if ("groupId" in change && !change.groupId.trim()) throw new Error("Enter a directory group ID.");
  if ("userId" in change && !change.userId.trim()) throw new Error("Enter a directory user ID.");
  if ("serviceId" in change && !change.serviceId.trim()) throw new Error("Enter a service category ID.");
  if (change.kind === "addGroup" || change.kind === "removeGroup") {
    if (context?.policy.ok && context.policy.data["@odata.type"] !== "#microsoft.graph.selectedGroupsSpendingPolicy") throw new Error("Only selected-group policies have assigned groups.");
  }
  if (change.kind === "removeGroup" && context?.groups?.ok && !context.groups.data["@odata.nextLink"] &&
    context.groups.data.value?.length === 1 && context.groups.data.value[0].id === change.groupId) {
    throw new Error("Keep at least one group assigned to this policy.");
  }
  if (change.kind === "updateService" && change.state === "disabled" && context?.services.ok) {
    const entries = context.services.data.value ?? [];
    if (!context.services.data["@odata.nextLink"] && entries.filter((entry) => entry.state === "enabled").length <= 1 &&
      entries.some((entry) => entry.serviceId === change.serviceId && entry.state === "enabled")) {
      throw new Error("Keep at least one service enabled on the policy.");
    }
  }
  if (change.kind === "updateAlert" && change.body.isEnabled === true && context &&
    (!context.recipients.ok || !context.recipients.data.value?.length)) throw new Error("Read and confirm at least one alert recipient before enabling notifications.");
  if (change.kind === "removeRecipient" && context?.alerts.ok && context.alerts.data.isEnabled &&
    context.recipients.ok && !context.recipients.data["@odata.nextLink"] && context.recipients.data.value?.length === 1 &&
    context.recipients.data.value[0].id === change.userId) throw new Error("Disable notifications before removing the last recipient.");
  if (change.kind === "updateAlert" && context?.policy.ok) {
    for (const threshold of change.body.thresholds ?? []) {
      if (threshold["@odata.type"] === "#microsoft.graph.absoluteCostManagementAlertThreshold" &&
        threshold.unit !== context.policy.data.periodLimit?.unit) throw new Error("Absolute alert units must match the policy limit unit.");
    }
  }
}

async function dispatch(id: string, etag: string, change: PolicyChange) {
  switch (change.kind) {
    case "updatePolicy": return call(() => service.UpdateSpendingPolicy(id, etag, change.body));
    case "deletePolicy": return call(() => service.DeleteSpendingPolicy(id, etag));
    case "addGroup": return call(() => service.AddAssignedGroup(id, etag, { "@odata.id": `https://graph.microsoft.com/beta/groups/${encodeURIComponent(change.groupId.trim())}` }));
    case "removeGroup": return call(() => service.RemoveAssignedGroup(id, change.groupId, etag));
    case "addService": return call(() => service.CreateServiceSetting(id, etag, { serviceId: change.serviceId.trim(), state: change.state }));
    case "updateService": return call(() => service.UpdateServiceSetting(id, change.serviceId, etag, { state: change.state }));
    case "updateAlert": return call(() => service.UpdateAlertSetting(id, etag, change.body));
    case "deleteAlert": return call(() => service.DeleteAlertSetting(id, etag));
    case "addRecipient": return call(() => service.AddRecipient(id, etag, { "@odata.id": `https://graph.microsoft.com/beta/users/${encodeURIComponent(change.userId.trim())}` }));
    case "removeRecipient": return call(() => service.RemoveRecipient(id, change.userId, etag));
  }
}

export async function applyChange(id: string, reviewedEtag: string, change: PolicyChange, confirmed = false): Promise<Result<unknown>> {
  if (!confirmed) return { ok: false, error: "Review and confirm this policy change first." };
  let attempted = false;
  try {
    const fresh = await loadPolicy(id);
    const token = concurrency(fresh);
    if (!token.etag) return { ok: false, error: token.blocked ?? "No parent ETag available." };
    if (token.etag !== reviewedEtag) return { ok: false, error: "The policy changed since you reviewed it. Refresh and review the change again; nothing was written." };
    validateChange(change, fresh);
    attempted = true;
    return await dispatch(id, reviewedEtag, change);
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  } finally {
    if (attempted) invalidateInventoryCache();
  }
}

export async function createPolicy(body: CreateSpendingPolicy, confirmed = false): Promise<Result<unknown>> {
  if (!confirmed) return { ok: false, error: "Review and confirm the new policy first." };
  let attempted = false;
  try {
    validateChange({ kind: "updatePolicy", body });
    if (!body.displayName || !body.serviceSettings.length || !body.serviceSettings.some((setting) => setting.state === "enabled")) {
      return { ok: false, error: "Provide a policy name and at least one enabled service." };
    }
    for (const setting of body.serviceSettings) if (!setting.serviceId.trim()) return { ok: false, error: "Enter a service category ID." };
    attempted = true;
    return await call(() => service.CreateSpendingPolicy(body));
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  } finally {
    if (attempted) invalidateInventoryCache();
  }
}
