import { beforeEach, describe, expect, it, vi } from "vitest";
const { executeAsync, invalidateInventoryCache } = vi.hoisted(() => ({ executeAsync: vi.fn(), invalidateInventoryCache: vi.fn() }));
vi.mock("@microsoft/power-apps/data", () => ({ getClient: () => ({ executeAsync }) }));
vi.mock("../../data/inventory", () => ({ invalidateInventoryCache }));
import { getDailyUsage, getFundingUsage, investigateUser } from "./usageData";
import { decideRequests, getRequest, listRequests } from "./requestData";

const item = { requestId: "r", state: "approved" as const, etag: '"7"' };
beforeEach(() => {
  vi.clearAllMocks();
  executeAsync.mockReset();
  executeAsync.mockImplementation(async ({ connectorOperation }: { connectorOperation: { operationName: string; parameters?: { id?: string } } }) => {
    if (connectorOperation.operationName === "GetCreditRequest") return { success: true, data: { id: connectorOperation.parameters?.id, state: "pending", "@odata.etag": '"7"' } };
    if (connectorOperation.operationName === "BatchRecordCreditRequestDecisions") return { success: true, data: { succeededCount: 1, failedCount: 0, responses: [{ requestId: "r", status: "succeeded", etag: '"8"' }] } };
    return { success: true, data: { value: [] } };
  });
});

