/**
 * Smoke test for EnvironmentGroupDetail.
 *
 * Three parallel on-mount calls:
 *   - getEnvironmentGroup(groupId)
 *   - listEnvironmentsInGroup(groupId)
 *   - countResourcesByTypeForGroup(groupId)
 *
 * Plus the page's "Load governance" supplemental card which calls
 * `getEnvironmentGroupGovernance(groupId)`. The card itself is tested
 * generically in SupplementalAdminCard.test.tsx.
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
    getEnvironmentGroup: vi.fn(),
    listEnvironmentsInGroup: vi.fn(),
    countResourcesByTypeForGroup: vi.fn(),
  };
});

vi.mock("../../data/adminEnrichment", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/adminEnrichment")
  >("../../data/adminEnrichment");
  return {
    ...actual,
    getEnvironmentGroupGovernance: vi.fn(),
  };
});

import { EnvironmentGroupDetail } from "../../features/environment-groups/EnvironmentGroupDetail";
import {
  getEnvironmentGroup,
  listEnvironmentsInGroup,
  countResourcesByTypeForGroup,
} from "../../features/environment-groups/data";
import { getEnvironmentGroupGovernance } from "../../data/adminEnrichment";

function groupRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "grp-1",
    displayName: "Production Pillar",
    description: "Top-tier production environments",
    location: "unitedstates",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderGroupDetail(groupId = "grp-1") {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[`/environment-groups/${groupId}`]}>
        <Routes>
          <Route
            path="/environment-groups/:groupId"
            element={<EnvironmentGroupDetail />}
          />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

function primeOnMountCalls() {
  vi.mocked(getEnvironmentGroup).mockResolvedValue({
    ok: true,
    data: { row: groupRow() as never, raw: {} },
  });
  vi.mocked(listEnvironmentsInGroup).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(countResourcesByTypeForGroup).mockResolvedValue({
    ok: true,
    data: [],
  });
}

describe("EnvironmentGroupDetail smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and renders the group display name", async () => {
    primeOnMountCalls();
    renderGroupDetail();
    await waitFor(() => {
      expect(
        screen.getAllByText("Production Pillar").length,
      ).toBeGreaterThan(0);
    });
    expect(getEnvironmentGroup).toHaveBeenCalledWith("grp-1");
    expect(listEnvironmentsInGroup).toHaveBeenCalledWith("grp-1");
    expect(countResourcesByTypeForGroup).toHaveBeenCalledWith("grp-1");
  });

  it("renders the missing-state EmptyPane when getEnvironmentGroup returns ok:true but no data", async () => {
    vi.mocked(getEnvironmentGroup).mockResolvedValue({ ok: true, data: null });
    vi.mocked(listEnvironmentsInGroup).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(countResourcesByTypeForGroup).mockResolvedValue({
      ok: true,
      data: [],
    });
    renderGroupDetail();
    await waitFor(() => {
      expect(
        screen.getByText(/Environment group "grp-1" was not found/),
      ).toBeInTheDocument();
    });
  });

  it("renders the error-state ErrorPane when getEnvironmentGroup fails", async () => {
    vi.mocked(getEnvironmentGroup).mockResolvedValue({
      ok: false,
      error: "boom",
    });
    vi.mocked(listEnvironmentsInGroup).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(countResourcesByTypeForGroup).mockResolvedValue({
      ok: true,
      data: [],
    });
    renderGroupDetail();
    await waitFor(() => {
      expect(
        screen.getByText("Couldn't load environment group"),
      ).toBeInTheDocument();
    });
  });

  it("clicking the governance 'View all rules' button calls getEnvironmentGroupGovernance(groupId)", async () => {
    primeOnMountCalls();
    vi.mocked(getEnvironmentGroupGovernance).mockResolvedValue({
      ok: true,
      data: {
        rulesets: { ok: true, data: { rulesets: [], raw: {} } as never },
        policies: { ok: true, data: { policies: [], raw: {} } as never },
      },
    });
    renderGroupDetail();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "View all rules" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "View all rules" }),
    );
    await waitFor(() => {
      expect(getEnvironmentGroupGovernance).toHaveBeenCalledWith("grp-1");
    });
  });
});
