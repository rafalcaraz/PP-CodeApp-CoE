import { useEffect, useMemo, useState } from "react";
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Card,
  CardHeader,
  Spinner,
  Menu,
  MenuTrigger,
  MenuButton,
  MenuPopover,
  MenuList,
  MenuItem,
} from "@fluentui/react-components";
import { MoreHorizontalRegular } from "@fluentui/react-icons";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  buildClausesFromSpec,
  DASHBOARD_CACHE_TTL_MS,
  friendlyConnectorName,
  runAggregateCount,
  runRawQuery,
  runTimeSeriesAggregate,
  shortResourceType,
} from "../data/inventory";
import type { DashboardTile, TileTableColumn } from "../data/dashboards";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "240px",
  },
  body: {
    flex: 1,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  kpi: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    flex: 1,
    gap: tokens.spacingVerticalXS,
  },
  kpiValue: {
    fontSize: "56px",
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: 1,
    textAlign: "center",
  },
  kpiLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    textAlign: "center",
  },
  chartHost: {
    width: "100%",
  },
  tableWrap: {
    flex: 1,
    overflow: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeBase200,
  },
  th: {
    textAlign: "left",
    fontWeight: tokens.fontWeightSemibold,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: "sticky",
    top: 0,
  },
  td: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "260px",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    fontSize: tokens.fontSizeBase200,
    padding: tokens.spacingHorizontalM,
  },
  err: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
    padding: tokens.spacingHorizontalM,
  },
  centerSpinner: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

// Pleasant default palette — recharts cycles through these.
const PALETTE = [
  "#0078D4",
  "#107C10",
  "#5C2D91",
  "#D83B01",
  "#FFB900",
  "#00B294",
  "#E81123",
  "#797775",
  "#B4A0FF",
  "#79CC00",
];

interface TileViewProps {
  tile: DashboardTile;
  /** When true (edit mode), shows the kebab menu with Edit/Delete actions. */
  editable?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  /** Optional className merged onto the Card root — used by the editor preview. */
  className?: string;
  /** Bumping this triggers a refetch that bypasses the inventory cache.
   *  The dashboard's "Refresh" button increments this. */
  refreshKey?: number;
}

interface QueryState {
  phase: "loading" | "ready" | "error";
  /** Raw items — populated for table tiles. */
  items: Array<Record<string, unknown>>;
  /** Tenant-wide total — populated for KPI tiles. */
  total: number;
  /** Pre-aggregated buckets — populated for bar/pie tiles. */
  chart: ChartDatum[];
  /** Time-series buckets — populated for line tiles. */
  series: SeriesDatum[];
  error: string;
}

interface ChartDatum {
  name: string;
  value: number;
}

interface SeriesDatum {
  /** ISO datetime string for the bucket start. */
  date: string;
  /** Human-friendly label for the X axis tick. */
  label: string;
  value: number;
}

/** Humanize a dotted field path into a column header. e.g.
 *  "properties.lastModifiedAt" → "Last modified at". */
