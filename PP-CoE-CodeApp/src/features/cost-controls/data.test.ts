import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSpendingPolicy, Quantity } from "../../generated/models/CostControsl_CustomConnModel";

const { executeAsync, invalidateInventoryCache } = vi.hoisted(() => ({ executeAsync: vi.fn(), invalidateInventoryCache: vi.fn() }));
vi.mock("@microsoft/power-apps/data", () => ({ getClient: () => ({ executeAsync }) }));
vi.mock("../../data/inventory", () => ({ invalidateInventoryCache }));
import { CostControsl_CustomConnService as service } from "../../generated/services/CostControsl_CustomConnService";
import {
  applyChange, concurrency, createPolicy, getTenantBalance, getUserBalance, listPolicies, loadPolicy, validateChange,
  type PolicyChange, type PolicyContext,
} from "./data";

const etag = 'W/"7"';
const quantity: Quantity = { "@odata.type": "#microsoft.graph.limitedCostManagementQuantity", unit: "copilotCredit", value: 0 };
const createBody: CreateSpendingPolicy = {
  "@odata.type": "#microsoft.graph.selectedGroupsSpendingPolicy", displayName: "Example policy",
  periodLimit: quantity, perUserLimit: quantity, serviceSettings: [{ serviceId: "workIQ", state: "enabled" }],
};
function context(): PolicyContext {
  return {
    id: "p",
    policy: { ok: true, data: { id: "p", displayName: "Example policy", status: "enabled", "@odata.type": createBody["@odata.type"], periodLimit: quantity }, raw: {} },
    services: { ok: true, data: { value: [{ serviceId: "workIQ", state: "enabled", parentEtag: etag }, { serviceId: "cowork", state: "enabled", parentEtag: etag }] }, raw: {} },
    groups: { ok: true, data: { value: [{ id: "g" }, { id: "other" }] }, raw: {} },
    alerts: { ok: true, data: { isEnabled: false }, raw: {} },
    recipients: { ok: true, data: { value: [{ id: "u" }, { id: "other" }] }, raw: {} },
  };
}
let current: PolicyContext;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  current = context();
  executeAsync.mockImplementation(async ({ connectorOperation }: { connectorOperation: { operationName: string } }) => {
    switch (connectorOperation.operationName) {
      case "GetSpendingPolicy": return current.policy.ok ? { success: true, data: current.policy.data, ...current.policy.raw as object } : { success: false, error: current.policy.error };
      case "ListServiceSettings": return current.services.ok ? { success: true, data: current.services.data } : { success: false, error: current.services.error };
      case "ListAssignedGroups": return current.groups?.ok ? { success: true, data: current.groups.data } : { success: false, error: "No groups" };
      case "GetAlertSetting": return current.alerts.ok ? { success: true, data: current.alerts.data } : { success: false, error: current.alerts.error };
      case "ListRecipients": return current.recipients.ok ? { success: true, data: current.recipients.data } : { success: false, error: current.recipients.error };
      default: return { success: true, data: { value: [] } };
    }
  });
});

