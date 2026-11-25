import type { CreditReportRow, ReportRange } from "./types";

export type ConsumptionMetric = "total" | "billed" | "nonbilled";
export const creditAmount = (value: number | null) => value === null ? "Not reported" : value.toLocaleString("en-US",
  value !== 0 && Math.abs(value) < 0.01 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 });
export const creditLabels = (funding: boolean) => funding
  ? { first: "Capacity-pack credits consumed", second: "PAYG credits consumed" }
  : { first: "Billed credits", second: "Nonbilled credits" };
export type ConsumptionGrain = "day" | "week" | "month";
export const MANAGED_APP_SCENARIO = "CopilotStudio_AppStudio";
export type ConsumptionDimension = "environment" | "resource" | "family" | "group" | "Product" | "Feature" | "ScenarioName" | "Channel" | "LLMModel" | "ToolUsed";
export interface ConsumptionIdentity {
  environmentId: string;
  resourceId: string;
  resourceAliases?: readonly string[];
  schemaName: string;
  name: string;
}
export interface ConsumptionEnvironment {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  type: string;
}
export interface ConsumptionInventory {
  loadedAt: string;
  agents: readonly ConsumptionIdentity[];
  environments: readonly ConsumptionEnvironment[];
}
export interface ManagedAppConsumptionInventory {
  loadedAt: string;
  apps: readonly Pick<ConsumptionIdentity, "environmentId" | "resourceId" | "name">[];
  environments: readonly ConsumptionEnvironment[];
}
export interface ConsumptionFilter extends Partial<ReportRange> {
  environmentId?: string;
  resourceKey?: string;
  family?: string;
  group?: string;
  product?: string;
  feature?: string;
  scenarioName?: string;
  channel?: string;
  model?: string;
  tool?: string;
  search?: string;
}
export interface ConsumptionRow {
  source: CreditReportRow;
  resourceKey: string;
  resourceName: string;
  schemaName: string;
  environmentName: string;
  groupKey: string;
  groupName: string;
  environmentType: string;
  inventoryMatch: "notAttempted" | "matched" | "schemaMissing" | "notFound" | "ambiguous";
  managedAppMatch: "notAttempted" | "matched" | "notFound" | "ambiguous";
}
export interface ConsumptionTotal {
  key: string;
  label: string;
  detail: string;
  first: number;
  second: number;
  total: number;
  rows: number;
}
export interface ConsumptionBucket {
  key: string;
  label: string;
  first: number | null;
  second: number | null;
  total: number | null;
  reportedDays: number;
  calendarDays: number;
  partial: boolean;
  windowStart?: string;
}
export const metricValue = (value: Pick<ConsumptionTotal, "first" | "second" | "total">, metric: ConsumptionMetric) =>
  metric === "billed" ? value.first : metric === "nonbilled" ? value.second : value.total;
export const resourceKey = (environmentId: string | null, id: string) =>
  JSON.stringify([environmentId?.trim().toLowerCase() || null, id.trim().toLowerCase()]);
const dayMs = 86_400_000;

