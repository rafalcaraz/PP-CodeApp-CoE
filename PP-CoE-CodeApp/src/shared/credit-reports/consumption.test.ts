import { describe, expect, it } from "vitest";
import type { CreditReportRow } from "./types";
import {
  concentration, consumptionRange, consumptionTimeline, filterConsumptionRows, groupConsumption,
  latestFundingSnapshots, prepareConsumptionRows, rankedChartGroups, totalConsumption, rolling30ConsumptionTimeline, MANAGED_APP_SCENARIO,
  type ConsumptionInventory, type ManagedAppConsumptionInventory,
} from "./consumption";

const row = (date: string, env: string, id: string, first: number, second: number, feature = "Answers"): CreditReportRow => ({
  date, environmentId: env, environmentName: env, first, second,
  cells: { ResourceID: id, ResourceName: "Same name", Feature: feature, Product: "Copilot Studio" },
});
const inventory: ConsumptionInventory = {
  loadedAt: "2026-11-24T00:00:00Z",
  agents: [
    { environmentId: "dev", resourceId: "bot", schemaName: "prefix_agent", name: "Agent" },
    { environmentId: "prod", resourceId: "bot", schemaName: "prefix_agent", name: "Agent" },
  ],
  environments: [{ id: "dev", name: "Dev", groupId: "group", groupName: "Group", type: "Sandbox" }],
};

