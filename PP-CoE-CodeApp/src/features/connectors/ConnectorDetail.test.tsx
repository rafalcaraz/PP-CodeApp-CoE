import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const {
  getConnectorDetailMock,
  loadConnectorUsageSummaryMock,
  listConnectorUsagePageMock,
  exportConnectorUsageMock,
  downloadCsvMock,
  rowsToCsvMock,
} = vi.hoisted(() => ({
  getConnectorDetailMock: vi.fn(),
  loadConnectorUsageSummaryMock: vi.fn(),
  listConnectorUsagePageMock: vi.fn(),
  exportConnectorUsageMock: vi.fn(),
  downloadCsvMock: vi.fn(),
  rowsToCsvMock: vi.fn(() => "CSV_CONTENT"),
}));

vi.mock("./data", () => ({
  getConnectorDetail: getConnectorDetailMock,
  loadConnectorUsageSummary: loadConnectorUsageSummaryMock,
  listConnectorUsagePage: listConnectorUsagePageMock,
  exportConnectorUsage: exportConnectorUsageMock,
  shortResourceType: (type: string) =>
    type.includes("canvasapps") ? "Canvas app" : type,
}));

vi.mock("../../utils/csv", () => ({
  downloadCsv: downloadCsvMock,
  rowsToCsv: rowsToCsvMock,
}));

import { ConnectorDetail } from "./ConnectorDetail";
import type { ConnectorUsageRecord } from "./data";

function appRecord(index: number): ConnectorUsageRecord {
  return {
    kind: "apps",
    row: {
      id: `app-${index}`,
      type: "microsoft.powerapps/canvasapps",
      displayName: `App ${index}`,
      environmentId: "env-1",
      environmentName: "Production",
      ownerId: "owner-1",
      ownerDisplayName: "Adele Vance",
      createdAt: "",
      createdBy: "",
      lastModifiedAt: "2026-05-01T00:00:00Z",
      lastModifiedBy: "",
      lastLaunchedAt: "",
      appType: "",
      subType: "",
      region: "",
      tenantId: "",
      isFeatured: false,
      bypassConsent: false,
      isQuarantined: false,
      sharedUsersCount: 0,
      sharedGroupsCount: 0,
      logicalName: "",
      appModuleId: "",
      connectors: [],
    },
  };
}

function renderView() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/connectors/shared_sql"]}>
        <Routes>
          <Route
            path="/connectors/:connectorId"
            element={<ConnectorDetail />}
          />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getConnectorDetailMock.mockResolvedValue({
    ok: true,
    data: {
      entry: {
        connectorId: "shared_sql",
        displayName: "SQL Server",
        description: "Connect to SQL Server data.",
        tier: "Premium",
        publisher: "Microsoft",
        releaseTag: "Production",
        isDeprecated: false,
        operations: [
          {
            operationId: "ExecuteQuery",
            displayName: "Execute query",
            description: "Runs a SQL query.",
            method: "POST",
          },
        ],
      },
      source: "inventory",
      complete: true,
    },
  });
  loadConnectorUsageSummaryMock.mockResolvedValue({
    ok: true,
    data: { total: 24, apps: 16, flows: 5, agents: 3, environments: 4 },
  });
  listConnectorUsagePageMock.mockResolvedValue({
    ok: true,
    data: { records: [], totalRecords: 0 },
  });
  exportConnectorUsageMock.mockResolvedValue({ ok: true, data: [] });
});

describe("ConnectorDetail", () => {
  it("renders catalog metadata, KPIs, operations, and usage tabs", async () => {
    renderView();

    expect(await screen.findAllByText("SQL Server")).toHaveLength(2);
    expect(screen.getByText("Connect to SQL Server data.")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getByText("Execute query")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Apps \(16\)/i }),
    ).toBeInTheDocument();
  });

  it("loads the next cursor page and returns to the cached previous page", async () => {
    listConnectorUsagePageMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          records: Array.from({ length: 15 }, (_, index) =>
            appRecord(index + 1),
          ),
          nextSkipToken: "page-2",
          totalRecords: 16,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          records: [appRecord(16)],
          totalRecords: 16,
        },
      });
    renderView();

    expect(await screen.findByText("App 1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("App 16")).toBeInTheDocument();
    expect(listConnectorUsagePageMock).toHaveBeenLastCalledWith(
      "apps",
      "shared_sql",
      "page-2",
      15,
      15,
    );

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("App 1")).toBeInTheDocument();
    expect(listConnectorUsagePageMock).toHaveBeenCalledTimes(2);
  });

  it("exports all connector usage", async () => {
    exportConnectorUsageMock.mockResolvedValue({
      ok: true,
      data: [appRecord(1)],
    });
    renderView();
    await screen.findByRole("button", { name: /Export all usage/i });

    await userEvent.click(
      screen.getByRole("button", { name: /Export all usage/i }),
    );

    await waitFor(() =>
      expect(exportConnectorUsageMock).toHaveBeenCalledWith(
        "all",
        "shared_sql",
      ),
    );
    expect(downloadCsvMock).toHaveBeenCalledWith(
      "connector-shared_sql-all-usage",
      "CSV_CONTENT",
    );
  });
});
