import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardFromTemplate, getDashboard } from "../../data/dashboards";
import { consumptionDashboardLayout, managedAppConsumptionLayout, newCreditReportTile } from "../../data/dashboardCreditReports";
import { clearCreditReports, readCreditReport, retainCreditReport, type ConsumptionInventory, type ManagedAppConsumptionInventory } from "../../shared/credit-reports";
import { DashboardDetail } from "./DashboardDetail";

const { match, appMatch, query } = vi.hoisted(() => ({ match: vi.fn(), appMatch: vi.fn(), query: vi.fn() }));
vi.mock("../../data/dashboardCreditInventory", () => ({ loadConsumptionInventory: match, loadManagedAppConsumptionInventory: appMatch }));
vi.mock("../../data/inventory", async (original) => ({
  ...await original<typeof import("../../data/inventory")>(), runQuery: query,
}));
vi.mock("recharts", async (original) => ({
  ...await original<typeof import("recharts")>(),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const { Blob: NodeBlob } = await vi.importActual<{ Blob: typeof Blob }>("node:buffer");
const header = "ConsumptionDate,TenantID,EnvironmentID,EnvironmentName,ResourceID,ResourceName,Product,Feature,BilledCredits,NonBilledCredits";
const csv = `${header}\n2026-10-25,tenant-a,dev,Development,bot,Sample agent,Copilot Studio,Answers,10,40\n2026-11-01,tenant-a,prod,Production,bot,Sample agent,Copilot Studio,Tools,30,10`;
const billing = "BilledDate,TenantID,EnvironmentID,EnvironmentName,EntitlementID,BillingPolicyId,AllocatedCapacityPackCredits,CapacityPackCreditsConsumed,PayGoConsumedQuantity\n2026-11-01,tenant-a,prod,Production,credits,policy,500,7,3";
const inventory: ConsumptionInventory = {
  loadedAt: "2026-11-24T00:00:00Z",
  agents: [{ environmentId: "dev", resourceId: "bot", schemaName: "prefix_sample", name: "Sample agent" },
    { environmentId: "prod", resourceId: "bot", schemaName: "prefix_sample", name: "Sample agent" }],
  environments: [{ id: "dev", name: "Development", groupId: "group", groupName: "Group", type: "Sandbox" }],
};
const appInventory: ManagedAppConsumptionInventory = {
  loadedAt: "2026-11-24T00:00:00Z",
  apps: [{ environmentId: "dev", resourceId: "app", name: "Current dev app" }, { environmentId: "prod", resourceId: "app", name: "Current prod app" }],
  environments: [{ id: "dev", name: "Dev", groupId: "business", groupName: "Business", type: "Sandbox" },
    { id: "prod", name: "Prod", groupId: "production", groupName: "Production group", type: "Production" }],
};
async function load(text = csv) { retainCreditReport(await readCreditReport(new Blob([text]), "daily.csv", { source: "upload" })); }
function mount(layout = consumptionDashboardLayout()) {
  const dashboard = createDashboardFromTemplate("Consumption & Value", "Synthetic reporting dashboard", layout);
  const view = render(<FluentProvider theme={webLightTheme}><MemoryRouter initialEntries={[`/dashboards/${dashboard.id}`]}>
    <Routes><Route path="/dashboards/:dashboardId" element={<DashboardDetail />} />
      <Route path="/cost-controls/power-platform" element={<div>Daily report management</div>} /></Routes>
  </MemoryRouter></FluentProvider>);
  return { ...view, id: dashboard.id };
}
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob); localStorage.clear(); clearCreditReports();
  match.mockReset(); match.mockResolvedValue(inventory); appMatch.mockReset(); appMatch.mockResolvedValue(appInventory); query.mockReset();
});
afterEach(() => { cleanup(); clearCreditReports(); localStorage.clear(); vi.unstubAllGlobals(); });

