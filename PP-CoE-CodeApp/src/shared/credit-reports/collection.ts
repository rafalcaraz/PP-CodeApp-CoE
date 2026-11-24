import type { CreditReport, CreditReportRow, ReconciledCreditReport, ReportName, ReportRange } from "./types";

export function orderCreditReportCaptures(captures: readonly CreditReport[]): CreditReport[] {
  return [...captures].sort((a, b) => Date.parse(a.loadedAt) - Date.parse(b.loadedAt));
}

export function creditReportScope(report: CreditReport): { key: string; label: string } {
  const tenants = new Set(report.rows.map((row) => row.cells.TenantID?.trim().toLowerCase()).filter(Boolean));
  if (tenants.size === 1 && report.rows.every((row) => Boolean(row.cells.TenantID?.trim()))) {
    const tenant = [...tenants][0];
    return { key: `tenant:${tenant}`, label: `Reported tenant ${tenant}` };
  }
  return {
    key: `capture:${report.id}`,
    label: `${tenants.size > 1 ? "Mixed tenants" : "Tenant not fully reported"} / ${report.fileName} / ${report.loadedAt}`,
  };
}

export function creditReportScopes(captures: readonly CreditReport[], name: ReportName) {
  const scopes = new Map<string, { key: string; label: string }>();
  for (const capture of orderCreditReportCaptures(captures).reverse()) {
    if (capture.name === name) {
      const scope = creditReportScope(capture);
      scopes.set(scope.key, scope);
    }
  }
  return [...scopes.values()].sort((a, b) => Number(b.key.startsWith("tenant:")) - Number(a.key.startsWith("tenant:")));
}

export function findCoveringCreditReport(captures: readonly CreditReport[], name: ReportName, range: ReportRange) {
  return orderCreditReportCaptures(captures).reverse().find((capture) =>
    capture.name === name && capture.source !== "upload" && capture.requestedRange
    && capture.requestedRange.startDate <= range.startDate && capture.requestedRange.endDate >= range.endDate);
}

export function reconcileCreditReports(
  captures: readonly CreditReport[], name: ReportName, scopeKey?: string,
): ReconciledCreditReport | undefined {
  const scopes = creditReportScopes(captures, name);
  if (!scopes.length) return undefined;
  if (!scopeKey && scopes.length > 1) throw new Error("Choose one reported tenant scope before reconciling captures. Unknown or mixed tenant captures are kept separate.");
  const scope = scopeKey ?? scopes[0].key;
  const selected = orderCreditReportCaptures(captures).filter((capture) =>
    capture.name === name && creditReportScope(capture).key === scope);
  if (!selected.length) throw new Error("No retained captures match the selected report type and tenant scope.");
  const days = new Map<string, { captureId: string; rows: CreditReportRow[] }>();
  const columns = new Set<string>();
  for (const capture of selected) {
    for (const column of capture.columns) columns.add(column);
    const capturedDays = new Map<string, CreditReportRow[]>();
    for (const row of capture.rows) {
      const rows = capturedDays.get(row.date) ?? [];
      rows.push(row);
      capturedDays.set(row.date, rows);
    }
    // Replace complete reported days, not guessed row identities or absent dates.
    for (const [day, rows] of capturedDays) days.set(day, { captureId: capture.id, rows });
  }
  const dates = [...days.keys()].sort();
  const newest = selected[selected.length - 1];
  return {
    id: JSON.stringify(["reconciled", name, scope, selected.map((capture) => capture.id)]),
    schemaVersion: 1, name, granularity: "Daily", source: "reconciled", scopeKey: scope,
    loadedAt: newest.loadedAt, columns: [...columns],
    rows: dates.flatMap((day) => days.get(day)!.rows),
    observedRange: dates.length ? { startDate: dates[0], endDate: dates[dates.length - 1] } : null,
    captureIds: selected.map((capture) => capture.id),
    daySources: Object.fromEntries(dates.map((day) => [day, days.get(day)!.captureId])),
  };
}
