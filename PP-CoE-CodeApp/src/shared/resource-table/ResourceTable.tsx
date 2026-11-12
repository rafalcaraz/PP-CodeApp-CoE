import { useMemo, useState } from "react";
import {
  Button, Checkbox, DataGrid, DataGridBody, DataGridCell, DataGridHeader, DataGridHeaderCell,
  DataGridRow, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger,
  Dropdown, Field, Input, Option, Popover, PopoverSurface, PopoverTrigger, Text,
  createTableColumn, makeStyles, tokens,
} from "@fluentui/react-components";
import {
  allowedOperators, applyView, defaultView, validFilter, valueText, viewCsv,
  type ColumnFilter, type FilterOperator, type TableView, type ViewColumn,
} from "./model";
import { useTableView, type ViewPersistence } from "./useTableView";
import { ChevronDownRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  root: { minWidth: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.spacingHorizontalS },
  scroll: { overflowX: "auto", maxWidth: "100%" },
  row: { display: "flex", minWidth: "max-content" },
  cell: { flexShrink: 0, flexGrow: 0, minWidth: 0, boxSizing: "border-box", overflowWrap: "anywhere", whiteSpace: "normal" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" },
  resize: { cursor: "col-resize", width: "8px", flexShrink: 0, alignSelf: "stretch", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, touchAction: "none" },
  controls: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: "220px" },
  choices: { maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  choice: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS, alignItems: "center" },
  label: { flex: "1 1 160px" },
  width: { width: "90px" },
  muted: { color: tokens.colorNeutralForeground3 },
});
const operatorLabels: Record<FilterOperator, string> = {
  contains: "Contains", equals: "Equals", gt: "Greater than", lt: "Less than",
  from: "On or after (UTC)", through: "On or before (UTC)", in: "Any selected value",
  empty: "Is empty / not reported", notEmpty: "Is not empty",
};
function Header<T>({ column, rows, view, change }: {
  column: ViewColumn<T>; rows: T[]; view: TableView; change: (view: TableView) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const active = Object.hasOwn(view.filters, column.id) ? view.filters[column.id] : undefined;
  const [draft, setDraft] = useState<ColumnFilter>(active ?? { op: allowedOperators(column.kind)[0], value: "" });
  const options = useMemo(() => column.kind === "boolean" ? ["true", "false"] :
    column.kind === "category" ? [...new Set(rows.map((row) => valueText(column.value(row))).filter(Boolean))].sort() : [], [column, rows]);
  const setFilter = (filter?: ColumnFilter) => {
    const filters = filter ? { ...view.filters, [column.id]: filter } :
      Object.fromEntries(Object.entries(view.filters).filter(([id]) => id !== column.id));
    change({ ...view, filters });
    setOpen(false);
  };
  const sort = (direction?: "ascending" | "descending") => {
    change({ ...view, sort: direction ? { id: column.id, direction } : undefined });
    setOpen(false);
  };
  if (column.action) return column.label;
  return <Popover open={open} onOpenChange={(_e, data) => {
    setOpen(data.open);
    if (data.open) setDraft(active ?? { op: allowedOperators(column.kind)[0], value: "" });
  }}>
    <PopoverTrigger disableButtonEnhancement>
      <Button size="small" appearance="subtle" icon={<ChevronDownRegular />} iconPosition="after" aria-label={`${column.label} column options`}>
        {column.label}{view.sort?.id === column.id ? view.sort.direction === "ascending" ? " ↑" : " ↓" : ""}{active ? " •" : ""}
      </Button>
    </PopoverTrigger>
    <PopoverSurface>
      <div className={styles.controls}>
        <Text weight="semibold">{column.label}</Text>
        <Button onClick={() => sort("ascending")}>Sort ascending</Button>
        <Button onClick={() => sort("descending")}>Sort descending</Button>
        {view.sort && <Button onClick={() => sort()}>Clear sort</Button>}
        <Field label="Column filter">
          <Dropdown aria-label={`${column.label} filter operator`} value={operatorLabels[draft.op]} selectedOptions={[draft.op]}
            onOptionSelect={(_e, data) => {
              const op = allowedOperators(column.kind).find((o) => o === data.optionValue);
              if (op) setDraft({ op, value: "" });
            }}>
            {allowedOperators(column.kind).map((op) => <Option key={op} value={op}>{operatorLabels[op]}</Option>)}
          </Dropdown>
        </Field>
        {draft.op === "in" ? <Field label="Values (match any)">
          <Dropdown aria-label={`${column.label} filter values`} multiselect
            value={(draft.values ?? []).join(", ")} selectedOptions={draft.values ?? []}
            onOptionSelect={(_e, data) => setDraft({ ...draft, values: data.selectedOptions })}>
            {[...new Set([...options, ...(draft.values ?? [])])].map((value) => <Option key={value} value={value}>{value}</Option>)}
          </Dropdown>
        </Field> : !["empty", "notEmpty"].includes(draft.op) && <Field label={column.kind === "date" ? "Date (UTC)" : "Value"}>
          <Input aria-label={`${column.label} filter value`} type={column.kind === "number" ? "number" : column.kind === "date" ? "date" : "text"}
            value={draft.value} onChange={(_e, data) => setDraft({ ...draft, value: data.value })} />
        </Field>}
        <Button appearance="primary" disabled={!validFilter(draft, column.kind)} onClick={() => setFilter(draft)}>Apply filter</Button>
        <Button disabled={!active} onClick={() => setFilter()}>Clear filter</Button>
      </div>
    </PopoverSurface>
  </Popover>;
}
export interface ResourceTableProps<T> {
  columns: ViewColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  label: string;
  persistence?: ViewPersistence;
  scope?: string;
  pageSize?: number;
  pageResetKey?: string;
  exportDisabled?: boolean;
}
export function ResourceTable<T>(props: ResourceTableProps<T>) {
  const { columns, rows, label, pageSize } = props;
  const { view, change, error } = useTableView(columns, props.persistence);
  const styles = useStyles();
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ index: 0, reset: props.pageResetKey });
  const [exportError, setExportError] = useState("");
  const [resize, setResize] = useState<{ id: string; x: number; width: number }>();
  const filtered = useMemo(() => applyView(rows, columns, { filters: view.filters, sort: view.sort }), [rows, columns, view.filters, view.sort]);
  const visible = view.columns.map((id) => columns.find((c) => c.id === id)).filter((c): c is ViewColumn<T> => !!c);
  const setPageIndex = (index: number) => setPage({ index, reset: props.pageResetKey });
  const update = (next: TableView) => { setPageIndex(0); change(next); };
  const width = (column: ViewColumn<T>) => (Object.hasOwn(view.widths, column.id) ? view.widths[column.id] : undefined) ?? column.width ?? 200;
  const size = (id: string, value: number, persist = true) => change({ ...view, widths: { ...view.widths, [id]: Math.min(800, Math.max(100, value)) } }, false, persist);
  const pageCount = pageSize ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const currentPage = Math.min(page.reset === props.pageResetKey ? page.index : 0, pageCount - 1);
  const displayed = pageSize ? filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : filtered;
  const gridColumns = visible.map((column) => createTableColumn<T>({
    columnId: column.id,
    renderHeaderCell: () => <Header column={column} rows={rows} view={view} change={update} />,
    renderCell: (row) => column.render ? column.render(row) : valueText(column.value(row)) || "Not reported",
  }));
  const move = (id: string, delta: number) => {
    const order = view.columns.slice();
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    update({ ...view, columns: order });
  };
  const exportView = () => {
    try {
      const blob = new Blob(["\uFEFF", viewCsv(filtered, columns, view)], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-current-view.csv`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportError("");
    } catch (cause) {
      setExportError(`View export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  const columnPicker = <Dialog open={picker} onOpenChange={(_e, data) => setPicker(data.open)}>
    <DialogTrigger disableButtonEnhancement><Button aria-expanded={picker}>Columns</Button></DialogTrigger>
    <DialogSurface><DialogBody><DialogTitle>Columns</DialogTitle><DialogContent>
      <div className={styles.controls}>
        <Input aria-label="Search columns" value={search} placeholder="Search columns" onChange={(_e, data) => setSearch(data.value)} />
        <div className={styles.choices}>
          {[...visible, ...columns.filter((c) => !view.columns.includes(c.id))].filter((c) => c.label.toLowerCase().includes(search.toLowerCase())).map((column) => {
            const selected = view.columns.includes(column.id);
            return <div className={styles.choice} key={column.id}>
              <Checkbox className={styles.label} label={column.label} checked={selected}
                disabled={column.action || (selected && visible.filter((c) => !c.action).length === 1)}
                onChange={(_e, data) => {
                  const filters = { ...view.filters };
                  if (!data.checked) delete filters[column.id];
                  update({ ...view, columns: data.checked ? [...view.columns, column.id] : view.columns.filter((id) => id !== column.id),
                    filters, sort: !data.checked && view.sort?.id === column.id ? undefined : view.sort });
                }} />
              {selected && <>
                <Button size="small" aria-label={`Move ${column.label} earlier`} disabled={view.columns.indexOf(column.id) === 0} onClick={() => move(column.id, -1)}>Earlier</Button>
                <Button size="small" aria-label={`Move ${column.label} later`} disabled={view.columns.indexOf(column.id) === visible.length - 1} onClick={() => move(column.id, 1)}>Later</Button>
                <Input className={styles.width} type="number" min={100} max={800} step={20} aria-label={`${column.label} width`} value={String(width(column))}
                  onChange={(_e, data) => { if (data.value && Number.isFinite(Number(data.value))) size(column.id, Number(data.value)); }} />
              </>}
            </div>;
          })}
        </div>
      </div>
    </DialogContent><DialogActions><Button onClick={() => setPicker(false)}>Done</Button></DialogActions></DialogBody></DialogSurface>
  </Dialog>;
  return <div className={styles.root}>
    <div className={styles.toolbar}>
      {columnPicker}
      <Button disabled={!Object.keys(view.filters).length} onClick={() => update({ ...view, filters: {} })}>Clear column filters</Button>
      <Button onClick={() => { setPageIndex(0); change(defaultView(columns), true); }}>Reset view</Button>
      <Button disabled={!filtered.length || props.exportDisabled} onClick={exportView}>Export current view</Button>
      <Text role="status">{filtered.length.toLocaleString()} matching / {rows.length.toLocaleString()} loaded</Text>
    </div>
    <Text size={200} className={styles.muted}>{props.scope ?? "Sort and column filters apply to loaded rows only."}</Text>
    {Object.entries(view.filters).map(([id, filter]) => <Text key={id} size={200}>
      {columns.find((c) => c.id === id)?.label}: {operatorLabels[filter.op]} {filter.values?.join(", ") ?? filter.value}
      <Button size="small" appearance="subtle" aria-label={`Remove ${columns.find((c) => c.id === id)?.label} filter`} onClick={() => {
        const filters = { ...view.filters }; delete filters[id]; update({ ...view, filters });
      }}>Remove</Button>
    </Text>)}
    {(error || exportError) && <Text role="alert">{[error, exportError].filter(Boolean).join(" ")}</Text>}
    <div className={styles.scroll} role="region" aria-label={label} tabIndex={0}>
      <DataGrid key={JSON.stringify(view.columns)} items={displayed} columns={gridColumns} getRowId={props.getRowId} sortable={false} focusMode="composite"
        style={{ minWidth: visible.reduce((sum, column) => sum + width(column), 0) }}>
        <DataGridHeader><DataGridRow className={styles.row}>
          {({ renderHeaderCell, columnId }) => {
            const column = visible.find((c) => c.id === columnId)!;
            return <DataGridHeaderCell className={styles.cell} style={{ width: width(column), flexBasis: width(column) }}
              aria-sort={view.sort?.id === column.id ? view.sort.direction : "none"}>
              <div className={styles.header}>{renderHeaderCell()}
                <div role="separator" aria-label={`Resize ${column.label}`} aria-orientation="vertical" aria-valuenow={width(column)} aria-valuemin={100} aria-valuemax={800}
                  data-tabster='{"focusable":{"ignoreKeydown":{"ArrowLeft":true,"ArrowRight":true}}}'
                  tabIndex={0} className={styles.resize}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault(); event.stopPropagation();
                      size(column.id, width(column) + (event.key === "ArrowLeft" ? -20 : 20));
                    }
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
                    setResize({ id: column.id, x: event.clientX, width: width(column) });
                  }}
                  onPointerMove={(event) => { if (resize?.id === column.id) size(column.id, resize.width + event.clientX - resize.x, false); }}
                  onPointerUp={() => { setResize(undefined); change(view); }}
                  onLostPointerCapture={() => { if (resize) { setResize(undefined); change(view); } }} />
              </div>
            </DataGridHeaderCell>;
          }}
        </DataGridRow></DataGridHeader>
        <DataGridBody<T>>{({ item, rowId }) => <DataGridRow<T> key={rowId} className={styles.row}>
          {({ renderCell, columnId }) => {
            const column = visible.find((c) => c.id === columnId)!;
            return <DataGridCell className={styles.cell} style={{ width: width(column), flexBasis: width(column) }}>{renderCell(item)}</DataGridCell>;
          }}
        </DataGridRow>}</DataGridBody>
      </DataGrid>
    </div>
    {!filtered.length && <Text>No matching loaded rows. Clear column filters or load more results.</Text>}
    {pageSize && <div className={styles.toolbar}>
      <Text>Page {currentPage + 1} of {pageCount} · {filtered.length.toLocaleString()} {label.toLowerCase()}</Text>
      <Button disabled={currentPage === 0} onClick={() => setPageIndex(currentPage - 1)}>Previous</Button>
      <Button disabled={currentPage + 1 >= pageCount} onClick={() => setPageIndex(currentPage + 1)}>Next</Button>
    </div>}
  </div>;
}
