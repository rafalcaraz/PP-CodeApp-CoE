import { describe, expect, it } from "vitest";
import { applyView, defaultView, isTableView, matchesFilter, reconcileView, validFilter, viewCsv, type ViewColumn } from "./model";

interface Row { id: string; name: string; count?: number; date?: string; enabled?: boolean; group?: string }
const columns: ViewColumn<Row>[] = [
  { id: "name", label: "Name", value: (row) => row.name },
  { id: "count", label: "Count", kind: "number", value: (row) => row.count },
  { id: "date", label: "Date", kind: "date", value: (row) => row.date },
  { id: "enabled", label: "Enabled", kind: "boolean", value: (row) => row.enabled },
  { id: "group", label: "Group", kind: "category", value: (row) => row.group, defaultVisible: false },
  { id: "inspect", label: "Inspect", value: () => "", action: true },
];
const rows: Row[] = [
  { id: "a", name: "Alpha", count: 10, date: "2026-01-02T23:59:59Z", enabled: true, group: "East" },
  { id: "b", name: "Bravo", count: 2, date: "2026-01-03T00:00:00Z", enabled: false, group: "West" },
  { id: "c", name: "Charlie", count: 0, date: "invalid" },
  { id: "d", name: "ALPHA", count: 10, enabled: true, group: "North" },
  { id: "e", name: "Delta" },
];
describe("table view transformations", () => {
  it("combines columns with AND and categorical selections with OR without changing source rows", () => {
    const view = defaultView(columns);
    view.filters = {
      name: { op: "contains", value: "ALP" },
      group: { op: "in", value: "", values: ["East", "North"] },
      count: { op: "gt", value: "2" },
    };
    expect(applyView(rows, columns, view).map((row) => row.id)).toEqual(["a", "d"]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("sorts numbers numerically, preserves ties, and keeps missing values last in either direction", () => {
    const view = { ...defaultView(columns), sort: { id: "count", direction: "ascending" as const } };
    expect(applyView(rows, columns, view).map((row) => row.id)).toEqual(["c", "b", "a", "d", "e"]);
    expect(applyView(rows, columns, { ...view, sort: { id: "count", direction: "descending" } }).map((row) => row.id)).toEqual(["a", "d", "b", "c", "e"]);
  });
  it("distinguishes false and zero from missing data", () => {
    expect(matchesFilter(false, { op: "in", value: "", values: ["false"] }, "boolean")).toBe(true);
    expect(matchesFilter(undefined, { op: "in", value: "", values: ["false"] }, "boolean")).toBe(false);
    expect(matchesFilter(0, { op: "empty", value: "" }, "number")).toBe(false);
    expect(matchesFilter(false, { op: "notEmpty", value: "" }, "boolean")).toBe(true);
    expect(matchesFilter(undefined, { op: "equals", value: "0" }, "number")).toBe(false);
  });
  it("compares actual dates with inclusive UTC date bounds and rejects invalid dates as not reported", () => {
    const view = { ...defaultView(columns), filters: { date: { op: "through" as const, value: "2026-01-02" } } };
    expect(applyView(rows, columns, view).map((row) => row.id)).toEqual(["a"]);
    expect(matchesFilter("2026-01-02T23:00:00-02:00", view.filters.date, "date")).toBe(false);
    expect(matchesFilter("invalid", { op: "empty", value: "" }, "date")).toBe(true);
    expect(validFilter({ op: "from", value: "2026-02-31" }, "date")).toBe(false);
  });
  it("reconciles removed fields and changed types while retaining a data column and fixed actions", () => {
    const old = {
      ...defaultView(columns), columns: ["gone"], widths: { gone: 200, count: 240 },
      filters: { gone: { op: "contains" as const, value: "x" }, count: { op: "contains" as const, value: "1" } },
      sort: { id: "gone", direction: "ascending" as const },
    };
    const restored = reconcileView(old, columns);
    expect(restored.columns).toContain("name");
    expect(restored.columns).toContain("inspect");
    expect(restored.columns).not.toContain("gone");
    expect(restored.filters).toEqual({});
    expect(restored.widths).toEqual({ count: 240 });
    expect(restored.sort).toBeUndefined();
    expect(isTableView({ ...old, widths: { count: -1 } })).toBe(false);
  });
  it("exports the transformed rows and selected column order with raw values, not action/render text", () => {
    const exportColumns = columns.map((column) => column.id === "name" ? { ...column, render: () => "Friendly name", exportValue: (row: Row) => row.id } : column);
    const view = { ...defaultView(columns), columns: ["count", "name", "inspect"], filters: { enabled: { op: "in" as const, value: "", values: ["true"] } } };
    expect(viewCsv(applyView(rows, columns, view), exportColumns, view)).toBe('"Count","Name"\r\n"10","a"\r\n"10","d"');
    expect(viewCsv([{ id: "x", name: '=HYPERLINK("x")', count: -2 }], columns, { ...view, columns: ["name", "count"] }))
      .toBe('"Name","Count"\r\n"\'=HYPERLINK(""x"")","-2"');
  });
});
