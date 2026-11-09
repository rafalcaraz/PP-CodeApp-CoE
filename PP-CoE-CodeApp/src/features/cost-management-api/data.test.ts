import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeAsync, invalidateInventoryCache } = vi.hoisted(() => ({
  executeAsync: vi.fn(), invalidateInventoryCache: vi.fn(),
}));
vi.mock("@microsoft/power-apps/data", () => ({ getClient: () => ({ executeAsync }) }));
vi.mock("../../data/inventory", () => ({ invalidateInventoryCache }));

import { CostControsl_CustomConnService as service } from "../../generated/services/CostControsl_CustomConnService";
import { costActions, costDataSourceName } from "./catalog";
import { costDispatch, executeCostRequest, unsupportedReason } from "./data";

const etag = 'W/"7"';
const quantity = { "@odata.type": "#microsoft.graph.limitedCostManagementQuantity", unit: "copilotCredit", value: 500 };
const policyBody = {
  "@odata.type": "#microsoft.graph.allUsersSpendingPolicy", displayName: "Example policy",
  periodLimit: quantity, perUserLimit: quantity, serviceSettings: [{ serviceId: "workIQ", state: "enabled" }],
};
const groupBody = { "@odata.id": "https://graph.microsoft.com/beta/groups/example-group" };
const recipientBody = { "@odata.id": "https://graph.microsoft.com/beta/users/example-user" };
const queries = { $select: "id", $top: 2, $count: false, $filter: "test filter", $orderby: "id" };

