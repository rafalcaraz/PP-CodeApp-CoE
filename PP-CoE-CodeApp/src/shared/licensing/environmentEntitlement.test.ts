import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
vi.mock(
  "../../generated/services/PPLicensingAPI_Wrapper_FlowService",
  () => ({
    PPLicensingAPI_Wrapper_FlowService: { Run: runMock },
  }),
);

import {
  getEnvironmentMcsEntitlement,
  normalizeEnvironmentEntitlement,
} from "./environmentEntitlement";
import { clearLicensingInflight } from "./client";

const TENANT = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
const ENV = "45a99c18-86f9-e37d-998d-0f057ab0bf03";

// Verbatim from the user's captured response.
const SAMPLE_RESPONSE = {
  environmentId: ENV,
  environmentType: "Sandbox",
  environmentName: "ralop-demos-ready",
  isManagedEnvironment: true,
  location: "NAM",
  scenario: "None",
  disasterRecoveryState: "Unavailable",
  disasterRecoveryLocation: "NearCopy",
  entitlement: {
    unit: "Count",
    capacity: {
      allocated: { value: 0.0, autoAllocated: 0.0 },
      enforcementRules: [{ ruleType: "TenantPool", enabled: true }],
      consumed: {
        value: 0.0,
        consumptionType: "Snapshot",
        lastUpdatedOn: "2026-04-08T00:00:00Z",
        writeOff: 0.0,
      },
      availableQuantity: 0.0,
      status: "WithinCapacity",
    },
    payGo: {
      entitled: { value: 0.0 },
      consumed: { value: 0.0, consumptionType: "NotSpecified", writeOff: 0.0 },
    },
  },
  addons: [],
  entitlementId: "MCSMessages",
  productCategories: ["CopilotStudio"],
};

function asFlowResponse(payload: unknown) {
  return { success: true, data: { response: JSON.stringify(payload) } };
}

beforeEach(() => {
  runMock.mockReset();
  clearLicensingInflight();
});

afterEach(() => {
  clearLicensingInflight();
});

describe("normalizeEnvironmentEntitlement", () => {
  it("flattens the captured sample shape", () => {
    const out = normalizeEnvironmentEntitlement(SAMPLE_RESPONSE, {
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(out).toEqual({
      environmentId: ENV,
      environmentName: "ralop-demos-ready",
      environmentType: "Sandbox",
      isManagedEnvironment: true,
      location: "NAM",
      entitlementId: "MCSMessages",
      unit: "Count",
      capacity: {
        allocated: 0,
        autoAllocated: 0,
        consumed: 0,
        consumptionType: "Snapshot",
        lastUpdatedOn: "2026-04-08T00:00:00Z",
        writeOff: 0,
        available: 0,
        status: "WithinCapacity",
      },
      payGo: {
        entitled: 0,
        consumed: 0,
        consumptionType: "NotSpecified",
        writeOff: 0,
      },
      enforcementRules: [{ ruleType: "TenantPool", enabled: true }],
      productCategories: ["CopilotStudio"],
    });
  });

  it("falls back to the requested entitlementId if the response omits it", () => {
    const noEntId = { ...SAMPLE_RESPONSE, entitlementId: undefined };
    const out = normalizeEnvironmentEntitlement(noEntId, {
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(out.entitlementId).toBe("MCSMessages");
  });

  it("ignores unknown entitlement ids in the response (falls back to requested)", () => {
    const weird = { ...SAMPLE_RESPONSE, entitlementId: "SomeFutureThing" };
    const out = normalizeEnvironmentEntitlement(weird, {
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(out.entitlementId).toBe("MCSMessages");
  });

  it("coerces missing numeric fields to 0 and missing strings to undefined", () => {
    const sparse = {
      entitlement: {
        unit: "Count",
        capacity: {},
        payGo: {},
      },
      entitlementId: "MCSMessages",
    };
    const out = normalizeEnvironmentEntitlement(sparse, {
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(out.capacity.allocated).toBe(0);
    expect(out.capacity.consumed).toBe(0);
    expect(out.capacity.available).toBe(0);
    expect(out.payGo.entitled).toBe(0);
    expect(out.payGo.consumed).toBe(0);
    expect(out.capacity.status).toBeUndefined();
    expect(out.environmentName).toBeUndefined();
    // environmentId always falls back to the requested one when missing
    expect(out.environmentId).toBe(ENV);
    expect(out.enforcementRules).toEqual([]);
    expect(out.productCategories).toEqual([]);
  });

  it("filters out malformed enforcement-rule entries", () => {
    const mixedRules = {
      ...SAMPLE_RESPONSE,
      entitlement: {
        ...SAMPLE_RESPONSE.entitlement,
        capacity: {
          ...SAMPLE_RESPONSE.entitlement.capacity,
          enforcementRules: [
            { ruleType: "TenantPool", enabled: true },
            null,
            "garbage",
            { ruleType: "Other" }, // enabled missing → defaults to false
          ],
        },
      },
    };
    const out = normalizeEnvironmentEntitlement(mixedRules, {
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(out.enforcementRules).toEqual([
      { ruleType: "TenantPool", enabled: true },
      { ruleType: "Other", enabled: false },
    ]);
  });

  it("throws on completely wrong-shape payloads (caller catches)", () => {
    expect(() =>
      normalizeEnvironmentEntitlement("not an object", {
        tenantId: TENANT,
        environmentId: ENV,
      }),
    ).toThrow();
  });
});

describe("getEnvironmentMcsEntitlement", () => {
  it("returns { ok: false } when tenantId is missing", async () => {
    const res = await getEnvironmentMcsEntitlement({
      tenantId: "",
      environmentId: ENV,
    });
    expect(res.ok).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when environmentId is missing", async () => {
    const res = await getEnvironmentMcsEntitlement({
      tenantId: TENANT,
      environmentId: "",
    });
    expect(res.ok).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("returns normalized data on a successful flow call", async () => {
    runMock.mockResolvedValueOnce(asFlowResponse(SAMPLE_RESPONSE));
    const res = await getEnvironmentMcsEntitlement({
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.environmentName).toBe("ralop-demos-ready");
      expect(res.data.capacity.status).toBe("WithinCapacity");
    }
    expect(runMock).toHaveBeenCalledOnce();
    const args = runMock.mock.calls[0][0];
    expect(args.text).toBe("GET");
    expect(args.text_1).toContain(
      `/v0.1-alpha/tenants/${TENANT}/environments/${ENV}/entitlements/MCSMessages`,
    );
  });

  it("returns { ok: false } when the flow itself fails", async () => {
    runMock.mockResolvedValueOnce({ success: false, error: "boom" });
    const res = await getEnvironmentMcsEntitlement({
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(res.ok).toBe(false);
  });
});
