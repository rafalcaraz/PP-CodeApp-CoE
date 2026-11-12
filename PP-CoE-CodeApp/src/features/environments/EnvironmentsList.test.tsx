/**
 * Smoke test for EnvironmentsList.
 *
 * EnvironmentsList does NOT use ResourceListPage — it has its own
 * state machine because search is CLIENT-SIDE (in-memory filter of
 * already-loaded rows). The server still paginates with skipToken,
 * but the search box only narrows what's already in `rows`.
 *
 * That's important enough that we want a dedicated test pinning the
 * behavior:
 *  1. Initial load renders the mocked row.
 *  2. Typing in the search box filters rows in-memory WITHOUT
 *     triggering another `listEnvironmentsPage` call.
 *  3. With a skipToken, the "Load more" button calls
 *     `listEnvironmentsPage(token, 500, rows.length)`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/environments/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/environments/data")
  >("../../features/environments/data");
  return {
    ...actual,
    listEnvironmentsPage: vi.fn(),
  };
});

import { EnvironmentsList } from "../../features/environments/EnvironmentsList";
import { listEnvironmentsPage } from "../../features/environments/data";
import { downloadCsv } from "../../utils/csv";

vi.mock("../../utils/csv", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../utils/csv")>(),
  downloadCsv: vi.fn(),
}));

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "env-1",
    name: "env-1",
    displayName: "Production",
    region: "us-east",
    environmentType: "Default",
    environmentGroup: "",
    environmentGroupId: "",
    isManaged: true,
    location: "us-east",
    createdAt: "2024-01-01T00:00:00Z",
    lastModifiedAt: "2024-09-01T00:00:00Z",
    createdBy: "",
    tenantId: "tenant-1",
    ...overrides,
  };
}

function renderEnvList() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/environments"]}>
        <Routes>
          <Route path="/environments" element={<EnvironmentsList />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("EnvironmentsList smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("sorts by the displayed name and keeps column controls after filtering to zero", async () => {
    vi.mocked(listEnvironmentsPage).mockResolvedValue({
      ok: true,
      data: { rows: [makeRow({ displayName: "Zulu" }), makeRow({ id: "env-2", displayName: "Alpha" })] as never, totalRecords: 2 },
    });
    renderEnvList();
    await screen.findByText("Zulu");
    await userEvent.click(screen.getByRole("button", { name: "Name column options" }));
    await userEvent.click(screen.getByRole("button", { name: "Sort ascending" }));
    const gridRows = within(screen.getByRole("region", { name: "Environments" })).getAllByRole("row");
    expect(within(gridRows[1]).getByText("Alpha")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Name column options" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name filter value" }), "missing");
    await userEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear column filters" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(listEnvironmentsPage).toHaveBeenCalledTimes(1);
  });

  it("does not export an incomplete all-results download", async () => {
    vi.mocked(listEnvironmentsPage)
      .mockResolvedValueOnce({ ok: true, data: { rows: [makeRow()] as never, totalRecords: 2, skipToken: "next" } })
      .mockResolvedValueOnce({ ok: true, data: { rows: [], totalRecords: 2, skipToken: "next" } });
    renderEnvList();
    await screen.findByText("Production");
    await userEvent.click(screen.getByRole("button", { name: "Export all" }));
    expect(await screen.findByText(/Loading incomplete:.*empty page/)).toBeInTheDocument();
    expect(downloadCsv).not.toHaveBeenCalled();
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("stops an obsolete load-all request after the view unmounts", async () => {
    let resolvePage!: (result: Awaited<ReturnType<typeof listEnvironmentsPage>>) => void;
    vi.mocked(listEnvironmentsPage)
      .mockResolvedValueOnce({ ok: true, data: { rows: [makeRow()] as never, totalRecords: 3, skipToken: "next" } })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }));
    const view = renderEnvList();
    await screen.findByText("Production");
    await userEvent.click(screen.getByRole("button", { name: "Load all remaining" }));
    await waitFor(() => expect(listEnvironmentsPage).toHaveBeenCalledTimes(2));
    view.unmount();
    await act(async () => resolvePage({
      ok: true,
      data: { rows: [makeRow({ id: "env-2" })] as never, totalRecords: 3, skipToken: "next-2" },
    }));
    expect(listEnvironmentsPage).toHaveBeenCalledTimes(2);
  });

  it("renders the mocked environment rows", async () => {
    vi.mocked(listEnvironmentsPage).mockResolvedValue({
      ok: true,
      data: {
        rows: [
          makeRow({ id: "env-1", displayName: "Production" }),
          makeRow({ id: "env-2", displayName: "Development" }),
        ] as never,
        totalRecords: 2,
        skipToken: undefined,
      },
    });
    renderEnvList();
    await waitFor(() => {
      expect(screen.getByText("Production")).toBeInTheDocument();
    });
    expect(screen.getByText("Development")).toBeInTheDocument();
  });

  it("client-side search filters loaded rows WITHOUT a refetch", async () => {
    vi.mocked(listEnvironmentsPage).mockResolvedValue({
      ok: true,
      data: {
        rows: [
          makeRow({ id: "env-1", displayName: "Production" }),
          makeRow({ id: "env-2", displayName: "Development" }),
        ] as never,
        totalRecords: 2,
        skipToken: undefined,
      },
    });
    renderEnvList();
    await waitFor(() => {
      expect(screen.getByText("Production")).toBeInTheDocument();
    });
    expect(listEnvironmentsPage).toHaveBeenCalledTimes(1);

    const search = screen.getByPlaceholderText(/search by name/i);
    await userEvent.type(search, "prod");

    await waitFor(() => {
      expect(screen.queryByText("Development")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Production")).toBeInTheDocument();
    // Confirm no extra fetch was issued — search is purely local.
    expect(listEnvironmentsPage).toHaveBeenCalledTimes(1);
  });

  it("'Load more' calls listEnvironmentsPage with (token, 500, rows.length) and appends rows", async () => {
    vi.mocked(listEnvironmentsPage)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [makeRow({ id: "env-1", displayName: "First" })] as never,
          totalRecords: 2,
          skipToken: "tok-1",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [makeRow({ id: "env-2", displayName: "Second" })] as never,
          totalRecords: 2,
          skipToken: undefined,
        },
      });
    renderEnvList();
    await waitFor(() => {
      expect(screen.getByText("First")).toBeInTheDocument();
    });
    const loadMore = screen.getByRole("button", { name: /load more/i });
    await userEvent.click(loadMore);

    await waitFor(() => {
      expect(screen.getByText("Second")).toBeInTheDocument();
    });
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(listEnvironmentsPage).toHaveBeenNthCalledWith(2, "tok-1", 500, 1);
  });

  it("shows the ErrorPane when the initial fetch fails", async () => {
    vi.mocked(listEnvironmentsPage).mockResolvedValue({
      ok: false,
      error: "rate limited",
    });
    renderEnvList();
    await waitFor(() => {
      expect(
        screen.getByText("Couldn't load environments"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("rate limited")).toBeInTheDocument();
  });
});
