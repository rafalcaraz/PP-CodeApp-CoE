import { gzipSync, strToU8 } from "fflate";
import { afterAll, describe, expect, it, vi } from "vitest";
import { connectorReportBlob, defaultReportRange, MAX_REPORT_BYTES, parseReportCsv, readCreditReport, validateReportRange } from "./files";
import { aggregateReportRows, selectReportRows } from "./selectors";
import { clearCreditReports, getCreditReports, replaceCreditReport } from "./store";

const { Blob: NodeBlob } = await vi.importActual<{ Blob: typeof Blob }>("node:buffer");
vi.stubGlobal("Blob", NodeBlob);
afterAll(() => vi.unstubAllGlobals());
const featureHeader = "ConsumptionDate,EnvironmentID,EnvironmentName,ResourceID,ResourceName,ResourceType,Feature,Product,BilledCredits,NonBilledCredits";
const csv = `${featureHeader}\r\n2026-11-01,ENV-A,Environment A,bot-1,"Agent, ""One""",Bot,Answers,CopilotStudio,10.25,2\r\n2026-11-02,ENV-A,Environment A,bot-1,"Agent, ""One""",Bot,Tools,CopilotStudio,5,0\r\n2026-11-02,env-b,Environment B,bot-1,Same solution bot,Bot,Answers,CopilotStudio,50,1`;
const billing = "BilledDate,EnvironmentID,EnvironmentName,AllocatedCapacityPackCredits,CapacityPackCreditsConsumed,PayGoConsumedQuantity\n2026-11-01,env-a,Environment A,1000,7.5,2.5";

