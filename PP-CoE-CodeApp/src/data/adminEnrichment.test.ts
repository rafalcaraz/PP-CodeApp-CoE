/**
 * Phase 4 tests for `adminEnrichment.ts` — supplemental admin
 * enrichment wrappers.
 *
 * Each wrapper is a thin shim over a generated connector call:
 *   - validate the input (envId / appId required)
 *   - invoke the connector
 *   - shape the response as `DataResult<{ data, raw }>`
 *
 * These tests mock the connector with REAL captured responses
 * (anonymized) and verify the wrapper plumbing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import envAdmin from "../test/fixtures/get-environment-by-id-for-user.json";
import appAdmin from "../test/fixtures/get-admin-app.json";

const { getEnvByIdMock, getAdminAppMock } = vi.hoisted(() => ({
  getEnvByIdMock: vi.fn(),
  getAdminAppMock: vi.fn(),
}));

vi.mock("../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    GetEnvironmentByIdForUser: getEnvByIdMock,
    Get_AdminApp: getAdminAppMock,
  },
}));

import {
  getAppAdminDetails,
  getEnvironmentAdminDetails,
  isAppAdminDetailsSupported,
} from "./adminEnrichment";

beforeEach(() => {
  getEnvByIdMock.mockReset();
  getAdminAppMock.mockReset();
});

// ---------------------------------------------------------------------------
// isAppAdminDetailsSupported — the type gate
// ---------------------------------------------------------------------------

describe("isAppAdminDetailsSupported", () => {
  it("returns true for canvas, code, and app-builder apps", () => {
    expect(isAppAdminDetailsSupported("microsoft.powerapps/canvasapps")).toBe(
      true,
    );
    expect(isAppAdminDetailsSupported("microsoft.powerapps/codeapps")).toBe(
      true,
    );
    expect(isAppAdminDetailsSupported("microsoft.powerapps/apps")).toBe(true);
  });

  it("returns false for model-driven apps (Dataverse — no equivalent endpoint)", () => {
    expect(
      isAppAdminDetailsSupported("microsoft.powerapps/modeldrivenapps"),
    ).toBe(false);
  });

  it("returns false for undefined / empty input", () => {
    expect(isAppAdminDetailsSupported(undefined)).toBe(false);
    expect(isAppAdminDetailsSupported("")).toBe(false);
  });

  it("returns false for unrelated resource types", () => {
    expect(isAppAdminDetailsSupported("microsoft.flow/flows")).toBe(false);
    expect(isAppAdminDetailsSupported("microsoft.copilotstudio/agents")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// getEnvironmentAdminDetails
// ---------------------------------------------------------------------------

describe("getEnvironmentAdminDetails", () => {
  it("rejects empty envId without calling the connector", async () => {
    const result = await getEnvironmentAdminDetails("");
    expect(result.ok).toBe(false);
    expect(getEnvByIdMock).not.toHaveBeenCalled();
  });

  it("wraps a successful response as { data, raw }", async () => {
    getEnvByIdMock.mockResolvedValue({ success: true, data: envAdmin });
    const result = await getEnvironmentAdminDetails(envAdmin.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both `data` and `raw` should reference the same payload.
    expect(result.data.data).toBe(envAdmin);
    expect(result.data.raw).toBe(envAdmin);
    // Spot-check that a real captured field round-trips intact.
    expect((result.data.data as typeof envAdmin).url).toBe(
      "https://contoso.crm.dynamics.com",
    );
    expect((result.data.data as typeof envAdmin).state).toBe("Enabled");
  });

  it("forwards a connector failure message", async () => {
    getEnvByIdMock.mockResolvedValue({
      success: false,
      error: { message: "forbidden" },
    });
    const result = await getEnvironmentAdminDetails("env-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/forbidden/);
  });

  it("catches connector exceptions and surfaces as ok:false", async () => {
    getEnvByIdMock.mockRejectedValue(new Error("network blew up"));
    const result = await getEnvironmentAdminDetails("env-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/network blew up/);
  });

  it("forwards the envId to the connector call", async () => {
    getEnvByIdMock.mockResolvedValue({ success: true, data: envAdmin });
    await getEnvironmentAdminDetails("env-abc-123");
    expect(getEnvByIdMock).toHaveBeenCalledWith(
      "env-abc-123",
      expect.any(String), // api-version
    );
  });
});

// ---------------------------------------------------------------------------
// getAppAdminDetails
// ---------------------------------------------------------------------------

describe("getAppAdminDetails", () => {
  it("rejects empty environmentId", async () => {
    const result = await getAppAdminDetails("", "app-1");
    expect(result.ok).toBe(false);
    expect(getAdminAppMock).not.toHaveBeenCalled();
  });

  it("rejects empty appId", async () => {
    const result = await getAppAdminDetails("env-1", "");
    expect(result.ok).toBe(false);
    expect(getAdminAppMock).not.toHaveBeenCalled();
  });

  it("wraps a successful response and preserves the rich PowerApp shape", async () => {
    getAdminAppMock.mockResolvedValue({ success: true, data: appAdmin });
    const result = await getAppAdminDetails("env-1", "app-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Spot-check fields the UI actually reads off the admin app details.
    const data = result.data.data as typeof appAdmin;
    expect(data.properties.displayName).toBeTruthy();
    expect(data.properties.appPlanClassification).toBe("Premium");
    expect(data.properties.owner.email).toMatch(/@contoso\.example$/);
    expect(data.properties.executionRestrictions.dataLossPreventionEvaluationResult.status)
      .toBe("Compliant");
  });

  it("forwards env + app ids to the connector call", async () => {
    getAdminAppMock.mockResolvedValue({ success: true, data: appAdmin });
    await getAppAdminDetails("env-XYZ", "app-ABC");
    expect(getAdminAppMock).toHaveBeenCalledWith(
      "env-XYZ",
      "app-ABC",
      expect.any(String),
    );
  });

  it("forwards a connector failure message", async () => {
    getAdminAppMock.mockResolvedValue({
      success: false,
      error: { message: "app not found" },
    });
    const result = await getAppAdminDetails("env-1", "app-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/app not found/);
  });

  it("catches connector exceptions", async () => {
    getAdminAppMock.mockRejectedValue(new Error("kaboom"));
    const result = await getAppAdminDetails("env-1", "app-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/kaboom/);
  });
});
