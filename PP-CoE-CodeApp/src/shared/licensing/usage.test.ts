import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
vi.mock(
  "../../generated/services/PPLicensingAPI_Wrapper_FlowService",
  () => ({
    PPLicensingAPI_Wrapper_FlowService: { Run: runMock },
  }),
);

import { getUsageTimeseries, normalizeUsageSeries } from "./usage";
import { clearLicensingInflight } from "./client";

const TENANT = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
const RESOURCE_CS = "23aea064-6242-f111-bec7-7ced8d6fee16";

const COPILOT_SAMPLE = {
  productCategory: "CopilotStudio",
  interval: "Monthly",
  top: 0,
  fromDate: "2026-01-01T00:00:00+00:00",
  toDate: "2026-05-31T00:00:00+00:00",
  points: [
    {
      date: "2026-04-01T00:00:00+00:00",
      metrics: { activeUsers: 1.0, activeSessions: 10.0, activeRuns: 0.0 },
    },
    {
      date: "2026-05-01T00:00:00+00:00",
      metrics: { activeUsers: 1.0, activeSessions: 527.0, activeRuns: 0.0 },
    },
  ],
  totals: { activeUsers: 2.0, activeSessions: 537.0, activeRuns: 0.0 },
};

const POWER_AUTOMATE_DESCENDING = {
  productCategory: "PowerAutomate",
  interval: "Monthly",
  fromDate: "2026-01-01T00:00:00+00:00",
  toDate: "2026-05-31T00:00:00+00:00",
  points: [
    {
      date: "2026-05-01T00:00:00+00:00",
      metrics: { activeUsers: 1.0, activeSessions: 31.0, activeRuns: 60731.0 },
    },
    {
      date: "2026-04-01T00:00:00+00:00",
      metrics: { activeUsers: 1.0, activeSessions: 30.0, activeRuns: 0.0 },
    },
    {
      date: "2026-01-01T00:00:00+00:00",
      metrics: { activeUsers: 1.0, activeSessions: 14.0, activeRuns: 0.0 },
    },
  ],
  totals: { activeUsers: 3.0, activeSessions: 75.0, activeRuns: 60731.0 },
};

beforeEach(() => {
  runMock.mockReset();
  clearLicensingInflight();
});

afterEach(() => {
  clearLicensingInflight();
});

describe("normalizeUsageSeries (pure)", () => {
  it("normalizes the Copilot Studio sample exactly", () => {
    const series = normalizeUsageSeries(COPILOT_SAMPLE, {
      productCategory: "CopilotStudio",
    });
    expect(series.productCategory).toBe("CopilotStudio");
    expect(series.interval).toBe("Monthly");
    expect(series.points).toHaveLength(2);
    expect(series.points[0].date).toBe("2026-04-01T00:00:00+00:00");
    expect(series.points[1].date).toBe("2026-05-01T00:00:00+00:00");
    expect(series.totals).toEqual({
      activeUsers: 2,
      activeSessions: 537,
      activeRuns: 0,
    });
  });

  it("sorts API-descending points to ascending date order", () => {
    const series = normalizeUsageSeries(POWER_AUTOMATE_DESCENDING, {
      productCategory: "PowerAutomate",
    });
    const dates = series.points.map((p) => p.date);
    expect(dates).toEqual([
      "2026-01-01T00:00:00+00:00",
      "2026-04-01T00:00:00+00:00",
      "2026-05-01T00:00:00+00:00",
    ]);
  });

  it("coerces missing metric fields to 0", () => {
    const series = normalizeUsageSeries(
      {
        productCategory: "PowerApps",
        points: [
          { date: "2026-02-01T00:00:00+00:00", metrics: { activeUsers: 7 } },
        ],
        totals: { activeUsers: 7 },
      },
      { productCategory: "PowerApps" },
    );
    expect(series.points[0].metrics).toEqual({
      activeUsers: 7,
      activeSessions: 0,
      activeRuns: 0,
    });
    expect(series.totals).toEqual({
      activeUsers: 7,
      activeSessions: 0,
      activeRuns: 0,
    });
  });

  it("recomputes totals when the API omits them", () => {
    const series = normalizeUsageSeries(
      {
        productCategory: "CopilotStudio",
        points: [
          { date: "2026-01-01", metrics: { activeUsers: 1, activeSessions: 2, activeRuns: 3 } },
          { date: "2026-02-01", metrics: { activeUsers: 4, activeSessions: 5, activeRuns: 6 } },
        ],
      },
      { productCategory: "CopilotStudio" },
    );
    expect(series.totals).toEqual({
      activeUsers: 5,
      activeSessions: 7,
      activeRuns: 9,
    });
  });

  it("returns empty points (not an error) when the API returns no buckets", () => {
    const series = normalizeUsageSeries(
      {
        productCategory: "PowerAutomate",
        interval: "Monthly",
        points: [],
        totals: { activeUsers: 0, activeSessions: 0, activeRuns: 0 },
      },
      { productCategory: "PowerAutomate" },
    );
    expect(series.points).toEqual([]);
    expect(series.totals).toEqual({
      activeUsers: 0,
      activeSessions: 0,
      activeRuns: 0,
    });
  });

  it("drops points missing a date string", () => {
    const series = normalizeUsageSeries(
      {
        productCategory: "CopilotStudio",
        points: [
          { date: "2026-01-01", metrics: {} },
          { metrics: { activeUsers: 99 } },
          { date: 12345, metrics: {} }, // wrong type
        ],
      },
      { productCategory: "CopilotStudio" },
    );
    expect(series.points).toHaveLength(1);
    expect(series.points[0].date).toBe("2026-01-01");
  });
});

describe("getUsageTimeseries (integration with mocked flow)", () => {
  it("end-to-end happy path returns a normalized series", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify(COPILOT_SAMPLE) },
    });
    const res = await getUsageTimeseries({
      productCategory: "CopilotStudio",
      tenantId: TENANT,
      resourceId: RESOURCE_CS,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.productCategory).toBe("CopilotStudio");
      expect(res.data.points).toHaveLength(2);
    }
  });

  it("guards against empty tenantId without invoking the flow", async () => {
    const res = await getUsageTimeseries({
      productCategory: "CopilotStudio",
      tenantId: "",
      resourceId: RESOURCE_CS,
    });
    expect(res).toEqual({
      ok: false,
      error: "Missing tenantId — cannot query licensing API.",
    });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("guards against empty resourceId without invoking the flow", async () => {
    const res = await getUsageTimeseries({
      productCategory: "CopilotStudio",
      tenantId: TENANT,
      resourceId: "",
    });
    expect(res).toEqual({
      ok: false,
      error: "Missing resourceId — cannot query licensing API.",
    });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("propagates client errors with their message", async () => {
    runMock.mockResolvedValueOnce({ success: false, error: { message: "Boom" } });
    const res = await getUsageTimeseries({
      productCategory: "PowerAutomate",
      tenantId: TENANT,
      resourceId: RESOURCE_CS,
    });
    expect(res).toEqual({ ok: false, error: "Boom" });
  });

  it("invokes the flow with the correct method/url translation", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ productCategory: "PowerApps", points: [] }) },
    });
    await getUsageTimeseries({
      productCategory: "PowerApps",
      tenantId: TENANT,
      resourceId: "some-app-id",
    });
    const args = runMock.mock.calls[0][0];
    expect(args.text).toBe("GET");
    expect(args.text_1).toContain("/v1.0/tenants/");
    expect(args.text_1).toContain("/usageData/PowerApps/timeseries");
    expect(args.text_1).toContain("resourceId=some-app-id");
  });
});
