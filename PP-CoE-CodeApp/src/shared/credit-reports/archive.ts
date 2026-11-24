import { strToU8, zipSync } from "fflate";
import { creditReportScopes, reconcileCreditReports } from "./collection";
import { REPORT_NAMES, type CreditReport, type ReconciledCreditReport } from "./types";

function safeFileName(name: string): string {
  return Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(character) ? "_" : character).join("")
    .replace(/^\.+/, "_") || "report.csv";
}

export function reconciledReportCsv(report: ReconciledCreditReport): string {
  const field = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [
    report.columns.map(field).join(","),
    ...report.rows.map((row) => report.columns.map((column) => field(row.cells[column] ?? "")).join(",")),
  ].join("\r\n");
}

export async function exportCreditReportArchive(captures: readonly CreditReport[]): Promise<Blob> {
  if (!captures.length) throw new Error("There are no retained report captures to export.");
  const files: Record<string, Uint8Array> = {};
  const manifest = {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    reconciliation: "Newest loaded capture wins per report type, reported/operator-assigned tenant and reported UTC day. Absent days retain older data; unassigned unknown/mixed tenant captures remain separate.",
    captures: await Promise.all(captures.map(async (capture, index) => {
      const originalPath = `originals/${String(index + 1).padStart(3, "0")}-${safeFileName(capture.fileName)}`;
      files[originalPath] = new Uint8Array(await capture.original.arrayBuffer());
      return {
        id: capture.id, name: capture.name, source: capture.source, loadedAt: capture.loadedAt,
        requestedRange: capture.requestedRange, observedRange: capture.observedRange,
        tenantAssignment: capture.tenantAssignment,
        originalPath, rows: capture.rows.length,
      };
    })),
    reconciled: REPORT_NAMES.flatMap((name) => creditReportScopes(captures, name).map((scope, index) => {
      const report = reconcileCreditReports(captures, name, scope.key)!;
      const csvPath = `reconciled/${name}-${index + 1}.csv`;
      files[csvPath] = strToU8(reconciledReportCsv(report));
      return { csvPath, name, scope: scope.key, captureIds: report.captureIds, daySources: report.daySources };
    })),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  // Store entries without recompressing large originals on the UI thread.
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: "application/zip" });
}
