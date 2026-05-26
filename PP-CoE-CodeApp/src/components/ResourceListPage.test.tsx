/**
 * Comprehensive test for the generic ResourceListPage shell.
 *
 * This component is the heart of Agents / Apps / Flows list views.
 * Validating it once covers the search → refetch → pagination →
 * error-handling mechanics for all three features that consume it.
 *
 * We use a fake `fetchPage` prop so there's no need to mock the
 * inventory connector at all — the shell only knows about
 * `DataResult<ResourcePage<T>>` shapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createTableColumn, type TableColumnDefinition } from "@fluentui/react-components";
import {
  ResourceListPage,
  type ResourcePage,
} from "./ResourceListPage";
import type { DataResult } from "../data/inventory";

interface Row {
  id: string;
  name: string;
}

const columns: TableColumnDefinition<Row>[] = [
  createTableColumn<Row>({
    columnId: "name",
    renderHeaderCell: () => "Name",
    renderCell: (row) => row.name,
  }),
];

function makePage(
  rows: Row[],
  opts: { skipToken?: string; totalRecords?: number } = {},
): DataResult<ResourcePage<Row>> {
  return {
    ok: true,
    data: {
      rows,
      skipToken: opts.skipToken,
      totalRecords: opts.totalRecords ?? rows.length,
    },
  };
}

function makeError(msg: string): DataResult<ResourcePage<Row>> {
  return { ok: false, error: msg };
}

function renderShell(props: {
  fetchPage: (
    skipToken?: string,
    skip?: number,
  ) => Promise<DataResult<ResourcePage<Row>>>;
  filterKey?: string;
  filterControls?: React.ReactNode;
  emptyMessage?: string;
}) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <ResourceListPage<Row>
        title="Widgets"
        subtitle="Test fixture"
        filterKey={props.filterKey ?? "init"}
        fetchPage={props.fetchPage}
        columns={columns}
        getRowId={(row) => row.id}
        filterControls={props.filterControls ?? <div data-testid="filters" />}
        emptyMessage={props.emptyMessage}
      />
    </FluentProvider>,
  );
}

describe("ResourceListPage — initial load", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls fetchPage with (undefined, 0) on mount and renders the rows", async () => {
    const fetchPage = vi
      .fn<
        (
          skipToken?: string,
          skip?: number,
        ) => Promise<DataResult<ResourcePage<Row>>>
      >()
      .mockResolvedValue(
        makePage([
          { id: "1", name: "Alpha" },
          { id: "2", name: "Bravo" },
        ]),
      );
    renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(undefined, 0);
  });

  it("shows the EmptyPane when the first page is empty", async () => {
    const fetchPage = vi.fn().mockResolvedValue(makePage([]));
    renderShell({ fetchPage, emptyMessage: "Nothing to see here." });

    await waitFor(() => {
      expect(screen.getByText("Nothing to see here.")).toBeInTheDocument();
    });
  });

  it("shows the ErrorPane when the first fetch fails", async () => {
    const fetchPage = vi.fn().mockResolvedValue(makeError("boom"));
    renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Couldn't load widgets")).toBeInTheDocument();
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

describe("ResourceListPage — filterKey reactivity (search)", () => {
  it("refetches and resets when filterKey changes", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(makePage([{ id: "1", name: "Alpha" }]))
      .mockResolvedValueOnce(makePage([{ id: "2", name: "Bravo" }]));
    const { rerender } = render(
      <FluentProvider theme={webLightTheme}>
        <ResourceListPage<Row>
          title="Widgets"
          filterKey="key-1"
          fetchPage={fetchPage}
          columns={columns}
          getRowId={(row) => row.id}
          filterControls={null}
        />
      </FluentProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    rerender(
      <FluentProvider theme={webLightTheme}>
        <ResourceListPage<Row>
          title="Widgets"
          filterKey="key-2" // changed
          fetchPage={fetchPage}
          columns={columns}
          getRowId={(row) => row.id}
          filterControls={null}
        />
      </FluentProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bravo")).toBeInTheDocument();
    });
    // The previous row should NOT still be rendered — the shell resets
    // the row list before issuing the new fetch.
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    // Both fetches should have started from offset 0 with no skipToken.
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, 0);
    expect(fetchPage).toHaveBeenNthCalledWith(2, undefined, 0);
  });
});

describe("ResourceListPage — skipToken pagination", () => {
  it("renders the 'Load more' button when the first page has a skipToken", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(
        makePage([{ id: "1", name: "Alpha" }], {
          skipToken: "tok-1",
          totalRecords: 3,
        }),
      );
    renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /load all remaining/i }),
    ).toBeInTheDocument();
  });

  it("does NOT render the 'Load more' button when the first page has no skipToken", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(makePage([{ id: "1", name: "Alpha" }]));
    renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("'Load more' calls fetchPage with the prior token + accumulated row count, and appends rows", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        makePage([{ id: "1", name: "Alpha" }], {
          skipToken: "tok-1",
          totalRecords: 3,
        }),
      )
      .mockResolvedValueOnce(
        makePage(
          [
            { id: "2", name: "Bravo" },
            { id: "3", name: "Charlie" },
          ],
          { totalRecords: 3 },
        ),
      );
    renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    const loadMore = screen.getByRole("button", { name: /load more/i });
    await userEvent.click(loadMore);

    await waitFor(() => {
      expect(screen.getByText("Bravo")).toBeInTheDocument();
    });
    // Original row should still be there (append, not replace).
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    // Pagination call: (skipToken, rows.length).
    expect(fetchPage).toHaveBeenNthCalledWith(2, "tok-1", 1);
    // Once the second page returns no skipToken, the button disappears.
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("'Load all remaining' drains pages in a loop until no skipToken", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        makePage([{ id: "1", name: "Alpha" }], { skipToken: "tok-1" }),
      )
      .mockResolvedValueOnce(
        makePage([{ id: "2", name: "Bravo" }], { skipToken: "tok-2" }),
      )
      .mockResolvedValueOnce(makePage([{ id: "3", name: "Charlie" }]));
    renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: /load all remaining/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("Charlie")).toBeInTheDocument();
    });
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "tok-1", 1);
    expect(fetchPage).toHaveBeenNthCalledWith(3, "tok-2", 2);
  });

  it("preserves loaded rows when 'Load more' errors mid-stream", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(
        makePage([{ id: "1", name: "Alpha" }], { skipToken: "tok-1" }),
      )
      .mockResolvedValueOnce(makeError("rate limited"));
    renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => {
      expect(screen.getByText("rate limited")).toBeInTheDocument();
    });
    // Original rows still visible.
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    // We're NOT in the full ErrorPane (that's reserved for initial-fetch).
    expect(
      screen.queryByText("Couldn't load widgets"),
    ).not.toBeInTheDocument();
  });
});

describe("ResourceListPage — count label", () => {
  it("renders the default count label with a '+' when more pages exist", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(
        makePage([{ id: "1", name: "Alpha" }], {
          skipToken: "tok-1",
          totalRecords: 100,
        }),
      );
    const { container } = renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    // "Showing 1 of 100+" appears alongside the toolbar.
    const text = within(container).getByText(/Showing 1 of 100\+/);
    expect(text).toBeInTheDocument();
  });

  it("renders the count label WITHOUT '+' when no more pages exist", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(
        makePage([{ id: "1", name: "Alpha" }], { totalRecords: 1 }),
      );
    const { container } = renderShell({ fetchPage });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(within(container).getByText("Showing 1 of 1")).toBeInTheDocument();
  });
});