describe("Native Consumption & Value dashboard", () => {
  it("adds the app tab explicitly to an existing dashboard without replacing its saved tiles", async () => {
    const original = newCreditReportTile("overview", { view: "summary" });
    const { id } = mount({ tabs: [{ id: "overview", name: "Overview" }], tiles: [original] });
    fireEvent.click(await screen.findByRole("button", { name: "Add managed app tab" }));
    expect(getDashboard(id)?.tiles[0]).toEqual(original);
    expect(getDashboard(id)?.tabs).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Managed app consumption" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Add managed app tab" })).not.toBeInTheDocument();
  });
  it("scopes app credits, includes rolling lookback, resolves inventory names and drills group to environment to app", async () => {
    await load(`${header},ScenarioName\n2026-11-01,tenant-a,dev,Dev,app,Old dev name,Copilot Studio,Build,10,5,CopilotStudio_AppStudio\n2026-11-02,tenant-a,prod,Prod,app,Old prod name,Copilot Studio,Build,20,0,CopilotStudio_AppStudio\n2026-11-02,tenant-a,dev,Dev,bot,Agent,Copilot Studio,Answers,1000,0,Other`);
    const layout = managedAppConsumptionLayout();
    mount({ ...layout, tiles: layout.tiles.filter((tile) => [
      "Managed app credits", "Rolling 30-day managed app credits", "Managed app credits by current environment group",
      "Managed app credits by environment", "Managed app consumption breakdown",
    ].includes(tile.title)) });
    const total = await screen.findByRole("region", { name: "Managed app credits" });
    expect(total).toHaveTextContent("35");
    fireEvent.change(screen.getByLabelText("Reporting from UTC"), { target: { value: "2026-11-02" } });
    expect(total).toHaveTextContent("20");
    fireEvent.click(within(screen.getByRole("region", { name: "Rolling 30-day managed app credits" })).getByText("View values and coverage"));
    expect(screen.getByRole("table", { name: "Rolling 30-day credits" })).toHaveTextContent("35");
    fireEvent.change(screen.getByLabelText("Reporting from UTC"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("This consumption scope belongs to the connected inventory tenant"));
    fireEvent.click(screen.getByRole("button", { name: "Match managed apps to inventory" }));
    const table = await screen.findByRole("table", { name: "Managed app consumption breakdown" });
    await waitFor(() => expect(table).toHaveTextContent("Current dev app"));
    expect(match).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("region", { name: "Managed app credits by current environment group" })).getByText("View values and drill down"));
    fireEvent.click(screen.getByRole("button", { name: "Business: 15" }));
    expect(total).toHaveTextContent("15");
    fireEvent.click(within(screen.getByRole("region", { name: "Managed app credits by environment" })).getByText("View values and drill down"));
    fireEvent.click(screen.getByRole("button", { name: "Dev: 15" }));
    fireEvent.click(within(table).getByRole("button", { name: "Current dev app" }));
    expect(screen.getByLabelText("Active reporting filters")).toHaveTextContent("Resource: Current dev app");
    expect(screen.getByLabelText("Reporting environment")).toHaveValue("dev");
  });
  it("filters the native reporting tiles together, reconciles new captures and keeps funding separate", async () => {
    await load(); await load(billing);
    const layout = consumptionDashboardLayout();
    mount({ tabs: layout.tabs, tiles: layout.tiles.filter((tile) =>
      ["Total reported consumption", "Nonbilled credits", "Resource consumption breakdown", "Capacity-pack credits consumed", "PAYG credits consumed", "Latest allocation snapshots"].includes(tile.title)) });
    expect(await screen.findByRole("region", { name: "Total reported consumption" })).toHaveTextContent("90");
    expect(screen.getByRole("region", { name: "Nonbilled credits" })).toHaveTextContent("50");
    expect(query).not.toHaveBeenCalled(); expect(match).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("table", { name: "Resource consumption breakdown" })).getAllByRole("button", { name: "Sample agent" })[0]);
    expect(screen.getByRole("region", { name: "Total reported consumption" })).toHaveTextContent("50");
    expect(screen.getByLabelText("Active reporting filters")).toHaveTextContent("Resource: Sample agent");
    fireEvent.click(screen.getByRole("button", { name: "Reset reporting filters" }));
    await act(() => load(`${header}\n2026-11-01,tenant-a,prod,Production,bot,Sample agent,Copilot Studio,Tools,2,1`));
    expect(screen.getByRole("region", { name: "Total reported consumption" })).toHaveTextContent("53");
    fireEvent.click(screen.getByRole("button", { name: "Data & filters" }));
    fireEvent.change(screen.getByLabelText("Reporting product"), { target: { value: "Copilot Studio" } });
    fireEvent.change(screen.getByLabelText("Search consumption reports"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Close data and filters" }));
    expect(screen.queryByLabelText("Reporting product")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Total reported consumption" })).toHaveTextContent("No reported activity");
    fireEvent.click(screen.getByRole("tab", { name: "Funding" }));
    expect(screen.getByRole("region", { name: "Capacity-pack credits consumed" })).toHaveTextContent("7");
    expect(screen.getByRole("region", { name: "PAYG credits consumed" })).toHaveTextContent("3");
    expect(screen.getByRole("table", { name: "Latest allocation snapshots" })).toHaveTextContent("500");
    fireEvent.change(screen.getByLabelText("Reporting environment"), { target: { value: "dev" } });
    expect(screen.getByRole("region", { name: "PAYG credits consumed" })).toHaveTextContent("No reported activity");
  });
  it("persists report-specific edits", async () => {
    await load();
    const layout = consumptionDashboardLayout();
    const { id } = mount({ tabs: layout.tabs.slice(0, 2),
      tiles: layout.tiles.filter((tile) => ["Total reported consumption", "Consumption by environment"].includes(tile.title)) });
    await screen.findByRole("region", { name: "Total reported consumption" });
    fireEvent.click(screen.getByLabelText("Edit mode"));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Consumption by environment" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText("Report tile title"), { target: { value: "Feature drivers" } });
    fireEvent.change(screen.getByLabelText("Report grouping"), { target: { value: "Feature" } });
    fireEvent.change(screen.getByLabelText("Report tile size"), { target: { value: "large" } });
    fireEvent.click(screen.getByRole("button", { name: "Save report tile" }));
    expect(getDashboard(id)?.tiles.find((tile) => tile.title === "Feature drivers")).toMatchObject({
      size: "large", source: "credit-report", creditReport: { dimension: "Feature", view: "ranking" },
    });
  });
  it("uses native duplicate, move, and add operations for report tiles", async () => {
    await load();
    const layout = consumptionDashboardLayout();
    const { id } = mount({ tabs: layout.tabs.slice(0, 2),
      tiles: [{ ...layout.tiles.find((tile) => tile.title === "Consumption by environment")!,
        title: "Feature drivers", creditReport: { reportName: "FeatureDetailsPerResource", view: "ranking", dimension: "Feature", metric: "total" } }] });
    await screen.findByRole("region", { name: "Feature drivers" });
    fireEvent.click(screen.getByLabelText("Edit mode"));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Feature drivers" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(getDashboard(id)?.tiles.filter((tile) => tile.creditReport?.dimension === "Feature" && tile.tabId === "consumption-overview")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Feature drivers" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to tab" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nonbilled consumption" }));
    expect(getDashboard(id)?.tiles.find((tile) => tile.title === "Feature drivers")?.tabId).toBe("consumption-nonbilled");
    fireEvent.click(screen.getAllByRole("button", { name: "Add tile" })[0]);
    fireEvent.change(screen.getByLabelText("Report tile title"), { target: { value: "Extra credits" } });
    fireEvent.change(screen.getByLabelText("Report visualization"), { target: { value: "summary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save report tile" }));
    expect(getDashboard(id)?.tiles.find((tile) => tile.title === "Extra credits")).toMatchObject({
      source: "credit-report", tabId: "consumption-overview", creditReport: { view: "summary" },
    });
  });
  it("surfaces failed family matching and allows a retry without discarding report usage", async () => {
    await load();
    match.mockRejectedValueOnce(new Error("Synthetic inventory read failed"));
    mount({ tabs: [{ id: "family", name: "Agent families" }],
      tiles: [{ ...newCreditReportTile("family", { reportName: "FeatureDetailsPerResource", view: "table", dimension: "family" }), title: "Families" }] });
    fireEvent.click(await screen.findByLabelText("This consumption scope belongs to the connected inventory tenant"));
    fireEvent.click(screen.getByRole("button", { name: "Match report resources to inventory" }));
    await waitFor(() => expect(screen.getByText("Synthetic inventory read failed")).toBeInTheDocument());
    expect(screen.queryByRole("table", { name: "Families" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Match report resources to inventory" }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Families" })).toHaveTextContent("90"));
    expect(screen.queryByText("Synthetic inventory read failed")).not.toBeInTheDocument();
  });
  it("requires tenant confirmation for family matching and drills environment/month without changing scope", async () => {
    await load(); mount();
    await screen.findByRole("region", { name: "Total reported consumption" });
    fireEvent.click(screen.getByRole("tab", { name: "Agent families" }));
    expect(screen.queryByRole("table", { name: "Schema family consumption" })).not.toBeInTheDocument();
    expect(screen.queryByText("Schema not resolved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match report resources to inventory" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("This consumption scope belongs to the connected inventory tenant"));
    fireEvent.click(screen.getByRole("button", { name: "Match report resources to inventory" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Agent inventory matching" })).toHaveTextContent("2 of 2 reported resource instances"));
    fireEvent.click(within(screen.getByRole("table", { name: "Schema family consumption" })).getByRole("button", { name: "prefix_sample" }));
    const table = screen.getByRole("table", { name: "Monthly reported activity by environment" });
    expect(table).toHaveTextContent("No reported activity");
    fireEvent.click(within(table).getByRole("button", { name: "50" }));
    expect(screen.getByLabelText("Reporting environment")).toHaveValue("dev");
    expect(screen.getByLabelText("Reporting from UTC")).toHaveValue("2026-10-25");
    expect(screen.getByLabelText("Reporting through UTC")).toHaveValue("2026-10-31");
  });
  it("shows evidence-aware empty states and invalid dates instead of successful zero totals", async () => {
    mount();
    expect(await screen.findByRole("region", { name: "Billed credits" })).toHaveTextContent("This Daily report is not loaded");
    await act(() => load());
    fireEvent.change(screen.getByLabelText("Reporting from UTC"), { target: { value: "2026-12-01" } });
    expect(screen.getByRole("region", { name: "Billed credits" })).toHaveTextContent("start date must be on or before");
    fireEvent.click(screen.getByRole("button", { name: "Manage Daily report data" }));
    expect(screen.getByText("Daily report management")).toBeInTheDocument();
  });
  it("expands allocation snapshots without dropping later environments", async () => {
    const rows = Array.from({ length: 27 }, (_, i) => `2026-11-01,tenant-a,env-${i},Environment ${i},credits,policy,${500 + i},1,2`);
    await load(`${billing.split("\n")[0]}\n${rows.join("\n")}`);
    mount({ tabs: [{ id: "funding", name: "Funding" }],
      tiles: [{ ...newCreditReportTile("funding", { reportName: "BillingDetailsPerEnvironment", view: "allocations" }), title: "Allocations" }] });
    const table = await screen.findByRole("table", { name: "Allocations" });
    expect(table).not.toHaveTextContent("Environment 26");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(table).toHaveTextContent("Environment 19");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(table).toHaveTextContent("Environment 26");
    expect(screen.getByText("Showing 27 of 27")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });
});
