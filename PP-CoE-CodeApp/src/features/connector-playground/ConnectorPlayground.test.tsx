import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("ConnectorPlayground", () => {
  it("renders without calling connectors and runs only on demand", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Connector playground" })).toBeInTheDocument();
    expect(executeAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await screen.findByText("Succeeded");
    expect(executeAction).toHaveBeenCalledExactlyOnceWith({
      actionId: "ListEnvironmentGroups", parameters: { "api-version": "2024-10-01" },
    }, false);
    expect(screen.getByLabelText("JSON response")).toHaveTextContent("example");
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

  it("cancels a write without sending anything", () => {
    renderPage();
    chooseAction("ProvisionNewEnvironment");
    fireEvent.click(screen.getByRole("button", { name: "Review and run" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(executeAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows failed calls and their submitted request", async () => {
    executeAction.mockResolvedValueOnce({ ok: false, error: "Forbidden (403)" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await screen.findByText("Failed");
    expect(screen.getByText("Forbidden (403)")).toBeInTheDocument();
    expect(screen.getByText("Submitted request")).toBeInTheDocument();
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
