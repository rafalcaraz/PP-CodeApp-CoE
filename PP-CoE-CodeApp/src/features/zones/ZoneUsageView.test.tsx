import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { customRef, refToKey } from "../../data/zones";

const {
  listEnvironmentsMock,
  listEnvironmentGroupsMock,
  listZoneAgentsMock,
  listZoneFlowsMock,
  listZoneAppsMock,
  getUsageTimeseriesMock,
  useZonesMock,
} = vi.hoisted(() => ({
  listEnvironmentsMock: vi.fn(),
  listEnvironmentGroupsMock: vi.fn(),
  listZoneAgentsMock: vi.fn(),
  listZoneFlowsMock: vi.fn(),
  listZoneAppsMock: vi.fn(),
  getUsageTimeseriesMock: vi.fn(),
  useZonesMock: vi.fn(),
}));

vi.mock("../../data/inventory", async () => {
  const actual = await vi.importActual<typeof import("../../data/inventory")>(
    "../../data/inventory",
  );
  return {
    ...actual,
    listEnvironments: listEnvironmentsMock,
    listEnvironmentGroups: listEnvironmentGroupsMock,
  };
});

vi.mock("../../hooks/useZones", () => ({
  useZones: useZonesMock,
}));

vi.mock("./usageData", () => ({
  listZoneAgents: listZoneAgentsMock,
  listZoneFlows: listZoneFlowsMock,
  listZoneApps: listZoneAppsMock,
}));

vi.mock("../../shared/licensing", async () => {
  const actual = await vi.importActual<typeof import("../../shared/licensing")>(
    "../../shared/licensing",
  );
  return {
    ...actual,
    getUsageTimeseries: getUsageTimeseriesMock,
  };
});

import { ZoneUsageView } from "./ZoneUsageView";

const ZONE_ID = "zone-1";
const TENANT_ID = "tenant-1";

