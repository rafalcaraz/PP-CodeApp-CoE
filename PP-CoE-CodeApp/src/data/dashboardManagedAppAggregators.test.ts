import { describe, expect, it } from "vitest";
import { ResourceType, toAppRow } from "./inventory";
import { managedAppsEstateMetric as metric } from "./dashboardManagedAppAggregators";
import type { EstateManagedApp } from "./dashboardManagedAppSource";

const now = "2026-03-01T12:00:00Z";
function app(index: number, patch: Partial<EstateManagedApp> = {}): EstateManagedApp {
  return {
    ...toAppRow({ name: `app-${index}`, type: ResourceType.AppBuilderApp, properties: {
      subType: "microsoftApp", environmentId: `env-${index}`, createdBy: `creator-${index % 2}`,
      ownerId: "same-owner", createdAt: "2026-02-20T00:00:00Z",
    } }),
    creatorName: "", origin: "CopilotStudio", connectorIds: [],
    environmentType: "Developer", environmentManaged: true, environmentMapped: true,
    groupId: "group", groupName: "Synthetic group", membershipKnown: true,
    acp: "With ACP", acpReason: "Assigned policy identity", snapshotAt: now, ...patch,
  };
}
const eight = () => [
  app(0, { connectorIds: ["sql", "sql", "sharepointonline"] }),
  app(1, { connectorIds: ["sql"], origin: "PAC CLI", environmentType: "Sandbox", environmentManaged: false }),
  app(2, { origin: "App Studio", createdAt: "2026-01-15T00:00:00Z", environmentType: "Production" }),
  app(3, { origin: "Cowork", groupId: "no-policy", groupName: "No ACP", acp: "Without ACP" }),
  app(4, { origin: "", creatorName: "Synthetic creator", groupId: "", groupName: "", acp: "Ungrouped", environmentManaged: null }),
  app(5, { origin: "New future origin", createdBy: "", connectorIds: null, environmentMapped: false,
    membershipKnown: false, groupId: "", acp: "Unable to assess", environmentType: "", environmentManaged: null }),
  app(6, { groupId: "failed", groupName: "Read failed", acp: "Unable to assess", createdAt: "invalid" }),
  app(7, { environmentId: "", environmentMapped: false, membershipKnown: false, groupId: "", acp: "Unable to assess", createdAt: "2026-03-02T00:00:00Z" }),
];
function buckets(rows: EstateManagedApp[], name: string) {
  const result = metric(rows, { metric: name });
  if (result.kind !== "chart") throw new Error("Expected chart");
  return result.buckets;
}
function table(rows: EstateManagedApp[], name: string) {
  const result = metric(rows, { metric: name });
  if (result.kind !== "table") throw new Error("Expected table");
  return result.items;
}
describe("Managed Apps Estate aggregations", () => {
  it("uses all eight apps, createdBy not owner, unique environments and a single exact creation window", () => {
    const rows = eight();
    expect(metric(rows, { metric: "total" })).toMatchObject({ kind: "kpi", total: 8 });
    expect(metric(rows, { metric: "creators" })).toMatchObject({ total: 2 });
    expect(metric(rows, { metric: "environments" })).toMatchObject({ total: 7 });
    expect(metric(rows, { metric: "new" })).toMatchObject({ total: 5 });
    const creators = table(rows, "creatorsTable");
    expect(creators.map((row) => row.apps).reduce((a, b) => Number(a) + Number(b), 0)).toBe(8);
    expect(creators.some((row) => row.creatorId === "same-owner")).toBe(false);
    expect(creators.some((row) => row.creatorId === "")).toBe(true);
    const trend = metric(rows, { metric: "trend", days: 30 });
    expect(trend.kind).toBe("series");
    if (trend.kind === "series") expect(trend.series.reduce((sum, bucket) => sum + bucket.delta, 0)).toBe(5);
    const coverage = table(rows, "coverage");
    expect(coverage).toContainEqual({ field: "Created in last 90 days", apps: 6 });
    expect(coverage).toContainEqual({ field: "Creation date missing/invalid/future", apps: 2 });
  });
  it("preserves all real origins and gives unknown metadata its own counted bucket", () => {
    const origins = buckets(eight(), "origins");
    expect(origins.map((bucket) => bucket.name)).toEqual(expect.arrayContaining([
      "Copilot Studio", "PAC CLI", "App Studio", "Cowork", "New future origin", "Origin unavailable",
    ]));
    expect(origins.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(8);
    expect(table(eight(), "coverage")).toContainEqual({ field: "Environment mapping unavailable", apps: 2 });
  });
  it("counts unique app-connector usage, includes no-connector apps and does not zero malformed metadata", () => {
    const connectors = buckets(eight(), "connectors");
    expect(connectors.map((bucket) => bucket.value).sort()).toEqual([1, 2]);
    expect(buckets(eight(), "connectorCoverage")).toEqual(expect.arrayContaining([
      { name: "Uses connectors", value: 2 }, { name: "No connectors used", value: 5 },
      { name: "Connector metadata malformed", value: 1 },
    ]));
    expect(table(eight(), "connectorApps").filter((row) => row.id === "app-0")).toHaveLength(2);
  });
  it("reconciles all apps once across ACP categories, but counts groups separately and lists exact affected resources", () => {
    const rows = eight();
    expect(buckets(rows, "acpApps")).toEqual(expect.arrayContaining([
      { name: "With ACP", value: 3 }, { name: "Without ACP", value: 1 },
      { name: "Ungrouped", value: 1 }, { name: "Unable to assess", value: 3 },
    ]));
    expect(buckets(rows, "acpGroups")).toEqual([
      { name: "With ACP", value: 1 }, { name: "Without ACP", value: 1 }, { name: "Unable to assess", value: 1 },
    ]);
    expect(table(rows, "withoutAcp")).toMatchObject([{ groupId: "no-policy", apps: 1, environments: 1 }]);
    expect(table(rows, "appsTable").filter((row) => row.groupId === "no-policy")).toHaveLength(1);
  });
  it("shows app and distinct returned environment distributions without conflating ungrouped, unknown or managed status", () => {
    const rows = eight();
    rows[1] = { ...rows[1], environmentId: rows[0].environmentId, environmentType: rows[0].environmentType, environmentManaged: true };
    for (const dimension of ["environmentGroups", "environmentTypes", "environmentManaged"]) {
      const distribution = metric(rows, { metric: dimension });
      if (distribution.kind !== "stackedBar") throw new Error("Expected multi-series output");
      expect(distribution.data.reduce((sum, row) => sum + Number(row.Apps), 0)).toBe(8);
      expect(distribution.data.reduce((sum, row) => sum + Number(row["App-bearing environments"]), 0)).toBe(6);
    }
    const groups = metric(rows, { metric: "environmentGroups" });
    if (groups.kind === "stackedBar") expect(groups.data.map((row) => row.category)).toEqual(expect.arrayContaining(["Ungrouped", "Membership unresolved"]));
  });
  it("keeps topN Other totals exact and distinct same-name groups separate", () => {
    const rows = Array.from({ length: 14 }, (_, index) => app(index, {
      origin: `Origin ${index}`, groupId: `group-${index}`, groupName: "Repeated friendly name",
    }));
    expect(buckets(rows, "origins").reduce((sum, bucket) => sum + bucket.value, 0)).toBe(14);
    const groups = metric(rows, { metric: "environmentGroups" });
    if (groups.kind !== "stackedBar") throw new Error("Expected grouped bars");
    expect(new Set(groups.data.map((row) => row.category)).size).toBe(groups.data.length);
    expect(groups.data.reduce((sum, row) => sum + Number(row.Apps), 0)).toBe(14);
  });
  it("handles empty snapshots without inventing fields and rejects an unknown metric", () => {
    expect(metric([], { metric: "total" })).toMatchObject({ total: 0 });
    expect(table([], "withoutAcp")).toEqual([]);
    expect(metric([], { metric: "trend" })).toEqual({ kind: "series", series: [] });
    expect(() => metric([], { metric: "not-a-metric" })).toThrow("Unknown managed-app estate metric");
  });
  it("uses app-only composition with secondary environment counts and a ranked complete group table", () => {
    const rows = eight();
    rows[1] = { ...rows[1], environmentId: rows[0].environmentId, environmentType: rows[0].environmentType, environmentManaged: true };
    for (const name of ["environmentTypes", "environmentManaged"]) {
      const distribution = metric(rows, { metric: name, presentation: 2 });
      if (distribution.kind !== "chart") throw new Error("Expected composition");
      expect(distribution.buckets.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(8);
      expect(distribution.details?.items.reduce((sum, bucket) => sum + (bucket.environments ?? 0), 0)).toBe(6);
      expect(distribution.details?.items.reduce((sum, bucket) => sum + bucket.apps, 0)).toBe(8);
    }
    const groups = metric(rows, { metric: "environmentGroups", presentation: 2 });
    if (groups.kind !== "table") throw new Error("Expected ranked table");
    expect(groups.items.reduce((sum, row) => sum + Number(row.apps), 0)).toBe(8);
    expect(groups.items.reduce((sum, row) => sum + Number(row.environments), 0)).toBe(6);
    expect(groups.items.find((row) => row.groupId === "group")).toMatchObject({ apps: 3, environments: 2, acp: "With ACP" });
    expect(groups.items.find((row) => row.groupName === "Ungrouped")).toMatchObject({ apps: 1 });
    expect(groups.items.find((row) => row.groupName === "Membership unresolved")).toMatchObject({ apps: 2, environments: 1, acp: "Unable to assess" });
  });
  it("separates recent growth from genuine metadata issues, never treats an unlooked-up name as defective", () => {
    const rows = eight();
    const output = metric(rows, { metric: "coverage", presentation: 2 });
    expect(output.kind).toBe("table");
    if (output.kind === "table") expect(output.items).toEqual([
      { field: "Created in last 30 days", apps: 5 }, { field: "Created in last 90 days", apps: 6 },
    ]);
    expect(output.details?.items.some((entry) => /name unresolved/i.test(entry.measure))).toBe(false);
    expect(output.details?.items).toContainEqual({ measure: "Creator identity unavailable", apps: 1 });
    expect(output.details?.items.every((entry) => entry.apps > 0)).toBe(true);
    const complete = metric([app(0)], { metric: "coverage", presentation: 2 });
    expect(complete.details?.items).toEqual([]);
  });
  it("keeps full creator identity in table output and stable identity ranking when names change", () => {
    const guid = "11111111-2222-4333-8444-555555555555";
    const rows = [app(0, { createdBy: guid }), app(1, { createdBy: guid })];
    expect(table(rows, "creatorsTable")[0]).toMatchObject({ creator: guid, creatorId: guid, rank: 1, apps: 2 });
    expect(buckets(rows, "topCreators")).toEqual([{ name: guid, value: 2 }]);
    const named = rows.map((row) => ({ ...row, creatorName: "Synthetic resolved name" }));
    expect(table(named, "creatorsTable")[0]).toMatchObject({ creator: "Synthetic resolved name", creatorId: guid, rank: 1, apps: 2 });
    expect(buckets(named, "topCreators")).toEqual([{ name: guid, value: 2 }]);
    expect(table(rows, "appsTable").every((row) => row.creatorId === guid && row.creator === guid)).toBe(true);
  });
  it("preserves chart identity sorting, counts and Other aggregation without rank aliases", () => {
    const rows = Array.from({ length: 12 }, (_, index) => app(index, {
      createdBy: `11111111-2222-4333-8444-${String(index).padStart(12, "0")}`, creatorName: "Same friendly name",
    }));
    rows.push({ ...rows[11], id: "extra" });
    const result = buckets(rows, "topCreators");
    expect(result[0]).toEqual({ name: rows[11].createdBy, value: 2 });
    expect(result[1].name).toBe(rows[0].createdBy);
    expect(result.at(-1)).toEqual({ name: "Other (remaining categories)", value: 2 });
    expect(result.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(13);
    expect(result.every((bucket) => !/^Creator \d/.test(bucket.name))).toBe(true);
  });
});
