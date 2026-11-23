import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

const { executeAction } = vi.hoisted(() => ({ executeAction: vi.fn() }));
vi.mock("./data", () => ({ executeAction }));
import { ConnectorPlayground } from "./ConnectorPlayground";

function renderPage() {
  return render(<FluentProvider theme={webLightTheme}><ConnectorPlayground /></FluentProvider>);
}

function chooseAction(id: string) {
  fireEvent.change(screen.getByRole("combobox", { name: /Action \(/ }), { target: { value: id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  executeAction.mockResolvedValue({ ok: true, data: { success: true, data: { value: ["example"] } } });
});

afterEach(() => vi.useRealTimers());

describe("ConnectorPlayground", () => {
  it("renders without calling connectors and runs only on demand", async () => {
    executeAction.mockResolvedValueOnce({
      ok: true, data: { success: true, data: { value: ["example"] }, headers: { Location: "/operations/example", "Retry-After": "10" } },
    });
    renderPage();
    expect(screen.getByRole("heading", { name: "Connector playground" })).toBeInTheDocument();
    expect(executeAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await screen.findByText("Succeeded");
    expect(executeAction).toHaveBeenCalledExactlyOnceWith({
      actionId: "ListEnvironmentGroups", parameters: { "api-version": "2024-10-01" },
    }, false);
    expect(screen.getByLabelText("JSON response")).toHaveTextContent("example");
    fireEvent.click(screen.getByText("Response headers"));
    expect(screen.getByLabelText("Response headers JSON")).toHaveTextContent("/operations/example");
    expect(screen.getByRole("button", { name: "Copy response headers" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Submitted request"));
    expect(screen.getByLabelText("Submitted request")).toHaveTextContent("ListEnvironmentGroups");
    expect(screen.getByRole("button", { name: "Copy submitted request" })).toBeInTheDocument();
  });

  it("validates required inputs without submitting", () => {
    renderPage();
    chooseAction("GetEnvironmentByIdForUser");
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    expect(screen.getByText("environmentId is required.")).toBeInTheDocument();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("requires typed confirmation and submits the reviewed snapshot once", async () => {
    renderPage();
    chooseAction("DeleteEnvironmentByID");
    fireEvent.change(screen.getByRole("textbox", { name: /environmentId \(/ }), { target: { value: "test-target" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/test-target/)).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole("button", { name: "Confirm and run" });
    expect(confirmButton).toBeDisabled();
    expect(executeAction).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "DeleteEnvironmentByID" } });
    fireEvent.click(confirmButton);
    await screen.findByText("Succeeded");
    expect(executeAction).toHaveBeenCalledExactlyOnceWith({
      actionId: "DeleteEnvironmentByID",
      parameters: { environmentId: "test-target", "api-version": "2024-10-01" },
    }, true);
  });

  it("prefills an editable report payload and restores the example without running anything", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:15:00Z"));
    renderPage();
    chooseAction("GenerateLicensingReport");
    const body = screen.getByRole("textbox", { name: "body (JSON request body)" });
    const reportName = screen.getByRole("combobox", { name: /^ReportName \(/ });
    const example = { startDate: "2025-12-18", endDate: "2025-12-31", granularity: "Summary" };
    expect(body).toHaveValue(JSON.stringify(example, null, 2));
    expect(reportName).toHaveValue("FeatureDetailsPerResource");
    expect(screen.getByText("startDate (required)")).toBeInTheDocument();
    expect(screen.getByText("granularity (optional)")).toBeInTheDocument();
    expect(screen.getByText(/currently registered connector has no format field/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Copilot Credit usage report examples/ })).toHaveAttribute(
      "href", "https://learn.microsoft.com/en-us/power-platform/admin/programmability-tutorial-download-copilot-credit-usage-reports?tabs=powershell",
    );
    fireEvent.change(reportName, { target: { value: "BillingDetailsPerEnvironment" } });
    fireEvent.change(body, { target: { value: '{"startDate":"2025-12-30","endDate":"2025-12-31"}' } });
    expect(body).toHaveValue('{"startDate":"2025-12-30","endDate":"2025-12-31"}');
    fireEvent.click(screen.getByRole("button", { name: "Insert report example (last 14 UTC days)" }));
    expect(body).toHaveValue(JSON.stringify(example, null, 2));
    expect(reportName).toHaveValue("BillingDetailsPerEnvironment");
    fireEvent.click(screen.getByRole("button", { name: "Reset inputs" }));
    expect(reportName).toHaveValue("FeatureDetailsPerResource");
    chooseAction("GetLicensingReportOperation");
    expect(screen.queryByRole("textbox", { name: "body (JSON request body)" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^OperationId \(/ })).toHaveValue("");
    expect(screen.getByText(/HTTP 200 can still mean Running/)).toBeInTheDocument();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("submits only the edited report payload after exact-request review", async () => {
    renderPage();
    chooseAction("GenerateLicensingReport");
    fireEvent.change(screen.getByRole("combobox", { name: /^ReportName \(/ }), { target: { value: "BillingDetailsPerEnvironment" } });
    const payload = { startDate: "2026-11-20", endDate: "2026-11-21", granularity: "Daily" };
    fireEvent.change(screen.getByRole("textbox", { name: "body (JSON request body)" }), {
      target: { value: JSON.stringify(payload) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/"granularity": "Daily"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert report example (last 14 UTC days)" })).toBeDisabled();
    expect(executeAction).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "GenerateLicensingReport" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm and run" }));
    await screen.findByText("Succeeded");
    expect(executeAction).toHaveBeenCalledExactlyOnceWith({
      actionId: "GenerateLicensingReport",
      parameters: { ReportName: "BillingDetailsPerEnvironment", "api-version": "2024-10-01", body: payload },
    }, true);
  });

  it("cancels a write without sending anything", () => {
    renderPage();
    chooseAction("ProvisionNewEnvironment");
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(executeAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows failed calls and their submitted request", async () => {
    executeAction.mockResolvedValueOnce({
      ok: false, error: "Forbidden (403)", data: { success: false, headers: { "Retry-After": "30" }, error: { code: "Forbidden" } },
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await screen.findByText("Failed");
    expect(screen.getByText("Forbidden (403)")).toBeInTheDocument();
    expect(screen.getByText("Submitted request")).toBeInTheDocument();
    expect(screen.getByLabelText("JSON response")).toHaveTextContent('"code": "Forbidden"');
    fireEvent.click(screen.getByText("Response headers"));
    expect(screen.getByLabelText("Response headers JSON")).toHaveTextContent('"Retry-After": "30"');
  });

  it("prevents duplicate submissions while a request is running", async () => {
    let finish: (value: { ok: true; data: unknown }) => void = () => { throw new Error("Missing resolver"); };
    executeAction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderPage();
    const run = screen.getByRole("button", { name: "Run action" });
    fireEvent.click(run);
    fireEvent.click(run);
    expect(run).toBeDisabled();
    expect(executeAction).toHaveBeenCalledOnce();
    finish({ ok: true, data: {} });
    await waitFor(() => expect(run).not.toBeDisabled());
  });

  it("does not leave a runnable stale selection when search has no matches", () => {
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Find an action" }), { target: { value: "no-such-operation" } });
    expect(screen.getByText(/No matching actions. Try/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run action" })).not.toBeInTheDocument();
  });

  it("keeps the last response searchable even when the operation filter has no matches", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await screen.findByText("Succeeded");
    fireEvent.change(screen.getByRole("textbox", { name: "Search response" }), { target: { value: "EXAMPLE" } });
    expect(screen.getByLabelText("JSON response").querySelector("mark")).toHaveTextContent("example");
    fireEvent.change(screen.getByRole("textbox", { name: "Find an action" }), { target: { value: "no-such-operation" } });
    expect(screen.getByRole("textbox", { name: "Search response" })).toHaveValue("EXAMPLE");
    expect(screen.getByLabelText("JSON response").querySelector("mark")).toHaveTextContent("example");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "Run action" })).toBeInTheDocument();
    expect(executeAction).toHaveBeenCalledOnce();
  });
});
