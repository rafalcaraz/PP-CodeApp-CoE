import { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Input,
  Dropdown,
  Option,
  Combobox,
  Button,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Divider,
  type InputOnChangeData,
} from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import {
  ALL_RESOURCE_TYPES,
  COMMON_FIELD_SUGGESTIONS,
  resourceTypeShort,
  type QueryFilter,
  type QueryFilterOp,
  type ResourceTypeValue,
} from "../data/inventory";
import type { DashboardTile, TileVizType } from "../data/dashboards";
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
  helper: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
});

const OPERATORS: { value: QueryFilterOp; label: string }[] = [
  { value: "==", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "startswith", label: "starts with" },
  { value: "endswith", label: "ends with" },
  { value: "in~", label: "in" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
];

const VIZ_TYPES: { value: TileVizType; label: string; hint: string }[] = [
  { value: "kpi", label: "KPI", hint: "Single big number — the total record count." },
  { value: "table", label: "Table", hint: "Top N rows from the query." },
  { value: "bar", label: "Bar chart", hint: "Grouped counts by a chosen field." },
  { value: "pie", label: "Pie chart", hint: "Distribution by a chosen field." },
];

const ORDER_FIELD_SUGGESTIONS = [
  "properties.lastModifiedAt",
  "properties.createdAt",
  "properties.displayName",
  "name",
  "location",
];

interface TileEditorDialogProps {
  open: boolean;
  initialTile: DashboardTile;
  onClose: () => void;
  onSave: (tile: DashboardTile) => void;
}

export function TileEditorDialog({ open, initialTile, onClose, onSave }: TileEditorDialogProps) {
  const styles = useStyles();
  const [tile, setTile] = useState<DashboardTile>(initialTile);

  // Reset internal state whenever the dialog (re)opens with a new tile.
  // The parent passes a fresh `initialTile` each open.
  if (open && tile.id !== initialTile.id) setTile(initialTile);

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

  const typeText =
    tile.spec.resourceTypes.length === 0
      ? "All resource types"
      : tile.spec.resourceTypes.map(resourceTypeShort).join(", ");

  const vizMeta = VIZ_TYPES.find((v) => v.value === tile.viz.type);

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
                  {VIZ_TYPES.map((v) => (
                    <Option key={v.value} value={v.value} text={v.label}>
                      {v.label}
                    </Option>
                  ))}
                </Dropdown>
                <Text className={styles.helper}>{vizMeta?.hint}</Text>
              </div>

              {tile.viz.type === "kpi" && (
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
                      {COMMON_FIELD_SUGGESTIONS.map((s) => (
                        <Option key={s} value={s} text={s}>
                          {s}
                        </Option>
                      ))}
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
              )}

              <Divider />

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
                      {COMMON_FIELD_SUGGESTIONS.map((s) => (
                        <Option key={s} value={s} text={s}>
                          {s}
                        </Option>
                      ))}
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
                      placeholder={f.op === "in~" ? "v1, v2, v3" : "Value"}
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
                  {ORDER_FIELD_SUGGESTIONS.map((s) => (
                    <Option key={s} value={s} text={s}>
                      {s}
                    </Option>
                  ))}
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
