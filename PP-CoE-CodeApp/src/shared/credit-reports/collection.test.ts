import { gzipSync, strFromU8, strToU8, unzipSync } from "fflate";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { exportCreditReportArchive } from "./archive";
import { creditReportScope, creditReportScopes, findCoveringCreditReport, reconcileCreditReports } from "./collection";
import { parseReportCsv, readCreditReport, reportRangePreset } from "./files";
import {
  clearCreditReports, getCreditReportCaptures, getCreditReports, removeCreditReportCapture, retainCreditReport,
} from "./store";
import type { CreditReport } from "./types";

const { Blob: NodeBlob } = await vi.importActual<{ Blob: typeof Blob }>("node:buffer");
vi.stubGlobal("Blob", NodeBlob);
afterAll(() => vi.unstubAllGlobals());
afterEach(() => clearCreditReports());
const header = "ConsumptionDate,TenantID,EnvironmentID,ResourceID,ResourceName,BilledCredits,NonBilledCredits";
const row = (day: string, value: number, resource = "bot-a", tenant = "tenant-a") =>
  `${day},${tenant},env-a,${resource},Example resource,${value},0`;
async function capture(id: string, rows: string[], loadedAt = "2026-11-03T00:00:00Z"): Promise<CreditReport> {
  return {
    ...await readCreditReport(new Blob([[header, ...rows].join("\r\n")]), `${id}.csv`, { source: "upload" }),
    id, loadedAt,
  };
}

describe("retained credit-report captures", () => {
  it("replaces an entire overlapping day, retaining absent days and original captures", async () => {
    const first = await capture("first", [row("2026-11-01", 10), row("2026-11-02", 20), row("2026-11-02", 30, "bot-removed")]);
    const next = await capture("next", [row("2026-11-02", 7), row("2026-11-03", 5)]);
    retainCreditReport(first); retainCreditReport(next);
    const combined = reconcileCreditReports(getCreditReportCaptures(), first.name)!;
    expect(combined.rows.map(({ date, first }) => [date, first])).toEqual([
      ["2026-11-01", 10], ["2026-11-02", 7], ["2026-11-03", 5],
    ]);
    expect(combined.daySources).toEqual({ "2026-11-01": "first", "2026-11-02": "next", "2026-11-03": "next" });
    expect(getCreditReports()).toEqual([next]);
    expect(getCreditReportCaptures()).toEqual([first, next]);
    expect(first.rows).toHaveLength(3);
    removeCreditReportCapture(next.id);
    expect(reconcileCreditReports(getCreditReportCaptures(), first.name)?.rows).toEqual(first.rows);
    expect(getCreditReports()).toEqual([first]);
  });
  it("uses load time rather than caller order, breaking timestamp ties by collection order", async () => {
    const older = await capture("older", [row("2026-11-01", 10)], "2026-11-02T00:00:00Z");
    const newer = await capture("newer", [row("2026-11-01", 3)]);
    expect(reconcileCreditReports([newer, older], older.name)?.rows[0].first).toBe(3);
    expect(reconcileCreditReports([newer, { ...older, loadedAt: newer.loadedAt }], older.name)?.rows[0].first).toBe(10);
    retainCreditReport(newer); retainCreditReport(older); retainCreditReport(older);
    expect(getCreditReports()).toEqual([newer]);
    expect(getCreditReportCaptures()).toHaveLength(2);
    expect(getCreditReportCaptures()).toBe(getCreditReportCaptures());
    clearCreditReports();
    const tiedOlder = { ...older, loadedAt: newer.loadedAt };
    retainCreditReport(tiedOlder); retainCreditReport(newer); retainCreditReport(tiedOlder);
    expect(getCreditReports()).toEqual([newer]);
  });
  it("does not erase observed days with empty captures or combine report types or reported tenants", async () => {
    const first = await capture("first", [row("2026-11-01", 10)]);
    const otherTenant = await capture("other", [row("2026-11-01", 99, "bot-a", "tenant-b")]);
    const empty = await capture("empty", []);
    const billing = await readCreditReport(new Blob([
      "BilledDate,TenantID,CapacityPackCreditsConsumed,PayGoConsumedQuantity\n2026-11-01,tenant-a,100,2",
    ]), "billing.csv", { source: "upload" });
    const captures = [first, otherTenant, empty, billing];
    expect(() => reconcileCreditReports(captures, first.name)).toThrow("Choose one reported tenant scope");
    const combined = reconcileCreditReports(captures, first.name, creditReportScope(first).key)!;
    expect(combined.rows).toEqual(first.rows);
    expect(combined.captureIds).toEqual(["first"]);
    expect(reconcileCreditReports(captures, billing.name)?.rows[0].first).toBe(100);
    expect(() => reconcileCreditReports(captures, first.name, "tenant:missing")).toThrow("No retained captures");
  });
  it("keeps missing, partially reported and mixed tenant identities isolated instead of guessing joins", async () => {
    const missing = await capture("missing", [row("2026-11-01", 1, "bot-a", "")]);
    const anotherMissing = { ...missing, id: "another-missing" };
    const partial = await capture("partial", [row("2026-11-01", 2), row("2026-11-02", 3, "bot-a", "")]);
    const mixed = await capture("mixed", [row("2026-11-01", 4), row("2026-11-02", 5, "bot-a", "tenant-b")]);
    const captures = [missing, anotherMissing, partial, mixed];
    expect(creditReportScopes(captures, missing.name)).toHaveLength(4);
    expect(() => reconcileCreditReports(captures, missing.name)).toThrow("Choose one reported tenant scope");
    expect(reconcileCreditReports(captures, missing.name, creditReportScope(missing).key)?.rows).toEqual(missing.rows);
    const differentlyCased = await capture("case", [row("2026-11-01", 7, "bot-a", " TENANT-A ")]);
    expect(creditReportScope(differentlyCased).key).toBe("tenant:tenant-a");
  });
  it("offers a prior requested-period match without treating uploads or observed gaps as verified freshness", async () => {
    const range = { startDate: "2026-11-01", endDate: "2026-11-03" };
    const downloaded: CreditReport = {
      ...await capture("download", [row("2026-11-01", 1)]), source: "connector", requestedRange: range,
    };
    const uploaded = { ...downloaded, id: "upload", source: "upload" } as const;
    expect(findCoveringCreditReport([downloaded, uploaded], downloaded.name, range)).toBe(downloaded);
    expect(findCoveringCreditReport([uploaded], uploaded.name, range)).toBeUndefined();
    expect(findCoveringCreditReport([downloaded], downloaded.name, { ...range, endDate: "2026-11-04" })).toBeUndefined();
  });
  it("calculates editable request presets as completed UTC days across leap and year boundaries", () => {
    expect(reportRangePreset(1, new Date("2026-01-01T00:00:00Z"))).toEqual({ startDate: "2025-12-31", endDate: "2025-12-31" });
    expect(reportRangePreset(7, new Date("2028-03-01T23:59:59Z"))).toEqual({ startDate: "2028-02-23", endDate: "2028-02-29" });
  });
});

