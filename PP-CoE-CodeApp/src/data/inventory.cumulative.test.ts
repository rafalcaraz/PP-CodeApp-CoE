/**
 * Tests for the cumulative time-series helpers in `inventory.ts`.
 *
 * `computeCumulative` is a pure function — tested directly.
 * `runCumulativeSeries` integrates the existing `runTimeSeriesAggregate`
 * (delta query) with a baseline `runRawQuery` call; we mock the
 * underlying connector and assert both queries are issued and the math
 * lines up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryResourcesMock } = vi.hoisted(() => ({
  queryResourcesMock: vi.fn(),
}));

vi.mock("../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    QueryResources: queryResourcesMock,
  },
}));

// Import AFTER vi.mock so the mock is in place when inventory.ts evaluates.
import {
  ResourceType,
  computeCumulative,
  invalidateInventoryCache,
  runCumulativeSeries,
} from "./inventory";

beforeEach(() => {
  queryResourcesMock.mockReset();
  invalidateInventoryCache();
});

// ---------------------------------------------------------------------------
// computeCumulative — pure math
// ---------------------------------------------------------------------------

describe("computeCumulative", () => {
  it("returns empty when there are no deltas", () => {
    expect(computeCumulative(0, [])).toEqual([]);
    expect(computeCumulative(42, [])).toEqual([]);
  });

  it("running total stacks on top of baseline", () => {
    const out = computeCumulative(10, [
      { date: "2026-04-01", value: 3 },
      { date: "2026-04-08", value: 2 },
      { date: "2026-04-15", value: 5 },
    ]);
    expect(out).toEqual([
      { date: "2026-04-01", delta: 3, total: 13 },
      { date: "2026-04-08", delta: 2, total: 15 },
      { date: "2026-04-15", delta: 5, total: 20 },
    ]);
  });

  it("baseline 0 reduces to pure cumsum", () => {
    const out = computeCumulative(0, [
      { date: "2026-04-01", value: 1 },
      { date: "2026-04-02", value: 2 },
      { date: "2026-04-03", value: 3 },
    ]);
    expect(out.map((d) => d.total)).toEqual([1, 3, 6]);
  });

  it("handles empty (zero) buckets without resetting the running total", () => {
    const out = computeCumulative(5, [
      { date: "w1", value: 0 },
      { date: "w2", value: 0 },
      { date: "w3", value: 4 },
    ]);
    expect(out.map((d) => d.total)).toEqual([5, 5, 9]);
  });

  it("clamps negative baselines to 0 (defensive)", () => {
    const out = computeCumulative(-100, [{ date: "x", value: 7 }]);
    expect(out[0]).toEqual({ date: "x", delta: 7, total: 7 });
  });

  it("coerces non-number delta values via Number()", () => {
    const out = computeCumulative(10, [
      // Cast through unknown because the helper accepts the field generically.
      { date: "x", value: "3" as unknown as number },
      { date: "y", value: "2" as unknown as number },
    ]);
    expect(out.map((d) => d.total)).toEqual([13, 15]);
  });
});

// ---------------------------------------------------------------------------
// runCumulativeSeries — wires baseline + delta query together
// ---------------------------------------------------------------------------

const AGENT_SPEC = {
  resourceTypes: [ResourceType.CopilotStudioAgent],
  filters: [],
  orderField: "",
  orderDirection: "desc" as const,
  limit: 100,
};

/** Helper: produce a connector response shape that runQuery expects.
 *  Mirrors the real envelope `{ success, data: { totalRecords, data: [], skipToken } }`. */
function connectorResponse(items: unknown[], totalRecords?: number) {
  return {
    success: true,
    data: {
      totalRecords: totalRecords ?? items.length,
      data: items,
      skipToken: null,
    },
  };
}

describe("runCumulativeSeries", () => {
  it("returns empty data when dateField is blank", async () => {
    const res = await runCumulativeSeries(AGENT_SPEC, "", "week", 30);
    expect(res).toEqual({ ok: true, data: [] });
    // No connector calls made.
    expect(queryResourcesMock).not.toHaveBeenCalled();
  });

  it("issues two queries (deltas + baseline) and merges via computeCumulative", async () => {
    // 1st call: the delta time-series aggregate. Items shape mirrors what
    // `runTimeSeriesAggregate` reads: `{ properties: { t_bucket, resourceCount } }`.
    // The function reads from both raw and props, so put fields on raw
    // for clarity.
    queryResourcesMock.mockResolvedValueOnce(
      connectorResponse(
        [
          { t_bucket: "2026-04-01T00:00:00Z", resourceCount: 3, properties: {} },
          { t_bucket: "2026-04-08T00:00:00Z", resourceCount: 2, properties: {} },
        ],
        2
      )
    );

    // 2nd call: baseline count query (where dateField <= ago(Nd)). The
    // function reads `totalRecords` from the envelope — items don't matter.
    queryResourcesMock.mockResolvedValueOnce(connectorResponse([{}], 100));

    const res = await runCumulativeSeries(
      AGENT_SPEC,
      "properties.createdAt",
      "week",
      30
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
    expect(res.data).toEqual([
      { date: "2026-04-01T00:00:00Z", delta: 3, total: 103 },
      { date: "2026-04-08T00:00:00Z", delta: 2, total: 105 },
    ]);
  });

  it("propagates the delta-query error without making the baseline call", async () => {
    queryResourcesMock.mockRejectedValueOnce(new Error("kaboom"));

    const res = await runCumulativeSeries(
      AGENT_SPEC,
      "properties.createdAt",
      "week",
      30
    );

    expect(res.ok).toBe(false);
    expect(queryResourcesMock).toHaveBeenCalledTimes(1);
  });

  it("propagates the baseline-query error", async () => {
    // Delta query succeeds with zero buckets.
    queryResourcesMock.mockResolvedValueOnce(connectorResponse([], 0));
    queryResourcesMock.mockRejectedValueOnce(new Error("baseline failed"));

    const res = await runCumulativeSeries(
      AGENT_SPEC,
      "properties.createdAt",
      "week",
      30
    );

    expect(res.ok).toBe(false);
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
  });

  it("baseline query is constructed with <= ago(Nd) on the dateField", async () => {
    queryResourcesMock.mockResolvedValueOnce(connectorResponse([], 0));
    queryResourcesMock.mockResolvedValueOnce(connectorResponse([{}], 42));

    await runCumulativeSeries(
      AGENT_SPEC,
      "properties.createdAt",
      "day",
      90
    );

    // The second call is the baseline. Inspect its clauses to confirm
    // the cutoff filter is present.
    const baselineCall = queryResourcesMock.mock.calls[1];
    const body = baselineCall[1] as { Clauses?: Array<{ $type?: string; FieldName?: string; Operator?: string; Values?: string[] }> };
    const clauses = body.Clauses ?? [];
    const whereClauses = clauses.filter((c) => c.$type === "where");
    const cutoff = whereClauses.find(
      (c) => c.FieldName === "properties.createdAt" && c.Operator === "<="
    );
    expect(cutoff).toBeDefined();
    expect(cutoff?.Values).toEqual(["ago(90d)"]);
  });
});
