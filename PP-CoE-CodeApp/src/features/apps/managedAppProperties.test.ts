import { describe, expect, it } from "vitest";
import { toAppRow } from "../../data/inventory";
import {
  managedAppPackageLabel, managedAppPackageText, matchesPackage, propertyLabel, readManagedAppProperties,
} from "./managedAppProperties";

const properties = () => ({
  createdIn: "Copilot Studio", hasCustomMiddleTier: false,
  sharing: { edit: { userCount: 1, groupCount: 0 }, run: { userCount: 2, groupCount: 1, entireTenant: false } },
  npmPackages: [{ name: "@example/widgets", version: "6.3.1" }, { name: "react", version: "19.2.5" }],
  npmPackageCount: 2, npmPackageInventoryScope: "directProduction", npmPackageInventoryTruncated: false,
  npmPackageUnresolvedCount: 0, npmPackageInventoryVersion: 1,
});
describe("managed app property inventory", () => {
  it("preserves exact returned strings, explicit false/zero and source fields", () => {
    const raw = properties(), before = structuredClone(raw), report = readManagedAppProperties(raw);
    expect(report.origin).toBe("CopilotStudio");
    expect(propertyLabel(report.customMiddleTier)).toBe("No");
    expect(propertyLabel(report.edit.groups)).toBe("0");
    expect(propertyLabel(report.run.entireTenant)).toBe("No");
    expect(propertyLabel(report.run.guests)).toBe("Not reported");
    expect(report.complete).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(matchesPackage(report.packages[0], "@EXAMPLE/widgets 6.3")).toBe(true);
    expect(matchesPackage(report.packages[0], "19.2")).toBe(false);
    expect(raw).toEqual(before);
  });
  it("distinguishes unreported data from explicit empty packages and zero sharing", () => {
    const missing = readManagedAppProperties({});
    expect(missing.listKind).toBe("unreported");
    expect(missing.complete).toBe(false);
    expect(propertyLabel(missing.run.users)).toBe("Not reported");
    const empty = readManagedAppProperties({ ...properties(), npmPackages: [], npmPackageCount: 0 });
    expect(empty.listKind).toBe("reported");
    expect(empty.packages).toEqual([]);
    expect(empty.complete).toBe(true);
    expect(propertyLabel(readManagedAppProperties({ hasCustomMiddleTier: null }).customMiddleTier)).toBe("Not reported");
  });
  it("keeps partial package entries visible and exposes every incomplete coverage reason", () => {
    const report = readManagedAppProperties({ ...properties(), npmPackages: [
      { name: "usable-name", version: null }, false, { name: "complete", version: "workspace:^" },
    ], npmPackageCount: 7, npmPackageInventoryTruncated: true, npmPackageUnresolvedCount: 4 });
    expect(report.packages).toHaveLength(3);
    expect(matchesPackage(report.packages[0], "usable-name")).toBe(true);
    expect(propertyLabel(report.packages[0].version)).toBe("Invalid value");
    expect(report.warnings.join(" ")).toMatch(/2 returned package entries.*truncated.*4 unresolved.*Declared package count/);
    expect(report.complete).toBe(false);
  });
  it.each([null, "[]", {}, false])("does not turn a malformed package list %j into an empty success", (npmPackages) => {
    const report = readManagedAppProperties({ ...properties(), npmPackages });
    expect(report.listKind).toBe("invalid");
    expect(report.complete).toBe(false);
    expect(report.warnings.join()).toContain("invalid shape");
  });
  it("does not treat invalid sharing/count flags as zero or infer completeness for future metadata", () => {
    const malformed = readManagedAppProperties({ ...properties(), sharing: { run: null }, npmPackageCount: "2", npmPackageInventoryTruncated: "false" });
    expect(propertyLabel(malformed.run.users)).toBe("Invalid value");
    expect(propertyLabel(malformed.declaredCount)).toBe("Invalid value");
    expect(malformed.complete).toBe(false);
    const future = readManagedAppProperties({ ...properties(), npmPackageInventoryScope: "futureScope", npmPackageInventoryVersion: 3 });
    expect(propertyLabel(future.scope)).toBe("futureScope");
    expect(propertyLabel(future.inventoryVersion)).toBe("3");
    expect(future.complete).toBe(false);
  });
  it("reads packages from retained source records only for exactly classified managed apps", () => {
    const raw = { name: "synthetic", type: "microsoft.powerapps/apps", properties: { ...properties(), subType: "microsoftApp" } };
    const row = toAppRow(raw);
    expect(managedAppPackageText(row)).toBe("@example/widgets 6.3.1 react 19.2.5");
    expect(managedAppPackageLabel(row)).toBe("2 returned");
    expect(managedAppPackageText(toAppRow({ ...raw, properties: { ...raw.properties, subType: "appBuilderApp" } }))).toBe("");
    expect(managedAppPackageLabel(toAppRow({ ...raw, properties: { subType: "microsoftApp" } }))).toBe("Not reported");
    expect(managedAppPackageLabel(toAppRow({ ...raw, properties: { subType: "microsoftApp", npmPackages: [] } }))).toContain("0 returned");
  });
});