describe("credit report collection ZIP", () => {
  it("preserves every original byte and separate derived datasets with winning-day provenance and CSV quoting", async () => {
    const originalText = `${header}\r\n2026-11-01,tenant-a,env-a,bot-a,"Agent, ""One""\nSecond line",10,2\r\n${row("2026-11-02", 20)}`;
    const gzip = gzipSync(strToU8(originalText));
    const first: CreditReport = {
      ...await readCreditReport(new Blob([gzip]), "same.csv.gz", { source: "upload" }),
      id: "first", loadedAt: "2026-11-03T00:00:00Z", fileName: "../unsafe\\same.csv.gz",
    };
    const next: CreditReport = { ...await readCreditReport(new Blob([
      `${header},AdditionalColumn\n${row("2026-11-02", 7)},new value`,
    ]), "same.csv.gz", { source: "upload" }), loadedAt: "2026-11-04T00:00:00Z" };
    const billing = await readCreditReport(new Blob([
      "BilledDate,TenantID,CapacityPackCreditsConsumed,PayGoConsumedQuantity\n2026-11-01,tenant-a,100,2",
    ]), "same.csv.gz", { source: "upload" });
    const captures = [first, next, billing];
    const blob = await exportCreditReportArchive(captures);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(Object.keys(files)).toHaveLength(6);
    expect(manifest.captures.map((entry: { originalPath: string }) => entry.originalPath)).toEqual([
      "originals/001-__unsafe_same.csv.gz", "originals/002-same.csv.gz", "originals/003-same.csv.gz",
    ]);
    for (const [index, original] of captures.entries()) {
      expect(files[manifest.captures[index].originalPath]).toEqual(new Uint8Array(await original.original.arrayBuffer()));
    }
    const derived = manifest.reconciled.find((entry: { name: string }) => entry.name === first.name);
    expect(derived.daySources).toEqual({ "2026-11-01": first.id, "2026-11-02": next.id });
    const parsed = parseReportCsv(strFromU8(files[derived.csvPath]), first.name);
    expect(parsed.rows.map((row) => row.first)).toEqual([10, 7]);
    expect(parsed.rows[0].cells.ResourceName).toBe('Agent, "One"\nSecond line');
    expect(parsed.rows.map((row) => row.cells.AdditionalColumn)).toEqual(["", "new value"]);
    expect(manifest.reconciled.find((entry: { name: string }) => entry.name === billing.name).csvPath).not.toBe(derived.csvPath);
  });
  it("exports unknown tenants separately and surfaces an empty collection", async () => {
    const first = await capture("first", [row("2026-11-01", 1, "bot-a", "")]);
    const second = { ...first, id: "second" };
    const files = unzipSync(new Uint8Array(await (await exportCreditReportArchive([first, second])).arrayBuffer()));
    expect(Object.keys(files).filter((name) => name.startsWith("reconciled/"))).toHaveLength(2);
    await expect(exportCreditReportArchive([])).rejects.toThrow("no retained report captures");
  });
});
