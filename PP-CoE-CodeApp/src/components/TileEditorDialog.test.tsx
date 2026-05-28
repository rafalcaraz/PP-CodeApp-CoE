/**
 * Smoke tests for the TileEditorDialog — Phase 3 Advanced (clauses)
 * authoring path.
 *
 * Pinning behavior we care about:
 *   - New tile defaults to Visual mode; mode toggle is visible
 *   - Switching to Advanced shows the clauses textarea
 *   - Editing an existing raw tile opens in Advanced mode with the
 *     textarea editable & populated
 *   - Editing a computed tile shows the read-only banner and HIDES the
 *     mode toggle
 *   - Pasting invalid JSON disables Save; pasting valid JSON re-enables it
 *
 * We stub out the TileView preview to avoid pulling the inventory
 * fetch path into these tests — that's covered by its own test suite.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { DashboardTile } from "../data/dashboards";

// Stub the live-preview tile so we don't hit the inventory layer here.
vi.mock("./TileView", () => ({
  TileView: () => <div data-testid="tile-preview-stub">preview</div>,
}));

// Pin saved-queries to an empty list — the "Start from" picker shouldn't
// influence these tests.
vi.mock("../data/savedQueries", async () => {
  const actual = await vi.importActual<typeof import("../data/savedQueries")>(
    "../data/savedQueries",
  );
  return { ...actual, listSavedQueries: () => [] };
});

import { TileEditorDialog } from "./TileEditorDialog";

function visualTile(overrides: Partial<DashboardTile> = {}): DashboardTile {
  return {
    id: "t1",
    title: "New tile",
    size: "medium",
    viz: { type: "kpi", kpiLabel: "Count" },
    spec: {
      resourceTypes: ["microsoft.powerapps/canvasapps"] as DashboardTile["spec"]["resourceTypes"],
      filters: [],
      orderField: "properties.lastModifiedAt",
      orderDirection: "desc",
      limit: 100,
    },
    source: "builder",
    ...overrides,
  };
}

function rawTile(overrides: Partial<DashboardTile> = {}): DashboardTile {
  return {
    id: "t-raw",
    title: "My raw tile",
    size: "medium",
    viz: { type: "kpi", kpiLabel: "Count" },
    spec: visualTile().spec,
    source: "raw",
    clauses: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { $type: "where", FieldName: "type", Operator: "==", Values: ["'agent'"] } as any,
    ],
    ...overrides,
  };
}

function computedTile(overrides: Partial<DashboardTile> = {}): DashboardTile {
  return {
    id: "t-computed",
    title: "Tool richness",
    size: "medium",
    viz: { type: "bar" },
    spec: visualTile().spec,
    source: "computed",
    computed: { aggregatorId: "agents.toolRichnessHistogram" },
    ...overrides,
  };
}

function renderEditor(initialTile: DashboardTile, onSave = vi.fn(), onClose = vi.fn()) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <TileEditorDialog
        open
        initialTile={initialTile}
        onClose={onClose}
        onSave={onSave}
      />
    </FluentProvider>,
  );
}

describe("TileEditorDialog — Phase 3 Advanced mode", () => {
  it("new tile defaults to Visual mode and shows the mode toggle", async () => {
    renderEditor(visualTile());
    expect(await screen.findByRole("button", { name: /Visual builder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Advanced \(clauses\)/i })).toBeInTheDocument();
    // Resource types field is part of the Visual builder — should be visible
    expect(screen.getByText(/Resource types/i)).toBeInTheDocument();
    // Clauses textarea is NOT visible in Visual mode
    expect(screen.queryByText(/Insert clause/i)).not.toBeInTheDocument();
  });

  it("clicking Advanced shows the clauses textarea + Insert clause button", async () => {
    renderEditor(visualTile());
    fireEvent.click(screen.getByRole("button", { name: /Advanced \(clauses\)/i }));
    expect(await screen.findByRole("button", { name: /Insert clause/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Format JSON/i })).toBeInTheDocument();
  });

  it("editing an existing raw tile opens in Advanced mode with editable textarea", async () => {
    renderEditor(rawTile());
    expect(await screen.findByRole("button", { name: /Insert clause/i })).toBeInTheDocument();
    // The textarea is populated with the tile's clauses
    const textareas = document.querySelectorAll("textarea");
    const clausesTextarea = Array.from(textareas).find((t) =>
      t.value.includes("\"$type\": \"where\""),
    );
    expect(clausesTextarea, "clauses textarea should be populated").toBeDefined();
    expect(clausesTextarea?.readOnly).toBe(false);
  });

  it("editing a computed tile shows the read-only banner and hides the mode toggle", async () => {
    renderEditor(computedTile());
    expect(await screen.findByText(/Managed by code/i)).toBeInTheDocument();
    expect(screen.getByText(/agents\.toolRichnessHistogram/i)).toBeInTheDocument();
    // Mode toggle should NOT be present for computed tiles
    expect(screen.queryByRole("button", { name: /Visual builder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Advanced \(clauses\)/i })).not.toBeInTheDocument();
    // Insert clause / Page size hidden too
    expect(screen.queryByRole("button", { name: /Insert clause/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Page size/i)).not.toBeInTheDocument();
  });

  it("pasting invalid JSON disables Save and shows an error status", async () => {
    const onSave = vi.fn();
    renderEditor(rawTile(), onSave);
    const textareas = document.querySelectorAll("textarea");
    const clausesTextarea = Array.from(textareas).find((t) =>
      t.value.includes("\"$type\":"),
    ) as HTMLTextAreaElement;
    expect(clausesTextarea).toBeDefined();
    fireEvent.change(clausesTextarea, { target: { value: "not valid json {" } });

    // Wait past the 300ms debounce + validation.
    await waitFor(
      () => {
        expect(screen.getByText(/JSON syntax error/i)).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    const saveBtn = screen.getByRole("button", { name: /Save tile/i });
    expect(saveBtn).toBeDisabled();
  });

  it("pasting valid JSON keeps Save enabled and shows '1 clause' status", async () => {
    renderEditor(rawTile());
    const textareas = document.querySelectorAll("textarea");
    const clausesTextarea = Array.from(textareas).find((t) =>
      t.value.includes("\"$type\":"),
    ) as HTMLTextAreaElement;
    fireEvent.change(clausesTextarea, {
      target: {
        value: '[{ "$type": "count" }]',
      },
    });
    await waitFor(
      () => {
        expect(screen.getByText(/1 clause/i)).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    const saveBtn = screen.getByRole("button", { name: /Save tile/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("strips //-style comments and reports them in the status row", async () => {
    renderEditor(rawTile());
    const textareas = document.querySelectorAll("textarea");
    const clausesTextarea = Array.from(textareas).find((t) =>
      t.value.includes("\"$type\":"),
    ) as HTMLTextAreaElement;
    fireEvent.change(clausesTextarea, {
      target: {
        value: `[
          // this is a comment
          { "$type": "count" } // and another
        ]`,
      },
    });
    await waitFor(
      () => {
        expect(screen.getByText(/Stripped 2 line comments/i)).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });
});
