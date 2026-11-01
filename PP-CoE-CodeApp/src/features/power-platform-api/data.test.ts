import { beforeEach, describe, expect, it, vi } from "vitest";

const { runFlow, invalidateInventoryCache } = vi.hoisted(() => ({
  runFlow: vi.fn(), invalidateInventoryCache: vi.fn(),
}));
vi.mock("../../generated/services/PP_API_Wrapper_FlowService", () => ({
  PP_API_Wrapper_FlowService: { Run: runFlow },
}));
vi.mock("../../data/inventory", () => ({ invalidateInventoryCache }));

import { apiOperations, initialApiInputs } from "./catalog";
import { executeApiRequest, normalizeFlowResponse } from "./data";

const getAll = (() => {
  const operation = apiOperations.find((entry) => entry.method === "GET" && entry.path.endsWith("/resourceThresholds"));
  if (!operation) throw new Error("Missing Get All Resource Thresholds.");
  return operation;
})();

function getInputs() {
  const inputs = initialApiInputs(getAll);
  inputs.parameters["path:entitlementId"] = "MCSMessages";
  return inputs;
}

beforeEach(() => {
  vi.clearAllMocks();
  runFlow.mockResolvedValue({ success: true, data: { response: '[{"limit":100}]' } });
});

describe("flow-only Power Platform API adapter", () => {
  it("calls only the registered PP API flow with all three exact trigger fields", async () => {
    expect(await executeApiRequest(getInputs())).toEqual({
      ok: true, data: { body: [{ limit: 100 }], raw: '[{"limit":100}]' },
    });
    expect(runFlow).toHaveBeenCalledExactlyOnceWith({
      text: "GET",
      text_1: "https://api.powerplatform.com/licensing/entitlements/MCSMessages/resourceThresholds?api-version=2024-10-01",
      text_2: "",
    });
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });

  it("never invokes a flow with invalid inputs or an unregistered operation", async () => {
    expect((await executeApiRequest({ operationId: "unknown", parameters: {}, body: "" })).ok).toBe(false);
    expect((await executeApiRequest(initialApiInputs(getAll))).ok).toBe(false);
    expect(runFlow).not.toHaveBeenCalled();
  });

  it("surfaces SDK failures, missing response output, and thrown failures without retrying", async () => {
    runFlow.mockResolvedValueOnce({ success: false, error: { message: "Forbidden" } });
    expect((await executeApiRequest(getInputs())).ok).toBe(false);
    runFlow.mockResolvedValueOnce({ success: true, data: {} });
    expect(await executeApiRequest(getInputs())).toMatchObject({ ok: false, error: expect.stringContaining("expected response text") });
    runFlow.mockRejectedValueOnce(new Error("Flow connection unavailable"));
    expect(await executeApiRequest(getInputs())).toEqual({ ok: false, error: "Flow connection unavailable" });
    expect(runFlow).toHaveBeenCalledTimes(3);
  });

  it("requires write confirmation and forwards the exact upsert body after approval", async () => {
    const operation = apiOperations.find((entry) => entry.title === "Upsert Resource Threshold");
    if (!operation) throw new Error("Missing Upsert Resource Threshold.");
    const inputs = initialApiInputs(operation);
    Object.assign(inputs.parameters, {
      "path:environmentId": "test-environment", "path:entitlementId": "MCSMessages", "path:resourceId": "test-resource",
    });
    inputs.body = '{"limit":100,"notifyIfOverCapacity":true}';
    expect(await executeApiRequest(inputs)).toMatchObject({ ok: false, error: expect.stringContaining("Review and confirm") });
    expect(runFlow).not.toHaveBeenCalled();
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
    expect((await executeApiRequest(inputs, true)).ok).toBe(true);
    expect(runFlow).toHaveBeenCalledExactlyOnceWith({
      text: "PUT",
      text_1: "https://api.powerplatform.com/licensing/environments/test-environment/entitlements/MCSMessages/resources/test-resource/threshold?api-version=2024-10-01",
      text_2: inputs.body,
    });
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
    runFlow.mockRejectedValueOnce(new Error("Response lost"));
    expect(await executeApiRequest(inputs, true)).toEqual({ ok: false, error: "Response lost" });
    expect(invalidateInventoryCache).toHaveBeenCalledTimes(2);
  });
});

describe("flow response normalization", () => {
  it("preserves JSON, text, empty, and null responses without inventing HTTP status", () => {
    expect(normalizeFlowResponse("plain text")).toEqual({ ok: true, data: { body: "plain text", raw: "plain text" } });
    expect(normalizeFlowResponse("")).toEqual({ ok: true, data: { body: null, raw: "" } });
    expect(normalizeFlowResponse("null")).toEqual({ ok: true, data: { body: null, raw: "null" } });
  });

  it("recognizes HTTP error envelopes, JSON API errors, and preserves raw failure evidence", () => {
    expect(normalizeFlowResponse('{"error":{"code":"Forbidden","message":"No access"}}')).toMatchObject({
      ok: false, error: expect.stringContaining("No access"), data: { body: { error: { code: "Forbidden" } } },
    });
    expect(normalizeFlowResponse('{"statusCode":403,"headers":{"x-ms-request-id":"test-request"},"body":"denied"}')).toMatchObject({
      ok: false, data: { status: 403, body: "denied", headers: { "x-ms-request-id": "test-request" } },
    });
    expect(normalizeFlowResponse('{"statusCode":202,"headers":{},"body":""}')).toMatchObject({
      ok: true, data: { status: 202, body: null },
    });
  });
});