export function prepareConsumptionRows(rows: readonly CreditReportRow[], inventory?: ConsumptionInventory, appInventory?: ManagedAppConsumptionInventory): ConsumptionRow[] {
  const agents = new Map<string, ConsumptionIdentity | null>();
  for (const agent of inventory?.agents ?? []) {
    for (const id of new Set([agent.resourceId, ...agent.resourceAliases ?? []].map((id) => id.trim().toLowerCase()).filter(Boolean))) {
      const key = resourceKey(agent.environmentId, id);
      const previous = agents.get(key);
      agents.set(key, previous === null || (previous && previous.schemaName.trim().toLowerCase() !== agent.schemaName.trim().toLowerCase()) ? null : agent);
    }
  }
  const environments = new Map(inventory?.environments.map((env) => [env.id.toLowerCase(), env]));
  const apps = new Map<string, ManagedAppConsumptionInventory["apps"][number] | null>();
  for (const app of appInventory?.apps ?? []) {
    if (!app.resourceId.trim() || !app.environmentId.trim()) continue;
    const key = resourceKey(app.environmentId, app.resourceId), previous = apps.get(key);
    apps.set(key, previous === null || (previous && previous.name.trim().toLowerCase() !== app.name.trim().toLowerCase()) ? null : app);
  }
  const appEnvironments = new Map(appInventory?.environments.map((env) => [env.id.toLowerCase(), env]));
  return rows.map((source) => {
    const id = source.cells.ResourceID?.trim() || "";
    const key = resourceKey(source.environmentId || (source.environmentName ? `unresolved-environment:${source.environmentName}` : null),
      id || `unresolved:${source.cells.ResourceName || ""}`);
    const agent = source.environmentId && id ? agents.get(key) : undefined;
    const isApp = source.cells.ScenarioName?.trim() === MANAGED_APP_SCENARIO;
    const app = isApp && source.environmentId && id ? apps.get(key) : undefined;
    const env = source.environmentId ? (isApp ? appEnvironments.get(source.environmentId) : undefined) || environments.get(source.environmentId) : undefined;
    return {
      source, resourceKey: key,
      resourceName: app?.name.trim() || source.cells.ResourceName?.trim() || id || "Resource not reported",
      schemaName: agent?.schemaName.trim().toLowerCase() || "",
      environmentName: source.environmentName || env?.name || source.environmentId || "Environment not reported",
      groupKey: env?.groupId.toLowerCase() || "",
      groupName: env?.groupName || env?.groupId || "Ungrouped / not resolved",
      environmentType: env?.type || source.cells.EnvironmentType || "Type not reported",
      inventoryMatch: !inventory ? "notAttempted" : agent === null ? "ambiguous" : !agent ? "notFound" : agent.schemaName.trim() ? "matched" : "schemaMissing",
      managedAppMatch: !appInventory ? "notAttempted" : app === null ? "ambiguous" : app ? "matched" : "notFound",
    };
  });
}

export function filterConsumptionRows(rows: readonly ConsumptionRow[], filter: ConsumptionFilter) {
  const search = filter.search?.trim().toLowerCase();
  return rows.filter((row) =>
    (!filter.startDate || row.source.date >= filter.startDate) &&
    (!filter.endDate || row.source.date <= filter.endDate) &&
    (!filter.environmentId || row.source.environmentId === filter.environmentId) &&
    (!filter.resourceKey || row.resourceKey === filter.resourceKey) &&
    (!filter.family || row.schemaName === filter.family) &&
    (filter.group === undefined || row.groupKey === filter.group) &&
    (!filter.product || row.source.cells.Product === filter.product) &&
    (!filter.feature || row.source.cells.Feature === filter.feature) &&
    (!filter.scenarioName || row.source.cells.ScenarioName?.trim() === filter.scenarioName) &&
    (!filter.channel || row.source.cells.Channel === filter.channel) &&
    (!filter.model || row.source.cells.LLMModel === filter.model) &&
    (!filter.tool || row.source.cells.ToolUsed === filter.tool) &&
    (!search || [row.schemaName, row.resourceName, row.environmentName, ...Object.values(row.source.cells)]
      .some((value) => value.toLowerCase().includes(search))));
}

