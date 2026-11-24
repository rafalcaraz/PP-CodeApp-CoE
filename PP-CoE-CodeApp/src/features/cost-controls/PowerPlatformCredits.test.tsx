import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCreditReports, getCreditReportCaptures, getCreditReports, readCreditReport, replaceCreditReport, reportRangePreset,
  type CreditReport, type ReportResult,
} from "../../shared/credit-reports";
import { PowerPlatformCredits } from "./PowerPlatformCredits";
import { costControlsRoutes } from "./routes";

const { acquire, graphRead } = vi.hoisted(() => ({ acquire: vi.fn(), graphRead: vi.fn() }));
vi.mock("../../shared/credit-reports", async (original) => ({
  ...await original<typeof import("../../shared/credit-reports")>(), acquireCreditReport: acquire,
}));
vi.mock("./usageData", async (original) => ({
  ...await original<typeof import("./usageData")>(), getDailyUsage: graphRead,
}));
vi.mock("recharts", async (original) => ({
  ...await original<typeof import("recharts")>(),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const { Blob: NodeBlob } = await vi.importActual<{ Blob: typeof Blob }>("node:buffer");
beforeAll(async () => { await import("./CostControls"); });
const csv = "ConsumptionDate,EnvironmentID,EnvironmentName,ResourceID,ResourceName,ResourceType,Feature,BilledCredits,NonBilledCredits\n2026-11-01,env-a,Environment A,bot-1,Example agent,Bot,Answers,10,2\n2026-11-02,env-a,Environment A,bot-1,Example agent,Bot,Tools,5,0\n2026-11-02,env-b,Environment B,bot-1,Other environment agent,Bot,Answers,50,1";
const billing = "BilledDate,EnvironmentID,AllocatedCapacityPackCredits,CapacityPackCreditsConsumed,PayGoConsumedQuantity\n2026-11-01,env-a,1000,7,3";

async function report(text = csv) {
  return readCreditReport(new Blob([text]), "daily.csv", { source: "upload" });
}
function renderPage(route = false) {
  return render(<FluentProvider theme={webLightTheme}><MemoryRouter initialEntries={["/cost-controls/power-platform"]}>
    {route ? <Suspense fallback="Loading route"><Routes>{costControlsRoutes()}</Routes></Suspense> : <PowerPlatformCredits />}
  </MemoryRouter></FluentProvider>);
}
function confirmGeneration() {
  if (!screen.queryByRole("button", { name: "Review report request" })) fireEvent.click(screen.getByText("Request or upload Daily reports", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "Review report request" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Type GenerateLicensingReport to confirm" }), { target: { value: "GenerateLicensingReport" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Generate reports" }));
}
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  clearCreditReports(); vi.clearAllMocks();
  acquire.mockResolvedValue({ ok: false, error: "Synthetic API error" });
});
afterEach(() => { cleanup(); clearCreditReports(); vi.unstubAllGlobals(); });

