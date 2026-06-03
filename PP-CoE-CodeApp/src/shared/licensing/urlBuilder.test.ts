import { describe, expect, it } from "vitest";
import {
  buildAgentMcsConsumptionUrl,
  buildEnvironmentMcsEntitlementUrl,
  buildTimeseriesUrl,
} from "./urlBuilder";

const TENANT = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
const RESOURCE = "23aea064-6242-f111-bec7-7ced8d6fee16";
const ENV = "45a99c18-86f9-e37d-998d-0f057ab0bf03";
const FIXED_NOW = new Date("2026-06-01T00:00:00.000Z");

describe("buildTimeseriesUrl", () => {
  it("builds the captured sample URL shape for CopilotStudio", () => {
    const url = buildTimeseriesUrl(
      {
        productCategory: "CopilotStudio",
        tenantId: TENANT,
        resourceId: RESOURCE,
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-05-31T07:00:00.000Z"),
      },
      FIXED_NOW,
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://licensing.powerplatform.microsoft.com");
    expect(parsed.pathname).toBe(
      `/v1.0/tenants/${TENANT}/usageData/CopilotStudio/timeseries`,
    );
    expect(parsed.searchParams.get("pageNumber")).toBe("1");
    expect(parsed.searchParams.get("orderByProperty")).toBe("date");
    expect(parsed.searchParams.get("orderDirection")).toBe("descending");
    expect(parsed.searchParams.get("pageSize")).toBe("50");
    expect(parsed.searchParams.get("trendInterval")).toBe("Monthly");
    expect(parsed.searchParams.get("from")).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.searchParams.get("to")).toBe("2026-05-31T07:00:00.000Z");
    expect(parsed.searchParams.get("resourceId")).toBe(RESOURCE);
  });

  it("preserves the empty filter/searchRequest/metrics params (defensive against undocumented endpoint)", () => {
    const url = buildTimeseriesUrl(
      {
        productCategory: "PowerAutomate",
        tenantId: TENANT,
        resourceId: RESOURCE,
      },
      FIXED_NOW,
    );
    // URLSearchParams.has returns true even for empty values
    expect(url).toContain("&filter=&");
    expect(url).toContain("&searchRequest=&");
    expect(url).toContain("&metrics=&");
  });

  it("defaults to a 12-month trailing window ending at `now`, shaved by 1 day to stay under the API's 365-day cap", () => {
    const url = buildTimeseriesUrl(
      {
        productCategory: "PowerAutomate",
        tenantId: TENANT,
        resourceId: RESOURCE,
      },
      FIXED_NOW,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("to")).toBe("2026-06-01T00:00:00.000Z");
    // 12 months back from 2026-06-01 is 2025-06-01; +1 safety day = 2025-06-02.
    expect(parsed.searchParams.get("from")).toBe("2025-06-02T00:00:00.000Z");
    // Explicit invariant: the licensing API enforces span <= 365 days strictly,
    // so this window must be strictly under 365 days regardless of leap years.
    const from = new Date(parsed.searchParams.get("from")!);
    const to = new Date(parsed.searchParams.get("to")!);
    const spanDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    expect(spanDays).toBeLessThan(365);
  });

  it("URL-encodes the tenant and product category but uses URLSearchParams for resourceId (it appears as-is for GUIDs but encoded for other chars)", () => {
    const url = buildTimeseriesUrl(
      {
        productCategory: "CopilotStudio",
        tenantId: "tenant with spaces",
        resourceId: "id with spaces",
      },
      FIXED_NOW,
    );
    expect(url).toContain("/tenants/tenant%20with%20spaces/");
    // URLSearchParams encodes spaces as + (form-encoding), which is also valid.
    expect(url).toContain("resourceId=id+with+spaces");
  });

  it("honors a custom interval and page size", () => {
    const url = buildTimeseriesUrl(
      {
        productCategory: "PowerApps",
        tenantId: TENANT,
        resourceId: RESOURCE,
        interval: "Daily",
        pageSize: 200,
      },
      FIXED_NOW,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("trendInterval")).toBe("Daily");
    expect(parsed.searchParams.get("pageSize")).toBe("200");
  });
});

describe("buildAgentMcsConsumptionUrl", () => {
  it("builds the captured sample URL shape", () => {
    const url = buildAgentMcsConsumptionUrl(
      {
        tenantId: TENANT,
        resourceId: "18fdcde8-4e1b-f111-8341-0022480a5972",
        from: new Date("2026-05-04T00:00:00.000Z"),
        to: new Date("2026-06-03T00:00:00.000Z"),
      },
      FIXED_NOW,
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://licensing.powerplatform.microsoft.com");
    expect(parsed.pathname).toBe(
      `/v2.0/tenants/${TENANT}/entitlements/MCSMessages/resources`,
    );
    expect(parsed.searchParams.get("fromDate")).toBe("2026-05-04");
    expect(parsed.searchParams.get("toDate")).toBe("2026-06-03");
    expect(parsed.searchParams.get("pageNumber")).toBe("1");
    expect(parsed.searchParams.get("pageSize")).toBe("100");
    expect(parsed.searchParams.get("searchRequest")).toBe(
      "18fdcde8-4e1b-f111-8341-0022480a5972",
    );
    // includeFields is sent empty (preserved defensively).
    expect(url).toContain("&includeFields=");
  });

  it("defaults to a 30-day window ending at `now`, using YYYY-MM-DD date-only format", () => {
    const url = buildAgentMcsConsumptionUrl(
      { tenantId: TENANT, resourceId: RESOURCE },
      FIXED_NOW,
    );
    const parsed = new URL(url);
    // 30 days back from 2026-06-01 → 2026-05-02
    expect(parsed.searchParams.get("toDate")).toBe("2026-06-01");
    expect(parsed.searchParams.get("fromDate")).toBe("2026-05-02");
  });

  it("honors a custom entitlement id and page size", () => {
    const url = buildAgentMcsConsumptionUrl(
      {
        tenantId: TENANT,
        resourceId: RESOURCE,
        entitlementId: "MCSMessages",
        pageSize: 25,
      },
      FIXED_NOW,
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toContain("/entitlements/MCSMessages/");
    expect(parsed.searchParams.get("pageSize")).toBe("25");
  });

  it("URL-encodes the tenant in the path", () => {
    const url = buildAgentMcsConsumptionUrl(
      { tenantId: "tenant with spaces", resourceId: RESOURCE },
      FIXED_NOW,
    );
    expect(url).toContain("/tenants/tenant%20with%20spaces/");
  });
});

describe("buildEnvironmentMcsEntitlementUrl", () => {
  it("builds the captured sample URL shape", () => {
    const url = buildEnvironmentMcsEntitlementUrl({
      tenantId: TENANT,
      environmentId: ENV,
    });
    expect(url).toBe(
      `https://licensing.powerplatform.microsoft.com/v0.1-alpha/tenants/${TENANT}/environments/${ENV}/entitlements/MCSMessages`,
    );
  });

  it("URL-encodes the tenant and environment in the path", () => {
    const url = buildEnvironmentMcsEntitlementUrl({
      tenantId: "tenant with spaces",
      environmentId: "env with spaces",
    });
    expect(url).toContain("/tenants/tenant%20with%20spaces/");
    expect(url).toContain("/environments/env%20with%20spaces/");
  });
});
