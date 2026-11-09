import { describe, expect, it } from "vitest";
import { dailyWindow, dayAfter, detailWindow, previousUtcDay, reviewDecision, strongRequestEtag, validateBatchResponse, validateDecisions, validateWave2Parameters } from "./wave2";

const now = Date.parse("2026-11-08T12:00:00Z");
describe("Wave 2 selectors", () => {
  it("uses completed UTC calendar days, including leap years, rather than local dates", () => {
    expect(previousUtcDay(now)).toBe("2026-11-07");
    expect(dayAfter("2024-02-29")).toBe("2024-03-01");
    expect(() => dailyWindow("2026-11-07", "2026-11-08", now)).not.toThrow();
    for (const [from, to] of [["2026-11-08", "2026-11-09"], ["2026-11-06", "2026-11-08"], ["2026-02-30", "2026-03-03"], ["2026-11-07", "2026-11-07"]]) {
      expect(() => dailyWindow(from, to, now)).toThrow();
    }
  });
  it("validates exact seven-digit timestamp precision, duration and the exclusive month boundary", () => {
    expect(() => detailWindow("2026-10-31T12:00:00Z", "2026-11-01T00:00:00.0000000Z", now)).not.toThrow();
    expect(() => detailWindow("2026-11-01T00:00:00.0000001Z", "2026-11-01T00:00:00.0000002Z", now)).not.toThrow();
    for (const [from, to] of [
      ["2026-10-31T12:00:00Z", "2026-11-01T00:00:00.0000001Z"],
      ["2026-11-01T00:00:00Z", "2026-11-02T00:00:00.0000001Z"],
      ["2026-11-01T00:00:00.0000002Z", "2026-11-01T00:00:00.0000001Z"],
      ["2026-11-08T11:00:00Z", "2026-11-08T12:00:00.0000001Z"],
      ["2026-11-01T00:00:00+00:00", "2026-11-01T12:00:00Z"],
      ["2026-02-30T00:00:00Z", "2026-03-01T00:00:00Z"],
    ]) expect(() => detailWindow(from, to, now)).toThrow();
  });
  it("rejects unsupported query forms without inventing fields or session minimums", () => {
    expect(() => validateWave2Parameters("ListFundingUsageRecords", { month: "2026-13" }, now)).toThrow("calendar month");
    expect(() => validateWave2Parameters("ListUserUsageRecords", { startDate: "2026-11-07", endDate: "2026-11-08", $filter: "groupId eq 'g'" }, now)).toThrow("userId eq");
    expect(() => validateWave2Parameters("ListCreditRequests", { $filter: "state eq 'pending' and serviceId eq 'workIQ'" })).not.toThrow();
    for (const filter of ["state eq 'pending' or state eq 'approved'", "state eq 'pending' and state eq 'approved'", "state eq microsoft.graph.creditRequestState'pending'", "state eq 'pending' and "]) {
      expect(() => validateWave2Parameters("ListCreditRequests", { $filter: filter })).toThrow();
    }
  });
});
describe("request-specific concurrency and non-atomic results", () => {
  it("accepts only whole quoted strong tokens, preserving quotes", () => {
    expect(strongRequestEtag('"7"')).toBe(true);
    expect(strongRequestEtag('""')).toBe(true);
    for (const token of ['W/"7"', "*", "7", '"7"\n', '"7"\r\n', null, undefined]) expect(strongRequestEtag(token)).toBe(false);
    expect(reviewDecision({ id: "r", state: "pending", "@odata.etag": '"7"' }, "approved")).toEqual({ requestId: "r", state: "approved", etag: '"7"' });
    for (const state of ["approved", "rejected", "cancelled", "unknownFutureValue", undefined]) {
      expect(() => reviewDecision({ id: "r", state, "@odata.etag": '"7"' }, "rejected")).toThrow("Only pending");
    }
  });
  it("enforces 1-100 unique IDs and verifies partial batch accounting without converting failures into successes", () => {
    const item = { requestId: "r", state: "approved" as const, etag: '"7"' };
    for (const value of [[], [item, item], [item, { ...item, requestId: "R" }], Array.from({ length: 101 }, (_, i) => ({ ...item, requestId: String(i) })), [{ ...item, etag: 'W/"7"' }]]) {
      expect(() => validateDecisions(value)).toThrow();
    }
    expect(() => validateDecisions([item])).not.toThrow();
    expect(() => validateBatchResponse({ succeededCount: 0, failedCount: 1, responses: [{ requestId: "r", status: "preconditionFailed" }] }, [item])).not.toThrow();
    for (const data of [{}, { succeededCount: 1, failedCount: 0, responses: [] }, { succeededCount: 1, failedCount: 0, responses: [{ requestId: "r", status: "failed" }] }]) {
      expect(() => validateBatchResponse(data, [item])).toThrow("never replay");
    }
  });
});
