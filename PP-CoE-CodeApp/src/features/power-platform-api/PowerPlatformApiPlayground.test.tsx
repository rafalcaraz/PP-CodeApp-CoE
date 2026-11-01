import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

const { executeApiRequest } = vi.hoisted(() => ({ executeApiRequest: vi.fn() }));
vi.mock("./data", () => ({ executeApiRequest }));
import { apiOperations } from "./catalog";
import { PowerPlatformApiPlayground } from "./PowerPlatformApiPlayground";
import type { ApiResult } from "./types";

function renderPage() {
  return render(<FluentProvider theme={webLightTheme}><PowerPlatformApiPlayground /></FluentProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  executeApiRequest.mockResolvedValue({
    ok: true, data: { body: [{ limit: 100 }], raw: '[{"limit":100}]' },
  });
});

describe("Power Platform API playground", () => {
  it("opens on Resource Threshold without running the flow, and previews exact request values", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Power Platform API playground" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "API section" })).toHaveValue("Licensing");
    expect(screen.getByRole("combobox", { name: "Resource group" })).toHaveValue("Resource Threshold");
    expect(executeApiRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "entitlementId (path)" }), { target: { value: "MCSMessages" } });
    expect(screen.getByText(/https:\/\/api\.powerplatform\.com\/licensing\/entitlements\/MCSMessages/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run API request" }));
    await screen.findByText("Response received");
    expect(executeApiRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      parameters: { "path:entitlementId": "MCSMessages", "query:api-version": "2024-10-01" }, body: "",
    }), false);
    expect(screen.getByLabelText("API response body")).toHaveTextContent('"limit": 100');
  });

  it("does not call the flow when required inputs are missing", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run API request" }));
    expect(screen.getAllByText("entitlementId is required.").length).toBeGreaterThan(0);
    expect(executeApiRequest).not.toHaveBeenCalled();
  });

  it("requires request review and typed operation confirmation for upsert", async () => {
    const upsert = apiOperations.find((operation) => operation.title === "Upsert Resource Threshold");
    if (!upsert) throw new Error("Missing Upsert Resource Threshold.");
    renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: /API operation \(/ }), { target: { value: upsert.id } });
    for (const parameter of upsert.parameters.filter((entry) => entry.in === "path")) {
      fireEvent.change(screen.getByRole("textbox", { name: `${parameter.name} (path)` }), {
        target: { value: parameter.name === "entitlementId" ? "MCSMessages" : "test-target" },
      });
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Request body (JSON)" }), {
      target: { value: '{"limit":100,"notifyIfOverCapacity":true}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review API request" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/MCSMessages/)).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole("button", { name: "Confirm and run API request" });
    expect(confirmButton).toBeDisabled();
    expect(executeApiRequest).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: upsert.title } });
    fireEvent.click(confirmButton);
    await screen.findByText("Response received");
    expect(executeApiRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      operationId: upsert.id, body: '{"limit":100,"notifyIfOverCapacity":true}',
    }), true);
  });

  it("keeps all section and group choices browsable without making requests", () => {
    renderPage();
    const section = screen.getByRole("combobox", { name: "API section" });
    expect(within(section).getAllByRole("option").length).toBe(new Set(apiOperations.map((operation) => operation.section)).size + 1);
    fireEvent.change(section, { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "Run API request" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Find an API operation" }), { target: { value: "no-such-operation" } });
    expect(screen.getByText(/No operations match/)).toBeInTheDocument();
    expect(executeApiRequest).not.toHaveBeenCalled();
  });

  it("shows failed flow calls with their submitted request and raw evidence", async () => {
    executeApiRequest.mockResolvedValueOnce({
      ok: false, error: "Forbidden", data: { body: { error: "Forbidden" }, raw: '{"error":"Forbidden"}' },
    });
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "entitlementId (path)" }), { target: { value: "MCSMessages" } });
    fireEvent.click(screen.getByRole("button", { name: "Run API request" }));
    await screen.findByText("Failed");
    expect(screen.getByText("Forbidden")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Raw flow response" })).toBeInTheDocument();
    expect(screen.getByText("Submitted flow request")).toBeInTheDocument();
  });

  it("highlights response text and supports searching the raw flow output", async () => {
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "entitlementId (path)" }), { target: { value: "MCSMessages" } });
    fireEvent.click(screen.getByRole("button", { name: "Run API request" }));
    await screen.findByText("Response received");
    fireEvent.change(screen.getByRole("textbox", { name: "Search response" }), { target: { value: "LIMIT" } });
    expect(screen.getByLabelText("API response body").querySelector("mark")).toHaveTextContent("limit");
    fireEvent.click(screen.getByRole("tab", { name: "Raw flow response" }));
    expect(screen.getByLabelText("Raw flow response text").querySelector("mark")).toHaveTextContent("limit");
    expect(executeApiRequest).toHaveBeenCalledOnce();
  });

  it("locks request inputs and prevents duplicate flow calls while a request is running", async () => {
    let finish!: (result: ApiResult) => void;
    executeApiRequest.mockImplementationOnce(() => new Promise<ApiResult>((resolve) => { finish = resolve; }));
    renderPage();
    const entitlement = screen.getByRole("textbox", { name: "entitlementId (path)" });
    fireEvent.change(entitlement, { target: { value: "MCSMessages" } });
    const run = screen.getByRole("button", { name: "Run API request" });
    fireEvent.click(run);
    fireEvent.click(run);
    expect(executeApiRequest).toHaveBeenCalledOnce();
    expect(run).toBeDisabled();
    expect(entitlement).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "API section" })).toBeDisabled();
    await act(async () => finish({ ok: true, data: { body: [], raw: "[]" } }));
    expect(await screen.findByText("Response received")).toBeInTheDocument();
    expect(run).toBeEnabled();
  });
});
