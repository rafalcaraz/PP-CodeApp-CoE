/**
 * Smoke test for EnvironmentGroupsList.
 *
 * Unlike Apps / Flows / Agents / Environments, env groups are NOT
 * server-paginated — `listEnvironmentGroups` returns the full set in
 * one call (tenants rarely have more than a handful). Search is
 * purely client-side.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/environment-groups/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/environment-groups/data")
  >("../../features/environment-groups/data");
  return {
    ...actual,
    listEnvironmentGroups: vi.fn(),
  };
});

import { EnvironmentGroupsList } from "../../features/environment-groups/EnvironmentGroupsList";
import { listEnvironmentGroups } from "../../features/environment-groups/data";

function makeGroupRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "grp-1",
    displayName: "Production Pillar",
    description: "Top-tier production environments",
    location: "unitedstates",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderList() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/environment-groups"]}>
        <Routes>
          <Route
            path="/environment-groups"
            element={<EnvironmentGroupsList />}
          />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("EnvironmentGroupsList smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the mocked group rows", async () => {
    vi.mocked(listEnvironmentGroups).mockResolvedValue({
      ok: true,
      data: [
        makeGroupRow({ id: "grp-1", displayName: "Production Pillar" }),
        makeGroupRow({ id: "grp-2", displayName: "Dev Sandbox" }),
      ] as never,
    });
    renderList();
    await waitFor(() => {
      expect(screen.getByText("Production Pillar")).toBeInTheDocument();
    });
    expect(screen.getByText("Dev Sandbox")).toBeInTheDocument();
  });

  it("client-side search narrows the rows without refetching", async () => {
    vi.mocked(listEnvironmentGroups).mockResolvedValue({
      ok: true,
      data: [
        makeGroupRow({ id: "grp-1", displayName: "Production Pillar" }),
        makeGroupRow({ id: "grp-2", displayName: "Dev Sandbox" }),
      ] as never,
    });
    renderList();
    await waitFor(() => {
      expect(screen.getByText("Production Pillar")).toBeInTheDocument();
    });
    expect(listEnvironmentGroups).toHaveBeenCalledTimes(1);

    const search = screen.getByPlaceholderText(/search by name/i);
    await userEvent.type(search, "Dev");

    await waitFor(() => {
      expect(screen.queryByText("Production Pillar")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Dev Sandbox")).toBeInTheDocument();
    expect(listEnvironmentGroups).toHaveBeenCalledTimes(1);
  });

  it("shows the ErrorPane when the initial fetch fails", async () => {
    vi.mocked(listEnvironmentGroups).mockResolvedValue({
      ok: false,
      error: "boom",
    });
    renderList();
    await waitFor(() => {
      expect(
        screen.getByText("Couldn't load environment groups"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("shows the empty pane when the search has no matches", async () => {
    vi.mocked(listEnvironmentGroups).mockResolvedValue({
      ok: true,
      data: [makeGroupRow({ id: "grp-1", displayName: "Prod" })] as never,
    });
    renderList();
    await waitFor(() => {
      expect(screen.getByText("Prod")).toBeInTheDocument();
    });
    const search = screen.getByPlaceholderText(/search by name/i);
    await userEvent.type(search, "nonexistent");
    await waitFor(() => {
      expect(
        screen.getByText(/No environment groups match "nonexistent"/),
      ).toBeInTheDocument();
    });
  });
});
