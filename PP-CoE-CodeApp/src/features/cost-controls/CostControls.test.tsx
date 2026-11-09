import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Routes } from "react-router-dom";
import type { Quantity } from "../../generated/models/CostControsl_CustomConnModel";
import { CostControls } from "./CostControls";
import { PolicyDetails } from "./PolicyDetails";
import { costControlsRoutes } from "./index";
import type { PolicyContext, Result } from "./data";

const { getTenantBalance, getUserBalance, listPolicies, loadPolicy, applyChange, createPolicy } = vi.hoisted(() => ({
  getTenantBalance: vi.fn(), getUserBalance: vi.fn(), listPolicies: vi.fn(), loadPolicy: vi.fn(),
  applyChange: vi.fn(), createPolicy: vi.fn(),
}));
vi.mock("@microsoft/power-apps/data", () => ({ getClient: () => ({ executeAsync: vi.fn() }) }));
vi.mock("./data", async (importOriginal) => ({
  ...await importOriginal<typeof import("./data")>(),
  getTenantBalance, getUserBalance, listPolicies, loadPolicy, applyChange, createPolicy,
}));
vi.mock("recharts", async (importOriginal) => ({
  ...await importOriginal<typeof import("recharts")>(),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const quantity: Quantity = { "@odata.type": "#microsoft.graph.limitedCostManagementQuantity", unit: "copilotCredit", value: 100 };
function makeContext(): PolicyContext {
  return {
    id: "p", policy: { ok: true, data: { id: "p", displayName: "Example policy", "@odata.type": "#microsoft.graph.selectedGroupsSpendingPolicy", status: "enabled", periodLimit: quantity, perUserLimit: quantity }, raw: {} },
    services: { ok: true, data: { value: [{ serviceId: "workIQ", state: "enabled", parentEtag: 'W/"7"' }, { serviceId: "cowork", state: "enabled", parentEtag: 'W/"7"' }] }, raw: {} },
    groups: { ok: true, data: { value: [{ id: "g", displayName: "Example group" }, { id: "g2", displayName: "Second group" }] }, raw: {} },
    alerts: { ok: true, data: { isEnabled: false, thresholds: [{ "@odata.type": "#microsoft.graph.percentageCostManagementAlertThreshold", value: 80 }] }, raw: {} },
    recipients: { ok: true, data: { value: [{ id: "u", displayName: "Example recipient" }] }, raw: {} },
  };
}
function renderArea(path = "/cost-controls/reporting") {
  const view = render(<FluentProvider theme={webLightTheme}><MemoryRouter initialEntries={[path]}><CostControls /></MemoryRouter></FluentProvider>);
  if (path === "/cost-controls/reporting") fireEvent.click(screen.getByRole("tab", { name: "Current balances" }));
  return view;
}
function input(label: string, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}
async function openPolicy() {
  renderArea("/cost-controls/management");
  fireEvent.click(await screen.findByRole("button", { name: "Example policy (enabled)" }));
  await screen.findByRole("heading", { name: "Example policy" });
}
function confirm(title: string) {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: title } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  getTenantBalance.mockResolvedValue({ ok: true, data: { billingMethodBalances: [
    { billingMethod: "prepaidCredits", consumedQuantity: 0, purchasedQuantity: 100, remainingQuantity: 75, unit: "copilotCredit" },
    { billingMethod: "payAsYouGo", consumedQuantity: 0.0001, unit: "copilotCredit" },
  ] }, raw: { source: "mock SDK" } });
  getUserBalance.mockResolvedValue({ ok: true, data: { id: "u", serviceBalances: [], unevaluatedServices: [] }, raw: {} });
  listPolicies.mockResolvedValue({ ok: true, data: { value: [{ id: "p", displayName: "Example policy", status: "enabled" }] }, raw: {} });
  loadPolicy.mockResolvedValue(makeContext());
  applyChange.mockResolvedValue({ ok: true, data: undefined, raw: { success: true } });
  createPolicy.mockResolvedValue({ ok: true, data: undefined, raw: { success: true } });
});

describe("read-only Cost Controls reporting", () => {
  it("separates reporting from management and displays truthful chart/table data without any writes", async () => {
    renderArea();
    expect(await screen.findByRole("table", { name: "Authoritative billing-method balances" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Consumed and remaining/ })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("0.0001");
    expect(table).toHaveTextContent("Not reported");
    expect(table).toHaveTextContent("75");
    expect(table).toHaveTextContent("Source time not reported");
    expect(screen.getByText(/Remaining credits are calculated by the service/)).toBeInTheDocument();
    expect(screen.getByText(/Use Usage or User investigation for history/)).toBeInTheDocument();
    expect(getTenantBalance).toHaveBeenCalledOnce();
    expect(getUserBalance).not.toHaveBeenCalled();
    expect(listPolicies).not.toHaveBeenCalled();
    expect(applyChange).not.toHaveBeenCalled();
    expect(createPolicy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Management" }));
    await screen.findByRole("button", { name: "Example policy (enabled)" });
    expect(screen.queryByRole("table", { name: "Authoritative billing-method balances" })).not.toBeInTheDocument();
  });
  it("checks a known user only on demand and exposes partial/paged diagnostics", async () => {
    getUserBalance.mockResolvedValueOnce({ ok: true, raw: {}, data: {
      id: "u", selectionDataStatus: { evaluatedDateTime: "2026-01-01T00:00:00Z" },
      serviceBalances: [{ serviceId: "workIQ", spendingPolicyId: "p", consumedQuantity: 10, remainingQuantity: quantity,
        configuredPerUserLimit: quantity, configuredPeriodLimit: quantity, isConsumptionAllowed: false, accessDecisionReason: "limitExhausted", unit: "copilotCredit" }],
      unevaluatedServices: [{ serviceId: "cowork", reason: "upstreamFailure" }],
      "serviceBalances@odata.nextLink": "https://graph.microsoft.com/opaque",
    } });
    renderArea();
    input("Directory user ID", " u ");
    expect(getUserBalance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check user consumption" }));
    expect(await screen.findByText("Partial results: some services could not be evaluated")).toBeInTheDocument();
    expect(getUserBalance).toHaveBeenCalledExactlyOnceWith("u");
    expect(screen.getByRole("table", { name: /Month-to-date service balances/ })).toHaveTextContent("Blocked: limitExhausted");
    expect(screen.getByText(/cowork: upstreamFailure/)).toBeInTheDocument();
    expect(screen.getByText(/More user-service rows exist/)).toBeInTheDocument();
    expect(applyChange).not.toHaveBeenCalled();
  });
  it("surfaces read errors and empty data without converting them to zero", async () => {
    getTenantBalance.mockResolvedValueOnce({ ok: false, error: "403 missing permission" });
    const { unmount } = renderArea();
    expect(await screen.findByText("403 missing permission")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    unmount();
    getTenantBalance.mockResolvedValueOnce({ ok: true, data: {}, raw: {} });
    renderArea();
    expect(await screen.findByText(/No billing-method balances were returned/)).toBeInTheDocument();
    getUserBalance.mockResolvedValueOnce({ ok: false, error: "503 no source available" });
    input("Directory user ID", "u");
    fireEvent.click(screen.getByRole("button", { name: "Check user consumption" }));
    expect(await screen.findByText("503 no source available")).toBeInTheDocument();
  });
  it("locks duplicate reads and stores no reporting response across mounts", async () => {
    let finish!: (value: Result<{ billingMethodBalances: [] }>) => void;
    getTenantBalance.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = renderArea();
    const refresh = screen.getByRole("button", { name: "Refresh snapshot" });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(getTenantBalance).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: true, data: { billingMethodBalances: [] }, raw: {} }));
    await screen.findByText(/No billing-method balances were returned/);
    unmount();
    renderArea();
    expect(screen.queryByText("No billing-method balances were returned.")).not.toBeInTheDocument();
    await screen.findByRole("table");
    expect(getTenantBalance).toHaveBeenCalledTimes(2);
  });
});

describe("guided policy management", () => {
  it("renders incomplete collection warning and supports opening a known policy without making writes", async () => {
    listPolicies.mockResolvedValueOnce({ ok: true, raw: {}, data: { value: [], "@odata.nextLink": "opaque" } });
    renderArea("/cost-controls/management");
    await screen.findByText(/More policies exist/);
    input("Open a known policy ID", " p ");
    fireEvent.click(screen.getByRole("button", { name: "Open policy" }));
    await screen.findByRole("heading", { name: "Example policy" });
    expect(loadPolicy).toHaveBeenCalledExactlyOnceWith("p");
    expect(applyChange).not.toHaveBeenCalled();
    expect(createPolicy).not.toHaveBeenCalled();
  });
  it("blocks existing-policy writes without a parent token and surfaces partial children", async () => {
    const context = makeContext();
    context.services = { ok: false, error: "403 no service permission" };
    context.alerts = { ok: false, error: "404 alert not found" };
    loadPolicy.mockResolvedValue(context);
    await openPolicy();
    expect(screen.getByText(/No usable parent ETag/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit limits and funding" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    expect(screen.getByText("403 no service permission")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review service addition" })).toBeDisabled();
    expect(applyChange).not.toHaveBeenCalled();
  });
  it("reviews an immutable policy edit, cancels safely and requires exact confirmation", async () => {
    await openPolicy();
    fireEvent.click(screen.getByRole("button", { name: "Edit limits and funding" }));
    input("Policy name", "Changed policy");
    fireEvent.click(screen.getByRole("button", { name: "Review policy" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/"displayName": "Changed policy"/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Policy name" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Confirm change" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(applyChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review policy" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toHaveValue("");
    confirm("Update policy limits and funding");
    await screen.findByText(/Update policy limits and funding completed/);
    expect(applyChange).toHaveBeenCalledExactlyOnceWith("p", 'W/"7"', {
      kind: "updatePolicy", body: { displayName: "Changed policy", periodLimit: quantity, perUserLimit: quantity },
    }, true);
    expect(loadPolicy).toHaveBeenCalledTimes(2);
    expect(listPolicies).toHaveBeenCalledTimes(2);
  });
  it("locks duplicate writes, retains the submitted snapshot, refreshes errors and never retries", async () => {
    let finish!: (value: Result<unknown>) => void;
    applyChange.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await openPolicy();
    fireEvent.click(screen.getByRole("button", { name: "Review policy deletion" }));
    confirm("Delete spending policy");
    expect(applyChange).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Create policy" })).toBeDisabled();
    await act(async () => finish({ ok: false, error: "412 stale ETag", raw: { success: false } }));
    await screen.findAllByText(/412 stale ETag/);
    expect(applyChange).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Inspect submitted change and SDK response")).toHaveTextContent('"kind": "deletePolicy"');
    expect(loadPolicy).toHaveBeenCalledTimes(2);
  });
  it("refreshes after a write even when an older list read is still in flight", async () => {
    await openPolicy();
    let finish!: (value: Result<{ value: [] }>) => void;
    listPolicies.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh policies" }));
    await screen.findByRole("heading", { name: "Example policy" });
    fireEvent.click(screen.getByRole("button", { name: "Review policy deletion" }));
    confirm("Delete spending policy");
    await waitFor(() => expect(applyChange).toHaveBeenCalledOnce());
    expect(listPolicies).toHaveBeenCalledTimes(2);
    await act(async () => finish({ ok: true, data: { value: [] }, raw: {} }));
    await waitFor(() => expect(listPolicies).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Create policy" })).not.toBeDisabled();
  });
  it("creates with explicit review, finite zero/unlimited quantities, flags and initial service", async () => {
    renderArea("/cost-controls/management");
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));
    input("Policy name", "New spending policy");
    input("Monthly policy limit (Copilot Credits)", "0");
    input("Initial service category ID", "workIQ");
    fireEvent.click(screen.getByRole("checkbox", { name: "Prepaid credits" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay as you go" }));
    fireEvent.click(screen.getByRole("button", { name: "Review policy" }));
    expect(createPolicy).not.toHaveBeenCalled();
    confirm("Create spending policy");
    await screen.findByText(/Policy creation completed/);
    expect(createPolicy).toHaveBeenCalledExactlyOnceWith({
      "@odata.type": "#microsoft.graph.selectedGroupsSpendingPolicy", displayName: "New spending policy",
      periodLimit: { ...quantity, value: 0 },
      perUserLimit: { "@odata.type": "#microsoft.graph.unlimitedCostManagementQuantity", unit: "copilotCredit" },
      billingMethods: "prepaidCredits,payAsYouGo",
      serviceSettings: [{ serviceId: "workIQ", state: "enabled" }],
    }, true);
    expect(screen.getByText(/SDK does not expose a typed creation body/)).toBeInTheDocument();
  });
  it("validates creation fields and does not open a review for invalid inputs", async () => {
    renderArea("/cost-controls/management");
    await screen.findByRole("button", { name: "Example policy (enabled)" });
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));
    input("Policy name", "short");
    input("Monthly policy limit (Copilot Credits)", "10");
    input("Initial service category ID", "workIQ");
    fireEvent.click(screen.getByRole("button", { name: "Review policy" }));
    expect(screen.getByRole("alert")).toHaveTextContent("10-64");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    input("Policy name", "New spending policy");
    input("Monthly policy limit (Copilot Credits)", "abc");
    fireEvent.click(screen.getByRole("button", { name: "Review policy" }));
    expect(screen.getByRole("alert")).toHaveTextContent("finite credit limit");
    expect(createPolicy).not.toHaveBeenCalled();
  });
  it.each([
    { tab: "Audience", label: "Directory group ID", value: "g-new", button: "Review group addition", title: "Add group to policy", change: { kind: "addGroup", groupId: "g-new" } },
    { tab: "Services", label: "Service category ID", value: "newService", button: "Review service addition", title: "Add governed service", change: { kind: "addService", serviceId: "newService", state: "enabled" } },
    { tab: "Notifications", label: "Recipient directory user ID", value: "newUser", button: "Review recipient addition", title: "Add alert recipient", change: { kind: "addRecipient", userId: "newUser" } },
  ])("$tab guides the reference/child action through review and refresh", async ({ tab, label, value, button, title, change }) => {
    await openPolicy();
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    input(label, value);
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(applyChange).not.toHaveBeenCalled();
    confirm(title);
    await screen.findByText(`${title} completed. Current policy data has been refreshed.`);
    expect(applyChange).toHaveBeenCalledExactlyOnceWith("p", 'W/"7"', change, true);
  });
  it("builds percentage or absolute thresholds, distinguishes preserve/clear and requires recipients to enable", async () => {
    await openPolicy();
    fireEvent.click(screen.getByRole("tab", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Replace configured thresholds" }));
    input("Percentages (1-100)", "101");
    fireEvent.click(screen.getByRole("button", { name: "Save notification settings" }));
    expect(screen.getByText(/must be an integer from 1 to 100/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Threshold type" }), { target: { value: "absolute" } });
    input("Positive credit quantities", "25, 50");
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable email notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Save notification settings" }));
    confirm("Save notification settings");
    await screen.findByText(/Save notification settings completed/);
    expect(applyChange).toHaveBeenCalledWith("p", 'W/"7"', { kind: "updateAlert", body: { isEnabled: true, thresholds: [
      { "@odata.type": "#microsoft.graph.absoluteCostManagementAlertThreshold", value: 25, unit: "copilotCredit" },
      { "@odata.type": "#microsoft.graph.absoluteCostManagementAlertThreshold", value: 50, unit: "copilotCredit" },
    ] } }, true);
  });
  it("keeps policy lifecycle, last groups and last enabled services safe", () => {
    const context = makeContext();
    if (context.groups?.ok) context.groups.data.value = [{ id: "g" }];
    if (context.services.ok) context.services.data.value = [{ serviceId: "workIQ", state: "enabled", parentEtag: 'W/"7"' }];
    const onReview = vi.fn();
    render(<FluentProvider theme={webLightTheme}><PolicyDetails context={context} locked={false} onReview={onReview} /></FluentProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Audience" }));
    expect(screen.getByRole("button", { name: "Remove group" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    fireEvent.click(screen.getByRole("button", { name: "Exclude service" }));
    expect(screen.getByText("Keep at least one service enabled on the policy.")).toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
  });
  it("does not confuse an old policy response with a newer selected ID", async () => {
    let finish!: (value: PolicyContext) => void;
    loadPolicy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderArea("/cost-controls/management");
    fireEvent.click(await screen.findByRole("button", { name: "Example policy (enabled)" }));
    input("Open a known policy ID", "second");
    const second = makeContext();
    second.id = "second";
    if (second.policy.ok) second.policy.data.displayName = "Second spending policy";
    loadPolicy.mockResolvedValueOnce(second);
    fireEvent.click(screen.getByRole("button", { name: "Open policy" }));
    await screen.findByRole("heading", { name: "Second spending policy" });
    await act(async () => finish(makeContext()));
    expect(screen.queryByRole("heading", { name: "Example policy" })).not.toBeInTheDocument();
  });
});

describe("public Cost Controls routes", () => {
  it.each(["/cost-controls", "/cost-controls/reporting", "/cost-controls/management"])("registers %s", async (path) => {
    render(<FluentProvider theme={webLightTheme}><MemoryRouter initialEntries={[path]}>
      <Suspense fallback="Loading route"><Routes>{costControlsRoutes()}</Routes></Suspense>
    </MemoryRouter></FluentProvider>);
    await screen.findByRole("heading", { name: "Cost Controls" });
    if (path.endsWith("/management")) await waitFor(() => expect(listPolicies).toHaveBeenCalled());
    else {
      expect(screen.getByRole("heading", { name: "Daily credit usage" })).toBeInTheDocument();
      expect(getTenantBalance).not.toHaveBeenCalled();
    }
    expect(applyChange).not.toHaveBeenCalled();
  });
});
