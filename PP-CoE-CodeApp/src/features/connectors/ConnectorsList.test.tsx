import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  ConnectorCatalog,
  ConnectorEntry,
} from "../../shared/connector-catalog";

vi.mock("../../shared/connector-catalog", () => ({
  loadCatalog: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  useConnectorCatalog: vi.fn(),
}));

vi.mock("../../utils/csv", () => ({
  rowsToCsv: vi.fn(() => "CSV_CONTENT"),
  downloadCsv: vi.fn(),
}));

import { ConnectorsList } from "./ConnectorsList";
import {
  loadCatalog,
  useConnectorCatalog,
} from "../../shared/connector-catalog";
import { downloadCsv, rowsToCsv } from "../../utils/csv";

const mockedUseCatalog = vi.mocked(useConnectorCatalog);
const mockedLoadCatalog = vi.mocked(loadCatalog);
const mockedDownloadCsv = vi.mocked(downloadCsv);
const mockedRowsToCsv = vi.mocked(rowsToCsv);

function entry(
  connectorId: string,
  overrides: Partial<ConnectorEntry> = {},
): ConnectorEntry {
  return {
    connectorId,
    displayName: connectorId,
    description: "",
    tier: "Standard",
    publisher: "Microsoft",
    releaseTag: "Production",
    isDeprecated: false,
    operations: [],
    ...overrides,
  };
}

function catalog(entries: ConnectorEntry[]): ConnectorCatalog {
  return {
    entries: new Map(entries.map((item) => [item.connectorId, item])),
    fetchedAt: Date.now(),
    source: "inventory",
    complete: true,
  };
}

function renderView() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/connectors"]}>
        <Routes>
          <Route path="/connectors" element={<ConnectorsList />} />
          <Route
            path="/connectors/:connectorId"
            element={<div>Connector detail route</div>}
          />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConnectorsList", () => {
  function manyConnectors(count = 61) {
    const entries = Array.from({ length: count }, (_, index) =>
      entry(`shared_test_${index}`, {
        displayName: `Connector ${String(index).padStart(3, "0")}`,
      }),
    );
    mockedUseCatalog.mockReturnValue({
      catalog: catalog(entries),
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    return entries;
  }

  it("renders 25 connectors per page, including a partial final page", async () => {
    manyConnectors();
    renderView();
    expect(screen.getAllByRole("row")).toHaveLength(26);
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(screen.queryByText("Connector 025")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Connector 025")).toBeInTheDocument();
    expect(screen.queryByText("Connector 000")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("row")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
  });

  it("sorts the entire catalog before slicing and resets paging on sort or filter", async () => {
    manyConnectors();
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("columnheader", { name: /Display name/i }));
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText("Connector 060")).toBeInTheDocument();
    expect(screen.queryByText("Connector 000")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByPlaceholderText(/Type to filter/i), {
      target: { value: "Connector 00" },
    });
    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(11);
  });

  it("exports the complete catalog and filtered results, not just the visible page", async () => {
    manyConnectors();
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /Export all/i }));
    expect(mockedRowsToCsv.mock.calls.at(-1)?.[0]).toHaveLength(61);
    fireEvent.change(screen.getByPlaceholderText(/Type to filter/i), {
      target: { value: "Connector" },
    });
    await userEvent.click(screen.getByRole("button", { name: /Export filtered/i }));
    expect(mockedRowsToCsv.mock.calls.at(-1)?.[0]).toHaveLength(61);
  });

  it("clamps the current page when a refreshed catalog shrinks", async () => {
    manyConnectors();
    const view = renderView();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    manyConnectors(2);
    view.rerender(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={["/connectors"]}>
          <Routes>
            <Route path="/connectors" element={<ConnectorsList />} />
            <Route path="/connectors/:connectorId" element={<div>Connector detail route</div>} />
          </Routes>
        </MemoryRouter>
      </FluentProvider>,
    );
    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("renders a loading state when the catalog is still loading", () => {
    mockedUseCatalog.mockReturnValue({
      catalog: undefined,
      status: "loading",
      error: "",
      classify: vi.fn(),
    });
    renderView();
    expect(screen.getByText(/Loading connector catalog/i)).toBeInTheDocument();
  });

  it("renders rich catalog metadata and summary counts", () => {
    mockedUseCatalog.mockReturnValue({
      catalog: catalog([
        entry("shared_sharepointonline", {
          displayName: "SharePoint",
          description: "SharePoint data",
          operations: [
            {
              operationId: "GetItems",
              displayName: "Get items",
              description: "",
              method: "GET",
            },
          ],
        }),
        entry("shared_sql", {
          displayName: "SQL Server",
          tier: "Premium",
          releaseTag: "Preview",
          isDeprecated: true,
        }),
      ]),
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();

    expect(screen.getByText("SharePoint")).toBeInTheDocument();
    expect(screen.getByText("SQL Server")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Deprecated")).toBeInTheDocument();
    expect(screen.getByText(/connectors in catalog/i)).toBeInTheDocument();
    expect(screen.getByText(/Inventory preview/i)).toBeInTheDocument();
  });

  it("calls loadCatalog({ force: true }) when Refresh is clicked", async () => {
    mockedUseCatalog.mockReturnValue({
      catalog: catalog([]),
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() =>
      expect(mockedLoadCatalog).toHaveBeenCalledWith({ force: true }),
    );
  });

  it("opens a connector detail route from its display name", async () => {
    mockedUseCatalog.mockReturnValue({
      catalog: catalog([
        entry("shared_sharepointonline", { displayName: "SharePoint" }),
      ]),
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "SharePoint" }));

    expect(screen.getByText("Connector detail route")).toBeInTheDocument();
  });

  it("exports all connector metadata to CSV", async () => {
    mockedUseCatalog.mockReturnValue({
      catalog: catalog([
        entry("shared_sql", {
          displayName: "SQL Server",
          description: "SQL data",
          tier: "Premium",
          operations: [
            {
              operationId: "ExecuteQuery",
              displayName: "Execute query",
              description: "",
              method: "POST",
            },
          ],
        }),
      ]),
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /Export all/i }));

    expect(mockedRowsToCsv).toHaveBeenCalledWith([
      {
        "Display name": "SQL Server",
        Description: "SQL data",
        Tier: "Premium",
        "Release stage": "Production",
        Deprecated: false,
        Publisher: "Microsoft",
        Operations: 1,
        "Connector id": "shared_sql",
      },
    ]);
    expect(mockedDownloadCsv).toHaveBeenCalledWith(
      "connectors",
      "CSV_CONTENT",
    );
  });

  it("filters across catalog metadata before exporting", async () => {
    mockedUseCatalog.mockReturnValue({
      catalog: catalog([
        entry("shared_sql", {
          displayName: "SQL Server",
          tier: "Premium",
          releaseTag: "Preview",
        }),
        entry("shared_sharepointonline", {
          displayName: "SharePoint",
        }),
      ]),
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();

    const exportFiltered = screen.getByRole("button", {
      name: /Export filtered/i,
    });
    expect(exportFiltered).toBeDisabled();
    await userEvent.type(
      screen.getByPlaceholderText(/Type to filter/i),
      "preview",
    );
    expect(exportFiltered).toBeEnabled();
    await userEvent.click(exportFiltered);
    expect(mockedDownloadCsv).toHaveBeenCalledWith(
      "connectors-filtered",
      "CSV_CONTENT",
    );
  });
});
