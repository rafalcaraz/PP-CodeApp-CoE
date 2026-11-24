import type { CreditReport, CreditReportRow } from "./types";

export interface ReportFilter { startDate?: string; endDate?: string; environmentId?: string; search?: string }
export type ReportDimension = "date" | "environment" | "resource" | "Feature" | "Product";
export interface CreditTotal { key: string; label: string; detail: string; first: number; second: number; total: number; rows: number }

export function selectReportRows(report: CreditReport, filter: ReportFilter = {}) {
  const search = filter.search?.trim().toLocaleLowerCase();
  return report.rows.filter((row) =>
    (!filter.startDate || row.date >= filter.startDate) &&
    (!filter.endDate || row.date <= filter.endDate) &&
    (!filter.environmentId || row.environmentId === filter.environmentId) &&
    (!search || Object.values(row.cells).some((value) => value.toLocaleLowerCase().includes(search))));
}

export function aggregateReportRows(rows: readonly CreditReportRow[], dimension: ReportDimension): CreditTotal[] {
  const groups = new Map<string, CreditTotal>();
  for (const row of rows) {
    const environment = row.environmentName || row.environmentId || "Environment not reported";
    let key: string;
    let label: string;
    let detail = "";
    if (dimension === "date") { key = row.date; label = row.date; }
    else if (dimension === "environment") {
      key = JSON.stringify([row.environmentId, row.environmentId ? null : row.environmentName]);
      label = environment; detail = row.environmentId || "Environment ID not reported";
    } else if (dimension === "resource") {
      const id = row.cells.ResourceID?.trim().toLowerCase();
      key = JSON.stringify([row.environmentId, row.environmentId ? null : row.environmentName, id || null, id ? null : row.cells.ResourceName]);
      label = row.cells.ResourceName || id || "Resource not reported";
      detail = `${environment} / ${id || "Resource ID not reported"} / ${row.cells.ResourceType || "Type not reported"}`;
    } else {
      key = row.cells[dimension] || "";
      label = key || "Not reported";
    }
    const group = groups.get(key) ?? { key, label, detail, first: 0, second: 0, total: 0, rows: 0 };
    group.first += row.first; group.second += row.second;
    group.total += row.first + row.second; group.rows++;
    if (![group.first, group.second, group.total].every(Number.isFinite)) throw new Error("Aggregated credits exceed the supported numeric range.");
    groups.set(key, group);
  }
  return [...groups.values()].sort(dimension === "date"
    ? (a, b) => a.key.localeCompare(b.key)
    : (a, b) => b.total - a.total || a.key.localeCompare(b.key));
}