describe("consumption projections", () => {
  it("joins managed app names and groups by environment-qualified IDs only within the AppStudio scenario", () => {
    const appInventory: ManagedAppConsumptionInventory = {
      loadedAt: "2026-11-24T00:00:00Z",
      apps: [{ environmentId: "dev", resourceId: "same", name: "Current dev app" }, { environmentId: "prod", resourceId: "same", name: "Current prod app" }],
      environments: [{ id: "dev", name: "Dev", groupId: "business", groupName: "Business", type: "Sandbox" }],
    };
    const source = (env: string, id: string, scenario = MANAGED_APP_SCENARIO): CreditReportRow => {
      const value = row("2026-11-01", env, id, 3, 1);
      return { ...value, cells: { ...value.cells, ScenarioName: scenario } };
    };
    const original = [source("dev", "same"), source("prod", "same"), source("dev", "different"), source("dev", "same", "Other")];
    const matched = prepareConsumptionRows(original, undefined, appInventory);
    expect(matched.map((row) => row.resourceName)).toEqual(["Current dev app", "Current prod app", "Same name", "Same name"]);
    expect(matched.map((row) => row.managedAppMatch)).toEqual(["matched", "matched", "notFound", "notFound"]);
    expect(original[0].cells.ResourceName).toBe("Same name");
    expect(totalConsumption(filterConsumptionRows(matched, { scenarioName: MANAGED_APP_SCENARIO })).total).toBe(12);
    expect(totalConsumption(filterConsumptionRows(matched, { scenarioName: MANAGED_APP_SCENARIO, group: "business" })).total).toBe(8);
    const conflict = prepareConsumptionRows(original, undefined, { ...appInventory,
      apps: [...appInventory.apps, { environmentId: "dev", resourceId: "same", name: "Conflicting app" }] });
    expect(conflict[0]).toMatchObject({ managedAppMatch: "ambiguous", resourceName: "Same name" });
  });
  it("sums exact trailing 30-calendar-day windows with lookback, signed adjustments and partial coverage", () => {
    const sources = [row("2026-10-01", "dev", "app", 1000, 0), row("2026-11-01", "dev", "app", 10.1, 2),
      row("2026-11-02", "dev", "app", 3, 4), row("2026-11-30", "dev", "app", -1, 2), row("2026-12-01", "dev", "app", 7, 1)];
    const reported = Array.from({ length: 30 }, (_, i) => row(`2026-11-${String(i + 1).padStart(2, "0")}`, "other", "other", 500, 0));
    const buckets = rolling30ConsumptionTimeline(prepareConsumptionRows(sources), [...reported, sources[4]],
      { startDate: "2026-11-30", endDate: "2026-12-02" });
    expect(buckets.map((bucket) => bucket.windowStart)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(buckets[0].total).toBeCloseTo(20.1);
    expect(buckets.slice(1).map((bucket) => bucket.total)).toEqual([16, 9]);
    expect(buckets.map((bucket) => [bucket.reportedDays, bucket.calendarDays, bucket.partial])).toEqual([[30, 30, false], [30, 30, false], [29, 30, true]]);
    expect(rolling30ConsumptionTimeline([], reported, { startDate: "2026-11-30", endDate: "2026-11-30" })[0].total).toBeNull();
    expect(rolling30ConsumptionTimeline(prepareConsumptionRows([row("2026-11-30", "dev", "app", 0, 0)]), reported,
      { startDate: "2026-11-30", endDate: "2026-11-30" })[0].total).toBe(0);
  });
  it("matches exact record IDs and bot IDs only within their environment, and exposes missing/conflicting schema states", () => {
    const mappedInventory: ConsumptionInventory = {
      ...inventory,
      agents: [
        { environmentId: "dev", resourceId: "bot-id", resourceAliases: [" record-id "], schemaName: "Prefix_Agent", name: "Agent" },
        { environmentId: "dev", resourceId: "missing-schema", schemaName: "", name: "Agent" },
        { environmentId: "dev", resourceId: "another-bot", resourceAliases: ["record-id"], schemaName: "different_schema", name: "Another" },
      ],
    };
    const rows = [row("2026-11-01", "dev", "bot-id", 1, 2), row("2026-11-01", "dev", "record-id", 3, 4),
      row("2026-11-01", "prod", "bot-id", 5, 6), row("2026-11-01", "dev", "missing-schema", 7, 8)];
    expect(prepareConsumptionRows(rows).map((row) => row.inventoryMatch)).toEqual(Array(4).fill("notAttempted"));
    const matched = prepareConsumptionRows(rows, mappedInventory);
    expect(matched.map((row) => row.inventoryMatch)).toEqual(["matched", "ambiguous", "notFound", "schemaMissing"]);
    expect(matched.map((row) => row.schemaName)).toEqual(["prefix_agent", "", "", ""]);
    expect(totalConsumption(matched).total).toBe(36);
    const aliases = prepareConsumptionRows(rows, { ...mappedInventory, agents: mappedInventory.agents.slice(0, 1) });
    expect(aliases[1].schemaName).toBe("prefix_agent");
  });
  it("keeps environment-scoped resource IDs, includes unresolved usage and joins exact inventory IDs", () => {
    const rows = prepareConsumptionRows([row("2026-10-25", "dev", "BOT", 10, 5), row("2026-11-01", "prod", "bot", 2, 20), row("2026-11-01", "other", "bot", 4, 0)], inventory);
    expect(groupConsumption(rows, "resource", "billed")).toHaveLength(3);
    expect(groupConsumption(rows, "family", "total").map((group) => [group.label, group.total])).toEqual([["prefix_agent", 37], ["Schema not resolved", 4]]);
    expect(filterConsumptionRows(rows, { search: "PREFIX_AGENT" })).toHaveLength(2);
    expect(filterConsumptionRows(rows, { group: "group" })).toHaveLength(1);
    expect(totalConsumption(rows).total).toBe(41);
  });
  it("does not resolve conflicting inventory identities or a shared display name", () => {
    const rows = prepareConsumptionRows([row("2026-11-01", "dev", "bot", 3, 0), row("2026-11-01", "dev", "other-id", 0, 7)], {
      ...inventory, agents: [...inventory.agents, { environmentId: "dev", resourceId: "bot", schemaName: "different_schema", name: "Agent" }],
    });
    expect(rows.map((row) => row.schemaName)).toEqual(["", ""]);
    expect(totalConsumption(rows).total).toBe(10);
  });
  it("composes inclusive dates, environment, feature and resource filters before aggregating", () => {
    const rows = prepareConsumptionRows([row("2026-11-01", "dev", "one", 9, 2), row("2026-11-02", "dev", "one", 3, 1, "Tools"), row("2026-11-02", "prod", "one", 20, 0)]);
    const selected = filterConsumptionRows(rows, { startDate: "2026-11-02", endDate: "2026-11-02", environmentId: "dev", feature: "Tools", resourceKey: rows[0].resourceKey });
    expect(totalConsumption(selected)).toMatchObject({ first: 3, second: 1, total: 4, rows: 1 });
  });
  it("marks incomplete calendar months, emits null gaps and does not infer a missing resource as zero", () => {
    const sources = [row("2026-10-25", "dev", "one", 10, 2), row("2026-12-01", "dev", "one", 4, 0)];
    const buckets = consumptionTimeline(prepareConsumptionRows(sources), sources, { startDate: "2026-10-25", endDate: "2026-12-01" }, "month");
    expect(buckets.map((bucket) => [bucket.label, bucket.first, bucket.reportedDays, bucket.calendarDays, bucket.partial]))
      .toEqual([["2026-10", 10, 1, 31, true], ["2026-11", null, 0, 30, true], ["2026-12", 4, 1, 31, true]]);
    expect(consumptionTimeline([], sources, { startDate: "2026-10-25", endDate: "2026-10-25" }, "day")[0])
      .toMatchObject({ first: null, second: null, reportedDays: 1 });
  });
  it("buckets weeks at Monday UTC across a year boundary", () => {
    const sources = [row("2027-01-01", "dev", "one", 1, 2), row("2027-01-04", "dev", "one", 4, 3)];
    const buckets = consumptionTimeline(prepareConsumptionRows(sources), sources, { startDate: "2027-01-01", endDate: "2027-01-04" }, "week");
    expect(buckets.map((bucket) => [bucket.key, bucket.total])).toEqual([["2026-12-28", 3], ["2027-01-04", 7]]);
  });
  it("sorts by the chosen metric and retains Other without losing credits", () => {
    const rows = prepareConsumptionRows([row("2026-11-01", "dev", "one", 100, 1), row("2026-11-01", "prod", "two", 1, 200), row("2026-11-01", "test", "three", 2, 0)]);
    const groups = groupConsumption(rows, "resource", "nonbilled");
    expect(groups[0].second).toBe(200);
    const chart = rankedChartGroups(groups, 1);
    expect(chart).toHaveLength(2);
    expect(chart[1]).toMatchObject({ key: "__other__", first: 102, second: 1, total: 103 });
    expect(concentration(groups, "nonbilled", 1)).toBeCloseTo(200 / 201);
  });
  it("preserves negative adjustments and suppresses misleading shares", () => {
    const rows = prepareConsumptionRows([row("2026-11-01", "dev", "one", 20, 0), row("2026-11-02", "prod", "two", -5, 0)]);
    expect(totalConsumption(rows).total).toBe(15);
    expect(concentration(groupConsumption(rows, "resource", "billed"), "billed", 1)).toBeNull();
  });
  it("rejects invalid/reversed dates and overflow instead of presenting successful empty results", () => {
    expect(() => consumptionRange([], { startDate: "2026-02-30", endDate: "2026-03-01" })).toThrow(/valid UTC/);
    expect(() => consumptionRange([], { startDate: "2026-11-02", endDate: "2026-11-01" })).toThrow(/before/);
    expect(() => totalConsumption(prepareConsumptionRows([row("2026-11-01", "dev", "one", Number.MAX_VALUE, Number.MAX_VALUE)]))).toThrow(/numeric range/);
  });
  it("takes the latest allocation day per funding scope and preserves duplicates rather than summing snapshots", () => {
    const sources = [
      { ...row("2026-11-01", "dev", "", 4, 0), cells: { EntitlementID: "credits", BillingPolicyId: "policy", AllocatedCapacityPackCredits: "100" } },
      { ...row("2026-11-02", "dev", "", 1, 0), cells: { EntitlementID: "credits", BillingPolicyId: "policy", AllocatedCapacityPackCredits: "200" } },
      { ...row("2026-11-02", "dev", "", 2, 0), cells: { EntitlementID: "credits", BillingPolicyId: "policy", AllocatedCapacityPackCredits: "200" } },
    ];
    expect(latestFundingSnapshots(sources, {}).map((row) => row.cells.AllocatedCapacityPackCredits)).toEqual(["200", "200"]);
    expect(latestFundingSnapshots(sources, { endDate: "2026-11-01" }).map((row) => row.cells.AllocatedCapacityPackCredits)).toEqual(["100"]);
  });
});