describe("Wave 2 typed reporting adapters", () => {
  it.each(["users", "groups", "services"] as const)("reads one selected %s UTC day and preserves coverage instead of aggregating", async (dimension) => {
    const key = dimension === "users" ? "userId" : dimension === "groups" ? "groupId" : "serviceId";
    const data = { value: [{ userId: "unrelated-user", groupId: "unrelated-group", serviceId: "unrelated-service", [key]: "entity", consumedQuantity: 0, unit: "unknownFutureUnit" }], "@odata.nextLink": "opaque complete URL", "@odata.count": 200 };
    executeAsync.mockResolvedValueOnce({ success: true, data });
    expect(await getDailyUsage(dimension, "2026-01-01")).toMatchObject({
      ok: true, data: { dimension, day: "2026-01-01", value: [{ entityId: "entity", consumedQuantity: 0, unit: "unknownFutureUnit" }], nextLink: "opaque complete URL", count: 200 },
    });
    expect(executeAsync).toHaveBeenCalledExactlyOnceWith({ connectorOperation: {
      tableName: expect.any(String), operationName: `List${dimension === "users" ? "User" : dimension === "groups" ? "Group" : "Service"}UsageRecords`,
      parameters: { startDate: "2026-01-01", endDate: "2026-01-02", $count: true, $top: 100, $orderby: "consumedQuantity desc" },
    } });
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
  it("blocks invalid windows/months before any request and never turns omitted collections into empty success", async () => {
    expect((await getDailyUsage("users", "2026-02-30")).ok).toBe(false);
    expect((await getFundingUsage("2026-13")).ok).toBe(false);
    expect((await investigateUser("u", "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z")).ok).toBe(false);
    expect(executeAsync).not.toHaveBeenCalled();
    executeAsync.mockResolvedValueOnce({ success: true, data: {} });
    expect(await getFundingUsage("2026-01")).toMatchObject({ ok: false, error: expect.stringContaining("omitted") });
    executeAsync.mockResolvedValueOnce({ success: true, data: {} });
    expect((await getDailyUsage("services", "2026-01-01")).ok).toBe(false);
  });
  it("preserves funding nullable freshness and unknown classes without adding currency or inferring month closure", async () => {
    const data = { value: [{ id: "unknown", fundingClass: "future", unit: "copilotCredit", consumedQuantity: 4, dataStatus: { latestSourceDateTime: null } }] };
    executeAsync.mockResolvedValueOnce({ success: true, data });
    expect(await getFundingUsage("2026-01")).toMatchObject({ ok: true, data });
    expect(executeAsync).toHaveBeenCalledOnce();
  });
  it("keeps independently failed raw detail and nullable window-scoped/native session fields, never replaying nextLink", async () => {
    executeAsync.mockResolvedValueOnce({ success: false, error: { code: "usageDataUnavailable" } });
    executeAsync.mockResolvedValueOnce({ success: true, data: { value: [{ id: "workIQ", consumedQuantity: 2, unit: "copilotCredit" }] } });
    const sessions = { value: [{ id: "window-scoped", sourceSessionId: null, firstActivityDateTime: null, lastActivityDateTime: null }], "@odata.nextLink": "opaque" };
    executeAsync.mockResolvedValueOnce({ success: true, data: sessions });
    const result = await investigateUser(" u ", "2026-01-01T00:00:00.0000001Z", "2026-01-01T12:00:00Z");
    expect(result).toMatchObject({ ok: true, data: { detail: { ok: false, error: '{"code":"usageDataUnavailable"}' }, services: { ok: true }, sessions: { ok: true, data: sessions } } });
    expect(executeAsync).toHaveBeenCalledTimes(3);
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
});

describe("credit request decisions", () => {
  it("escapes filter literals and distinguishes unreadable/missing rows from empty queues", async () => {
    await listRequests("pending", "work'IQ");
    expect(executeAsync.mock.calls[0][0].connectorOperation.parameters).toEqual({ $count: true, $top: 100, $filter: "state eq 'pending' and serviceId eq 'work''IQ'" });
    executeAsync.mockResolvedValueOnce({ success: true, data: {} });
    expect((await listRequests()).ok).toBe(false);
    executeAsync.mockResolvedValueOnce({ success: true, data: { id: "other", state: "pending" } });
    expect((await getRequest("r")).ok).toBe(false);
  });
  it("never reads or writes unconfirmed, weak-token, duplicate or empty batches", async () => {
    expect((await decideRequests([item])).ok).toBe(false);
    expect((await decideRequests([{ ...item, etag: 'W/"7"' }], true)).ok).toBe(false);
    expect((await decideRequests([item, item], true)).ok).toBe(false);
    expect((await decideRequests([], true)).ok).toBe(false);
    expect(executeAsync).not.toHaveBeenCalled();
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
  it("rereads tokens and states immediately before exactly one direct batch write", async () => {
    expect((await decideRequests([item], true)).ok).toBe(true);
    expect(executeAsync.mock.calls.map(([request]) => request.connectorOperation.operationName)).toEqual(["GetCreditRequest", "BatchRecordCreditRequestDecisions"]);
    expect(executeAsync.mock.calls[1][0].connectorOperation.parameters).toEqual({ body: { requests: [item] } });
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });
  it.each([{ state: "pending", "@odata.etag": '"8"' }, { state: "approved", "@odata.etag": '"7"' }, { state: "unknownFutureValue", "@odata.etag": '"7"' }])("requires a fresh review after changed request %j", async (changed) => {
    executeAsync.mockResolvedValueOnce({ success: true, data: { id: "r", ...changed } });
    expect((await decideRequests([item], true)).ok).toBe(false);
    expect(executeAsync).toHaveBeenCalledOnce();
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });
  it("preserves ordered per-item failures in an HTTP-200 response and never retries the batch", async () => {
    const data = { succeededCount: 1, failedCount: 1, responses: [{ requestId: "r", status: "succeeded", etag: '"8"' }, { requestId: "r2", status: "preconditionFailed", message: "Stale ETag" }] };
    executeAsync.mockImplementation(async ({ connectorOperation }: { connectorOperation: { operationName: string; parameters: { id?: string } } }) => connectorOperation.operationName === "GetCreditRequest"
      ? { success: true, data: { id: connectorOperation.parameters.id, state: "pending", "@odata.etag": '"7"' } } : { success: true, data });
    expect(await decideRequests([item, { ...item, requestId: "r2" }], true)).toMatchObject({ ok: true, data });
    expect(executeAsync).toHaveBeenCalledTimes(3);
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });
  it("does not claim success or retry on malformed results or ambiguous write errors", async () => {
    executeAsync.mockResolvedValueOnce({ success: true, data: { id: "r", state: "pending", "@odata.etag": '"7"' } });
    executeAsync.mockResolvedValueOnce({ success: true, data: { succeededCount: 1, failedCount: 0, responses: [] } });
    expect(await decideRequests([item], true)).toMatchObject({ ok: false, error: expect.stringContaining("never replay"), raw: { success: true, data: { responses: [] } } });
    expect(executeAsync).toHaveBeenCalledTimes(2);
    executeAsync.mockClear();
    executeAsync.mockResolvedValueOnce({ success: true, data: { id: "r", state: "pending", "@odata.etag": '"7"' } });
    executeAsync.mockRejectedValueOnce(new Error("Timeout after write"));
    expect(await decideRequests([item], true)).toMatchObject({ ok: false, error: "Timeout after write" });
    expect(executeAsync).toHaveBeenCalledTimes(2);
    expect(invalidateInventoryCache).toHaveBeenCalledTimes(2);
  });
});
