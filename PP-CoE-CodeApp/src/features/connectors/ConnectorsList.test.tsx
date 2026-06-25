/**
 * Smoke test for ConnectorsList.
 *
 * Mocks the shared connector catalog so the test runs hermetically.
 * Asserts the loading/empty/loaded states and the Refresh button wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../shared/connector-catalog", () => ({
  loadCatalog: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  useConnectorCatalog: vi.fn(),
}));

vi.mock("../../utils/csv", () => ({
  rowsToCsv: vi.fn(() => "CSV_CONTENT"),
  downloadCsv: vi.fn(),
}));

import { ConnectorsList } from "../../features/connectors/ConnectorsList";
import {
  loadCatalog,
  useConnectorCatalog,
} from "../../shared/connector-catalog";
import { downloadCsv, rowsToCsv } from "../../utils/csv";

const mockedUseCatalog = vi.mocked(useConnectorCatalog);
const mockedLoadCatalog = vi.mocked(loadCatalog);
const mockedDownloadCsv = vi.mocked(downloadCsv);
const mockedRowsToCsv = vi.mocked(rowsToCsv);

function renderView() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/connectors"]}>
        <Routes>
          <Route path="/connectors" element={<ConnectorsList />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConnectorsList", () => {
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

  it("renders the catalog rows when loaded", () => {
    const entries = new Map([
      [
        "shared_sharepointonline",
        {
          connectorId: "shared_sharepointonline",
          displayName: "SharePoint",
          tier: "Standard",
          publisher: "Microsoft",
        },
      ],
      [
        "shared_sql",
        {
          connectorId: "shared_sql",
          displayName: "SQL Server",
          tier: "Premium",
          publisher: "Microsoft",
        },
      ],
    ]);
    mockedUseCatalog.mockReturnValue({
      catalog: { entries, fetchedAt: Date.now(), envId: "env-1" },
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();
    expect(screen.getByText("SharePoint")).toBeInTheDocument();
    expect(screen.getByText("SQL Server")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    // Summary line shows total catalog size.
    expect(screen.getByText(/connectors in catalog/i)).toBeInTheDocument();
  });

  it("calls loadCatalog({ force: true }) when Refresh is clicked", async () => {
    mockedUseCatalog.mockReturnValue({
      catalog: {
        entries: new Map(),
        fetchedAt: Date.now(),
        envId: "env-1",
      },
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

  it("exports all connectors to CSV when Export all is clicked", async () => {
    const entries = new Map([
      [
        "shared_sql",
        {
          connectorId: "shared_sql",
          displayName: "SQL Server",
          tier: "Premium",
          publisher: "Microsoft",
        },
      ],
    ]);
    mockedUseCatalog.mockReturnValue({
      catalog: { entries, fetchedAt: Date.now(), envId: "env-1" },
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /Export all/i }));

    // The serializer receives friendly-headered rows in grid order.
    expect(mockedRowsToCsv).toHaveBeenCalledWith([
      {
        "Display name": "SQL Server",
        Tier: "Premium",
        Publisher: "Microsoft",
        "Connector id": "shared_sql",
      },
    ]);
    expect(mockedDownloadCsv).toHaveBeenCalledWith("connectors", "CSV_CONTENT");
  });

  it("disables Export filtered until a filter is active, then exports the filtered set", async () => {
    const entries = new Map([
      [
        "shared_sql",
        {
          connectorId: "shared_sql",
          displayName: "SQL Server",
          tier: "Premium",
          publisher: "Microsoft",
        },
      ],
      [
        "shared_sharepointonline",
        {
          connectorId: "shared_sharepointonline",
          displayName: "SharePoint",
          tier: "Standard",
          publisher: "Microsoft",
        },
      ],
    ]);
    mockedUseCatalog.mockReturnValue({
      catalog: { entries, fetchedAt: Date.now(), envId: "env-1" },
      status: "ready",
      error: "",
      classify: vi.fn(),
    });
    renderView();

    const exportFiltered = screen.getByRole("button", {
      name: /Export filtered/i,
    });
    expect(exportFiltered).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText(/Type to filter/i), "sql");
    expect(exportFiltered).toBeEnabled();
    await userEvent.click(exportFiltered);

    expect(mockedRowsToCsv).toHaveBeenLastCalledWith([
      {
        "Display name": "SQL Server",
        Tier: "Premium",
        Publisher: "Microsoft",
        "Connector id": "shared_sql",
      },
    ]);
    expect(mockedDownloadCsv).toHaveBeenCalledWith(
      "connectors-filtered",
      "CSV_CONTENT",
    );
  });
});