describe("direct typed Cost Controls reads", () => {
  it("uses only known-user expansion, no user scan, continuation, or mutating calls", async () => {
    const tenant = vi.spyOn(service, "GetTenantCreditBalance");
    const policies = vi.spyOn(service, "ListSpendingPolicies");
    const user = vi.spyOn(service, "GetUserBalance");
    await getTenantBalance(); await listPolicies(); await getUserBalance(" u ");
    expect(tenant).toHaveBeenCalledExactlyOnceWith();
    expect(policies).toHaveBeenCalledExactlyOnceWith();
    expect(user).toHaveBeenCalledExactlyOnceWith("u", undefined, "serviceBalances");
    expect((await getUserBalance(" ")).ok).toBe(false);
    expect(executeAsync).toHaveBeenCalledTimes(3);
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
  it("keeps independently failed policy children and fetches groups only for the derived audience", async () => {
    current.alerts = { ok: false, error: "403 missing role" };
    const result = await loadPolicy("p");
    expect(result.alerts).toMatchObject({ ok: false, error: "403 missing role" });
    expect(result.policy.ok).toBe(true);
    expect(result.groups?.ok).toBe(true);
    if (current.policy.ok) current.policy.data["@odata.type"] = "#microsoft.graph.allUsersSpendingPolicy";
    executeAsync.mockClear();
    expect((await loadPolicy("p")).groups).toBeNull();
    expect(executeAsync).toHaveBeenCalledTimes(4);
  });
  it("preserves failures, raw evidence and nextLink without following arbitrary URLs", async () => {
    const raw = { success: true, data: { value: [], "@odata.nextLink": "https://graph.microsoft.com/opaque" } };
    executeAsync.mockResolvedValueOnce(raw);
    expect(await listPolicies()).toEqual({ ok: true, data: raw.data, raw });
    executeAsync.mockRejectedValueOnce(new Error("503 service unavailable"));
    expect(await getTenantBalance()).toMatchObject({ ok: false, error: "503 service unavailable" });
    expect(executeAsync).toHaveBeenCalledTimes(2);
  });
  it("rejects missing read bodies and success-shaped Graph errors while retaining evidence", async () => {
    const missing = { success: true, data: undefined };
    executeAsync.mockResolvedValueOnce(missing);
    expect(await getTenantBalance()).toMatchObject({ ok: false, error: expect.stringContaining("no usable response body"), raw: missing });
    const graphError = { success: true, data: { error: { code: "Forbidden", message: "Missing consent" } } };
    executeAsync.mockResolvedValueOnce(graphError);
    expect(await listPolicies()).toMatchObject({ ok: false, error: '{"code":"Forbidden","message":"Missing consent"}', raw: graphError });
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
});

describe("parent concurrency", () => {
  it("accepts only consistent parent annotations/headers/service-setting tokens", () => {
    expect(concurrency(current)).toEqual({ etag });
    current.services = { ok: false, error: "Missing services role" };
    expect(concurrency(current).blocked).toMatch(/No usable parent ETag/);
    if (current.policy.ok) current.policy.raw = { headers: { eTaG: etag } };
    expect(concurrency(current)).toEqual({ etag });
    if (current.policy.ok) current.policy.data["@odata.etag"] = etag;
    expect(concurrency(current)).toEqual({ etag });
    if (current.policy.ok) current.policy.data["@odata.etag"] = '"other"';
    expect(concurrency(current).blocked).toMatch(/disagree/);
  });
  it.each(["*", "unquoted", 'W/"bad\r\nheader"', ""])("blocks malformed/wildcard ETag %s", (token) => {
    if (current.services.ok) current.services.data.value = [{ parentEtag: token }];
    expect(concurrency(current).etag).toBeUndefined();
  });
  it.each(["provisioning", "provisioningFailed", "unknownFutureValue", undefined])("blocks noneditable lifecycle %s", (status) => {
    if (current.policy.ok) current.policy.data.status = status;
    expect(concurrency(current).blocked).toMatch(/not editable/);
  });
  it("blocks unreadable policy and noneditable child-reported parent status", () => {
    current.policy = { ok: false, error: "404" };
    expect(concurrency(current).blocked).toMatch(/could not be read/);
    current = context();
    if (current.services.ok) current.services.data.value = [{ parentEtag: etag, parentStatus: "provisioning" }];
    expect(concurrency(current).blocked).toMatch(/state/);
  });
});

const cases: { change: PolicyChange; method: Exclude<keyof typeof service, "prototype">; args: unknown[] }[] = [
  { change: { kind: "updatePolicy", body: { displayName: "Changed policy" } }, method: "UpdateSpendingPolicy", args: ["p", etag, { displayName: "Changed policy" }] },
  { change: { kind: "deletePolicy" }, method: "DeleteSpendingPolicy", args: ["p", etag] },
  { change: { kind: "addGroup", groupId: "g/space" }, method: "AddAssignedGroup", args: ["p", etag, { "@odata.id": "https://graph.microsoft.com/beta/groups/g%2Fspace" }] },
  { change: { kind: "removeGroup", groupId: "g" }, method: "RemoveAssignedGroup", args: ["p", "g", etag] },
  { change: { kind: "addService", serviceId: "cowork", state: "enabled" }, method: "CreateServiceSetting", args: ["p", etag, { serviceId: "cowork", state: "enabled" }] },
  { change: { kind: "updateService", serviceId: "workIQ", state: "disabled" }, method: "UpdateServiceSetting", args: ["p", "workIQ", etag, { state: "disabled" }] },
  { change: { kind: "updateAlert", body: { isEnabled: true, thresholds: [] } }, method: "UpdateAlertSetting", args: ["p", etag, { isEnabled: true, thresholds: [] }] },
  { change: { kind: "deleteAlert" }, method: "DeleteAlertSetting", args: ["p", etag] },
  { change: { kind: "addRecipient", userId: "u/name" }, method: "AddRecipient", args: ["p", etag, { "@odata.id": "https://graph.microsoft.com/beta/users/u%2Fname" }] },
  { change: { kind: "removeRecipient", userId: "u" }, method: "RemoveRecipient", args: ["p", "u", etag] },
];
describe("reviewed mutation dispatch", () => {
  it.each(cases)("$method revalidates before exactly one confirmed typed write", async ({ change, method, args }) => {
    const spy = vi.spyOn(service, method);
    expect((await applyChange("p", etag, change, true)).ok).toBe(true);
    expect(spy).toHaveBeenCalledExactlyOnceWith(...args);
    expect(executeAsync).toHaveBeenCalledTimes(6);
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });
  it("rejects every unconfirmed mutation without even reading", async () => {
    for (const entry of cases) expect((await applyChange("p", etag, entry.change)).ok).toBe(false);
    expect(executeAsync).not.toHaveBeenCalled();
  });
  it("does not write a stale reviewed ETag or replay a 412/timeout", async () => {
    expect(await applyChange("p", '"old"', { kind: "deletePolicy" }, true)).toMatchObject({ ok: false, error: expect.stringContaining("nothing was written") });
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
    const spy = vi.spyOn(service, "DeleteSpendingPolicy").mockResolvedValueOnce({ success: false, data: undefined, error: { message: "412 stale tag" } });
    expect(await applyChange("p", etag, { kind: "deletePolicy" }, true)).toMatchObject({ ok: false, error: '{"message":"412 stale tag"}' });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRejectedValueOnce(new Error("Write timeout"));
    expect(await applyChange("p", etag, { kind: "deletePolicy" }, true)).toMatchObject({ ok: false, error: "Write timeout" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(invalidateInventoryCache).toHaveBeenCalledTimes(2);
  });
  it("blocks missing fresh tokens before dispatch", async () => {
    if (current.services.ok) current.services.data.value = [];
    expect((await applyChange("p", etag, { kind: "deletePolicy" }, true)).ok).toBe(false);
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
  it("creates only on confirmation and does not invent a typed creation body", async () => {
    const spy = vi.spyOn(service, "CreateSpendingPolicy").mockResolvedValue({ success: true, data: undefined });
    expect((await createPolicy(createBody)).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(await createPolicy(createBody, true)).toMatchObject({ ok: true, data: undefined });
    expect(spy).toHaveBeenCalledExactlyOnceWith(createBody);
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });
});

describe("management invariants", () => {
  it("protects last enabled service only when the page is complete", () => {
    if (current.services.ok) current.services.data.value = [{ serviceId: "workIQ", state: "enabled", parentEtag: etag }];
    expect(() => validateChange({ kind: "updateService", serviceId: "workIQ", state: "disabled" }, current)).toThrow(/at least one service/);
    if (current.services.ok) current.services.data["@odata.nextLink"] = "opaque";
    expect(() => validateChange({ kind: "updateService", serviceId: "workIQ", state: "disabled" }, current)).not.toThrow();
  });
  it("protects the last group and last enabled-alert recipient", () => {
    current.groups = { ok: true, data: { value: [{ id: "g" }] }, raw: {} };
    expect(() => validateChange({ kind: "removeGroup", groupId: "g" }, current)).toThrow(/at least one group/);
    if (current.alerts.ok) current.alerts.data.isEnabled = true;
    current.recipients = { ok: true, data: { value: [{ id: "u" }] }, raw: {} };
    expect(() => validateChange({ kind: "removeRecipient", userId: "u" }, current)).toThrow(/Disable notifications/);
  });
  it("requires read recipient evidence to enable notifications, not permission failures or empty rows", () => {
    for (const recipients of [{ ok: false as const, error: "403" }, { ok: true as const, data: { value: [] }, raw: {} }]) {
      current.recipients = recipients;
      expect(() => validateChange({ kind: "updateAlert", body: { isEnabled: true } }, current)).toThrow(/recipient/);
    }
  });
  it("validates audience, names, IDs, quantity types and exact threshold units", () => {
    expect(() => validateChange({ kind: "updatePolicy", body: { displayName: "short" } })).toThrow(/10-64/);
    expect(() => validateChange({ kind: "addGroup", groupId: " " })).toThrow(/group ID/);
    expect(() => validateChange({ kind: "addRecipient", userId: "" })).toThrow(/user ID/);
    expect(() => validateChange({ kind: "addService", serviceId: "", state: "enabled" })).toThrow(/service category/);
    if (current.policy.ok) current.policy.data["@odata.type"] = "#microsoft.graph.allUsersSpendingPolicy";
    expect(() => validateChange({ kind: "addGroup", groupId: "g" }, current)).toThrow(/selected-group/);
    expect(() => validateChange({ kind: "updatePolicy", body: { periodLimit: { ...quantity, value: undefined } } })).toThrow(/required/);
    expect(() => validateChange({ kind: "updateAlert", body: { thresholds: [{ "@odata.type": "#microsoft.graph.percentageCostManagementAlertThreshold", value: 1.5 }] } })).toThrow(/integer/);
    expect(() => validateChange({ kind: "updateAlert", body: { thresholds: [{ "@odata.type": "#microsoft.graph.absoluteCostManagementAlertThreshold", value: 10, unit: "USD" }] } }, current)).toThrow(/match/);
  });
  it("does not invalidate or call the SDK for invalid creation", async () => {
    expect((await createPolicy({ ...createBody, serviceSettings: [] }, true)).ok).toBe(false);
    expect((await createPolicy({ ...createBody, displayName: "bad" }, true)).ok).toBe(false);
    expect(executeAsync).not.toHaveBeenCalled();
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
});
