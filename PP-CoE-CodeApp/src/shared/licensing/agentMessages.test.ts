import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
vi.mock(
  "../../generated/services/PPLicensingAPI_Wrapper_FlowService",
  () => ({
    PPLicensingAPI_Wrapper_FlowService: { Run: runMock },
  }),
);

import {
  getAgentMessagesConsumed,
  normalizeAgentMessages,
} from "./agentMessages";
import { clearLicensingInflight } from "./client";

const TENANT = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
const RESOURCE = "18fdcde8-4e1b-f111-8341-0022480a5972";

// Captured-sample response shape: array of pages each with a `resources`
// array. The sample we got back from the user had a single page with one
// matching resource; we test both single-page and multi-page below.
const ITSNOW_SAMPLE = [
  {
    resources: [
      {
        environmentId: "eb2d8ba3-28a6-efa4-8878-509c60c9fe1a",
        resourceId: RESOURCE,
        consumed: 0.0,
        unit: "Messages",
        metadata: {
          ResourceName: "ITSNowAgent",
          NonBillableQuantity: 0.0,
        },
        asOfDate: "2026-06-03T03:53:08.777",
      },
    ],
  },
];

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

describe("normalizeAgentMessages", () => {
  it("normalizes the captured ITSNowAgent sample into a single snapshot", () => {
    const out = normalizeAgentMessages(
      ITSNOW_SAMPLE,
      RESOURCE,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );
    expect(out).toEqual({
      consumed: 0,
      unit: "Messages",
      resourceName: "ITSNowAgent",
      environmentId: "eb2d8ba3-28a6-efa4-8878-509c60c9fe1a",
      asOfDate: "2026-06-03T03:53:08.777",
      fromDate: "2026-05-04",
      toDate: "2026-06-03",
      empty: false,
    });
  });

  it("matches resourceId case-insensitively (GUIDs sometimes round-trip mixed-case)", () => {
    const mixedCasePayload = [
      {
        resources: [
          {
            environmentId: "env-1",
            resourceId: RESOURCE.toUpperCase(),
            consumed: 12.5,
            unit: "Messages",
            metadata: { ResourceName: "MixedCase" },
            asOfDate: "2026-06-03T00:00:00",
          },
        ],
      },
    ];
    const out = normalizeAgentMessages(
      mixedCasePayload,
      RESOURCE,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );
    expect(out.consumed).toBe(12.5);
    expect(out.resourceName).toBe("MixedCase");
    expect(out.empty).toBe(false);
  });

  it("sums consumed across multiple matching entries and picks the most-recent asOfDate", () => {
    const multiPage = [
      {
        resources: [
          {
            resourceId: RESOURCE,
            consumed: 5,
            unit: "Messages",
            metadata: { ResourceName: "First" },
            asOfDate: "2026-06-01T00:00:00",
          },
        ],
      },
      {
        resources: [
          {
            resourceId: RESOURCE,
            consumed: 7,
            unit: "Messages",
            metadata: { ResourceName: "Second" },
            asOfDate: "2026-06-03T00:00:00", // newer — should win for asOfDate
          },
        ],
      },
    ];
    const out = normalizeAgentMessages(
      multiPage,
      RESOURCE,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );
    expect(out.consumed).toBe(12);
    expect(out.asOfDate).toBe("2026-06-03T00:00:00");
    // First non-empty metadata wins (deterministic order).
    expect(out.resourceName).toBe("First");
  });

  it("ignores resources that don't match the requested resourceId", () => {
    const mixed = [
      {
        resources: [
          { resourceId: "other-1", consumed: 999, unit: "Messages" },
          { resourceId: RESOURCE, consumed: 3, unit: "Messages" },
          { resourceId: "other-2", consumed: 999, unit: "Messages" },
        ],
      },
    ];
    const out = normalizeAgentMessages(
      mixed,
      RESOURCE,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );
    expect(out.consumed).toBe(3);
    expect(out.empty).toBe(false);
  });

  it("returns empty: true (consumed=0, no error) when no resources match", () => {
    const empty = [{ resources: [] }];
    const out = normalizeAgentMessages(
      empty,
      RESOURCE,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );
    expect(out.consumed).toBe(0);
    expect(out.empty).toBe(true);
    expect(out.unit).toBe("Messages");
    expect(out.fromDate).toBe("2026-05-04");
    expect(out.toDate).toBe("2026-06-03");
  });

  it("accepts a single page object too (not wrapped in an array)", () => {
    const singleObj = {
      resources: [
        {
          resourceId: RESOURCE,
          consumed: 42,
          unit: "Messages",
          asOfDate: "2026-06-03T00:00:00",
        },
      ],
    };
    const out = normalizeAgentMessages(
      singleObj,
      RESOURCE,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );
    expect(out.consumed).toBe(42);
    expect(out.empty).toBe(false);
  });

  it("coerces string consumed values to numbers", () => {
    const stringConsumed = [
      {
        resources: [
          {
            resourceId: RESOURCE,
            consumed: "17.25",
            unit: "Messages",
          },
        ],
      },
    ];
    const out = normalizeAgentMessages(
      stringConsumed,
      RESOURCE,
      new Date("2026-05-04T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
    );
    expect(out.consumed).toBe(17.25);
  });

  it("throws on completely wrong-shape payloads (caller catches)", () => {
    expect(() =>
      normalizeAgentMessages(
        "not an object",
        RESOURCE,
        new Date("2026-05-04T00:00:00.000Z"),
        new Date("2026-06-03T00:00:00.000Z"),
      ),
    ).toThrow();
  });
});

describe("getAgentMessagesConsumed", () => {
  it("returns { ok: false } when tenantId is missing", async () => {
    const res = await getAgentMessagesConsumed({
      tenantId: "",
      resourceId: RESOURCE,
    });
    expect(res.ok).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when resourceId is missing", async () => {
    const res = await getAgentMessagesConsumed({
      tenantId: TENANT,
      resourceId: "",
    });
    expect(res.ok).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("returns normalized data on a successful flow call", async () => {
    runMock.mockResolvedValueOnce(asFlowResponse(ITSNOW_SAMPLE));
    const res = await getAgentMessagesConsumed({
      tenantId: TENANT,
      resourceId: RESOURCE,
      from: new Date("2026-05-04T00:00:00.000Z"),
      to: new Date("2026-06-03T00:00:00.000Z"),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.consumed).toBe(0);
      expect(res.data.resourceName).toBe("ITSNowAgent");
      expect(res.data.empty).toBe(false);
    }
    expect(runMock).toHaveBeenCalledOnce();
    const args = runMock.mock.calls[0][0];
    expect(args.text).toBe("GET");
    expect(args.text_1).toContain("/entitlements/MCSMessages/resources?");
    expect(args.text_1).toContain("fromDate=2026-05-04");
    expect(args.text_1).toContain("toDate=2026-06-03");
    expect(args.text_1).toContain(`searchRequest=${RESOURCE}`);
  });

  it("returns { ok: false } when the flow itself fails", async () => {
    runMock.mockResolvedValueOnce({ success: false, error: "boom" });
    const res = await getAgentMessagesConsumed({
      tenantId: TENANT,
      resourceId: RESOURCE,
    });
    expect(res.ok).toBe(false);
  });
});