function add(total: ConsumptionTotal, row: CreditReportRow) {
  total.first += row.first; total.second += row.second;
  total.total = total.first + total.second; total.rows++;
  if (![total.first, total.second, total.total].every(Number.isFinite)) {
    throw new Error("Combined credits exceed the supported numeric range. Narrow the date range.");
  }
}
export function totalConsumption(rows: readonly ConsumptionRow[]): ConsumptionTotal {
  const total = { key: "total", label: "Total", detail: "", first: 0, second: 0, total: 0, rows: 0 };
  for (const row of rows) add(total, row.source);
  return total;
}
export function groupConsumption(rows: readonly ConsumptionRow[], dimension: ConsumptionDimension, metric: ConsumptionMetric): ConsumptionTotal[] {
  const groups = new Map<string, ConsumptionTotal>();
  for (const row of rows) {
    const { source } = row;
    const key = dimension === "environment" ? source.environmentId || ""
      : dimension === "resource" ? row.resourceKey : dimension === "family" ? row.schemaName
      : dimension === "group" ? row.groupKey : source.cells[dimension]?.trim() || "";
    const label = dimension === "environment" ? row.environmentName : dimension === "resource" ? row.resourceName
      : dimension === "family" ? row.schemaName || "Schema not resolved"
      : dimension === "group" ? row.groupName : key || "Not reported";
    const detail = dimension === "resource" ? `${row.environmentName} / ${source.cells.ResourceID || "ID not reported"} / ${row.schemaName || source.cells.ResourceType || "Type not resolved"}`
      : dimension === "environment" ? `${source.environmentId || "ID not reported"} / ${row.environmentType}` : "";
    const group = groups.get(key) ?? { key, label, detail, first: 0, second: 0, total: 0, rows: 0 };
    add(group, source); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => metricValue(b, metric) - metricValue(a, metric) || a.key.localeCompare(b.key));
}

function validDate(date: string) {
  const ms = Date.parse(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new Error("Choose valid UTC calendar dates.");
  }
  return ms;
}
export function consumptionRange(rows: readonly CreditReportRow[], filter: Partial<ReportRange>): ReportRange | null {
  let start = "", end = "";
  for (const row of rows) {
    if (!start || row.date < start) start = row.date;
    if (!end || row.date > end) end = row.date;
  }
  const startDate = filter.startDate || start, endDate = filter.endDate || end;
  if (!startDate || !endDate) return null;
  if (validDate(startDate) > validDate(endDate)) throw new Error("The analysis start date must be on or before its end date.");
  return { startDate, endDate };
}
function bucketDate(date: string, grain: ConsumptionGrain) {
  if (grain === "month") return `${date.slice(0, 7)}-01`;
  if (grain === "day") return date;
  const ms = Date.parse(date), weekday = new Date(ms).getUTCDay();
  return new Date(ms - ((weekday + 6) % 7) * dayMs).toISOString().slice(0, 10);
}
function nextBucket(key: string, grain: ConsumptionGrain) {
  const date = new Date(key);
  if (grain === "month") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + (grain === "week" ? 7 : 1));
  return date.toISOString().slice(0, 10);
}
export function consumptionTimeline(
  rows: readonly ConsumptionRow[], reportedRows: readonly CreditReportRow[], range: ReportRange | null, grain: ConsumptionGrain,
): ConsumptionBucket[] {
  if (!range) return [];
  consumptionRange([], range);
  const days = new Set(reportedRows.map((row) => row.date));
  const totals = new Map<string, ConsumptionTotal>();
  for (const row of rows) {
    const key = bucketDate(row.source.date, grain);
    const total = totals.get(key) ?? { key, label: key, detail: "", first: 0, second: 0, total: 0, rows: 0 };
    add(total, row.source); totals.set(key, total);
  }
  const buckets: ConsumptionBucket[] = [];
  for (let key = bucketDate(range.startDate, grain); key <= range.endDate; key = nextBucket(key, grain)) {
    if (buckets.length >= 4000) throw new Error("Too many chart periods. Choose weekly/monthly granularity or a shorter date range.");
    const next = nextBucket(key, grain), calendarDays = Math.round((Date.parse(next) - Date.parse(key)) / dayMs);
    let reportedDays = 0;
    for (let day = key; day < next; day = new Date(Date.parse(day) + dayMs).toISOString().slice(0, 10)) {
      if (day >= range.startDate && day <= range.endDate && days.has(day)) reportedDays++;
    }
    const total = totals.get(key);
    buckets.push({
      key, label: grain === "month" ? key.slice(0, 7) : key,
      first: total?.first ?? null, second: total?.second ?? null, total: total?.total ?? null,
      reportedDays, calendarDays, partial: reportedDays < calendarDays,
    });
  }
  return buckets;
}

