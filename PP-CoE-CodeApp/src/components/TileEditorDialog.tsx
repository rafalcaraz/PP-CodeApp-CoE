import { useEffect, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Input,
  Dropdown,
  Option,
  OptionGroup,
  Combobox,
  Button,
  Badge,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Divider,
  type InputOnChangeData,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowDownRegular,
  ArrowUpRegular,
  DeleteRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import {
  ALL_RESOURCE_TYPES,
  ResourceType,
  resourceTypeShort,
  type QueryFilter,
  type QueryFilterOp,
  type ResourceTypeValue,
} from "../data/inventory";
import {
  getFieldSuggestions,
  groupFields,
  type FieldPickerIntent,
  type InventoryField,
} from "../data/inventory.fields";
import type {
  DashboardTile,
  TileLineMode,
  TileTableColumn,
  TileTimeBucket,
  TileVizType,
} from "../data/dashboards";
import { listSavedQueries, type SavedQuery } from "../data/savedQueries";
import { TileView } from "./TileView";

const useStyles = makeStyles({
  surface: {
    maxWidth: "1100px",
    width: "calc(100vw - 48px)",
  },
  layout: {
    display: "flex",
    gap: tokens.spacingHorizontalXL,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  formCol: {
    flex: "1 1 480px",
    minWidth: 0,
  },
  previewCol: {
    flex: "0 1 380px",
    minWidth: "320px",
    position: "sticky",
    top: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  previewHeader: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  previewHost: {
    height: "360px",
    width: "100%",
    display: "flex",
    "> .fui-Card": {
      flex: "1 1 auto",
      width: "100%",
      minWidth: 0,
      height: "100%",
    },
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
  },
  label: {
    minWidth: "120px",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  filterRow: {
    display: "grid",
    gridTemplateColumns: "minmax(200px, 2fr) 130px minmax(160px, 2fr) auto",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  columnRow: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 2fr) minmax(140px, 1fr) auto auto auto",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  helper: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  loaderRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  rawNotice: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    flexWrap: "wrap",
  },
  rawNoticeText: {
    flex: "1 1 auto",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  rawJson: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "auto",
    maxHeight: "200px",
    whiteSpace: "pre",
  },
});

const OPERATORS: { value: QueryFilterOp; label: string }[] = [
  { value: "==", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "!contains", label: "does not contain" },
  { value: "startswith", label: "starts with" },
  { value: "!startswith", label: "does not start with" },
  { value: "endswith", label: "ends with" },
  { value: "!endswith", label: "does not end with" },
  { value: "in~", label: "in" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
  { value: "lastNdays", label: "in last (days)" },
];

const VIZ_TYPES: { value: TileVizType; label: string; hint: string }[] = [
  { value: "kpi", label: "KPI", hint: "Single big number — the total record count." },
  { value: "table", label: "Table", hint: "Top N rows from the query." },
  { value: "bar", label: "Bar chart", hint: "Grouped counts by a chosen field." },
  { value: "pie", label: "Pie chart", hint: "Distribution by a chosen field." },
  { value: "line", label: "Line chart", hint: "Trend over time — creations per bucket, or running total." },
  { value: "combo", label: "Combo (bars + line)", hint: "Bars = created per bucket, line = running total. Both stories in one tile." },
];

const BUCKET_OPTIONS: { value: TileTimeBucket; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const LINE_MODE_OPTIONS: { value: TileLineMode; label: string; hint: string }[] = [
  { value: "delta", label: "Per bucket (creations)", hint: "Count of records *created* in each bucket." },
  { value: "cumulative", label: "Cumulative (running total)", hint: "Running total of records that existed by the end of each bucket." },
];

/** Heuristic: filter values for these field paths are dates, so render a small
 *  hint near the value input. */
function isDateField(field: string): boolean {
  const f = field.trim().toLowerCase();
  return f.endsWith("at") || f.endsWith("date") || f.endsWith("on");
}

interface TileEditorDialogProps {
  open: boolean;
  initialTile: DashboardTile;
  onClose: () => void;
  onSave: (tile: DashboardTile) => void;
}

/** Renders an `InventoryField[]` as Fluent `<OptionGroup>` sections.
 *  Used by every field-picker Combobox in this dialog so they all share
 *  the same grouped-by-source UX. */
function FieldOptions({ fields }: { fields: InventoryField[] }) {
  const groups = useMemo(() => groupFields(fields), [fields]);
  return (
    <>
      {groups.map((g) => (
        <OptionGroup key={g.label} label={g.label}>
          {g.fields.map((f) => (
            <Option key={f.path} value={f.path} text={f.path}>
              {f.label}
              <span style={{ marginLeft: 8, opacity: 0.6, fontSize: "0.85em" }}>
                {f.path}
              </span>
            </Option>
          ))}
        </OptionGroup>
      ))}
    </>
  );
}

export function TileEditorDialog({ open, initialTile, onClose, onSave }: TileEditorDialogProps) {
  const styles = useStyles();
  const [tile, setTile] = useState<DashboardTile>(initialTile);

  // Reset internal state whenever the dialog (re)opens with a new tile.
  // The parent passes a fresh `initialTile` each open.
  if (open && tile.id !== initialTile.id) setTile(initialTile);

  // Snapshot of saved queries taken when the dialog opens. We don't poll —
  // the user can't add/delete saved queries from inside this dialog, so a
  // single read per open keeps the picker stable.
  const savedQueries = useMemo<SavedQuery[]>(
    () => (open ? listSavedQueries() : []),
    [open]
  );

  const linkedSaved = useMemo(
    () =>
      tile.savedQueryId
        ? savedQueries.find((q) => q.id === tile.savedQueryId) ?? null
        : null,
    [savedQueries, tile.savedQueryId]
  );

  const isRaw = tile.source === "raw";

  // Debounced copy of `tile` used by the live preview so we don't fire a
  // fresh inventory query on every keystroke. ~400ms feels responsive but
  // still cheap.
  const [previewTile, setPreviewTile] = useState<DashboardTile>(tile);
  useEffect(() => {
    const handle = window.setTimeout(() => setPreviewTile(tile), 400);
    return () => window.clearTimeout(handle);
  }, [tile]);

  const setSpec = (patch: Partial<DashboardTile["spec"]>) =>
    setTile((prev) => ({ ...prev, spec: { ...prev.spec, ...patch } }));

  const setViz = (patch: Partial<DashboardTile["viz"]>) =>
    setTile((prev) => ({ ...prev, viz: { ...prev.viz, ...patch } }));

  const applySavedQuery = (q: SavedQuery) => {
    if (q.source === "builder" && q.spec) {
      // Basic saved query: prefill the visual builder. No persistent linkage —
      // the user can edit freely from here. We DO record `savedQueryId` so
      // the picker shows the source as a hint until they change it.
      setTile((prev) => ({
        ...prev,
        spec: q.spec!,
        source: "builder",
        clauses: undefined,
        savedQueryId: q.id,
      }));
    } else {
      // Advanced saved query: switch to raw mode. The visual builder hides;
      // only KPI and Table viz types remain valid. Force the viz if needed.
      const nextVizType: TileVizType =
        tile.viz.type === "kpi" || tile.viz.type === "table"
          ? tile.viz.type
          : "kpi";
      setTile((prev) => ({
        ...prev,
        source: "raw",
        clauses: q.clauses,
        savedQueryId: q.id,
        viz: { ...prev.viz, type: nextVizType },
      }));
    }
  };

  const disconnectSaved = () => {
    // Return to manual builder mode. Keep whatever spec is currently in state
    // (in case the user already edited it) but drop the raw clauses.
    setTile((prev) => ({
      ...prev,
      source: "builder",
      clauses: undefined,
      savedQueryId: undefined,
    }));
  };

  const updateFilter = (idx: number, patch: Partial<QueryFilter>) => {
    setTile((prev) => ({
      ...prev,
      spec: {
        ...prev.spec,
        filters: prev.spec.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
      },
    }));
  };

  const addFilter = () =>
    setTile((prev) => ({
      ...prev,
      spec: {
        ...prev.spec,
        filters: [...prev.spec.filters, { field: "", op: "==", value: "" }],
      },
    }));

  const removeFilter = (idx: number) =>
    setTile((prev) => ({
      ...prev,
      spec: {
        ...prev.spec,
        filters: prev.spec.filters.filter((_, i) => i !== idx),
      },
    }));

  // ── Table column helpers ─────────────────────────────────────────────────
  const tableColumns: TileTableColumn[] = tile.viz.tableColumns ?? [];

  const setTableColumns = (cols: TileTableColumn[]) =>
    setViz({ tableColumns: cols });

  const addTableColumn = () =>
    setTableColumns([...tableColumns, { field: "", header: "" }]);

  const updateTableColumn = (idx: number, patch: Partial<TileTableColumn>) =>
    setTableColumns(tableColumns.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const removeTableColumn = (idx: number) =>
    setTableColumns(tableColumns.filter((_, i) => i !== idx));

  const moveTableColumn = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= tableColumns.length) return;
    const next = tableColumns.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setTableColumns(next);
  };

  const typeText =
    tile.spec.resourceTypes.length === 0
      ? "All resource types"
      : tile.spec.resourceTypes.map(resourceTypeShort).join(", ");

  // Memoize field suggestions per intent so the editor's four field
  // pickers all share resource-type-aware options without re-computing
  // on every render.
  const suggestionsFor = useMemo(() => {
    const make = (intent: FieldPickerIntent) =>
      getFieldSuggestions(tile.spec.resourceTypes, intent);
    return {
      groupBy: make("groupBy"),
      filter: make("filter"),
      sort: make("sort"),
      column: make("column"),
      dateField: make("dateField"),
    };
  }, [tile.spec.resourceTypes]);

  const vizMeta = VIZ_TYPES.find((v) => v.value === tile.viz.type);
  const availableVizTypes = isRaw
    ? VIZ_TYPES.filter((v) => v.value === "kpi" || v.value === "table")
    : VIZ_TYPES;

  return (
    <Dialog open={open} onOpenChange={(_e, data) => !data.open && onClose()}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{initialTile.title === "New tile" ? "Add tile" : "Edit tile"}</DialogTitle>
          <DialogContent>
            <div className={styles.layout}>
              <div className={styles.formCol}>
                <div className={styles.form}>
              <div className={styles.row}>
                <Text className={styles.label}>Title</Text>
                <Input
                  style={{ flex: 1, minWidth: 280 }}
                  value={tile.title}
                  onChange={(_e, data: InputOnChangeData) =>
                    setTile((prev) => ({ ...prev, title: data.value }))
                  }
                />
              </div>

              <div className={styles.row}>
                <Text className={styles.label}>Start from</Text>
                <Dropdown
                  style={{ flex: 1, minWidth: 280 }}
                  placeholder={
                    savedQueries.length === 0
                      ? "No saved queries — build below"
                      : "Build from scratch — or pick a saved query"
                  }
                  disabled={savedQueries.length === 0}
                  value={linkedSaved?.name ?? ""}
                  selectedOptions={linkedSaved ? [linkedSaved.id] : []}
                  onOptionSelect={(_e, data) => {
                    const id = data.optionValue;
                    if (!id) return;
                    const q = savedQueries.find((s) => s.id === id);
                    if (q) applySavedQuery(q);
                  }}
                >
                  {savedQueries.map((q) => (
                    <Option key={q.id} value={q.id} text={q.name}>
                      {q.name}
                      <span className={styles.helper}>
                        {" · "}
                        {q.source === "raw" ? "Advanced" : "Basic"}
                      </span>
                    </Option>
                  ))}
                </Dropdown>
                {linkedSaved && (
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<DismissRegular />}
                    onClick={disconnectSaved}
                  >
                    Disconnect
                  </Button>
                )}
              </div>

              {isRaw && (
                <div className={styles.rawNotice}>
                  <Badge appearance="filled" color="important" size="small">
                    Advanced query
                  </Badge>
                  <Text className={styles.rawNoticeText}>
                    This tile runs hand-written clauses from{" "}
                    <strong>{linkedSaved?.name ?? "a saved query"}</strong>.
                    The visual builder is hidden and only KPI / Table viz
                    types are available. Click <strong>Disconnect</strong> to
                    return to the visual builder.
                  </Text>
                </div>
              )}

              <div className={styles.row}>
                <Text className={styles.label}>Size</Text>
                <Dropdown
                  value={
                    tile.size === "xs"
                      ? "Extra small"
                      : tile.size === "small"
                      ? "Small"
                      : tile.size === "large"
                      ? "Large"
                      : "Medium"
                  }
                  selectedOptions={[tile.size ?? "medium"]}
                  onOptionSelect={(_e, data) =>
                    setTile((prev) => ({
                      ...prev,
                      size: (data.optionValue as "xs" | "small" | "medium" | "large") ?? "medium",
                    }))
                  }
                >
                  <Option value="xs" text="Extra small">Extra small (KPI)</Option>
                  <Option value="small" text="Small">Small</Option>
                  <Option value="medium" text="Medium">Medium</Option>
                  <Option value="large" text="Large">Large</Option>
                </Dropdown>
              </div>

              <Divider />

              <div className={styles.row}>
                <Text className={styles.label}>Visualization</Text>
                <Dropdown
                  value={vizMeta?.label ?? tile.viz.type}
                  selectedOptions={[tile.viz.type]}
                  onOptionSelect={(_e, data) =>
                    setViz({ type: (data.optionValue as TileVizType) ?? "kpi" })
                  }
                >
                  {availableVizTypes.map((v) => (
                    <Option key={v.value} value={v.value} text={v.label}>
                      {v.label}
                    </Option>
                  ))}
                </Dropdown>
                <Text className={styles.helper}>{vizMeta?.hint}</Text>
              </div>

              {tile.viz.type === "kpi" && (
                <>
                  <div className={styles.row}>
                    <Text className={styles.label}>KPI label</Text>
                    <Input
                      style={{ flex: 1, minWidth: 240 }}
                      placeholder="Total"
                      value={tile.viz.kpiLabel ?? ""}
                      onChange={(_e, data: InputOnChangeData) =>
                        setViz({ kpiLabel: data.value })
                      }
                    />
                  </div>
                  {/* KPI trend (D2) — opt-in mini chart + percent change
                      under the big number. Toggle on by picking a date
                      field; clear the field to turn it off. */}
                  <div className={styles.row}>
                    <Text className={styles.label}>Trend date field</Text>
                    <Combobox
                      style={{ flex: 1, minWidth: 280 }}
                      placeholder="(none — disables trend)"
                      value={tile.viz.kpiTrend?.dateField ?? ""}
                      freeform
                      onChange={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        setViz({
                          kpiTrend: v.trim()
                            ? { ...(tile.viz.kpiTrend ?? {}), dateField: v }
                            : undefined,
                        });
                      }}
                      onOptionSelect={(_e, data) => {
                        const v = data.optionValue ?? "";
                        setViz({
                          kpiTrend: v
                            ? { ...(tile.viz.kpiTrend ?? {}), dateField: v }
                            : undefined,
                        });
                      }}
                    >
                      <FieldOptions fields={suggestionsFor.dateField} />
                    </Combobox>
                    <Text className={styles.helper}>
                      Adds a sparkline + % change under the number.
                    </Text>
                  </div>
                  {tile.viz.kpiTrend?.dateField && (
                    <div className={styles.row}>
                      <Text className={styles.label}>Trend window</Text>
                      <Input
                        type="number"
                        style={{ width: 100 }}
                        value={String(tile.viz.kpiTrend.lookbackDays ?? 30)}
                        onChange={(_e, data) =>
                          setViz({
                            kpiTrend: {
                              ...tile.viz.kpiTrend!,
                              lookbackDays: Math.max(
                                1,
                                Math.min(3650, Number(data.value) || 30)
                              ),
                            },
                          })
                        }
                      />
                      <Text className={styles.label}>days</Text>
                      <Dropdown
                        style={{ minWidth: 200 }}
                        value={
                          (tile.viz.kpiTrend.show ?? "both") === "sparkline"
                            ? "Sparkline only"
                            : (tile.viz.kpiTrend.show ?? "both") === "percent"
                            ? "% change only"
                            : "Sparkline + % change"
                        }
                        selectedOptions={[tile.viz.kpiTrend.show ?? "both"]}
                        onOptionSelect={(_e, data) =>
                          setViz({
                            kpiTrend: {
                              ...tile.viz.kpiTrend!,
                              show:
                                (data.optionValue as
                                  | "sparkline"
                                  | "percent"
                                  | "both") ?? "both",
                            },
                          })
                        }
                      >
                        <Option value="both" text="Sparkline + % change">
                          Sparkline + % change
                        </Option>
                        <Option value="sparkline" text="Sparkline only">
                          Sparkline only
                        </Option>
                        <Option value="percent" text="% change only">
                          % change only
                        </Option>
                      </Dropdown>
                    </div>
                  )}
                </>
              )}

              {(tile.viz.type === "bar" || tile.viz.type === "pie") && (
                <>
                  <div className={styles.row}>
                    <Text className={styles.label}>Group by</Text>
                    <Combobox
                      style={{ flex: 1, minWidth: 280 }}
                      placeholder="e.g. type, properties.environmentId"
                      value={tile.viz.groupBy ?? ""}
                      freeform
                      onChange={(e) =>
                        setViz({ groupBy: (e.target as HTMLInputElement).value })
                      }
                      onOptionSelect={(_e, data) => setViz({ groupBy: data.optionValue ?? "" })}
                    >
                      <FieldOptions fields={suggestionsFor.groupBy} />
                    </Combobox>
                  </div>
                  <div className={styles.row}>
                    <Text className={styles.label}>Max categories</Text>
                    <Input
                      type="number"
                      style={{ width: 100 }}
                      value={String(tile.viz.maxCategories ?? 8)}
                      onChange={(_e, data) =>
                        setViz({
                          maxCategories: Math.max(1, Math.min(50, Number(data.value) || 8)),
                        })
                      }
                    />
                    <Text className={styles.helper}>
                      Smaller buckets get merged into "Other".
                    </Text>
                  </div>
                </>
              )}

              {tile.viz.type === "table" && (
                <>
                  <div className={styles.row}>
                    <Text className={styles.label}>Rows shown</Text>
                    <Input
                      type="number"
                      style={{ width: 100 }}
                      value={String(tile.viz.tableRows ?? 10)}
                      onChange={(_e, data) =>
                        setViz({
                          tableRows: Math.max(1, Math.min(50, Number(data.value) || 10)),
                        })
                      }
                    />
                  </div>
                  <div className={styles.section}>
                    <div className={styles.row}>
                      <Text className={styles.label}>Columns</Text>
                      <Button
                        icon={<AddRegular />}
                        appearance="subtle"
                        size="small"
                        onClick={addTableColumn}
                      >
                        Add column
                      </Button>
                      <Text className={styles.helper}>
                        Leave empty to use defaults (Display name, Type, Environment).
                      </Text>
                    </div>
                    {tableColumns.map((col, idx) => (
                      <div key={idx} className={styles.columnRow}>
                        <Combobox
                          placeholder="Field (e.g. properties.displayName)"
                          value={col.field}
                          freeform
                          onChange={(e) =>
                            updateTableColumn(idx, {
                              field: (e.target as HTMLInputElement).value,
                            })
                          }
                          onOptionSelect={(_e, data) =>
                            updateTableColumn(idx, { field: data.optionValue ?? "" })
                          }
                        >
                          <FieldOptions fields={suggestionsFor.column} />
                        </Combobox>
                        <Input
                          placeholder="Header (optional)"
                          value={col.header ?? ""}
                          onChange={(_e, data: InputOnChangeData) =>
                            updateTableColumn(idx, { header: data.value })
                          }
                        />
                        <Button
                          icon={<ArrowUpRegular />}
                          appearance="subtle"
                          aria-label="Move up"
                          disabled={idx === 0}
                          onClick={() => moveTableColumn(idx, -1)}
                        />
                        <Button
                          icon={<ArrowDownRegular />}
                          appearance="subtle"
                          aria-label="Move down"
                          disabled={idx === tableColumns.length - 1}
                          onClick={() => moveTableColumn(idx, 1)}
                        />
                        <Button
                          icon={<DeleteRegular />}
                          appearance="subtle"
                          aria-label="Remove column"
                          onClick={() => removeTableColumn(idx)}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(tile.viz.type === "line" || tile.viz.type === "combo") && (
                <>
                  <div className={styles.row}>
                    <Text className={styles.label}>Date field</Text>
                    <Combobox
                      style={{ flex: 1, minWidth: 280 }}
                      placeholder="e.g. properties.createdAt"
                      value={tile.viz.dateField ?? ""}
                      freeform
                      onChange={(e) =>
                        setViz({ dateField: (e.target as HTMLInputElement).value })
                      }
                      onOptionSelect={(_e, data) => setViz({ dateField: data.optionValue ?? "" })}
                    >
                      <FieldOptions fields={suggestionsFor.dateField} />
                    </Combobox>
                  </div>
                  {tile.viz.type === "line" && (
                    <div className={styles.row}>
                      <Text className={styles.label}>Mode</Text>
                      <Dropdown
                        style={{ minWidth: 240 }}
                        value={
                          LINE_MODE_OPTIONS.find(
                            (m) => m.value === (tile.viz.lineMode ?? "delta")
                          )?.label ?? "Per bucket (creations)"
                        }
                        selectedOptions={[tile.viz.lineMode ?? "delta"]}
                        onOptionSelect={(_e, data) =>
                          setViz({
                            lineMode: (data.optionValue as TileLineMode) ?? "delta",
                          })
                        }
                      >
                        {LINE_MODE_OPTIONS.map((m) => (
                          <Option key={m.value} value={m.value} text={m.label}>
                            {m.label}
                          </Option>
                        ))}
                      </Dropdown>
                      <Text className={styles.helper}>
                        {LINE_MODE_OPTIONS.find(
                          (m) => m.value === (tile.viz.lineMode ?? "delta")
                        )?.hint}
                      </Text>
                    </div>
                  )}
                  <div className={styles.row}>
                    <Text className={styles.label}>Bucket</Text>
                    <Dropdown
                      value={
                        BUCKET_OPTIONS.find((b) => b.value === (tile.viz.bucket ?? "week"))?.label ??
                        "Week"
                      }
                      selectedOptions={[tile.viz.bucket ?? "week"]}
                      onOptionSelect={(_e, data) =>
                        setViz({ bucket: (data.optionValue as TileTimeBucket) ?? "week" })
                      }
                    >
                      {BUCKET_OPTIONS.map((b) => (
                        <Option key={b.value} value={b.value} text={b.label}>
                          {b.label}
                        </Option>
                      ))}
                    </Dropdown>
                    <Text className={styles.label}>Lookback (days)</Text>
                    <Input
                      type="number"
                      style={{ width: 100 }}
                      value={String(tile.viz.lookbackDays ?? 90)}
                      onChange={(_e, data) =>
                        setViz({
                          lookbackDays: Math.max(1, Math.min(3650, Number(data.value) || 90)),
                        })
                      }
                    />
                  </div>
                </>
              )}

              <Divider />

              {!isRaw && (
                <>
              <div className={styles.row}>
                <Text className={styles.label}>Resource types</Text>
                <Dropdown
                  style={{ flex: 1, minWidth: 320 }}
                  multiselect
                  placeholder="All resource types"
                  value={typeText}
                  selectedOptions={tile.spec.resourceTypes}
                  onOptionSelect={(_e, data) =>
                    setSpec({ resourceTypes: data.selectedOptions as ResourceTypeValue[] })
                  }
                >
                  {ALL_RESOURCE_TYPES.map((t) => (
                    <Option key={t} value={t} text={resourceTypeShort(t)}>
                      {resourceTypeShort(t)}
                    </Option>
                  ))}
                </Dropdown>
              </div>

              <div className={styles.section}>
                <div className={styles.row}>
                  <Text className={styles.label}>Filters</Text>
                  <Button
                    icon={<AddRegular />}
                    appearance="subtle"
                    size="small"
                    onClick={addFilter}
                  >
                    Add filter
                  </Button>
                  {/* "Hide first-party" one-click preset — only meaningful
                      when scoped to Copilot Studio agents alone (the
                      `msdyn_` schema-name prefix is agent-specific). Mirrors
                      `agentScope()` in dashboardTemplates.ts so users can
                      author the same filter from the visual builder. */}
                  {tile.spec.resourceTypes.length === 1 &&
                    tile.spec.resourceTypes[0] === ResourceType.CopilotStudioAgent &&
                    !tile.spec.filters.some(
                      (f) =>
                        f.field === "properties.schemaName" &&
                        f.op === "!startswith" &&
                        f.value === "msdyn_"
                    ) && (
                      <Button
                        appearance="subtle"
                        size="small"
                        onClick={() =>
                          setTile((prev) => ({
                            ...prev,
                            spec: {
                              ...prev.spec,
                              filters: [
                                ...prev.spec.filters,
                                {
                                  field: "properties.schemaName",
                                  op: "!startswith",
                                  value: "msdyn_",
                                },
                              ],
                            },
                          }))
                        }
                      >
                        + Hide first-party (msdyn_)
                      </Button>
                    )}
                </div>
                {tile.spec.filters.map((f, idx) => (
                  <div key={idx} className={styles.filterRow}>
                    <Combobox
                      placeholder="Field"
                      value={f.field}
                      freeform
                      onChange={(e) =>
                        updateFilter(idx, { field: (e.target as HTMLInputElement).value })
                      }
                      onOptionSelect={(_e, data) =>
                        updateFilter(idx, { field: data.optionValue ?? "" })
                      }
                    >
                      <FieldOptions fields={suggestionsFor.filter} />
                    </Combobox>
                    <Dropdown
                      value={OPERATORS.find((o) => o.value === f.op)?.label ?? f.op}
                      selectedOptions={[f.op]}
                      onOptionSelect={(_e, data) =>
                        updateFilter(idx, {
                          op: (data.optionValue as QueryFilterOp) ?? "==",
                        })
                      }
                    >
                      {OPERATORS.map((o) => (
                        <Option key={o.value} value={o.value} text={o.label}>
                          {o.label}
                        </Option>
                      ))}
                    </Dropdown>
                    <Input
                      type={f.op === "lastNdays" ? "number" : "text"}
                      placeholder={
                        f.op === "in~"
                          ? "v1, v2, v3"
                          : f.op === "lastNdays"
                          ? "30"
                          : isDateField(f.field)
                          ? "YYYY-MM-DD"
                          : "Value"
                      }
                      value={f.value}
                      onChange={(_e, data: InputOnChangeData) =>
                        updateFilter(idx, { value: data.value })
                      }
                    />
                    <Button
                      icon={<DeleteRegular />}
                      appearance="subtle"
                      aria-label="Remove filter"
                      onClick={() => removeFilter(idx)}
                    />
                  </div>
                ))}
                {tile.spec.filters.length === 0 && (
                  <Text className={styles.helper}>No filters.</Text>
                )}
                {tile.spec.filters.some(
                  (f) => isDateField(f.field) && f.op !== "lastNdays" && f.op !== "in~"
                ) && (
                  <Text className={styles.helper}>
                    Tip: date filters accept ISO dates like <code>2024-01-01</code>. For relative
                    windows, use the <strong>in last (days)</strong> operator.
                  </Text>
                )}
              </div>

              <div className={styles.row}>
                <Text className={styles.label}>Sort by</Text>
                <Combobox
                  style={{ minWidth: 280 }}
                  placeholder="Field (optional)"
                  value={tile.spec.orderField}
                  freeform
                  onChange={(e) =>
                    setSpec({ orderField: (e.target as HTMLInputElement).value })
                  }
                  onOptionSelect={(_e, data) => setSpec({ orderField: data.optionValue ?? "" })}
                >
                  <FieldOptions fields={suggestionsFor.sort} />
                </Combobox>
                <Dropdown
                  style={{ minWidth: 120 }}
                  value={tile.spec.orderDirection === "asc" ? "Ascending" : "Descending"}
                  selectedOptions={[tile.spec.orderDirection]}
                  onOptionSelect={(_e, data) =>
                    setSpec({
                      orderDirection: (data.optionValue as "asc" | "desc") ?? "desc",
                    })
                  }
                >
                  <Option value="asc" text="Ascending">Ascending</Option>
                  <Option value="desc" text="Descending">Descending</Option>
                </Dropdown>
              </div>
                </>
              )}

              {isRaw && (
                <div className={styles.row}>
                  <Text className={styles.label}>Clauses</Text>
                  <pre
                    className={styles.rawJson}
                    style={{ flex: 1, minWidth: 280 }}
                  >
                    {JSON.stringify(tile.clauses ?? [], null, 2)}
                  </pre>
                </div>
              )}

              <div className={styles.row}>
                <Text className={styles.label}>Page size</Text>
                <Input
                  type="number"
                  style={{ width: 100 }}
                  value={String(tile.spec.limit)}
                  onChange={(_e, data) =>
                    setSpec({
                      limit: Math.max(1, Math.min(500, Number(data.value) || 100)),
                    })
                  }
                />
                <Text className={styles.helper}>
                  KPI tiles ignore this — they always fetch 1 row + use the total count.
                </Text>
              </div>
                </div>
              </div>

              <div className={styles.previewCol}>
                <div className={styles.previewHeader}>
                  <Text weight="semibold">Preview</Text>
                  <Text className={styles.helper}>
                    Live preview — queries your tenant inventory. Updates ~400ms after edits.
                  </Text>
                </div>
                <div className={styles.previewHost}>
                  <TileView tile={previewTile} editable={false} />
                </div>
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Cancel</Button>
            <Button appearance="primary" onClick={() => onSave(tile)}>
              Save tile
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
