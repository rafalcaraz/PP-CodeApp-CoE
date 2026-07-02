/**
 * Smoke test for the Solutions section on EnvironmentDetail.
 *
 * Pins the button-gated retrieve flow: the section starts idle with a
 * "Retrieve solutions" button, clicking it calls listSolutions(envId), and a
 * successful result renders the solutions in a grid.
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

vi.mock("../../features/environments/solutions", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/environments/solutions")
  >("../../features/environments/solutions");
  return {
    ...actual,
    listSolutions: vi.fn(),
  };
});

import { EnvironmentDetail } from "../../features/environments/EnvironmentDetail";
import {
  getEnvironment,
  countResourcesByTypeForEnvironment,
} from "../../features/environments/data";
import { listSolutions } from "../../features/environments/solutions";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEnvironment).mockResolvedValue({
    ok: true,
    data: {
      row: {
        id: "env-1",
        name: "env-1",
        displayName: "Production",
        isManaged: true,
        environmentGroupId: "grp-1",
      } as never,
      raw: {},
    },
  });
  vi.mocked(countResourcesByTypeForEnvironment).mockResolvedValue({
    ok: true,
    data: [],
  });
});

describe("EnvironmentDetail — Solutions section", () => {
  it("retrieves and renders solutions on button click", async () => {
    vi.mocked(listSolutions).mockResolvedValue({
      ok: true,
      data: [
        {
          id: "s1",
          uniqueName: "ContosoFieldService",
          friendlyName: "Contoso Field Service",
          version: "2.0.0.1",
          isManaged: false,
          modifiedOn: "2025-03-22T11:25:00Z",
          raw: {},
        },
      ],
    });

    renderEnvDetail();

    const btn = await screen.findByRole("button", { name: "Retrieve solutions" });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(listSolutions).toHaveBeenCalledWith("env-1");
      expect(screen.getByText("Contoso Field Service")).toBeInTheDocument();
    });
  });

  it("shows an error pane when retrieval fails", async () => {
    vi.mocked(listSolutions).mockResolvedValue({ ok: false, error: "boom" });
    renderEnvDetail();

    const btn = await screen.findByRole("button", { name: "Retrieve solutions" });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText("Couldn't retrieve solutions")).toBeInTheDocument();
    });
  });

  it("paginates solutions 10 per page", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      uniqueName: `Solution${i}`,
      friendlyName: `Solution ${i}`,
      version: "1.0.0.0",
      isManaged: false,
      modifiedOn: "2025-03-22T11:25:00Z",
      raw: {},
    }));
    vi.mocked(listSolutions).mockResolvedValue({ ok: true, data: rows });

    renderEnvDetail();

    await userEvent.click(
      await screen.findByRole("button", { name: "Retrieve solutions" }),
    );

    // Page 1: first 10 rows visible, 11th is not.
    await waitFor(() => {
      expect(screen.getByText("Solution 0")).toBeInTheDocument();
    });
    expect(screen.getByText("Solution 9")).toBeInTheDocument();
    expect(screen.queryByText("Solution 10")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();

    // Advance to page 2.
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => {
      expect(screen.getByText("Solution 10")).toBeInTheDocument();
    });
    expect(screen.queryByText("Solution 0")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });
});
