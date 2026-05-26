/**
 * Smoke + filter-wiring test for AppsList.
 *
 * Pattern mirrors AgentsList.test.tsx. We mock the feature data layer
 * + the EnvironmentPicker so this test runs without touching the
 * generated connector at all, and asserts:
 *   1. The list renders a mocked row.
 *   2. Typing in the search box eventually triggers a refetch with the
 *      `nameContains` filter populated (proving the debounce → filterKey
 *      → fetch wiring works).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/apps/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/apps/data")
  >("../../features/apps/data");
  return {
    ...actual,
    listAppsPage: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        rows: [
          {
            id: "app-1",
            type: "microsoft.powerapps/canvasapps",
            displayName: "Onboarding App",
            environmentId: "env-1",
            environmentName: "Production",
            ownerId: "00000000-0000-0000-0000-000000000001",
            ownerDisplayName: "Alice Maker",
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

import { AppsList } from "../../features/apps/AppsList";
import { listAppsPage } from "../../features/apps/data";

function renderAppsList() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/apps"]}>
        <Routes>
          <Route path="/apps" element={<AppsList />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("AppsList smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the mocked app row", async () => {
    renderAppsList();
    await waitFor(() => {
      expect(screen.getByText("Onboarding App")).toBeInTheDocument();
    });
  });

  it("typing in the search box eventually refetches with the nameContains filter", async () => {
    renderAppsList();
    // Initial mount fetch.
    await waitFor(() => {
      expect(listAppsPage).toHaveBeenCalledTimes(1);
    });

    const search = screen.getByPlaceholderText("Search by name");
    await userEvent.type(search, "Onboarding");

    // The search input is debounced 350ms → new filterKey → refetch.
    await waitFor(
      () => {
        const call = vi.mocked(listAppsPage).mock.calls.at(-1);
        expect(call?.[0]).toMatchObject({ nameContains: "Onboarding" });
      },
      { timeout: 2000 },
    );
  });
});
