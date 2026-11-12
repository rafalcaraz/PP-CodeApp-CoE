/**
 * Smoke + filter-wiring test for FlowsList.
 *
 * Pattern mirrors AgentsList / AppsList tests. We mock the feature
 * data layer + the EnvironmentPicker so this test runs without
 * touching the generated connector at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/flows/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/flows/data")
  >("../../features/flows/data");
  return {
    ...actual,
    listFlowsPage: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: "flow-1",
            type: "microsoft.flow/flows",
            displayName: "Weekly Reminder",
            environmentId: "env-1",
            environmentName: "Production",
            ownerId: "00000000-0000-0000-0000-000000000001",
            ownerDisplayName: "Alice Maker",
            status: "Started",
            flowTriggerType: "Recurrence",
            trigger: null,
            triggerOperationId: "",
            triggerKind: "",
            createdAt: "2024-01-01T00:00:00Z",
            lastModifiedAt: "2024-09-01T00:00:00Z",
            connectors: [],
          },
        ],
        totalRecords: 1,
        skipToken: undefined,
      },
    }),
  };
});

vi.mock("../../components/EnvironmentPicker", () => ({
  EnvironmentPicker: () => <div data-testid="env-picker">all envs</div>,
}));

import { FlowsList } from "../../features/flows/FlowsList";
import { listFlowsPage } from "../../features/flows/data";

function renderFlowsList() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/flows"]}>
        <Routes>
          <Route path="/flows" element={<FlowsList />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("FlowsList smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("filters the derived trigger text and adds the created date without fetching", async () => {
    renderFlowsList();
    await screen.findByText("Weekly Reminder");
    await userEvent.click(screen.getByRole("button", { name: "Trigger column options" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Trigger filter value" }), "Recurrence");
    await userEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.getByText("Weekly Reminder")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByLabelText("Created on"));
    await userEvent.click(screen.getByText("Done"));
    expect(await screen.findByRole("button", { name: "Created on column options" })).toBeInTheDocument();
    expect(listFlowsPage).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("renders the mocked flow row", async () => {
    renderFlowsList();
    await waitFor(() => {
      expect(screen.getByText("Weekly Reminder")).toBeInTheDocument();
    });
  });

  it("typing in the search box eventually refetches with the nameContains filter", async () => {
    renderFlowsList();
    await waitFor(() => {
      expect(listFlowsPage).toHaveBeenCalledTimes(1);
    });

    const search = screen.getByPlaceholderText(/search/i);
    await userEvent.type(search, "Weekly");

    await waitFor(
      () => {
        const call = vi.mocked(listFlowsPage).mock.calls.at(-1);
        expect(call?.[0]).toMatchObject({ nameContains: "Weekly" });
      },
      { timeout: 2000 },
    );
  });
});