const cases: { id: keyof typeof costDispatch; parameters: Record<string, unknown>; args: unknown[] }[] = [
  { id: "GetTenantCreditBalance", parameters: {}, args: [] },
  { id: "ListSpendingPolicies", parameters: queries, args: ["id", 2, false, "test filter", "id"] },
  { id: "CreateSpendingPolicy", parameters: { body: policyBody }, args: [policyBody] },
  { id: "GetSpendingPolicy", parameters: { id: "p", $select: "id" }, args: ["p", "id"] },
  { id: "UpdateSpendingPolicy", parameters: { id: "p", "If-Match": etag, body: { billingMethods: "prepaidCredits,payAsYouGo" } }, args: ["p", etag, { billingMethods: "prepaidCredits,payAsYouGo" }] },
  { id: "DeleteSpendingPolicy", parameters: { id: "p", "If-Match": etag }, args: ["p", etag] },
  { id: "ListAssignedGroups", parameters: { id: "p" }, args: ["p"] },
  { id: "ListAssignedGroupReferences", parameters: { id: "p" }, args: ["p"] },
  { id: "AddAssignedGroup", parameters: { id: "p", "If-Match": etag, body: groupBody }, args: ["p", etag, groupBody] },
  { id: "RemoveAssignedGroup", parameters: { id: "p", groupId: "g", "If-Match": etag }, args: ["p", "g", etag] },
  { id: "ListServiceSettings", parameters: { id: "p", $select: "serviceId" }, args: ["p", "serviceId"] },
  { id: "CreateServiceSetting", parameters: { id: "p", "If-Match": etag, body: { serviceId: "workIQ", state: "enabled" } }, args: ["p", etag, { serviceId: "workIQ", state: "enabled" }] },
  { id: "GetServiceSetting", parameters: { id: "p", serviceId: "workIQ", $select: "parentEtag" }, args: ["p", "workIQ", "parentEtag"] },
  { id: "UpdateServiceSetting", parameters: { id: "p", serviceId: "workIQ", "If-Match": etag, body: { state: "disabled" } }, args: ["p", "workIQ", etag, { state: "disabled" }] },
  { id: "GetAlertSetting", parameters: { id: "p", $select: "isEnabled" }, args: ["p", "isEnabled"] },
  { id: "UpdateAlertSetting", parameters: { id: "p", "If-Match": etag, body: {} }, args: ["p", etag, {}] },
  { id: "DeleteAlertSetting", parameters: { id: "p", "If-Match": etag }, args: ["p", etag] },
  { id: "ListRecipients", parameters: { id: "p" }, args: ["p"] },
  { id: "ListRecipientReferences", parameters: { id: "p" }, args: ["p"] },
  { id: "AddRecipient", parameters: { id: "p", "If-Match": etag, body: recipientBody }, args: ["p", etag, recipientBody] },
  { id: "RemoveRecipient", parameters: { id: "p", userId: "u", "If-Match": etag }, args: ["p", "u", etag] },
  { id: "GetUserBalance", parameters: { userId: "u", $select: "id", $expand: "serviceBalances" }, args: ["u", "id", "serviceBalances"] },
  { id: "ListUserServiceBalances", parameters: { userId: "u", ...queries }, args: ["u", "id", 2, false, "test filter", "id"] },
  { id: "GetUserServiceBalance", parameters: { userId: "u", serviceId: "workIQ", $select: "remainingQuantity" }, args: ["u", "workIQ", "remainingQuantity"] },
  { id: "ListCreditRequests", parameters: { $select: "id,state", $count: false, $top: 100, $filter: "state eq 'pending'" }, args: ["id,state", false, 100, "state eq 'pending'"] },
  { id: "GetCreditRequest", parameters: { id: "r", $select: "id,state" }, args: ["r", "id,state"] },
  { id: "UpdateCreditRequest", parameters: { id: "r", "If-Match": '"7"', body: { state: "approved" } }, args: ["r", '"7"', { state: "approved" }] },
  { id: "BatchRecordCreditRequestDecisions", parameters: { body: { requests: [{ requestId: "r", state: "rejected", etag: '"7"' }] } }, args: [{ requests: [{ requestId: "r", state: "rejected", etag: '"7"' }] }] },
  ...(["User", "Group", "Service"] as const).flatMap((dimension) => {
    const key = `${dimension.toLowerCase()}Id`;
    const filter = `${key} eq 'entity'`;
    return [
      { id: `List${dimension}UsageRecords` as const, parameters: { startDate: "2026-01-01", endDate: "2026-01-02", $select: "consumedQuantity", $count: false, $top: 2, $orderby: "consumedQuantity desc", $filter: filter }, args: ["2026-01-01", "2026-01-02", "consumedQuantity", false, 2, "consumedQuantity desc", filter] },
      { id: `Get${dimension}UsageRecord` as const, parameters: { [key]: "entity", startDate: "2026-01-01", endDate: "2026-01-02", $select: "consumedQuantity" }, args: ["entity", "2026-01-01", "2026-01-02", "consumedQuantity"] },
    ];
  }),
  { id: "ListFundingUsageRecords", parameters: { month: "2026-01", $select: "fundingClass", $count: false, $orderby: "consumedQuantity desc" }, args: ["2026-01", "fundingClass", false, "consumedQuantity desc"] },
  { id: "GetUserUsageDetail", parameters: { userId: "u", startDateTime: "2026-01-01T00:00:00Z", endDateTime: "2026-01-02T00:00:00Z", $select: "userId", $expand: "services,sessions" }, args: ["u", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "userId", "services,sessions"] },
  { id: "ListUserUsageServiceDetails", parameters: { userId: "u", startDateTime: "2026-01-01T00:00:00Z", endDateTime: "2026-01-02T00:00:00Z", $select: "id" }, args: ["u", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "id"] },
  { id: "ListUserUsageSessionDetails", parameters: { userId: "u", startDateTime: "2026-01-01T00:00:00Z", endDateTime: "2026-01-02T00:00:00Z", $select: "sourceSessionId", $top: 100 }, args: ["u", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "sourceSessionId", 100] },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  executeAsync.mockResolvedValue({ success: true, data: { value: [] } });
});

