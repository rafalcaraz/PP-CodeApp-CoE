import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assignCreditReportTenant, creditReportScope, reconcileCreditReports } from "./collection";
import { readCreditReport } from "./files";
import { restoreSavedCreditReports } from "./persistence";
import { clearCreditReports, getCreditReportCaptures, hydrateCreditReportCaptures, retainCreditReport } from "./store";
const { Blob: NodeBlob } = await vi.importActual<{ Blob: typeof Blob }>("node:buffer");
const tenant = "00000000-0000-0000-0000-000000000001";
const csv = "ConsumptionDate,EnvironmentID,ResourceID,BilledCredits,NonBilledCredits\n2026-10-01,env,bot,10,2";
beforeAll(() => { vi.stubGlobal("Blob", NodeBlob); });
afterAll(() => { vi.unstubAllGlobals(); });

describe("capture restoration and explicit tenant provenance", () => {
  it("reparses originals and preserves capture IDs, priority, request bounds and tenant assignment", async () => {
    const capture = assignCreditReportTenant(await readCreditReport(new Blob([csv]), "daily.csv", { source: "upload" }), tenant);
    const restored = await restoreSavedCreditReports({ version: 1, captures: [{ ...capture, rows: [{ first: 9999 }] }] });
    expect(restored[0].id).toBe(capture.id);
    expect(restored[0].loadedAt).toBe(capture.loadedAt);
    expect(restored[0].tenantAssignment).toEqual(capture.tenantAssignment);
    expect(restored[0].rows[0].first).toBe(10);
    expect(await restored[0].original.text()).toBe(csv);
  });
  it("keeps unassigned files isolated and deliberately reconciles assigned history without altering retrieval times", async () => {
    const a = await readCreditReport(new Blob([csv]), "a.csv", { source: "upload" });
    const b = { ...await readCreditReport(new Blob([csv.replace("10,2", "3,1")]), "b.csv", { source: "upload" }), loadedAt: "2099-01-01T00:00:00Z" };
    expect(creditReportScope(a).key).not.toBe(creditReportScope(b).key);
    const assigned = [a, b].map((capture) => assignCreditReportTenant(capture, tenant));
    expect(assigned[0].loadedAt).toBe(a.loadedAt);
    expect(reconcileCreditReports(assigned, "FeatureDetailsPerResource")?.rows[0].first).toBe(3);
  });
  it("rejects conflicting/mixed tenant claims and malformed saved metadata without restoring partial results", async () => {
    const capture = await readCreditReport(new Blob([csv]), "daily.csv", { source: "upload" });
    expect(() => assignCreditReportTenant(capture, "not-a-guid")).toThrow(/valid tenant/);
    const claimed = { ...capture, rows: capture.rows.map((row) => ({ ...row, cells: { ...row.cells, TenantID: "different-tenant" } })) };
    expect(() => assignCreditReportTenant(claimed, tenant)).toThrow(/conflicts/);
    await expect(restoreSavedCreditReports({ version: 1, captures: [capture, { ...capture, id: "second", schemaVersion: 999 }] })).rejects.toThrow(/invalid metadata/);
    await expect(restoreSavedCreditReports({ version: 1, captures: [capture, capture] })).rejects.toThrow(/invalid metadata/);
    await expect(restoreSavedCreditReports({ version: 2, captures: [] })).rejects.toThrow(/Unsupported/);
  });
  it("hydrates saved captures before current captures, preserving current ID collisions and tie priority", async () => {
    clearCreditReports();
    const saved = await readCreditReport(new Blob([csv]), "saved.csv", { source: "upload" });
    const current = { ...saved, id: "current", fileName: "current.csv" };
    retainCreditReport(current);
    hydrateCreditReportCaptures([saved, { ...current, fileName: "stale.csv" }]);
    expect(getCreditReportCaptures().map((capture) => capture.fileName)).toEqual(["saved.csv", "current.csv"]);
    clearCreditReports();
  });
});
