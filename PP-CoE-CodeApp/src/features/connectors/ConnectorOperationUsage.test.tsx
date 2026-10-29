import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router-dom";
import { createRef, type Ref } from "react";
import { toAppRow } from "../../data/inventory";

const { loadMock, csvMock, downloadMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  csvMock: vi.fn<(rows: Record<string, string>[]) => string>(() => "CSV"),
  downloadMock: vi.fn(),
}));
vi.mock("./data", async () => ({
  ...await vi.importActual<typeof import("./data")>("./data"),
  loadConnectorOperationUsage: loadMock,
}));
vi.mock("../../utils/csv", () => ({ rowsToCsv: csvMock, downloadCsv: downloadMock }));

import { ConnectorOperationUsage, type ConnectorOperationUsageHandle } from "./ConnectorOperationUsage";
import type { ConnectorEntry, ConnectorOperationRecord } from "./data";

const entry: ConnectorEntry = {
  connectorId: "shared_test",
  displayName: "Test connector",
  description: "",
  tier: "Standard",
  publisher: "Example",
  releaseTag: "Production",
  isDeprecated: false,
  operations: ["Read", "Delete"].map((id) => ({
    operationId: id, displayName: id, description: "", method: "POST",
  })),
};
function record(index: number, ids: string[] = ["Read"]): ConnectorOperationRecord {
  return {
    resource: {
      kind: "apps",
      row: toAppRow({
        name: `app-${index}`,
        type: "microsoft.powerapps/canvasapps",
        properties: { displayName: `App ${index}`, environmentId: "env-test", environmentName: "Example environment" },
      }),
    },
    operations: ids.map((operationId) => ({
      operationId, role: "action", isEnabled: operationId !== "Delete",
    })),
  };
}
function tree(ref?: Ref<ConnectorOperationUsageHandle>) {
  return (
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <ConnectorOperationUsage entry={entry} ref={ref} />
      </MemoryRouter>
    </FluentProvider>
  );
}
async function load() {
  await userEvent.click(screen.getByRole("button", { name: "Load reported usage" }));
  await screen.findByRole("button", { name: "Refresh reported usage" });
}
async function select(id: string) {
  await userEvent.click(screen.getByRole("combobox", { name: "Operations" }));
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: id }));
  await userEvent.keyboard("{Escape}");
}

beforeEach(() => {
  vi.clearAllMocks();
  loadMock.mockResolvedValue({ ok: true, data: [
    record(1, ["Read", "Delete"]), record(2), record(3, []),
  ] });
});

describe("ConnectorOperationUsage", () => {
  it("loads on demand, excludes reference-only resources, and labels disabled operations", async () => {
    render(tree());
    expect(loadMock).not.toHaveBeenCalled();
    await load();
    expect(screen.getByText(/2 resources match/)).toHaveTextContent("3 references inspected; 1 have no operation IDs reported");
    expect(screen.getByText("Delete (disabled)")).toBeInTheDocument();
    expect(screen.queryByText("App 3")).not.toBeInTheDocument();
  });

  it("matches any/all selected operations locally, including unlisted IDs, without rescanning", async () => {
    render(tree());
    await load();
    await select("Read");
    await select("Delete");
    expect(screen.getByText("App 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Operation match" }));
    await userEvent.click(screen.getByRole("option", { name: "All selected operations" }));
    expect(screen.queryByText("App 2")).not.toBeInTheDocument();
    expect(screen.getByText("App 1")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Operations" }), {
      target: { value: "UnlistedOperation" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add operation ID" }));
    expect(screen.getByText("No resources report matching operations on this connector.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear operations" }));
    expect(screen.getByText("App 2")).toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("paginates 25 matching resources and exports all matching pages with operation evidence", async () => {
    loadMock.mockResolvedValue({ ok: true, data: Array.from({ length: 27 }, (_, i) => record(i + 1)) });
    render(tree());
    await load();
    expect(screen.getAllByRole("row")).toHaveLength(26);
    await userEvent.click(screen.getByRole("button", { name: "Next results" }));
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("App 27")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Export matching resources" }));
    expect(csvMock.mock.calls[0][0]).toHaveLength(27);
    expect(csvMock.mock.calls[0][0][0]).toMatchObject({ "Reported operations": "Read" });
    expect(downloadMock).toHaveBeenCalledWith("connector-shared_test-direct-operations", "CSV");
    await select("Delete");
    expect(screen.getByText("No resources report matching operations on this connector.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export matching resources" })).toBeDisabled();
  });

  it("filters by category and exports only that category", async () => {
    render(tree());
    await load();
    await userEvent.click(screen.getByRole("combobox", { name: "Operation usage resource category" }));
    await userEvent.click(screen.getByRole("option", { name: "Agents" }));
    expect(screen.getByText("No resources report matching operations on this connector.")).toBeInTheDocument();
  });

  it("surfaces failures without partial success and allows retry", async () => {
    loadMock.mockResolvedValueOnce({ ok: false, error: "Inventory permission denied" });
    render(tree());
    await userEvent.click(screen.getByRole("button", { name: "Load reported usage" }));
    expect(await screen.findByText("Inventory permission denied")).toBeInTheDocument();
    expect(screen.queryByText(/resources match:/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/2 resources match/)).toBeInTheDocument();
  });

  it("reuses the scan for successive catalog-operation shortcuts and refreshes explicitly", async () => {
    const ref = createRef<ConnectorOperationUsageHandle>();
    render(tree(ref));
    act(() => ref.current?.find("Read"));
    await screen.findByText(/2 resources match/);
    act(() => ref.current?.find("Delete"));
    expect(await screen.findByRole("button", { name: "Remove Delete" })).toBeInTheDocument();
    expect(screen.queryByText("App 2")).not.toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledTimes(1);
    loadMock.mockResolvedValue({ ok: true, data: [] });
    await userEvent.click(screen.getByRole("button", { name: "Refresh reported usage" }));
    expect(await screen.findByText(/0 resources match/)).toBeInTheDocument();
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending scan when the connector view unmounts", async () => {
    let finish!: (value: { ok: true; data: ConnectorOperationRecord[] }) => void;
    loadMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(tree());
    await userEvent.click(screen.getByRole("button", { name: "Load reported usage" }));
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
    const signal: AbortSignal = loadMock.mock.calls[0][1];
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, data: [] }));
  });
});