export function concentration(groups: readonly ConsumptionTotal[], metric: ConsumptionMetric, top: number): number | null {
  if (groups.some((group) => metricValue(group, metric) < 0)) return null;
  const sum = groups.reduce((value, group) => value + metricValue(group, metric), 0);
  if (!Number.isFinite(sum)) throw new Error("Combined credits exceed the supported numeric range.");
  return sum > 0 ? groups.slice(0, top).reduce((value, group) => value + metricValue(group, metric), 0) / sum : null;
}

export function rolling30ConsumptionTimeline(
  rows: readonly ConsumptionRow[], reportedRows: readonly CreditReportRow[], range: ReportRange | null,
): ConsumptionBucket[] {
  if (!range) return [];
  const start = validDate(range.startDate), end = validDate(range.endDate);
  consumptionRange([], range);
  if ((end - start) / dayMs >= 4000) throw new Error("Too many rolling chart days. Choose a shorter date range.");
  const days = new Set(reportedRows.map((row) => row.date));
  const daily = new Map<string, ConsumptionTotal>();
  for (const row of rows) {
    const total = daily.get(row.source.date) ?? { key: row.source.date, label: "", detail: "", first: 0, second: 0, total: 0, rows: 0 };
    add(total, row.source); daily.set(row.source.date, total);
  }
  const buckets: ConsumptionBucket[] = [];
  for (let ms = start; ms <= end; ms += dayMs) {
    const key = new Date(ms).toISOString().slice(0, 10);
    let first = 0, second = 0, activityRows = 0, reportedDays = 0;
    for (let offset = 29; offset >= 0; offset--) {
      const day = new Date(ms - offset * dayMs).toISOString().slice(0, 10), total = daily.get(day);
      first += total?.first ?? 0; second += total?.second ?? 0; activityRows += total?.rows ?? 0;
      reportedDays += Number(days.has(day));
    }
    if (![first, second, first + second].every(Number.isFinite)) throw new Error("Rolling credits exceed the supported numeric range.");
    buckets.push({
      key, label: key, windowStart: new Date(ms - 29 * dayMs).toISOString().slice(0, 10),
      first: activityRows ? first : null, second: activityRows ? second : null, total: activityRows ? first + second : null,
      reportedDays, calendarDays: 30, partial: reportedDays < 30,
    });
  }
  return buckets;
}

export function rankedChartGroups(groups: readonly ConsumptionTotal[], limit = 8): ConsumptionTotal[] {
  if (groups.length <= limit) return [...groups];
  const rest = groups.slice(limit);
  const other = rest.reduce((sum, group) => {
    sum.first += group.first; sum.second += group.second; sum.total += group.total; sum.rows += group.rows;
    if (![sum.first, sum.second, sum.total].every(Number.isFinite)) throw new Error("Combined credits exceed the supported numeric range.");
    return sum;
  }, { key: "__other__", label: `Other (${rest.length})`, detail: "Remaining groups", first: 0, second: 0, total: 0, rows: 0 });
  return [...groups.slice(0, limit), other];
}

export function latestFundingSnapshots(rows: readonly CreditReportRow[], filter: ConsumptionFilter) {
  const snapshots = new Map<string, { date: string; rows: CreditReportRow[] }>();
  for (const row of rows) {
    if ((filter.startDate && row.date < filter.startDate) || (filter.endDate && row.date > filter.endDate)
      || (filter.environmentId && row.environmentId !== filter.environmentId)) continue;
    const key = JSON.stringify([row.environmentId, row.cells.EntitlementID, row.cells.BillingPolicyId]);
    const current = snapshots.get(key);
    if (!current || row.date > current.date) snapshots.set(key, { date: row.date, rows: [row] });
    else if (row.date === current.date) current.rows.push(row);
  }
  return [...snapshots.values()].flatMap((snapshot) => snapshot.rows);
}