describe("Daily credit report ingestion", () => {
  it("parses BOM, quoted commas, escaped quotes, CRLF and multiline cells while preserving every column", () => {
    const result = parseReportCsv(`\uFEFF${csv.replace("Same solution bot", '"Same\nsolution bot"')}`);
    expect(result.name).toBe("FeatureDetailsPerResource");
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ date: "2026-11-01", environmentId: "env-a", first: 10.25, second: 2 });
    expect(result.rows[0].cells.ResourceName).toBe('Agent, "One"');
    expect(result.rows[2].cells.ResourceName).toBe("Same\nsolution bot");
    expect(result.observedRange).toEqual({ startDate: "2026-11-01", endDate: "2026-11-02" });
  });
  it("keeps capacity snapshots separate from consumed credits and accepts a header-only report", () => {
    const result = parseReportCsv(billing);
    expect(result.rows[0]).toMatchObject({ first: 7.5, second: 2.5 });
    expect(result.rows[0].cells.AllocatedCapacityPackCredits).toBe("1000");
    expect(aggregateReportRows(result.rows, "environment")[0].total).toBe(10);
    expect(parseReportCsv(featureHeader)).toMatchObject({ rows: [], observedRange: null });
  });
  it.each([
    ["ConsumptionDate,BilledCredits,NonBilledCredits", "FeatureDetailsPerResource"],
    ["BilledDate,CapacityPackCreditsConsumed,PayGoConsumedQuantity", "BillingDetailsPerEnvironment"],
  ] as const)("normalizes midnight report timestamps from %s without changing the original cells", (header, name) => {
    const result = parseReportCsv(`${header}\r\n2026-11-01 00:00:00.0000000,7.5,2.5`, name);
    expect(result.rows[0]).toMatchObject({ date: "2026-11-01", first: 7.5, second: 2.5 });
    expect(result.rows[0].cells[header.split(",")[0]]).toBe("2026-11-01 00:00:00.0000000");
    expect(result.observedRange).toEqual({ startDate: "2026-11-01", endDate: "2026-11-01" });
  });
  it.each([
    ["empty file", "", /CSV header/],
    ["Summary report", "BilledCredits,NonBilledCredits\n5,2", /Daily/],
    ["wrong casing", "consumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,5,2", /schema/],
    ["invalid calendar date", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-02-30,5,2", /Invalid UTC date/],
    ["invalid calendar timestamp", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-02-30 00:00:00.0000000,5,2", /Invalid UTC date/],
    ["non-midnight timestamp", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01 12:00:00.0000000,5,2", /Invalid UTC date/],
    ["nonzero fractional timestamp", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01 00:00:00.0000001,5,2", /Invalid UTC date/],
    ["missing amount", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,,2", /finite number/],
    ["invalid amount", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,NaN,2", /finite number/],
    ["infinite amount", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,1e999,2", /finite number/],
    ["missing cell", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,5", /expected 3 columns/],
    ["extra cell", "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,5,2,3", /expected 3 columns/],
    ["unclosed quote", 'ConsumptionDate,BilledCredits,NonBilledCredits\n"2026-11-01,5,2', /not closed/],
    ["bad quoted field", 'ConsumptionDate,BilledCredits,NonBilledCredits\n"2026-11-01"bad,5,2', /Malformed/],
    ["duplicate header", "ConsumptionDate,BilledCredits,NonBilledCredits,BilledCredits\n2026-11-01,5,2,3", /duplicate/],
  ])("rejects %s without guessing data", (_, input, message) => {
    expect(() => parseReportCsv(input)).toThrow(message);
  });
  it("accepts zero, decimals and negative adjustments without converting missing values to zero", () => {
    const result = parseReportCsv("ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,0,-0.25\n2026-11-02,1e-4,2.5");
    expect(result.rows.map((row) => [row.first, row.second])).toEqual([[0, -0.25], [0.0001, 2.5]]);
  });
  it("decompresses gzip by signature, retains original bytes and validates the expected report and date range", async () => {
    const bytes = gzipSync(strToU8(csv));
    const original = new Blob([bytes]);
    const report = await readCreditReport(original, "report.csv.gz", {
      source: "connector", expected: "FeatureDetailsPerResource",
      requestedRange: { startDate: "2026-11-01", endDate: "2026-11-02" },
    });
    expect(report.original).toBe(original);
    expect(new Uint8Array(await report.original.arrayBuffer())).toEqual(bytes);
    expect(report.rows).toHaveLength(3);
    await expect(readCreditReport(new Blob([csv]), "x.csv", { source: "connector", expected: "BillingDetailsPerEnvironment" })).rejects.toThrow("Expected BillingDetailsPerEnvironment");
    await expect(readCreditReport(new Blob([csv]), "x.csv", {
      source: "connector", requestedRange: { startDate: "2026-11-02", endDate: "2026-11-02" },
    })).rejects.toThrow("outside the requested period");
  });
  it("rejects compressed and expanded files over the memory limit", async () => {
    await expect(readCreditReport(new Blob([new Uint8Array(MAX_REPORT_BYTES + 1)]), "big.csv", { source: "upload" })).rejects.toThrow("exceeds 25 MiB");
    const compressed = gzipSync(new Uint8Array(MAX_REPORT_BYTES + 1).fill(65));
    await expect(readCreditReport(new Blob([compressed]), "big.csv.gz", { source: "upload" })).rejects.toThrow("expanded report exceeds");
  });
  it("rejects rows beyond the documented 200,000-row cap", () => {
    expect(() => parseReportCsv(`ConsumptionDate,BilledCredits,NonBilledCredits\n${"2026-11-01,0,0\n".repeat(200_001)}`)).toThrow("exceeds 200,000 rows");
  });
  it("decodes supported connector bodies without another network transport", async () => {
    expect(await connectorReportBlob(csv).text()).toBe(csv);
    const encoded = btoa(csv);
    expect(await connectorReportBlob(encoded).text()).toBe(csv);
    expect(await connectorReportBlob({ "$content-type": "application/gzip", $content: encoded }).text()).toBe(csv);
    expect(() => connectorReportBlob({ data: "missing binary content" })).toThrow("No alternate transport");
    const report = await readCreditReport(connectorReportBlob(csv), "server.csv.gz", { source: "connector" });
    expect(report.fileName).toBe("server.csv");
    expect(await report.original.text()).toBe(csv);
  });
  it("uses the last 30 complete UTC days at month/year boundaries and validates request windows", () => {
    const now = new Date("2026-01-01T23:59:59Z");
    expect(defaultReportRange(now)).toEqual({ startDate: "2025-12-02", endDate: "2025-12-31" });
    expect(() => validateReportRange(defaultReportRange(now), now)).not.toThrow();
    for (const range of [
      { startDate: "2025-12-01", endDate: "2025-12-31" },
      { startDate: "2025-12-03", endDate: "2026-01-01" },
      { startDate: "2025-12-30", endDate: "2025-12-20" },
    ]) expect(() => validateReportRange(range, now)).toThrow("complete UTC days");
  });
});

describe("shared snapshots and selectors", () => {
  it("separates the same resource ID in different environments and groups all feature rows per resource", async () => {
    const report = await readCreditReport(new Blob([csv]), "x.csv", { source: "upload" });
    const resources = aggregateReportRows(report.rows, "resource");
    expect(resources).toHaveLength(2);
    expect(resources.map((group) => group.total)).toEqual([51, 17.25]);
    const filtered = selectReportRows(report, { environmentId: "env-a", startDate: "2026-11-02", search: "tools" });
    expect(filtered).toHaveLength(1);
    expect(aggregateReportRows(filtered, "date")[0]).toMatchObject({ key: "2026-11-02", first: 5, second: 0 });
  });
  it("keeps the legacy latest-per-type snapshot API and clears one report type without affecting the other", async () => {
    clearCreditReports();
    const first = await readCreditReport(new Blob([csv]), "x.csv", { source: "upload" });
    const second = await readCreditReport(new Blob([billing]), "y.csv", { source: "upload" });
    replaceCreditReport(first); replaceCreditReport(second);
    const replacement = await readCreditReport(new Blob([csv]), "again.csv", { source: "upload" });
    replaceCreditReport(replacement);
    expect(getCreditReports()).toHaveLength(2);
    expect(getCreditReports().find((report) => report.name === first.name)).toBe(replacement);
    expect(getCreditReports().find((report) => report.name === first.name)?.rows).toHaveLength(3);
    clearCreditReports(first.name);
    expect(getCreditReports()).toEqual([second]);
    clearCreditReports();
  });
});