function humanizeField(field: string): string {
  const tail = field.split(".").pop() || field;
  const spaced = tail
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Default columns when a table tile doesn't specify any. */
const DEFAULT_TABLE_COLUMNS: TileTableColumn[] = [
  { field: "properties.displayName", header: "Display name" },
  { field: "type", header: "Type" },
  { field: "properties.environmentId", header: "Environment" },
];

/** Format a bucket date for the line chart X axis label, picking
 *  granularity to match the bucket size. */
function formatBucketLabel(iso: string, bucket: "day" | "week" | "month"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (bucket === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Read a dotted-path string from an inventory item. */
function readPath(item: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".");
  let cur: unknown = item;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function toCellString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Remove the old standalone ChartDatum interface — kept inline above. */

/** Map raw aggregated bucket names into friendlier labels for known fields.
 *  For example, group-by="type" comes back as "microsoft.powerapps/canvasapps"
 *  → relabel to "Canvas app". */
function relabel(groupBy: string, name: string): string {
  if (!name) return "(empty)";
  if (groupBy === "type") return shortResourceType(name as never) || name;
  // Connector IDs sometimes show up as group-by; prettify when known.
  if (groupBy.toLowerCase().includes("connectorid")) {
    return friendlyConnectorName(name) || name;
  }
  return name;
}

/** Apply max-categories collapse to an already-sorted list of buckets. */
function collapseOther(rows: ChartDatum[], maxCategories?: number): ChartDatum[] {
  if (!maxCategories || rows.length <= maxCategories) return rows;
  const head = rows.slice(0, maxCategories - 1);
  const other = rows.slice(maxCategories - 1).reduce((s, r) => s + r.value, 0);
  return [...head, { name: "Other", value: other }];
}

export function TileView({ tile, editable, onEdit, onDelete, onDuplicate, className, refreshKey }: TileViewProps) {
  const styles = useStyles();
  const [state, setState] = useState<QueryState>({
    phase: "loading",
    items: [],
    total: 0,
    chart: [],
    series: [],
    error: "",
  });

  const specKey = useMemo(() => JSON.stringify(tile.spec), [tile.spec]);
  const clausesKey = useMemo(() => JSON.stringify(tile.clauses ?? []), [tile.clauses]);

  useEffect(() => {
    let cancelled = false;
    // Dashboard tiles are expensive aggregates that change on minutes-to-
    // hours timescales — bump cache TTL to 5min. When the user clicks
    // "Refresh" on the dashboard (refreshKey > 0), bypass the cache once
    // to repopulate it with fresh data.
    const cacheOpts = {
      cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      forceFresh: (refreshKey ?? 0) > 0,
    };
    const setError = (error: string) =>
      setState({ phase: "error", items: [], total: 0, chart: [], series: [], error });
    (async () => {
      setState({ phase: "loading", items: [], total: 0, chart: [], series: [], error: "" });

      const isRaw = tile.source === "raw" && Array.isArray(tile.clauses);

      if (tile.viz.type === "kpi") {
        // KPI only needs totalRecords — fetch just one row.
        const clauses = isRaw ? tile.clauses! : buildClausesFromSpec(tile.spec);
        const res = await runRawQuery(clauses, { Top: 1 }, cacheOpts);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setState({
          phase: "ready",
          items: [],
          total: res.data.totalRecords,
          chart: [],
          series: [],
          error: "",
        });
        return;
      }

      if (tile.viz.type === "table") {
        const rows = Math.max(1, Math.min(50, tile.viz.tableRows ?? 10));
        const clauses = isRaw ? tile.clauses! : buildClausesFromSpec(tile.spec);
        const res = await runRawQuery(clauses, { Top: rows }, cacheOpts);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setState({
          phase: "ready",
          items: res.data.items as Array<Record<string, unknown>>,
          total: res.data.totalRecords,
          chart: [],
          series: [],
          error: "",
        });
        return;
      }

      // Chart viz types — bar/pie/line — need server-side aggregation
      // injected on top of the spec. That's incompatible with raw clauses
      // (the user's hand-written payload may already aggregate, or use
      // shapes our chart code doesn't understand). Fail fast with a hint
      // rather than emit a bad KQL query.
      if (isRaw) {
        setError(
          "Advanced (raw clauses) queries don't support chart visualizations yet. Switch this tile to a KPI or Table, or load a Basic saved query instead."
        );
        return;
      }

      if (tile.viz.type === "line") {
        const field = tile.viz.dateField?.trim() ?? "";
        if (!field) {
          setState({
            phase: "ready",
            items: [],
            total: 0,
            chart: [],
            series: [],
            error: "",
          });
          return;
        }
        const bucket = tile.viz.bucket ?? "week";
        const lookback = Math.max(1, Math.floor(tile.viz.lookbackDays ?? 90));
        const res = await runTimeSeriesAggregate(tile.spec, field, bucket, lookback, cacheOpts);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const series: SeriesDatum[] = res.data.map((d) => ({
          date: d.date,
          label: formatBucketLabel(d.date, bucket),
          value: d.value,
        }));
        setState({
          phase: "ready",
          items: [],
          total: series.reduce((s, r) => s + r.value, 0),
          chart: [],
          series,
          error: "",
        });
        return;
      }

      // bar | pie — server-side aggregation
      if (!tile.viz.groupBy) {
        setState({
          phase: "ready",
          items: [],
          total: 0,
          chart: [],
          series: [],
          error: "",
        });
        return;
      }
      const res = await runAggregateCount(tile.spec, tile.viz.groupBy, {}, cacheOpts);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const labeled = res.data.map((d) => ({
        name: relabel(tile.viz.groupBy!, d.name),
        value: d.value,
      }));
      setState({
        phase: "ready",
        items: [],
        total: labeled.reduce((s, r) => s + r.value, 0),
        chart: collapseOther(labeled, tile.viz.maxCategories),
        series: [],
        error: "",
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    specKey,
    clausesKey,
    tile.source,
    tile.viz.type,
    tile.viz.groupBy,
    tile.viz.maxCategories,
    tile.viz.tableRows,
    tile.viz.dateField,
    tile.viz.bucket,
    tile.viz.lookbackDays,
    refreshKey,
  ]);

  return (
    <Card className={mergeClasses(styles.root, className)}>
      <CardHeader
        header={<Text weight="semibold">{tile.title}</Text>}
        description={
          <Text size={200}>
            {tile.spec.resourceTypes.map((t) => shortResourceType(t)).join(", ") || "All types"}
          </Text>
        }
        action={
          editable ? (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <MenuButton
                  appearance="subtle"
                  icon={<MoreHorizontalRegular />}
                  size="small"
                  aria-label="Tile actions"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem onClick={onEdit}>Edit</MenuItem>
                  <MenuItem onClick={onDuplicate}>Duplicate</MenuItem>
                  <MenuItem onClick={onDelete}>Delete</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          ) : undefined
        }
      />
      <div className={styles.body}>
        {state.phase === "loading" && (
          <div className={styles.centerSpinner}>
            <Spinner size="small" label="Loading…" />
          </div>
        )}
        {state.phase === "error" && (
          <div className={styles.err}>Couldn't load: {state.error}</div>
        )}
        {state.phase === "ready" && <TileBody tile={tile} state={state} />}
      </div>
    </Card>
  );
}

function TileBody({ tile, state }: { tile: DashboardTile; state: QueryState }) {
  const styles = useStyles();
  const viz = tile.viz;

  if (viz.type === "kpi") {
    return (
      <div className={styles.kpi}>
        <Text className={styles.kpiValue}>{state.total.toLocaleString()}</Text>
        <Text className={styles.kpiLabel}>{viz.kpiLabel || "Total"}</Text>
      </div>
    );
  }

  if (viz.type === "table") {
    const rows = state.items.slice(0, viz.tableRows ?? 10);
    if (rows.length === 0) return <div className={styles.empty}>No items.</div>;
    const columns =
      viz.tableColumns && viz.tableColumns.length > 0 ? viz.tableColumns : DEFAULT_TABLE_COLUMNS;
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i} className={styles.th}>
                  {col.header?.trim() || humanizeField(col.field)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((it, idx) => (
              <tr key={idx}>
                {columns.map((col, i) => {
                  // For the display name column, fall back to "name" if the
                  // primary path is empty — matches the previous hard-coded
                  // behavior so existing dashboards don't regress.
                  let value = toCellString(readPath(it, col.field));
                  if (!value && col.field === "properties.displayName") {
                    value = toCellString(readPath(it, "name"));
                  }
                  return (
                    <td key={i} className={styles.td}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {state.total > rows.length && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: 8 }}>
            Showing {rows.length} of {state.total.toLocaleString()}
          </Text>
        )}
      </div>
    );
  }

  // Line chart — uses server-side time-series aggregate
  if (viz.type === "line") {
    if (!viz.dateField) {
      return (
        <div className={styles.empty}>
          Set a Date field on this tile to chart it.
        </div>
      );
    }
    const series = state.series;
    if (series.length === 0) {
      return (
        <div className={styles.empty}>
          No data in the last {viz.lookbackDays ?? 90} days.
        </div>
      );
    }
    return (
      <div className={styles.chartHost}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={series} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value) => {
                const n = typeof value === "number" ? value : Number(value) || 0;
                return [n.toLocaleString(), "Count"];
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={PALETTE[0]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Bar or Pie chart — uses server-side aggregated data
  const data = state.chart;
  if (data.length === 0) {
    return (
      <div className={styles.empty}>
        {viz.groupBy
          ? "No data for the current group-by field."
          : "Set a Group by field on this tile to chart it."}
      </div>
    );
  }

  if (viz.type === "pie") {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    // Suppress in-chart labels for slices below this fraction — those are the
    // ones whose connector lines crash into each other. Legend + tooltip carry
    // the full information for small slices.
    const LABEL_THRESHOLD = 0.05;
    return (
      <div className={styles.chartHost}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="40%"
              cy="50%"
              outerRadius="70%"
              labelLine={false}
              label={(props: { value?: string | number }) => {
                const v = Number(props.value) || 0;
                if (v / total < LABEL_THRESHOLD) return "";
                return `${Math.round((v / total) * 100)}%`;
              }}
            >
              {data.map((_, idx) => (
                <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => {
                const n = typeof value === "number" ? value : Number(value) || 0;
                return [
                  `${n.toLocaleString()} (${Math.round((n / total) * 100)}%)`,
                  String(name ?? ""),
                ];
              }}
            />
            <Legend
              layout="vertical"
              verticalAlign="middle"
              align="right"
              wrapperStyle={{ fontSize: 12, maxWidth: "40%" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Bar
  return (
    <div className={styles.chartHost}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 24, left: 8 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11 }}
            interval={0}
            angle={-20}
            textAnchor="end"
            padding={{ left: 16, right: 16 }}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" maxBarSize={64}>
            {data.map((_, idx) => (
              <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
