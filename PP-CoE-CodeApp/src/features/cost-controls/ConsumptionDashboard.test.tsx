import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCreditReports, readCreditReport, retainCreditReport } from "../../shared/credit-reports";
import { ConsumptionDashboard } from "./ConsumptionDashboard";
import type { ConsumptionInventory } from "../../shared/credit-reports";

const { match } = vi.hoisted(() => ({ match: vi.fn() }));
vi.mock("../../data/dashboardCreditInventory", () => ({ loadConsumptionInventory: match }));
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
  agents: [{ environmentId: "dev", resourceId: "bot", schemaName: "prefix_sample", name: "Sample agent" }, { environmentId: "prod", resourceId: "bot", schemaName: "prefix_sample", name: "Sample agent" }, { environmentId: "staging", resourceId: "bot", schemaName: "prefix_sample", name: "Sample agent" }],
  environments: [{ id: "dev", name: "Development", groupId: "g1", groupName: "Test group", type: "Sandbox" }, { id: "staging", name: "Staging", groupId: "", groupName: "", type: "Sandbox" }],
};
async function load(text = csv) { retainCreditReport(await readCreditReport(new Blob([text]), "daily.csv", { source: "upload" })); }
function mount() { return render(<FluentProvider theme={webLightTheme}><ConsumptionDashboard onAcquire={vi.fn()} /></FluentProvider>); }
beforeEach(() => { vi.stubGlobal("Blob", NodeBlob); clearCreditReports(); match.mockReset(); match.mockResolvedValue(inventory); });
afterEach(() => { cleanup(); clearCreditReports(); vi.unstubAllGlobals(); });

describe("Consumption & Value", () => {
  it("starts with evidence, drills into environment/resource/feature, and clears local filters", async () => {
    await load(); mount();
    expect(screen.getByLabelText("Consumption summary")).toHaveTextContent("Total reported credits: 90");
    expect(screen.getByText(/55.6% of reported credits are nonbilled/)).toBeInTheDocument();
    expect(match).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("table", { name: "Consumption explorer breakdown" })).getByRole("button", { name: "Development" }));
    expect(screen.getByRole("tab", { name: "Consumption explorer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Consumption summary")).toHaveTextContent("Total reported credits: 50");
    fireEvent.change(screen.getByLabelText("Explore consumption by"), { target: { value: "resource" } });
    fireEvent.click(within(screen.getByRole("table", { name: "Consumption explorer breakdown" })).getByRole("button", { name: "Sample agent" }));
    expect(screen.getByRole("heading", { name: "Sample agent" })).toBeInTheDocument();
    expect(screen.getByLabelText("Explore consumption by")).toHaveValue("Feature");
    expect(screen.getByRole("table", { name: "Consumption explorer breakdown" })).toHaveTextContent("Answers");
    fireEvent.click(screen.getByRole("button", { name: "Reset consumption filters" }));
    expect(screen.getByLabelText("Consumption summary")).toHaveTextContent("Total reported credits: 90");
  });
  it("keeps funding separate and shows allocation as a snapshot, not summed consumption", async () => {
    await load(); await load(billing); mount();
    fireEvent.change(screen.getByLabelText("Consumption product"), { target: { value: "Copilot Studio" } });
    fireEvent.click(screen.getByRole("tab", { name: "Funding" }));
    expect(screen.getByLabelText("Consumption summary")).toHaveTextContent("Total reported credits: 10");
    expect(screen.getByText(/totals are not expected to reconcile/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Consumption product")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Latest reported allocation snapshots/));
    expect(screen.getByRole("table", { name: "Latest reported allocation by billing scope" })).toHaveTextContent("500");
  });
  it("requires explicit inventory confirmation and compares schema candidates across environments", async () => {
    await load(); mount();
    fireEvent.click(screen.getByRole("tab", { name: "Agent families" }));
    expect(screen.getByRole("button", { name: "Match current inventory" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I confirm this report scope belongs to the connected inventory tenant"));
    fireEvent.click(screen.getByRole("button", { name: "Match current inventory" }));
    await waitFor(() => expect(match).toHaveBeenCalledOnce());
    await screen.findByText(/3 agent records read/);
    fireEvent.change(screen.getByLabelText("Agent schema family"), { target: { value: "prefix_sample" } });
    expect(screen.getByRole("table", { name: "Monthly reported activity by environment" })).toHaveTextContent("Development");
    expect(screen.getByRole("table", { name: "Monthly reported activity by environment" })).toHaveTextContent("No reported activity");
    expect(within(screen.getByRole("table", { name: "Monthly reported activity by environment" })).getByRole("row", { name: /Staging/ })).toHaveTextContent("Not reported");
    fireEvent.click(within(screen.getByRole("table", { name: "Monthly reported activity by environment" })).getByRole("button", { name: "50" }));
    expect(screen.getByRole("tab", { name: "Consumption explorer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Analysis from UTC")).toHaveValue("2026-10-25");
    expect(screen.getByLabelText("Analysis through UTC")).toHaveValue("2026-10-31");
    expect(screen.getByLabelText("Consumption summary")).toHaveTextContent("Total reported credits: 50");
  });
  it("reconciles overlapping captures before charting and updates when captures arrive", async () => {
    await load(); mount();
    await act(() => load(`${header}\n2026-11-01,tenant-a,prod,Production,bot,Sample agent,Copilot Studio,Tools,2,1`));
    expect(screen.getByLabelText("Consumption summary")).toHaveTextContent("Total reported credits: 53");
  });
  it("surfaces invalid ranges and unmatched filters instead of inventing zeros", async () => {
    await load(); mount();
    fireEvent.change(screen.getByLabelText("Analysis from UTC"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Analysis through UTC"), { target: { value: "2026-10-01" } });
    expect(screen.getByText(/start date must be on or before/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset consumption filters" }));
    fireEvent.change(screen.getByLabelText("Search consumption"), { target: { value: "missing-resource" } });
    expect(await screen.findByText(/No reported activity matches/)).toBeInTheDocument();
  });
});