function renderZoneRoute() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[`/zones/${ZONE_ID}/usage`]}>
        <Routes>
          <Route path="/zones/:zoneId/usage" element={<ZoneUsageView />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

function renderStandaloneRoute() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/zones/usage"]}>
        <Routes>
          <Route path="/zones/usage" element={<ZoneUsageView />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

function renderStandaloneRouteWithQuery(query: string) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[`/zones/usage?${query}`]}>
        <Routes>
          <Route path="/zones/usage" element={<ZoneUsageView />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

function usagePoint(
  date: string,
  activeUsers: number,
  activeSessions: number,
  activeRuns: number,
) {
  return {
    date,
    metrics: { activeUsers, activeSessions, activeRuns },
  };
}

describe("ZoneUsageView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEnvironmentsMock.mockResolvedValue({
      ok: true,
      data: [
        { id: "env-1", displayName: "Production", environmentGroupId: "", tenantId: TENANT_ID },
        { id: "env-2", displayName: "Test", environmentGroupId: "", tenantId: TENANT_ID },
      ],
    });
    listEnvironmentGroupsMock.mockResolvedValue({ ok: true, data: [] });
    listZoneAgentsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "agent-1",
          displayName: "Bot One",
          environmentId: "env-1",
          environmentName: "Production",
          tenantId: TENANT_ID,
        },
        {
          id: "agent-2",
          displayName: "Bot Two",
          environmentId: "env-1",
          environmentName: "Production",
          tenantId: TENANT_ID,
        },
        {
          id: "agent-3",
          displayName: "Bot Three",
          environmentId: "env-2",
          environmentName: "Test",
          tenantId: TENANT_ID,
        },
      ],
    });
    listZoneFlowsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "flow-1",
          displayName: "Flow One",
          environmentId: "env-1",
          environmentName: "Production",
          tenantId: TENANT_ID,
        },
      ],
    });
    listZoneAppsMock.mockResolvedValue({ ok: true, data: [] });

    useZonesMock.mockReturnValue({
      zones: [
        {
          id: ZONE_ID,
          name: "Zone Usage",
          description: "Testing zone",
          icon: "??",
          color: "#0078d4",
        },
        {
          id: "zone-2",
          name: "Second Zone",
          description: "Second",
          icon: "??",
          color: "#5c2d91",
        },
      ],
      assignments: {
        [refToKey(customRef("group-1"))]: { zoneId: ZONE_ID },
        [refToKey(customRef("group-2"))]: { zoneId: ZONE_ID },
      },
      standardGroups: [
        {
          id: "group-1",
          displayName: "All Envs",
          envIds: ["env-1", "env-2"],
        },
        {
          id: "group-2",
          displayName: "Primary Envs",
          envIds: ["env-1"],
        },
      ],
      refresh: vi.fn(),
    });

    getUsageTimeseriesMock.mockImplementation(
      async ({ productCategory, resourceId }: { productCategory: string; resourceId: string }) => {
        if (productCategory === "CopilotStudio") {
          switch (resourceId) {
            case "agent-1":
              return {
                ok: true,
                data: {
                  productCategory: "CopilotStudio",
                  interval: "Monthly",
                  fromDate: "2026-01-01T00:00:00.000Z",
                  toDate: "2026-03-01T00:00:00.000Z",
                  points: [usagePoint("2026-01-01T00:00:00.000Z", 1, 2, 3)],
                  totals: { activeUsers: 1, activeSessions: 2, activeRuns: 3 },
                },
              };
            case "agent-2":
              return {
                ok: true,
                data: {
                  productCategory: "CopilotStudio",
                  interval: "Monthly",
                  fromDate: "2026-01-01T00:00:00.000Z",
                  toDate: "2026-03-01T00:00:00.000Z",
                  points: [usagePoint("2026-01-01T00:00:00.000Z", 4, 5, 6)],
                  totals: { activeUsers: 4, activeSessions: 5, activeRuns: 6 },
                },
              };
            case "agent-3":
              return {
                ok: true,
                data: {
                  productCategory: "CopilotStudio",
                  interval: "Monthly",
                  fromDate: "2026-01-01T00:00:00.000Z",
                  toDate: "2026-03-01T00:00:00.000Z",
                  points: [usagePoint("2026-02-01T00:00:00.000Z", 7, 8, 9)],
                  totals: { activeUsers: 7, activeSessions: 8, activeRuns: 9 },
                },
              };
          }
        }
        if (productCategory === "PowerAutomate") {
          return {
            ok: true,
            data: {
              productCategory: "PowerAutomate",
              interval: "Monthly",
              fromDate: "2026-01-01T00:00:00.000Z",
              toDate: "2026-03-01T00:00:00.000Z",
              points: [usagePoint("2026-01-01T00:00:00.000Z", 10, 11, 12)],
              totals: { activeUsers: 10, activeSessions: 11, activeRuns: 12 },
            },
          };
        }
        return {
          ok: true,
          data: {
            productCategory: "PowerApps",
            interval: "Monthly",
            fromDate: "2026-01-01T00:00:00.000Z",
            toDate: "2026-03-01T00:00:00.000Z",
            points: [],
            totals: { activeUsers: 0, activeSessions: 0, activeRuns: 0 },
          },
        };
      },
    );
  });

  it("loads, filters scope by group, and keeps tabs independent", async () => {
    renderZoneRoute();

    await waitFor(() => {
      expect(screen.getByText("Usage overview")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Load usage" }));

    await waitFor(() => {
      expect(screen.getByTestId("zone-usage-total-users")).toHaveTextContent("12");
    });
    expect(screen.getByTestId("zone-usage-total-sessions")).toHaveTextContent("15");
    expect(screen.getByTestId("zone-usage-total-runs")).toHaveTextContent("18");

    const allEnvsCheckbox = screen.getByRole("checkbox", { name: /All Envs/i });
    await userEvent.click(allEnvsCheckbox);

    await waitFor(() => {
      expect(screen.getByTestId("zone-usage-total-users")).toHaveTextContent("5");
    });
    expect(screen.getByTestId("zone-usage-total-sessions")).toHaveTextContent("7");
    expect(screen.getByTestId("zone-usage-total-runs")).toHaveTextContent("9");

    const groupPrimary = screen.getByTestId("zone-usage-group-group-2");
    expect(within(groupPrimary).getByTestId("zone-usage-group-group-2-users")).toHaveTextContent("5");

    await userEvent.click(screen.getByRole("tab", { name: "Power Automate" }));
    expect(screen.getByText(/Nothing is loaded yet/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load usage" }));

    await waitFor(() => {
      expect(screen.getByTestId("zone-usage-total-users")).toHaveTextContent("10");
    });
    expect(screen.getByTestId("zone-usage-total-sessions")).toHaveTextContent("11");
    expect(screen.getByTestId("zone-usage-total-runs")).toHaveTextContent("12");
  });

  it("renders the standalone zones usage page with picker", async () => {
    renderStandaloneRoute();

    await waitFor(() => {
      expect(screen.getByText("Pick a zone")).toBeInTheDocument();
    });

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText(/2 zones available/i)).toBeInTheDocument();
  });

  it("applies seeded standalone scope from query params on first load", async () => {
    renderStandaloneRouteWithQuery("groupKind=custom&groupId=group-2&envId=env-1");

    await waitFor(() => {
      expect(screen.getByText("Usage overview")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Load usage" }));

    await waitFor(() => {
      expect(screen.getByTestId("zone-usage-total-users")).toHaveTextContent("5");
    });
    expect(screen.getByTestId("zone-usage-total-sessions")).toHaveTextContent("7");
    expect(screen.getByTestId("zone-usage-total-runs")).toHaveTextContent("9");
  });
});
