import { describe, expect, it } from "vitest";
import { aggregateUsageSeries } from "./aggregate";
import type { UsageSeries } from "./types";

const makeSeries = (productCategory: string, points: Array<[string, number, number, number]>): UsageSeries => ({
  productCategory,
  interval: "Monthly",
  fromDate: "2026-01-01",
  toDate: "2026-03-01",
  points: points.map(([date, users, sessions, runs]) => ({
    date,
    metrics: { activeUsers: users, activeSessions: sessions, activeRuns: runs },
  })),
  totals: { activeUsers: 0, activeSessions: 0, activeRuns: 0 },
});

describe("aggregateUsageSeries", () => {
  it("returns an empty series for empty input", () => {
    const aggregated = aggregateUsageSeries([]);
    expect(aggregated.points).toEqual([]);
    expect(aggregated.totals).toEqual({ activeUsers: 0, activeSessions: 0, activeRuns: 0 });
  });

  it("sums overlapping dates and keeps the output sorted", () => {
    const aggregated = aggregateUsageSeries([
      makeSeries("CopilotStudio", [
        ["2026-01-01", 1, 2, 3],
        ["2026-02-01", 4, 5, 6],
      ]),
      makeSeries("PowerAutomate", [
        ["2026-02-01", 7, 8, 9],
        ["2026-03-01", 10, 11, 12],
      ]),
    ]);

    expect(aggregated.points.map((point) => point.date)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(aggregated.points[1].metrics).toEqual({ activeUsers: 11, activeSessions: 13, activeRuns: 15 });
    expect(aggregated.totals).toEqual({ activeUsers: 22, activeSessions: 26, activeRuns: 30 });
  });
});
