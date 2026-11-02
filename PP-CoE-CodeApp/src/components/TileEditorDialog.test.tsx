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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { DashboardTile } from "../data/dashboards";
import type { SavedQuery } from "../data/savedQueries";

const { savedQueries } = vi.hoisted(() => ({ savedQueries: vi.fn<() => SavedQuery[]>(() => []) }));

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
  return { ...actual, listSavedQueries: savedQueries };
});

import { TileEditorDialog } from "./TileEditorDialog";
import { buildClausesFromSpec, formatQueryConditionSummary } from "../data/inventory";

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
  beforeEach(() => { savedQueries.mockReturnValue([]); });

  const groupedTile = () => {
    const tile = visualTile();
    tile.spec.conditions = {
      kind: "group", operator: "all", children: [
        { kind: "condition", filter: { field: "properties.isManaged", op: "==", value: "false" } },
        { kind: "group", operator: "any", children: [
          { kind: "condition", filter: { field: "location", op: "==", value: "west" } },
          { kind: "condition", filter: { field: "location", op: "==", value: "east" } },
        ] },
      ],
    };
    return tile;
  };

  it("preserves grouped saved specs on visualization edits and makes filters accurately read-only", () => {
    const tile = groupedTile();
    const onSave = vi.fn();
    renderEditor(tile, onSave);
    expect(screen.getByText(formatQueryConditionSummary(tile.spec))).toBeInTheDocument();
    expect(screen.getByText(/Grouped conditions \(read-only\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add filter" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("combobox").find((element) => element.getAttribute("value") === "KPI")!);
    fireEvent.click(screen.getByRole("option", { name: "Table" }));
    fireEvent.click(screen.getByRole("button", { name: /Save tile/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      source: "builder", spec: tile.spec, viz: expect.objectContaining({ type: "table" }),
    }));
  });

  it("converts grouped specs to exactly equivalent runnable Advanced clauses", async () => {
    const tile = groupedTile();
    const onSave = vi.fn();
    renderEditor(tile, onSave);
    fireEvent.click(screen.getByRole("button", { name: /Advanced \(clauses\)/ }));
    const textarea = Array.from(document.querySelectorAll("textarea"))
      .find((element) => element.value.includes("\"$type\""))!;
    expect(JSON.parse(textarea.value)).toEqual(buildClausesFromSpec(tile.spec));
    await waitFor(() => expect(screen.getByRole("button", { name: /Save tile/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Save tile/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      source: "raw", clauses: buildClausesFromSpec(tile.spec),
    }));
  });

  it("loads a grouped saved query in Advanced mode without falling back to legacy empty filters", () => {
    const querySpec = groupedTile().spec;
    savedQueries.mockReturnValue([{
      id: "grouped", name: "Grouped query", description: "", source: "builder",
      spec: querySpec, clauses: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }]);
    renderEditor(rawTile());
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(screen.getByRole("option", { name: /Grouped query/ }));
    const textarea = Array.from(document.querySelectorAll("textarea"))
      .find((element) => element.value.includes("\"$type\""))!;
    expect(JSON.parse(textarea.value)).toEqual(buildClausesFromSpec(querySpec));
  });

  it.each(["flat", "grouped"])("disables %s paired saved-query choices in Advanced mode with explanatory helper copy", (shape) => {
    const pairedSpec = visualTile().spec;
    pairedSpec.filters = [{ field: "__operation", op: "==", value: "DeleteItem", connectorId: "sharepointonline" }];
    if (shape === "grouped") {
      pairedSpec.conditions = { kind: "group", operator: "any", children: [
        { kind: "condition", filter: pairedSpec.filters[0] },
      ] };
      pairedSpec.filters = [];
    }
    savedQueries.mockReturnValue([{
      id: "paired-query",
      name: "Paired delete operation",
      description: "",
      source: "builder",
      spec: pairedSpec,
      clauses: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }]);
    renderEditor(rawTile());
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getByRole("option", { name: /Paired delete operation/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/cannot be loaded as raw clauses/)).toBeInTheDocument();
  });

  it.each(["flat", "grouped"])("prevents %s paired operation specs from being silently converted into raw clauses", (shape) => {
    const tile = visualTile();
    tile.spec.filters = [{ field: "__operation", op: "==", value: "DeleteItem", connectorId: "sharepointonline" }];
    if (shape === "grouped") {
      tile.spec.conditions = { kind: "group", operator: "any", children: [
        { kind: "condition", filter: tile.spec.filters[0] },
      ] };
      tile.spec.filters = [];
    }
    renderEditor(tile);
    expect(screen.getByRole("button", { name: /Advanced \(clauses\)/i })).toBeDisabled();
    expect(screen.getByText(/cannot be converted to raw clauses/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Insert clause/i })).not.toBeInTheDocument();
  });
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
