import type { UsageMetrics, UsagePoint, UsageSeries } from "./types";

export function aggregateUsageSeries(series: UsageSeries[]): UsageSeries {
  if (series.length === 0) {
    return {
      productCategory: "",
      interval: "Monthly",
      fromDate: "",
      toDate: "",
      points: [],
      totals: { activeUsers: 0, activeSessions: 0, activeRuns: 0 },
    };
  }

  const byDate = new Map<string, UsageMetrics>();
  for (const item of series) {
    for (const point of item.points) {
      const existing = byDate.get(point.date) ?? { activeUsers: 0, activeSessions: 0, activeRuns: 0 };
      existing.activeUsers += point.metrics.activeUsers;
      existing.activeSessions += point.metrics.activeSessions;
      existing.activeRuns += point.metrics.activeRuns;
      byDate.set(point.date, existing);
    }
  }

  const points: UsagePoint[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, metrics]) => ({ date, metrics }));

  const totals = points.reduce(
    (acc, point) => {
      acc.activeUsers += point.metrics.activeUsers;
      acc.activeSessions += point.metrics.activeSessions;
      acc.activeRuns += point.metrics.activeRuns;
      return acc;
    },
    { activeUsers: 0, activeSessions: 0, activeRuns: 0 },
  );

  return {
    productCategory: series[0]?.productCategory ?? "",
    interval: series[0]?.interval ?? "Monthly",
    fromDate: series[0]?.fromDate ?? "",
    toDate: series[0]?.toDate ?? "",
    points,
    totals,
  };
}
