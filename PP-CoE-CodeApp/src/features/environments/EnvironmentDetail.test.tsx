/**
 * Smoke test for EnvironmentDetail — load mechanics + the two
 * supplemental admin enrichment buttons.
 *
 * Two on-mount calls are made in parallel:
 *  - getEnvironment(envId)
 *  - countResourcesByTypeForEnvironment(envId)
 *
 * And the page exposes three on-demand `<SupplementalAdminCard>`-style
 * actions we want to pin the wiring for:
 *  1. "Load admin details"        → getEnvironmentAdminDetails(row.id)
 *  2. "Load DLP policy coverage"  → getEnvironmentDlpAndAcpStatus({ id, isManaged, environmentGroupId })
 *  3. (page-local) "Load resources" → listResourcesInEnvironment — covered
 *     less formally; the admin enrichment ones are the high-risk wires.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/environments/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/environments/data")
  >("../../features/environments/data");
  return {
    ...actual,
    getEnvironment: vi.fn(),
    countResourcesByTypeForEnvironment: vi.fn(),
    listResourcesInEnvironment: vi.fn(),
  };
});

vi.mock("../../data/adminEnrichment", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/adminEnrichment")
  >("../../data/adminEnrichment");
  return {
    ...actual,
    getEnvironmentAdminDetails: vi.fn(),
  };
});

vi.mock("../../data/dlpPolicies", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/dlpPolicies")
  >("../../data/dlpPolicies");
  return {
    ...actual,
    getEnvironmentDlpAndAcpStatus: vi.fn(),
  };
});

import { EnvironmentDetail } from "../../features/environments/EnvironmentDetail";
import {
  getEnvironment,
  countResourcesByTypeForEnvironment,
} from "../../features/environments/data";
import { getEnvironmentAdminDetails } from "../../data/adminEnrichment";
import { getEnvironmentDlpAndAcpStatus } from "../../data/dlpPolicies";

function envRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "env-1",
    name: "env-1",
    displayName: "Production",
    region: "unitedstates",
    environmentType: "Production",
    environmentGroup: "Prod Pillar",
    environmentGroupId: "grp-1",
    isManaged: true,
    location: "unitedstates",
    createdAt: "2024-01-01T00:00:00Z",
    lastModifiedAt: "2024-09-01T00:00:00Z",
    createdBy: "",
    tenantId: "tenant-1",
    ...overrides,
  };
}

function renderEnvDetail(envId = "env-1") {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[`/environments/${envId}`]}>
        <Routes>
          <Route path="/environments/:envId" element={<EnvironmentDetail />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

function primeOnMountCalls(rowOverrides: Partial<Record<string, unknown>> = {}) {
  vi.mocked(getEnvironment).mockResolvedValue({
    ok: true,
    data: { row: envRow(rowOverrides) as never, raw: {} },
  });
  vi.mocked(countResourcesByTypeForEnvironment).mockResolvedValue({
    ok: true,
    data: [],
  });
}

describe("EnvironmentDetail smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and renders the environment display name", async () => {
    primeOnMountCalls();
    renderEnvDetail();
    await waitFor(() => {
      expect(screen.getAllByText("Production").length).toBeGreaterThan(0);
    });
    expect(getEnvironment).toHaveBeenCalledWith("env-1");
    expect(countResourcesByTypeForEnvironment).toHaveBeenCalledWith("env-1");
  });

  it("renders the error-state ErrorPane when getEnvironment fails", async () => {
    vi.mocked(getEnvironment).mockResolvedValue({ ok: false, error: "boom" });
    vi.mocked(countResourcesByTypeForEnvironment).mockResolvedValue({
      ok: true,
      data: [],
    });
    renderEnvDetail();
    await waitFor(() => {
      expect(
        screen.getByText("Couldn't load environment"),
      ).toBeInTheDocument();
    });
  });
});

describe("EnvironmentDetail — supplemental enrichment buttons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("'Load admin details' button calls getEnvironmentAdminDetails(row.id)", async () => {
    primeOnMountCalls();
    vi.mocked(getEnvironmentAdminDetails).mockResolvedValue({
      ok: true,
      data: { data: {}, raw: {} } as never,
    });
    renderEnvDetail();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load admin details" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Load admin details" }),
    );
    await waitFor(() => {
      expect(getEnvironmentAdminDetails).toHaveBeenCalledWith("env-1");
    });
  });

  it("'Load DLP policy coverage' button calls getEnvironmentDlpAndAcpStatus with row fields", async () => {
    primeOnMountCalls();
    vi.mocked(getEnvironmentDlpAndAcpStatus).mockResolvedValue({
      ok: true,
      data: { coverage: [], trace: [], acp: null } as never,
    });
    renderEnvDetail();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load DLP policy coverage" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Load DLP policy coverage" }),
    );
    await waitFor(() => {
      expect(getEnvironmentDlpAndAcpStatus).toHaveBeenCalledWith({
        id: "env-1",
        isManaged: true,
        environmentGroupId: "grp-1",
      });
    });
  });
});
