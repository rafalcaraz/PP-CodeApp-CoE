/**
 * Smoke test for ConnectorsList.
 *
 * Mocks the feature data layer + the EnvironmentPicker so the test runs
 * without touching the generated connector. Asserts the empty/idle state,
 * that clicking Run triggers the data call, and that the resulting rows
 * (including the premium tier badge) render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/connectors/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/connectors/data")
  >("../../features/connectors/data");
  return {
    ...actual,
    listConnectorsForEnv: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
            connectorId: "shared_sharepointonline",
            displayName: "SharePoint",
            tier: "Standard",
            publisher: "Microsoft",
            isCustomApi: false,
            raw: {},
          },
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_sql",
            connectorId: "shared_sql",
            displayName: "SQL Server",
            tier: "Premium",
            publisher: "Microsoft",
            isCustomApi: false,
            raw: {},
          },
        ],
        raw: {
          value: [{ id: "shared_sharepointonline" }, { id: "shared_sql" }],
        },
      },
    }),
  };
});

// Stub the env picker so the test doesn't try to load envs from the
// generated connector. The stub exposes a button that flips the selected
// env to a fixed value so we can drive the rest of the flow.
vi.mock("../../components/EnvironmentPicker", () => ({
  EnvironmentPicker: ({
    onChange,
  }: {
    onChange: (envId: string | undefined) => void;
  }) => (
    <button data-testid="env-picker" onClick={() => onChange("env-1")}>
      pick env-1
    </button>
  ),
}));

import { ConnectorsList } from "../../features/connectors/ConnectorsList";
import { listConnectorsForEnv } from "../../features/connectors/data";

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

describe("ConnectorsList smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in the idle state with the Run button disabled", () => {
    renderView();
    expect(
      screen.getByText(/Pick an environment and hit Run/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run ListConnectors/i }),
    ).toBeDisabled();
  });

  it("loads connectors after picking an env and clicking Run", async () => {
    renderView();
    await userEvent.click(screen.getByTestId("env-picker"));
    const runBtn = screen.getByRole("button", { name: /Run ListConnectors/i });
    await waitFor(() => expect(runBtn).not.toBeDisabled());
    await userEvent.click(runBtn);

    await waitFor(() =>
      expect(listConnectorsForEnv).toHaveBeenCalledWith("env-1"),
    );

    expect(await screen.findByText("SharePoint")).toBeInTheDocument();
    expect(screen.getByText("SQL Server")).toBeInTheDocument();
    // Premium badge should render for SQL Server.
    expect(screen.getByText("Premium")).toBeInTheDocument();
  });
});
