import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router-dom";
const { getDailyUsage, getFundingUsage, investigateUser, listRequests, getRequest, decideRequests } = vi.hoisted(() => ({
  getDailyUsage: vi.fn(), getFundingUsage: vi.fn(), investigateUser: vi.fn(), listRequests: vi.fn(), getRequest: vi.fn(), decideRequests: vi.fn(),
}));
vi.mock("./usageData", () => ({ getDailyUsage, getFundingUsage, investigateUser }));
vi.mock("./requestData", () => ({ listRequests, getRequest, decideRequests }));
vi.mock("recharts", async (importOriginal) => ({
  ...await importOriginal<typeof import("recharts")>(),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
import { CostControls } from "./CostControls";
import type { Result } from "./data";
import type { UsagePage } from "./usageData";

function open(path = "/cost-controls/reporting") {
  return render(<FluentProvider theme={webLightTheme}><MemoryRouter initialEntries={[path]}><CostControls /></MemoryRouter></FluentProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  getDailyUsage.mockImplementation(async (dimension: string, day: string) => ({ ok: true, raw: {}, data: { dimension, day, value: [{ entityId: "workIQ", consumedQuantity: 0.0001, unit: "copilotCredit" }], nextLink: "opaque", count: 200 } }));
  getFundingUsage.mockResolvedValue({ ok: true, raw: {}, data: { value: [{ id: "overage", fundingClass: "overage", consumedQuantity: 2, unit: "copilotCredit", dataStatus: { latestSourceDateTime: null } }, { id: "future", fundingClass: "future", unit: "futureUnit" }] } });
  investigateUser.mockResolvedValue({ ok: true, raw: {}, data: {
    detail: { ok: false, error: "404 usageDataUnavailable" },
    services: { ok: true, data: { value: [{ id: "workIQ", consumedQuantity: 2, unit: "copilotCredit" }] }, raw: {} },
    sessions: { ok: true, data: { value: [{ id: "window-scoped", sourceSessionId: null, firstActivityDateTime: null }], "@odata.nextLink": "opaque" }, raw: {} },
  } });
  listRequests.mockResolvedValue({ ok: true, raw: {}, data: { value: [
    { id: "r1", state: "pending", serviceId: "workIQ", requestedBy: { user: { displayName: "Example user" } } },
    { id: "r2", state: "pending", serviceId: "cowork" },
    { id: "r3", state: "unknownFutureValue" },
  ], "@odata.nextLink": "opaque", "@odata.count": 150 } });
  getRequest.mockImplementation(async (id: string) => ({ ok: true, raw: {}, data: { id, state: "pending", serviceId: "workIQ", "@odata.etag": '"7"' } }));
  decideRequests.mockResolvedValue({ ok: true, raw: {}, data: { succeededCount: 1, failedCount: 1, responses: [{ requestId: "r1", status: "succeeded" }, { requestId: "r2", status: "preconditionFailed", message: "Stale ETag" }] } });
});

describe("historical MAC reporting", () => {
  it("makes history primary, separates MAC/PPAC and runs reads only after loading a selection", async () => {
    open();
    expect(screen.getByRole("tab", { name: "Usage" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/PPAC-managed Copilot Studio consumption is a separate source/)).toBeInTheDocument();
    expect(getDailyUsage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("UTC day"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Load daily usage" }));
    const table = await screen.findByRole("table", { name: /MAC daily services/ });
    expect(table).toHaveTextContent("0.0001");
    expect(getDailyUsage).toHaveBeenCalledExactlyOnceWith("services", "2026-01-01");
    expect(screen.getByText(/Partial page: more rows exist/)).toBeInTheDocument();
    expect(screen.getByText(/not a tenant consumption total/)).toHaveTextContent("200");
    fireEvent.change(screen.getByLabelText("UTC day"), { target: { value: "2026-01-02" } });
    expect(screen.getByText(/previous loaded result; controls have not been applied/)).toHaveTextContent("2026-01-01");
    expect(getDailyUsage).toHaveBeenCalledOnce();
    expect(decideRequests).not.toHaveBeenCalled();
  });
  it("retains prior-period results on refresh failure and discards an unmounted report response", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Load daily usage" }));
    await screen.findByRole("table");
    getDailyUsage.mockResolvedValueOnce({ ok: false, error: "503 source unavailable" });
    fireEvent.click(screen.getByRole("button", { name: "Load daily usage" }));
    await screen.findAllByText(/503 source unavailable/);
    expect(screen.getByRole("table")).toHaveTextContent("0.0001");
    expect(screen.getByText(/previous successful result remains/)).toBeInTheDocument();
    let finish!: (value: Result<UsagePage>) => void;
    getDailyUsage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Load daily usage" }));
    fireEvent.click(screen.getByRole("tab", { name: "Funding by month" }));
    await act(async () => finish({ ok: true, raw: {}, data: { dimension: "services", day: "2026-01-01", value: [{ entityId: "stale-result" }] } }));
    expect(screen.queryByText("stale-result")).not.toBeInTheDocument();
  });
  it("shows unbilled funding, unknown values and missing freshness without making up currency or a closed month", async () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "Funding by month" }));
    expect(getFundingUsage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load funding usage" }));
    const table = await screen.findByRole("table", { name: /reported funding classes/ });
    expect(table).toHaveTextContent("overage (unbilled)");
    expect(table).toHaveTextContent("futureUnit");
    expect(table).toHaveTextContent("Source time not reported");
    expect(screen.getByText(/not evidence that the month is closed/)).toBeInTheDocument();
  });
  it("drills a selected user into its exact raw window and keeps partial child failures and native IDs distinct", async () => {
    getDailyUsage.mockResolvedValueOnce({ ok: true, raw: {}, data: { dimension: "users", day: "2026-01-01", value: [{ entityId: "user-1", consumedQuantity: 8, unit: "copilotCredit", sessionCount: 3 }] } });
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Report dimension" }), { target: { value: "users" } });
    fireEvent.change(screen.getByLabelText("UTC day"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Load daily usage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Investigate user" }));
    expect(screen.getByRole("textbox", { name: "Historical directory user ID" })).toHaveValue("user-1");
    expect(investigateUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load user usage" }));
    expect((await screen.findAllByText(/404 usageDataUnavailable/)).length).toBeGreaterThan(0);
    expect(investigateUser).toHaveBeenCalledExactlyOnceWith("user-1", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z");
    expect(screen.getByRole("table", { name: /Raw service breakdown/ })).toHaveTextContent("workIQ");
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByText(/Partial session page/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Loaded raw sessions/ });
    expect(table).toHaveTextContent("window-scoped");
    expect(table).toHaveTextContent("Native source session ID");
    expect(table).toHaveTextContent("Not reported");
  });
});

describe("reviewed credit requests", () => {
  beforeEach(() => {
    // Without layout, Tabster treats jsdom's zero-sized body as a hidden iframe.
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1440, 900));
    vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (this: HTMLElement) {
      if (!this.isConnected || this.hidden || getComputedStyle(this).display === "none") return null;
      for (let element = this.parentElement; element; element = element.parentElement) {
        if (element.hidden || getComputedStyle(element).display === "none") return null;
      }
      return this.parentElement;
    });
  });
  afterEach(() => vi.restoreAllMocks());
  async function queue() {
    open("/cost-controls/management");
    fireEvent.click(screen.getByRole("tab", { name: "Credit requests" }));
    await screen.findByRole("checkbox", { name: "Select request r1" });
  }
  it("rereads before review, requires explicit confirmation, exposes partial HTTP-200 results and does not retry", async () => {
    await queue();
    expect(screen.getByRole("checkbox", { name: "Select request r3" })).toBeDisabled();
    expect(screen.getByText(/Partial queue: more requests exist/)).toBeInTheDocument();
    for (const id of ["r1", "r2"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select request ${id}` }));
    fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
    const dialog = await screen.findByRole("dialog");
    expect(getRequest).toHaveBeenCalledTimes(2);
    expect(decideRequests).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole("button", { name: "Confirm decisions" })).toBeDisabled();
    expect(within(dialog).getByText(/It does not allocate credits/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "approved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm decisions" }));
    expect(await screen.findByText(/Partial or failed batch/)).toHaveTextContent("1 succeeded, 1 failed");
    expect(screen.getByRole("table", { name: /Results of the last reviewed batch/ })).toHaveTextContent("Stale ETag");
    expect(decideRequests).toHaveBeenCalledExactlyOnceWith([{ requestId: "r1", state: "approved", etag: '"7"' }, { requestId: "r2", state: "approved", etag: '"7"' }], true);
    expect(listRequests).toHaveBeenCalledTimes(2);
  });
  it("blocks missing/weak tokens before opening confirmation and allows cancellation with no write", async () => {
    await queue();
    getRequest.mockResolvedValueOnce({ ok: true, raw: {}, data: { id: "r1", state: "pending", "@odata.etag": 'W/"7"' } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select request r1" }));
    fireEvent.click(screen.getByRole("button", { name: "Review rejection" }));
    await screen.findByText(/quoted strong request ETag/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review rejection" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Cancel" }));
    expect(decideRequests).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review rejection" })).toHaveFocus());
  });
  it("surfaces permission failures rather than empty queues and supports known-ID reads", async () => {
    listRequests.mockResolvedValueOnce({ ok: false, error: "403 missing CreditReq consent" });
    open("/cost-controls/management");
    fireEvent.click(screen.getByRole("tab", { name: "Credit requests" }));
    await screen.findAllByText(/403 missing CreditReq consent/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Known credit request ID" }), { target: { value: "r-known" } });
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(await screen.findByRole("table")).toHaveTextContent("r-known");
    expect(getRequest).toHaveBeenCalledExactlyOnceWith("r-known");
    expect(decideRequests).not.toHaveBeenCalled();
  });
});
