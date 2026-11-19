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
import { MANAGED_APP_SUBTYPE } from "../../features/apps/data";
import { toAppRow } from "../../data/inventory";

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
    localStorage.clear();
  });

  it("filters by the displayed owner and adds an optional column without fetching", async () => {
    renderAppsList();
    await screen.findByText("Onboarding App");
    await userEvent.click(screen.getByRole("button", { name: "Owner column options" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Owner filter value" }), "Alice");
    await userEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.getByText("Onboarding App")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByLabelText("App ID"));
    await userEvent.click(screen.getByText("Done"));
    expect(screen.getByText("app-1", { exact: true })).toBeInTheDocument();
    expect(listAppsPage).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("renders the mocked app row", async () => {
    renderAppsList();
    await waitFor(() => {
      expect(screen.getByText("Onboarding App")).toBeInTheDocument();
    });
  });
  it("finds managed apps by package name/version using the existing loaded-row column filter", async () => {
    vi.mocked(listAppsPage).mockResolvedValueOnce({ ok: true, data: {
      rows: ["with-package", "without-package"].map((id, index) => toAppRow({
        name: id, type: "microsoft.powerapps/apps", properties: {
          subType: "microsoftApp", displayName: id,
          npmPackages: [{ name: index ? "other" : "@example/widgets", version: index ? "1.0.0" : "6.3.1" }],
        },
      })), totalRecords: 2,
    } });
    renderAppsList();
    await screen.findByText("with-package");
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByLabelText("Packages"));
    await userEvent.click(screen.getByText("Done"));
    await userEvent.click(await screen.findByRole("button", { name: "Packages column options" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Packages filter value" }), "6.3.1");
    await userEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.getByText("with-package")).toBeInTheDocument();
    expect(screen.queryByText("without-package")).not.toBeInTheDocument();
    expect(screen.getByText(/1 matching \/ 2 loaded/)).toBeVisible();
    expect(listAppsPage).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("filters by sub-type and clears it when the resource type changes", async () => {
    renderAppsList();
    await screen.findByText("Onboarding App");
    await userEvent.click(screen.getByRole("combobox", { name: "App sub-type" }));
    await userEvent.click(screen.getByRole("option", { name: "Vibe app" }));
    await waitFor(() => {
      expect(vi.mocked(listAppsPage).mock.calls.at(-1)?.[0]).toMatchObject({
        subType: "vibeApp",
      });
    });
    await userEvent.click(screen.getByRole("combobox", { name: "App resource types" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Canvas" }));
    await waitFor(() => {
      expect(vi.mocked(listAppsPage).mock.calls.at(-1)?.[0]).toMatchObject({
        types: ["microsoft.powerapps/canvasapps"],
        subType: undefined,
      });
    });
    expect(screen.getByRole("combobox", { name: "App sub-type" })).toBeDisabled();
  });

  it("uses the shared managed-app subtype when matching governance counts", async () => {
    renderAppsList();
    await screen.findByText("Onboarding App");
    await userEvent.click(screen.getByRole("combobox", { name: "App sub-type" }));
    await userEvent.click(screen.getByRole("option", { name: "Managed app" }));
    await waitFor(() => expect(vi.mocked(listAppsPage).mock.calls.at(-1)?.[0]).toMatchObject({ subType: MANAGED_APP_SUBTYPE }));
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
