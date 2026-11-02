import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Routes } from "react-router-dom";
import { Suspense } from "react";

const { executeCostRequest } = vi.hoisted(() => ({ executeCostRequest: vi.fn() }));
vi.mock("./data", () => ({
  executeCostRequest,
  unsupportedReason: () => undefined,
}));
import { CostManagementApiPlayground } from "./CostManagementApiPlayground";
import { costManagementApiRoutes } from "./index";
import type { CostResult } from "./data";

function renderPage() {
  return render(<FluentProvider theme={webLightTheme}><CostManagementApiPlayground /></FluentProvider>);
}

function choose(id: string) {
  fireEvent.change(screen.getByRole("combobox", { name: /Action \(/ }), { target: { value: id } });
}

function enter(label: string, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  executeCostRequest.mockResolvedValue({
    ok: true, data: { success: true, data: { billingMethodBalances: [{ unit: "copilotCredit", consumedQuantity: 50 }] } },
  });
});

describe("Cost Management API playground", () => {
  it("opens without any calls, advertises direct SDK/beta/paging constraints and previews the selected read", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Cost Management API playground" })).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText(/No passthrough flow/)).toBeInTheDocument();
    expect(screen.getByText(/List actions return one page only/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/graph.microsoft.com\/beta\/copilot\/costManagement\/getTenantCreditBalance/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /connectionId/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(24);
    expect(executeCostRequest).not.toHaveBeenCalled();
  });

  it("executes a read only on click and uses shared response search and raw SDK inspection", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await screen.findByText("Succeeded");
    expect(executeCostRequest).toHaveBeenCalledExactlyOnceWith({ actionId: "GetTenantCreditBalance", parameters: {} }, false);
    expect(screen.getByLabelText("Raw connector response")).toHaveTextContent('"consumedQuantity": 50');
    fireEvent.change(screen.getByRole("textbox", { name: "Search response" }), { target: { value: "COPILOTCREDIT" } });
    expect(screen.getByLabelText("Raw connector response").querySelector("mark")).toHaveTextContent("copilotCredit");
    expect(screen.getByRole("checkbox", { name: "Wrap lines" })).toBeInTheDocument();
    expect(executeCostRequest).toHaveBeenCalledOnce();
  });

  it("rejects incomplete or malformed requests without calling the connector", () => {
    renderPage();
    choose("GetUserBalance");
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    expect(screen.getAllByText("userId is required.").length).toBeGreaterThan(0);
    choose("UpdateAlertSetting");
    enter("id (path)", "policy");
    enter("If-Match (header)", 'W/"7"');
    enter("body (body)", '{"thresholds":[{"@odata.type":"#microsoft.graph.percentageCostManagementAlertThreshold","value":101}]}');
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    expect(screen.getAllByText(/must be an integer from 1 to 100/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(executeCostRequest).not.toHaveBeenCalled();
  });

  it("requires exact typed write confirmation and submits the reviewed ETag/body snapshot", async () => {
    renderPage();
    choose("UpdateServiceSetting");
    enter("id (path)", "policy/one");
    enter("serviceId (path)", "workIQ");
    enter("If-Match (header)", 'W/"9"');
    enter("body (body)", '{"state":"disabled"}');
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/policy%2Fone/)).toHaveTextContent('"If-Match": "W/\\"9\\""');
    expect(within(dialog).getByText(/policy%2Fone/)).toHaveTextContent('"state": "disabled"');
    const confirm = within(dialog).getByRole("button", { name: "Confirm and run" });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "id (path)" })).toBeDisabled();
    expect(executeCostRequest).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Update service setting" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "UpdateServiceSetting" } });
    fireEvent.click(confirm);
    await screen.findByText("Succeeded");
    expect(executeCostRequest).toHaveBeenCalledExactlyOnceWith({
      actionId: "UpdateServiceSetting",
      parameters: { id: "policy/one", serviceId: "workIQ", "If-Match": 'W/"9"', body: { state: "disabled" } },
    }, true);
    choose("GetTenantCreditBalance");
    expect(screen.getByText("Submitted request").parentElement).toHaveTextContent("policy%2Fone");
  });

  it("cancels writes and requires new confirmation on every review", () => {
    renderPage();
    choose("DeleteSpendingPolicy");
    enter("id (path)", "policy");
    enter("If-Match (header)", 'W/"4"');
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox"), { target: { value: "DeleteSpendingPolicy" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    expect(within(screen.getByRole("dialog")).getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm and run" })).toBeDisabled();
    expect(executeCostRequest).not.toHaveBeenCalled();
  });

  it("filters routes/categories/read-only actions without executing hidden selections", () => {
    renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "Action category" }), { target: { value: "Group assignments" } });
    expect(screen.queryByRole("button", { name: "Run action" })).not.toBeInTheDocument();
    choose("RemoveAssignedGroup");
    fireEvent.click(screen.getByRole("checkbox", { name: "Read-only actions only" }));
    expect(screen.queryByRole("button", { name: "Review and run" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Find a Cost Management action" }), { target: { value: "$ref" } });
    expect(within(screen.getByRole("combobox", { name: /Action \(/ })).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: "Find a Cost Management action" }), { target: { value: "not-an-action" } });
    expect(screen.getByText(/No matching actions. Clear filters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(executeCostRequest).not.toHaveBeenCalled();
  });

  it("locks inputs and prevents duplicate calls while a request is running", async () => {
    let finish!: (value: CostResult) => void;
    executeCostRequest.mockImplementationOnce(() => new Promise<CostResult>((resolve) => { finish = resolve; }));
    renderPage();
    const run = screen.getByRole("button", { name: "Run action" });
    fireEvent.click(run);
    fireEvent.click(run);
    expect(executeCostRequest).toHaveBeenCalledOnce();
    expect(run).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Action category" })).toBeDisabled();
    await act(async () => finish({ ok: true, data: { success: true } }));
    await screen.findByText("Succeeded");
    expect(run).toBeEnabled();
  });

  it("shows failed calls with raw SDK evidence, submitted request and no persisted response", async () => {
    executeCostRequest.mockResolvedValueOnce({
      ok: false, error: "Stale ETag", data: { success: false, error: { code: "preconditionFailed", innerError: { code: "staleTag" } } },
    });
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await screen.findByText("Failed");
    expect(screen.getByText("Stale ETag")).toBeInTheDocument();
    expect(screen.getByLabelText("Raw connector response")).toHaveTextContent("staleTag");
    expect(screen.getByText("Submitted request")).toBeInTheDocument();
    unmount();
    renderPage();
    expect(screen.queryByLabelText("Raw connector response")).not.toBeInTheDocument();
    expect(executeCostRequest).toHaveBeenCalledOnce();
  });

  it("discloses the SDK's void creation response limitation and offers request schemas", () => {
    renderPage();
    choose("CreateServiceSetting");
    expect(screen.getByText(/generated service types this creation response as void/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert JSON template" })).toBeInTheDocument();
    expect(screen.getByText("Documented responses and schemas")).toBeInTheDocument();
    expect(executeCostRequest).not.toHaveBeenCalled();
  });

  it("registers the lazy playground route through the feature public API", async () => {
    render(<FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/cost-management-api"]}>
        <Suspense fallback="Loading route"><Routes>{costManagementApiRoutes()}</Routes></Suspense>
      </MemoryRouter>
    </FluentProvider>);
    expect(await screen.findByRole("heading", { name: "Cost Management API playground" })).toBeInTheDocument();
    expect(executeCostRequest).not.toHaveBeenCalled();
  });
});
