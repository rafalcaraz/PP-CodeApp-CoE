import { newId, type DashboardTab, type DashboardTile } from "./dashboards";
import type {
  ConsumptionDimension, ConsumptionGrain, ConsumptionMetric, ReportName,
} from "../shared/credit-reports";

export type CreditReportTileView = "summary" | "trend" | "line" | "rolling30" | "ranking" | "table" | "family" | "allocations";
export interface CreditReportTileConfig {
  reportName: ReportName;
  view: CreditReportTileView;
  metric: ConsumptionMetric;
  dimension?: ConsumptionDimension;
  grain?: ConsumptionGrain;
  scope?: "managed-apps";
}
export const CREDIT_REPORT_DIMENSIONS: { value: ConsumptionDimension; label: string }[] = [
  { value: "environment", label: "Environment" }, { value: "resource", label: "Resource instance" },
  { value: "Product", label: "Product" }, { value: "Feature", label: "Feature" },
  { value: "ScenarioName", label: "Scenario" },
  { value: "Channel", label: "Channel" }, { value: "LLMModel", label: "Model" },
  { value: "ToolUsed", label: "Tool" }, { value: "group", label: "Current environment group" },
  { value: "family", label: "Matched schema family" },
];
export const CREDIT_REPORT_VIEWS: { value: CreditReportTileView; label: string }[] = [
  { value: "summary", label: "Credit total" }, { value: "trend", label: "Consumption trend" },
  { value: "line", label: "Credit line trend" }, { value: "rolling30", label: "Rolling 30-day credits" },
  { value: "ranking", label: "Ranked bars" }, { value: "table", label: "Breakdown table" },
  { value: "family", label: "Agent family environments" }, { value: "allocations", label: "Allocation snapshots" },
];
export function newCreditReportTile(tabId: string, config: Partial<CreditReportTileConfig> = {}): DashboardTile {
  const creditReport: CreditReportTileConfig = { reportName: "FeatureDetailsPerResource", view: "trend", metric: "total", dimension: "environment", ...config };
  return {
    id: newId("t"), tabId, title: "Credit consumption", size: "large", source: "credit-report",
    spec: { resourceTypes: [], filters: [], limit: 500, orderField: "name", orderDirection: "asc" },
    viz: { type: creditReport.view === "summary" ? "kpi" : creditReport.view === "ranking" ? "bar" : creditReport.view === "line" || creditReport.view === "rolling30" ? "line" : creditReport.view === "trend" || creditReport.view === "family" ? "stackedBar" : "table" },
    creditReport,
  };
}

export function managedAppConsumptionLayout(tabId = "consumption-managed-apps"): { tabs: DashboardTab[]; tiles: DashboardTile[] } {
  const tile = (title: string, config: Partial<CreditReportTileConfig>, size: DashboardTile["size"] = "medium") =>
    ({ ...newCreditReportTile(tabId, { scope: "managed-apps", ...config }), title, size });
  return { tabs: [{ id: tabId, name: "Managed app consumption" }], tiles: [
    tile("Managed app credits", { view: "summary" }, "small"),
    tile("Billed managed app credits", { view: "summary", metric: "billed" }, "small"),
    tile("Nonbilled managed app credits", { view: "summary", metric: "nonbilled" }, "small"),
    tile("Managed app credits over time", { view: "line", grain: "day" }, "large"),
    tile("Rolling 30-day managed app credits", { view: "rolling30" }, "large"),
    tile("Managed app credits by current environment group", { view: "ranking", dimension: "group" }),
    tile("Managed app credits by environment", { view: "ranking", dimension: "environment" }),
    tile("Managed app consumption breakdown", { view: "table", dimension: "resource" }, "large"),
    tile("AppStudio feature consumption", { view: "table", dimension: "Feature" }, "large"),
  ] };
}

export function consumptionDashboardLayout(): { tabs: DashboardTab[]; tiles: DashboardTile[] } {
  const tabs = [
    { id: "consumption-overview", name: "Overview" },
    { id: "consumption-nonbilled", name: "Nonbilled consumption" },
    { id: "consumption-billed", name: "Billed consumption" },
    { id: "consumption-families", name: "Agent families" },
    { id: "consumption-funding", name: "Funding" },
  ];
  const tile = (tab: number, title: string, config: Partial<CreditReportTileConfig>, size: DashboardTile["size"] = "medium") =>
    ({ ...newCreditReportTile(tabs[tab].id, config), title, size });
  const managedApps = managedAppConsumptionLayout();
  return { tabs: [...tabs.slice(0, 4), ...managedApps.tabs, tabs[4]], tiles: [
    tile(0, "Billed credits", { view: "summary", metric: "billed" }, "small"),
    tile(0, "Nonbilled credits", { view: "summary", metric: "nonbilled" }, "small"),
    tile(0, "Total reported consumption", { view: "summary" }, "small"),
    tile(0, "Billed & nonbilled over time", { view: "trend" }, "large"),
    tile(0, "Consumption by environment", { view: "ranking", dimension: "environment" }),
    tile(0, "Consumption by product", { view: "ranking", dimension: "Product" }),
    tile(0, "Resource consumption breakdown", { view: "table", dimension: "resource" }, "large"),
    ...([["nonbilled", 1, "Nonbilled"], ["billed", 2, "Billed"]] as const).flatMap(([metric, tab, label]) => [
      tile(tab, `${label} credits over time`, { view: "trend", metric }, "large"),
      tile(tab, `${label} by environment`, { view: "ranking", metric, dimension: "environment" }),
      tile(tab, `${label} by feature`, { view: "ranking", metric, dimension: "Feature" }),
      tile(tab, `${label} resource consumers`, { view: "table", metric, dimension: "resource" }, "large"),
    ]),
    tile(3, "Schema family consumption", { view: "table", dimension: "family" }, "large"),
    tile(3, "Agent family across environments", { view: "family" }, "large"),
    tile(3, "Feature consumption", { view: "table", dimension: "Feature" }, "large"),
    tile(4, "Capacity-pack credits consumed", { reportName: "BillingDetailsPerEnvironment", view: "summary", metric: "billed" }),
    tile(4, "PAYG credits consumed", { reportName: "BillingDetailsPerEnvironment", view: "summary", metric: "nonbilled" }),
    tile(4, "Funding over time", { reportName: "BillingDetailsPerEnvironment", view: "trend" }, "large"),
    tile(4, "Funding by environment", { reportName: "BillingDetailsPerEnvironment", view: "ranking" }, "large"),
    tile(4, "Latest allocation snapshots", { reportName: "BillingDetailsPerEnvironment", view: "allocations" }, "large"),
    ...managedApps.tiles,
  ] };
}