describe("Power Platform credit usage", () => {
  it("opens the new native route without triggering Graph/MAC or any report request", async () => {
    renderPage(true);
    expect(await screen.findByRole("heading", { name: "Power Platform credit usage" })).toBeInTheDocument();
    expect(screen.getByText("Power Platform preview")).toBeInTheDocument();
    expect(screen.getByText(/Start with a report/)).toBeInTheDocument();
    expect(acquire).not.toHaveBeenCalled(); expect(graphRead).not.toHaveBeenCalled();
  });
  it("requires exact confirmation before sequentially requesting both Daily report types", async () => {
    const first = await report(billing);
    const second = await report();
    acquire.mockResolvedValueOnce({ ok: true, data: first }).mockResolvedValueOnce({ ok: true, data: second });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Review report request" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/through PP-Request-Credit-Licensing-Report/)).toBeInTheDocument();
    expect(within(dialog).getByText(/FeatureDetailsPerResource/)).toHaveTextContent("BillingDetailsPerEnvironment");
    expect(within(dialog).getByRole("button", { name: "Generate reports" })).toBeDisabled();
    expect(acquire).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "GenerateLicensingReport" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate reports" }));
    await waitFor(() => expect(acquire).toHaveBeenCalledTimes(2));
    expect(acquire.mock.calls.map(([options]) => options.name)).toEqual(["BillingDetailsPerEnvironment", "FeatureDetailsPerResource"]);
    expect(await screen.findByRole("tab", { name: "Environment billing (loaded)" })).toHaveAttribute("aria-selected", "true");
    await screen.findByText(/Capacity-pack and pay-as-you-go values describe/);
    expect(getCreditReports()).toHaveLength(2);
    expect(graphRead).not.toHaveBeenCalled();
  });
  it("does not submit the second report after a first failure and preserves the previous successful snapshot", async () => {
    replaceCreditReport(await report());
    renderPage();
    confirmGeneration();
    expect(await screen.findByText(/Synthetic API error.*remaining report was not requested/)).toBeInTheDocument();
    expect(acquire).toHaveBeenCalledOnce();
    expect(screen.getByRole("table", { name: /Filtered resources & features consumption/ })).toHaveTextContent("Example agent");
    expect(getCreditReports()).toHaveLength(1);
  });
  it("imports a file through the same parser, shows attribution, filters rows and never mixes report types", async () => {
    replaceCreditReport(await report(billing));
    renderPage();
    const file = Object.assign(new Blob([csv]), { name: "previous.csv" });
    fireEvent.change(screen.getByLabelText("Upload Daily credit report"), { target: { files: [file] } });
    const table = await screen.findByRole("table", { name: /Filtered resources & features consumption/ });
    expect(table).toHaveTextContent("Other environment agent");
    expect(table).toHaveTextContent("17");
    expect(screen.getByText(/tenant and completeness are not verified/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter environment" }), { target: { value: "env-a" } });
    expect(table).toHaveTextContent("Example agent");
    expect(table).not.toHaveTextContent("Other environment agent");
    fireEvent.change(screen.getByRole("textbox", { name: "Search report values" }), { target: { value: "Tools" } });
    expect(within(table).getByRole("row", { name: /Example agent/ })).toHaveTextContent("5");
    expect(getCreditReports()).toHaveLength(2);
    expect(acquire).not.toHaveBeenCalled();
  });
  it("downloads the complete original bytes regardless of active filters and retains cache across navigation/remount", async () => {
    const loaded = await report();
    replaceCreditReport(loaded);
    const createUrl = vi.fn().mockReturnValue("blob:synthetic");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const view = renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Search report values" }), { target: { value: "Tools" } });
    fireEvent.click(screen.getByRole("button", { name: "Download original file" }));
    expect(createUrl).toHaveBeenCalledExactlyOnceWith(loaded.original);
    expect(click).toHaveBeenCalledOnce();
    view.unmount(); renderPage();
    expect(screen.getByRole("table", { name: /Filtered resources & features consumption/ })).toHaveTextContent("Other environment agent");
    fireEvent.click(screen.getByRole("button", { name: "Remove selected capture" }));
    expect(screen.getByText(/Start with a report/)).toBeInTheDocument();
    click.mockRestore();
  });
  it("rejects malformed uploads without overwriting a loaded report", async () => {
    const loaded = await report();
    replaceCreditReport(loaded);
    renderPage();
    const file = Object.assign(new Blob(["BilledCredits,NonBilledCredits\n10,2"]), { name: "summary.csv" });
    fireEvent.change(screen.getByLabelText("Upload Daily credit report"), { target: { files: [file] } });
    expect(await screen.findByText(/Summary reports are not supported/)).toBeInTheDocument();
    expect(getCreditReports()[0]).toBe(loaded);
  });
  it("stops a pending acquisition on unmount and discards a late result", async () => {
    let finish!: (value: ReportResult<CreditReport>) => void;
    acquire.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const loaded = await report();
    const view = renderPage(); confirmGeneration();
    await waitFor(() => expect(acquire).toHaveBeenCalledOnce());
    const signal: AbortSignal = acquire.mock.calls[0][0].signal;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, data: loaded }));
    expect(getCreditReports()).toHaveLength(0);
    expect(acquire).toHaveBeenCalledOnce();
  });
  it("resumes a known operation without opening generation confirmation", async () => {
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Operation ID", hidden: true }), { target: { value: "known-operation" } });
    fireEvent.click(screen.getByRole("button", { name: "Resume without generating", hidden: true }));
    await waitFor(() => expect(acquire).toHaveBeenCalledOnce());
    expect(acquire.mock.calls[0][0].resume).toMatchObject({ operationId: "known-operation" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("changes request presets while preserving manually editable dates", () => {
    renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "Request date preset" }), { target: { value: "7" } });
    expect(screen.getByLabelText("UTC start date")).toHaveValue(reportRangePreset(7).startDate);
    expect(screen.getByLabelText("UTC end date")).toHaveValue(reportRangePreset(7).endDate);
    fireEvent.change(screen.getByRole("combobox", { name: "Request date preset" }), { target: { value: "1" } });
    expect(screen.getByLabelText("UTC start date")).toHaveValue(reportRangePreset(1).endDate);
    fireEvent.change(screen.getByLabelText("UTC start date"), { target: { value: reportRangePreset(7).startDate } });
    expect(screen.getByRole("combobox", { name: "Request date preset" })).toHaveValue("custom");
    expect(screen.getByLabelText("UTC start date")).toHaveValue(reportRangePreset(7).startDate);
  });
  it("switches between individual captures and reconciled days, with local-only filters and restored older days on removal", async () => {
    const header = "BilledDate,TenantID,EnvironmentID,CapacityPackCreditsConsumed,PayGoConsumedQuantity";
    const first = { ...await report(`${header}\n2026-11-01,tenant-a,env-a,10,0\n2026-11-02,tenant-a,env-a,20,0`), loadedAt: "2026-11-03T00:00:00Z" };
    const second = { ...await report(`${header}\n2026-11-02,tenant-a,env-a,7,0\n2026-11-03,tenant-a,env-a,5,0`), loadedAt: "2026-11-04T00:00:00Z" };
    replaceCreditReport(first); replaceCreditReport(second);
    renderPage();
    const total = () => screen.getByLabelText("Filtered report consumption");
    expect(total()).toHaveTextContent("Capacity-pack credits consumed: 12");
    fireEvent.change(screen.getByRole("combobox", { name: "Report capture" }), { target: { value: first.id } });
    expect(total()).toHaveTextContent("Capacity-pack credits consumed: 30");
    fireEvent.change(screen.getByRole("combobox", { name: "Analysis mode" }), { target: { value: "holistic" } });
    expect(total()).toHaveTextContent("Capacity-pack credits consumed: 22");
    expect(screen.getByText(/3 reported days; gaps are unknown/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download original file" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter from UTC"), { target: { value: "2026-11-02" } });
    expect(total()).toHaveTextContent("Capacity-pack credits consumed: 12");
    fireEvent.click(screen.getByRole("button", { name: "Clear analysis filters" }));
    expect(total()).toHaveTextContent("Capacity-pack credits consumed: 22");
    fireEvent.change(screen.getByRole("combobox", { name: "Analysis mode" }), { target: { value: "capture" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Report capture" }), { target: { value: second.id } });
    fireEvent.click(screen.getByRole("button", { name: "Remove selected capture" }));
    expect(total()).toHaveTextContent("Capacity-pack credits consumed: 30");
    expect(getCreditReportCaptures()).toEqual([first]);
    expect(acquire).not.toHaveBeenCalled();
  });
  it("warns about a retained requested period but permits an explicitly confirmed fresh request", async () => {
    const loaded: CreditReport = {
      ...await report(billing), source: "connector", requestedRange: reportRangePreset(30),
    };
    replaceCreditReport(loaded);
    renderPage();
    fireEvent.click(screen.getByText("Request or upload Daily reports", { selector: "summary" }));
    expect(screen.getByText(/A retained download was requested for these dates/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View loaded environment billing" }));
    expect(acquire).not.toHaveBeenCalled();
    confirmGeneration();
    await waitFor(() => expect(acquire).toHaveBeenCalledOnce());
    expect(getCreditReportCaptures()).toEqual([loaded]);
  });
  it("downloads a ZIP containing all captures even when analysis filters hide the rows", async () => {
    replaceCreditReport(await report(billing));
    replaceCreditReport(await report());
    const createUrl = vi.fn().mockReturnValue("blob:archive");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Search report values" }), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Export all captures (ZIP)" }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledOnce());
    expect(createUrl.mock.calls[0][0].type).toBe("application/zip");
    expect(getCreditReportCaptures()).toHaveLength(2);
    expect(click).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
