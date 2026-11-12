import type { ReactNode } from "react";
import type { TableColumnDefinition } from "@fluentui/react-components";

export type ColumnKind = "string" | "number" | "boolean" | "date" | "category";
export interface ViewColumn<T> {
  id: string;
  label: string;
  kind?: ColumnKind;
  value: (row: T) => unknown;
  exportValue?: (row: T) => unknown;
  render?: (row: T) => ReactNode;
  defaultVisible?: boolean;
  width?: number;
  action?: boolean;
}
export type FilterOperator = "contains" | "equals" | "gt" | "lt" | "from" | "through" | "in" | "empty" | "notEmpty";
export interface ColumnFilter {
  op: FilterOperator;
  value: string;
  values?: string[];
}
export interface TableView {
  version: 1;
  columns: string[];
  widths: Record<string, number>;
  filters: Record<string, ColumnFilter>;
  sort?: { id: string; direction: "ascending" | "descending" };
}
const operators = new Set(["contains", "equals", "gt", "lt", "from", "through", "in", "empty", "notEmpty"]);
export function isTableView(value: unknown): value is TableView {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.columns) || !v.columns.every((c) => typeof c === "string") ||
    !v.widths || typeof v.widths !== "object" || Array.isArray(v.widths) ||
    !Object.values(v.widths).every((w) => typeof w === "number" && Number.isFinite(w) && w >= 100 && w <= 800) ||
    !v.filters || typeof v.filters !== "object" || Array.isArray(v.filters)) return false;
  if (!Object.values(v.filters).every((f: unknown) => {
    if (!f || typeof f !== "object") return false;
    const filter = f as Record<string, unknown>;
    return typeof filter.op === "string" && operators.has(filter.op) && typeof filter.value === "string" &&
      (filter.values === undefined || (Array.isArray(filter.values) && filter.values.every((s) => typeof s === "string")));
  })) return false;
  if (v.sort !== undefined) {
    if (!v.sort || typeof v.sort !== "object") return false;
    const sort = v.sort as Record<string, unknown>;
    if (typeof sort.id !== "string" || !["ascending", "descending"].includes(String(sort.direction))) return false;
  }
  return true;
}
export function defaultView<T>(columns: ViewColumn<T>[]): TableView {
  const visible = columns.filter((c) => c.defaultVisible !== false).map((c) => c.id);
  if (!columns.some((c) => !c.action && visible.includes(c.id))) {
    const first = columns.find((c) => !c.action);
    if (first) visible.unshift(first.id);
  }
  return { version: 1, columns: visible, widths: {}, filters: {} };
}
export function allowedOperators(kind: ColumnKind = "string"): FilterOperator[] {
  const base: FilterOperator[] = kind === "number" ? ["equals", "gt", "lt"] :
    kind === "date" ? ["from", "through"] :
      kind === "boolean" || kind === "category" ? ["in"] : ["contains", "equals"];
  return [...base, "empty", "notEmpty"];
}
export function validFilter(filter: ColumnFilter, kind: ColumnKind = "string"): boolean {
  if (!allowedOperators(kind).includes(filter.op)) return false;
  if (filter.op === "empty" || filter.op === "notEmpty") return true;
  if (filter.op === "in") return !!filter.values?.length;
  if (!filter.value.trim()) return false;
  if (kind === "number") return Number.isFinite(Number(filter.value));
  if (kind === "date") {
    const time = Date.parse(filter.value);
    return /^\d{4}-\d{2}-\d{2}$/.test(filter.value) && Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === filter.value;
  }
  return true;
}
export function reconcileView<T>(view: TableView, columns: ViewColumn<T>[]): TableView {
  const ids = new Set(columns.map((c) => c.id));
  const visible = [...new Set(view.columns)].filter((id) => ids.has(id));
  for (const column of columns.filter((c) => c.action)) if (!visible.includes(column.id)) visible.push(column.id);
  if (!columns.some((c) => !c.action && visible.includes(c.id))) {
    visible.unshift(...defaultView(columns).columns.filter((id) => !visible.includes(id)));
  }
  const filters = Object.entries(view.filters).filter(([id, filter]) => {
    const column = columns.find((c) => c.id === id);
    return column && !column.action && validFilter(filter, column.kind);
  });
  return {
    version: 1, columns: visible,
    widths: Object.fromEntries(Object.entries(view.widths).filter(([id]) => ids.has(id))),
    filters: filters.length === Object.keys(view.filters).length ? view.filters : Object.fromEntries(filters),
    sort: columns.some((c) => c.id === view.sort?.id && !c.action) ? view.sort : undefined,
  };
}
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function comparable(value: unknown, kind?: ColumnKind): string | number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (kind === "number") return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (kind === "date") {
    const date = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(date) ? date : undefined;
  }
  if (kind === "boolean") return typeof value === "boolean" ? Number(value) : undefined;
  return valueText(value);
}
export function matchesFilter(value: unknown, filter: ColumnFilter, kind?: ColumnKind): boolean {
  const actual = comparable(value, kind);
  if (filter.op === "empty") return actual === undefined;
  if (filter.op === "notEmpty") return actual !== undefined;
  if (actual === undefined) return false;
  if (filter.op === "in") return !!filter.values?.includes(valueText(value));
  if (filter.op === "contains") return String(actual).toLocaleLowerCase().includes(filter.value.toLocaleLowerCase());
  if (filter.op === "from") return Number(actual) >= Date.parse(filter.value);
  if (filter.op === "through") return Number(actual) < Date.parse(filter.value) + 86_400_000;
  const expected = kind === "number" ? Number(filter.value) : filter.value;
  if (filter.op === "gt") return Number(actual) > Number(expected);
  if (filter.op === "lt") return Number(actual) < Number(expected);
  return typeof actual === "number" ? actual === expected : actual.toLocaleLowerCase() === String(expected).toLocaleLowerCase();
}
export function applyView<T>(rows: T[], columns: ViewColumn<T>[], view: Pick<TableView, "filters" | "sort">): T[] {
  const lookup = new Map(columns.map((c) => [c.id, c]));
  const filtered = rows.filter((row) => Object.entries(view.filters).every(([id, filter]) => {
    const column = lookup.get(id);
    return !column || matchesFilter(column.value(row), filter, column.kind);
  }));
  const column = view.sort && lookup.get(view.sort.id);
  if (!column || !view.sort) return filtered;
  const direction = view.sort.direction === "ascending" ? 1 : -1;
  return filtered.sort((a, b) => {
    const av = comparable(column.value(a), column.kind);
    const bv = comparable(column.value(b), column.kind);
    if (av === undefined) return bv === undefined ? 0 : 1;
    if (bv === undefined) return -1;
    return direction * (typeof av === "number" && typeof bv === "number" ? av - bv :
      String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }));
  });
}
export function viewCsv<T>(rows: T[], columns: ViewColumn<T>[], view: TableView): string {
  const visible = view.columns.map((id) => columns.find((c) => c.id === id)).filter((c): c is ViewColumn<T> => !!c && !c.action);
  const quote = (value: unknown) => {
    const text = valueText(value);
    return `"${(typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
  };
  return [visible.map((c) => quote(c.label)), ...rows.map((row) => visible.map((c) => quote((c.exportValue ?? c.value)(row))))]
    .map((row) => row.join(",")).join("\r\n");
}
export function fromFluentColumns<T>(
  columns: TableColumnDefinition<T>[],
  metadata: Partial<Record<string, Partial<Omit<ViewColumn<T>, "id" | "render">>>> = {},
): ViewColumn<T>[] {
  return columns.map((column) => {
    const id = String(column.columnId);
    const header: ReactNode = column.renderHeaderCell();
    return {
      id, label: typeof header === "string" ? header : id,
      value: (row: T) => row && typeof row === "object" ? (row as Record<string, unknown>)[id] : undefined,
      ...metadata[id], render: (row) => column.renderCell(row),
    };
  });
}
