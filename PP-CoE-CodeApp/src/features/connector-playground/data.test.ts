import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeAsync, invalidateInventoryCache } = vi.hoisted(() => ({
  executeAsync: vi.fn(),
  invalidateInventoryCache: vi.fn(),
}));
vi.mock("@microsoft/power-apps/data", () => ({ getClient: () => ({ executeAsync }) }));
vi.mock("../../data/inventory", () => ({ invalidateInventoryCache }));

import { executeAction } from "./data";

beforeEach(() => {
  vi.clearAllMocks();
  executeAsync.mockResolvedValue({ success: true, data: { value: [] } });
});

describe("executeAction", () => {
  it("uses SDK wire parameter names and returns the complete response envelope", async () => {
    const result = await executeAction({
      actionId: "GetRecommendations", parameters: { "api-version": "2024-10-01" },
    });
    expect(result).toEqual({ ok: true, data: { success: true, data: { value: [] } } });
    expect(executeAsync).toHaveBeenCalledExactlyOnceWith({
      connectorOperation: {
        tableName: "powerplatformadminv2", operationName: "GetRecommendations",
        parameters: { "api-version": "2024-10-01" },
      },
    });
    expect(invalidateInventoryCache).not.toHaveBeenCalled();
  });

  it("rejects unknown actions, unknown parameters and missing inputs before calling the SDK", async () => {
    expect((await executeAction({ actionId: "not-an-action", parameters: {} })).ok).toBe(false);
    expect((await executeAction({ actionId: "GetRecommendations", parameters: { extra: true } })).ok).toBe(false);
    expect((await executeAction({ actionId: "GetRecommendations", parameters: {} })).ok).toBe(false);
    expect(executeAsync).not.toHaveBeenCalled();
  });

  it("does not execute write-capable or general-purpose MCP calls without confirmation", async () => {
    expect((await executeAction({ actionId: "DeleteEnvironmentByID", parameters: {} })).ok).toBe(false);
    expect((await executeAction({ actionId: "mcp_Governance", parameters: {} })).ok).toBe(false);
    expect(executeAsync).not.toHaveBeenCalled();
  });

  it("executes newer metadata-only actions after confirmation and invalidates inventory", async () => {
    const result = await executeAction({
      actionId: "ProvisionNewEnvironment", parameters: { "api-version": "2024-10-01" },
    }, true);
    expect(result.ok).toBe(true);
    expect(executeAsync).toHaveBeenCalledOnce();
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });

  it("surfaces connector errors and exceptions without retrying", async () => {
    executeAsync.mockResolvedValueOnce({ success: false, error: { message: "Forbidden", status: 403 } });
    const result = await executeAction({ actionId: "GetRecommendations", parameters: { "api-version": "2024-10-01" } });
    expect(result).toEqual({ ok: false, error: '{"message":"Forbidden","status":403}' });
    executeAsync.mockRejectedValueOnce(new Error("Connection unavailable"));
    expect(await executeAction({ actionId: "GetRecommendations", parameters: { "api-version": "2024-10-01" } }))
      .toEqual({ ok: false, error: "Connection unavailable" });
    expect(executeAsync).toHaveBeenCalledTimes(2);
  });

  it("also invalidates after an ambiguous write failure", async () => {
    executeAsync.mockRejectedValueOnce(new Error("Timeout"));
    await executeAction({ actionId: "ProvisionNewEnvironment", parameters: { "api-version": "2024-10-01" } }, true);
    expect(invalidateInventoryCache).toHaveBeenCalledOnce();
  });
});