describe("Cost Management direct generated dispatch", () => {
  it("covers the registered catalog exactly without metadata-only bypasses", () => {
    expect(Object.keys(costDispatch).sort()).toEqual(costActions.map((a) => a.id).sort());
    expect(cases.map((c) => c.id).sort()).toEqual(Object.keys(costDispatch).sort());
    for (const action of costActions) expect(unsupportedReason(action.id)).toBeUndefined();
    expect(unsupportedReason("not-registered")).toMatch(/not registered/);
  });

  it.each(cases)("$id calls its generated typed method with exact positional arguments and wire parameter names", async ({ id, parameters, args }) => {
    if (id === "BatchRecordCreditRequestDecisions") executeAsync.mockResolvedValueOnce({ success: true, data: { succeededCount: 1, failedCount: 0, responses: [{ requestId: "r", status: "succeeded", etag: '"8"' }] } });
    const spy = vi.spyOn(service, id);
    const result = await executeCostRequest({ actionId: id, parameters }, true);
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledExactlyOnceWith(...args);
    expect(executeAsync).toHaveBeenCalledExactlyOnceWith({
      connectorOperation: {
        tableName: costDataSourceName, operationName: id,
        ...(id === "GetTenantCreditBalance" ? {} : { parameters }),
      },
    });

    expect(invalidateInventoryCache).toHaveBeenCalledTimes(costActions.find((a) => a.id === id)?.readOnly ? 0 : 1);
  });

  it("does not turn a non-atomic HTTP-200 batch into an all-green result or replay failures", async () => {
    const data = { succeededCount: 1, failedCount: 1, responses: [{ requestId: "r1", status: "succeeded" }, { requestId: "r2", status: "preconditionFailed", message: "Stale ETag" }] };
    executeAsync.mockResolvedValueOnce({ success: true, data });
    const result = await executeCostRequest({ actionId: "BatchRecordCreditRequestDecisions", parameters: { body: { requests: ["r1", "r2"].map((requestId) => ({ requestId, state: "approved", etag: '"7"' })) } } }, true);
    expect(result).toMatchObject({ ok: false, partial: true, error: expect.stringContaining("do not replay"), data: { success: true, data } });
    expect(executeAsync).toHaveBeenCalledOnce();
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });

  it("keeps omitted options undefined without coercing false or zero", async () => {
    const spy = vi.spyOn(service, "ListSpendingPolicies");
    await executeCostRequest({ actionId: "ListSpendingPolicies", parameters: { $top: 0, $count: false } });
    expect(spy).toHaveBeenCalledExactlyOnceWith(undefined, 0, false, undefined, undefined);
  });

  it("blocks every write without confirmation and rejects malformed requests before any service call", async () => {
    for (const entry of cases.filter((entry) => !costActions.find((a) => a.id === entry.id)?.readOnly)) {
      expect((await executeCostRequest({ actionId: entry.id, parameters: entry.parameters })).ok).toBe(false);
    }
    for (const request of [
      { actionId: "GetUserBalance", parameters: {} },
      { actionId: "GetTenantCreditBalance", parameters: { arbitraryUrl: "https://other.example" } },
      { actionId: "DeleteSpendingPolicy", parameters: { id: "p", "If-Match": "*" } },
      { actionId: "UpdateServiceSetting", parameters: { id: "p", serviceId: "workIQ", "If-Match": etag, body: { status: "disabled" } } },
      { actionId: "not-an-action", parameters: {} },
    ]) expect((await executeCostRequest(request, true)).ok).toBe(false);
    expect(executeAsync).not.toHaveBeenCalled();
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });

  it("retains complete raw SDK envelopes, including OData errors and any exposed headers", async () => {
    const raw = { success: false, error: { code: "preconditionFailed", innerError: { code: "staleTag" } }, headers: { ETag: etag } };
    executeAsync.mockResolvedValueOnce(raw);
    const result = await executeCostRequest({ actionId: "GetTenantCreditBalance", parameters: {} });
    expect(result).toEqual({ ok: false, error: JSON.stringify(raw.error), data: raw });
    expect(executeAsync).toHaveBeenCalledOnce();
  });

  it("does not retry or follow next links and invalidates after ambiguous write failures", async () => {
    const raw = { success: true, data: { value: [], "@odata.nextLink": "https://graph.microsoft.com/beta/copilot/costManagement/spendingPolicies?opaque=1" } };
    executeAsync.mockResolvedValueOnce(raw);
    expect(await executeCostRequest({ actionId: "ListSpendingPolicies", parameters: {} })).toEqual({ ok: true, data: raw });
    expect(executeAsync).toHaveBeenCalledOnce();
    executeAsync.mockRejectedValueOnce(new Error("Timeout"));
    expect(await executeCostRequest({ actionId: "DeleteSpendingPolicy", parameters: { id: "p", "If-Match": etag } }, true))
      .toMatchObject({ ok: false, error: "Timeout" });
    expect(executeAsync).toHaveBeenCalledTimes(2);
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });
});
