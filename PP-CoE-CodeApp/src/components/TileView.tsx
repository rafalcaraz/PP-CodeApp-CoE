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
  MenuDivider,
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
  ComposedChart,
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
  runCumulativeSeries,
  runRawQuery,
  runTimeSeriesAggregate,
  shortResourceType,
} from "../data/inventory";
import type { DashboardTab, DashboardTile, TileTableColumn } from "../data/dashboards";
import { fetchAllCustomerAgents } from "../data/dashboardAgentSource";
import { fetchAllCustomerApps } from "../data/dashboardAppSource";
import {
  getAggregator,
  getAggregatorRegistration,
  type StackedChartDatum,
} from "../data/dashboardAggregators";
// Side-effect import — running this module registers the app-typed
// aggregators with the central registry. Belt-and-suspenders alongside
// the equivalent import in `dashboardTemplates.ts`, so a persisted
// dashboard containing `apps.*` computed tiles still resolves even if
// the templates module hasn't been pulled in yet (e.g. when rendering
// a stored dashboard on cold load without visiting the templates flow).
import "../data/dashboardAppAggregators";

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
  kpiTrendRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXS,
    width: "100%",
    marginTop: tokens.spacingVerticalS,
  },
  kpiSparkline: {
    width: "85%",
    maxWidth: "240px",
    height: "44px",
  },
  kpiPercentUp: {
    color: tokens.colorPaletteGreenForeground2,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  kpiPercentDown: {
    color: tokens.colorPaletteRedForeground2,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  kpiPercentFlat: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
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
  /** Available tabs for the "Move to tab" submenu. Only rendered when
   *  there are ≥2 tabs AND `onMoveToTab` is provided. */
  tabs?: DashboardTab[];
  onMoveToTab?: (tabId: string) => void;
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
  /** Optional cumulative series for the KPI trend (sparkline / percent).
   *  Populated only when `tile.viz.kpiTrend` is configured. Empty
   *  otherwise. */
  trend: SeriesDatum[];
  /** Multi-series buckets — populated for stackedBar tiles. */
  stackedChart: { series: string[]; data: StackedChartDatum[] };
  /** Optional override for the KPI label (computed tiles can supply one). */
  kpiLabelOverride?: string;
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
  /** "Per-bucket" count (e.g. *created this week*). Same as `value` for
   *  legacy delta tiles. */
  delta: number;
  /** Running total through this bucket. Equal to `delta` (no baseline)
   *  when the tile is a pure delta line. */
  total: number;
  /** Back-compat alias used by the pure-delta line tile. Mirrors `delta`. */
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

export function TileView({ tile, editable, onEdit, onDelete, onDuplicate, className, refreshKey, tabs, onMoveToTab }: TileViewProps) {
  const styles = useStyles();
  const [state, setState] = useState<QueryState>({
    phase: "loading",
    items: [],
    total: 0,
    chart: [],
    series: [],
    trend: [],
    stackedChart: { series: [], data: [] },
    error: "",
  });

  const specKey = useMemo(() => JSON.stringify(tile.spec), [tile.spec]);
  const clausesKey = useMemo(() => JSON.stringify(tile.clauses ?? []), [tile.clauses]);
  const computedKey = useMemo(
    () => JSON.stringify(tile.computed ?? null),
    [tile.computed],
  );

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
    // Shorthand for "no data of this shape" so each branch below can
    // populate only what it cares about. Saves repeating empty arrays
    // across nine setState() calls.
    const EMPTY_DATA: Pick<QueryState, "items" | "total" | "chart" | "series" | "trend" | "stackedChart"> = {
      items: [],
      total: 0,
      chart: [],
      series: [],
      trend: [],
      stackedChart: { series: [], data: [] },
    };
    const setError = (error: string) =>
      setState({ phase: "error", ...EMPTY_DATA, error });
    (async () => {
      setState({ phase: "loading", ...EMPTY_DATA, error: "" });

      const isRaw = tile.source === "raw" && Array.isArray(tile.clauses);
      const isComputed = tile.source === "computed" && !!tile.computed?.aggregatorId;

      // ── Computed branch ─────────────────────────────────────────────────
      // Fetches the agent universe (with msdyn_ excluded) and runs a
      // client-side aggregator. The aggregator's discriminated output
      // dictates which slice of QueryState we populate; the existing KPI /
      // Table / Bar / Pie / StackedBar renderers below pick up from there.
      if (isComputed) {
        const aggregator = getAggregator(tile.computed!.aggregatorId);
        if (!aggregator) {
          setError(
            `Unknown computed-tile aggregator "${tile.computed!.aggregatorId}". ` +
              "The tile's computed.aggregatorId doesn't match any registered aggregator."
          );
          return;
        }
        // Dispatch the right "fetch the universe" call based on what the
        // aggregator was registered against. Defaults to the agent
        // population so legacy aggregators (registered before the
        // dataSource field existed) keep working untouched.
        const registration = getAggregatorRegistration(tile.computed!.aggregatorId);
        const dataSource = registration?.dataSource ?? "agents";
        let rows: unknown[];
        if (dataSource === "apps") {
          const res = await fetchAllCustomerApps(registration?.appTypes, {}, cacheOpts);
          if (cancelled) return;
          if (!res.ok) {
            setError(res.error);
            return;
          }
          rows = res.data;
        } else {
          const agentsRes = await fetchAllCustomerAgents({}, cacheOpts);
          if (cancelled) return;
          if (!agentsRes.ok) {
            setError(agentsRes.error);
            return;
          }
          rows = agentsRes.data;
        }
        const out = aggregator(rows, tile.computed!.params);
        if (cancelled) return;
        if (out.kind === "kpi") {
          setState({
            phase: "ready",
            ...EMPTY_DATA,
            total: out.total,
            kpiLabelOverride: out.kpiLabel,
            error: "",
          });
        } else if (out.kind === "chart") {
          setState({
            phase: "ready",
            ...EMPTY_DATA,
            chart: out.buckets,
            error: "",
          });
        } else if (out.kind === "table") {
          setState({
            phase: "ready",
            ...EMPTY_DATA,
            items: out.items,
            total: out.total ?? out.items.length,
            error: "",
          });
        } else if (out.kind === "stackedBar") {
          setState({
            phase: "ready",
            ...EMPTY_DATA,
            stackedChart: { series: out.series, data: out.data },
            error: "",
          });
        } else if (out.kind === "series") {
          // Computed series → line viz. Populate both `series` (delta line
          // renderer) and `trend` (KPI sparkline / cumulative line renderer)
          // so the existing render branches all work without a viz-specific
          // dispatch up here.
          setState({
            phase: "ready",
            ...EMPTY_DATA,
            series: out.series,
            trend: out.series,
            error: "",
          });
        }
        return;
      }

      if (tile.viz.type === "kpi") {
        // KPI only needs totalRecords — fetch just one row.
        const clauses = isRaw ? tile.clauses! : buildClausesFromSpec(tile.spec);
        const res = await runRawQuery(clauses, { Top: 1 }, cacheOpts);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }

        // Optional KPI trend (D2): fetch a cumulative series alongside.
        // Doesn't block the KPI render — if the trend query fails we
        // surface the count without the sparkline and swallow the error.
        let trend: SeriesDatum[] = [];
        if (!isRaw && tile.viz.kpiTrend?.dateField) {
          const trendBucket = tile.viz.kpiTrend.bucket ?? "day";
          const trendLookback = Math.max(
            1,
            Math.floor(tile.viz.kpiTrend.lookbackDays ?? 30)
          );
          const trendRes = await runCumulativeSeries(
            tile.spec,
            tile.viz.kpiTrend.dateField,
            trendBucket,
            trendLookback,
            cacheOpts
          );
          if (cancelled) return;
          if (trendRes.ok) {
            trend = trendRes.data.map((d) => ({
              date: d.date,
              label: formatBucketLabel(d.date, trendBucket),
              delta: d.delta,
              total: d.total,
              value: d.delta,
            }));
          }
        }

        setState({
          phase: "ready",
          ...EMPTY_DATA,
          total: res.data.totalRecords,
          trend,
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
          ...EMPTY_DATA,
          items: res.data.items as Array<Record<string, unknown>>,
          total: res.data.totalRecords,
          error: "",
        });
        return;
      }

      // Chart viz types — bar/pie/line/stackedBar — need server-side
      // aggregation injected on top of the spec. That's incompatible with
      // raw clauses (the user's hand-written payload may already aggregate,
      // or use shapes our chart code doesn't understand) AND with stackedBar
      // (which is exclusively a computed-source viz). Fail fast with a hint
      // rather than emit a bad KQL query.
      if (isRaw) {
        setError(
          "Advanced (raw clauses) queries don't support chart visualizations yet. Switch this tile to a KPI or Table, or load a Basic saved query instead."
        );
        return;
      }
      if (tile.viz.type === "stackedBar") {
        setError(
          "Stacked bar tiles must use source: \"computed\" — no server-side aggregation pattern is wired in for this viz."
        );
        return;
      }

      if (tile.viz.type === "line" || tile.viz.type === "combo") {
        const field = tile.viz.dateField?.trim() ?? "";
        if (!field) {
          setState({ phase: "ready", ...EMPTY_DATA, error: "" });
          return;
        }
        const bucket = tile.viz.bucket ?? "week";
        const lookback = Math.max(1, Math.floor(tile.viz.lookbackDays ?? 90));
        // Combo always needs both deltas + cumulative totals; cumulative
        // line needs the running total; pure delta line only needs the
        // existing aggregate. Pick the cheapest path that satisfies the
        // tile.
        const wantsCumulative =
          tile.viz.type === "combo" ||
          (tile.viz.type === "line" && tile.viz.lineMode === "cumulative");
        if (wantsCumulative) {
          const res = await runCumulativeSeries(tile.spec, field, bucket, lookback, cacheOpts);
          if (cancelled) return;
          if (!res.ok) {
            setError(res.error);
            return;
          }
          const series: SeriesDatum[] = res.data.map((d) => ({
            date: d.date,
            label: formatBucketLabel(d.date, bucket),
            delta: d.delta,
            total: d.total,
            value: d.delta,
          }));
          setState({
            phase: "ready",
            ...EMPTY_DATA,
            // For combo / cumulative tiles, the header total reflects the
            // *final* running total — that's the most informative single
            // number for "how many of X do we have now".
            total: series.length > 0 ? series[series.length - 1].total : 0,
            series,
            error: "",
          });
          return;
        }
        const res = await runTimeSeriesAggregate(tile.spec, field, bucket, lookback, cacheOpts);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const series: SeriesDatum[] = res.data.map((d) => ({
          date: d.date,
          label: formatBucketLabel(d.date, bucket),
          delta: d.value,
          total: d.value,
          value: d.value,
        }));
        setState({
          phase: "ready",
          ...EMPTY_DATA,
          total: series.reduce((s, r) => s + r.value, 0),
          series,
          error: "",
        });
        return;
      }

      // bar | pie — server-side aggregation
      if (!tile.viz.groupBy) {
        setState({ phase: "ready", ...EMPTY_DATA, error: "" });
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
        ...EMPTY_DATA,
        total: labeled.reduce((s, r) => s + r.value, 0),
        chart: collapseOther(labeled, tile.viz.maxCategories),
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
    computedKey,
    tile.source,
    tile.viz.type,
    tile.viz.groupBy,
    tile.viz.maxCategories,
    tile.viz.tableRows,
    tile.viz.dateField,
    tile.viz.bucket,
    tile.viz.lookbackDays,
    tile.viz.lineMode,
    tile.viz.kpiTrend?.dateField,
    tile.viz.kpiTrend?.lookbackDays,
    tile.viz.kpiTrend?.bucket,
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
                  {onMoveToTab && tabs && tabs.length > 1 && (
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <MenuItem>Move to tab</MenuItem>
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList>
                          {tabs
                            .filter((t) => t.id !== tile.tabId)
                            .map((t) => (
                              <MenuItem
                                key={t.id}
                                onClick={() => onMoveToTab(t.id)}
                              >
                                {t.name}
                              </MenuItem>
                            ))}
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                  )}
                  <MenuDivider />
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
    const trend = state.trend;
    const showTrend = viz.kpiTrend && trend.length >= 2;
    const showSparkline =
      showTrend && (viz.kpiTrend?.show ?? "both") !== "percent";
    const showPercent =
      showTrend && (viz.kpiTrend?.show ?? "both") !== "sparkline";
    // Percent change uses the first vs last buckets of the cumulative
    // series — they represent the running total at window start and now.
    let pctText = "";
    let pctClass = styles.kpiPercentFlat;
    if (showPercent) {
      const first = trend[0].total;
      const last = trend[trend.length - 1].total;
      const diff = last - first;
      const pct = first > 0 ? (diff / first) * 100 : diff > 0 ? 100 : 0;
      const rounded = Math.round(pct * 10) / 10;
      const arrow = rounded > 0 ? "↑" : rounded < 0 ? "↓" : "→";
      const lookback = viz.kpiTrend?.lookbackDays ?? 30;
      pctText = `${arrow} ${Math.abs(rounded).toLocaleString()}% over ${lookback}d`;
      pctClass =
        rounded > 0
          ? styles.kpiPercentUp
          : rounded < 0
          ? styles.kpiPercentDown
          : styles.kpiPercentFlat;
    }
    return (
      <div className={styles.kpi}>
        <Text className={styles.kpiValue}>{state.total.toLocaleString()}</Text>
        <Text className={styles.kpiLabel}>{state.kpiLabelOverride || viz.kpiLabel || "Total"}</Text>
        {showTrend && (
          <div className={styles.kpiTrendRow}>
            {showSparkline && (
              <div className={styles.kpiSparkline}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={trend}
                    margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
                  >
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke={PALETTE[0]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {showPercent && <Text className={pctClass}>{pctText}</Text>}
          </div>
        )}
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

  // Line chart — uses server-side time-series aggregate. Two modes:
  // `delta` (default) plots `value` (per-bucket creations); `cumulative`
  // plots `total` (running total) and switches the tooltip label.
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
    const isCumulative = viz.lineMode === "cumulative";
    const dataKey = isCumulative ? "total" : "value";
    const tooltipLabel = isCumulative ? "Total" : "Created";
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
                return [n.toLocaleString(), tooltipLabel];
              }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
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

  // Combo chart — bars = per-bucket creations (left axis), line = running
  // total (right axis). Uses recharts ComposedChart. Always renders both
  // series; no mode toggle.
  if (viz.type === "combo") {
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
          <ComposedChart data={series} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              yAxisId="left"
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              label={{
                value: "Created",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "#797775" },
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              label={{
                value: "Total",
                angle: 90,
                position: "insideRight",
                style: { fontSize: 11, fill: "#797775" },
              }}
            />
            <Tooltip
              formatter={(value, name) => {
                const n = typeof value === "number" ? value : Number(value) || 0;
                const label = name === "total" ? "Total" : "Created";
                return [n.toLocaleString(), label];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(name) => (name === "total" ? "Total" : "Created")}
            />
            <Bar
              yAxisId="left"
              dataKey="delta"
              fill={PALETTE[1]}
              name="delta"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="total"
              stroke={PALETTE[0]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              name="total"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (viz.type === "stackedBar") {
    const { series, data: stackedData } = state.stackedChart;
    if (stackedData.length === 0 || series.length === 0) {
      return (
        <div className={styles.empty}>No data to chart.</div>
      );
    }
    // Long category labels (e.g. connectorIds) overflow horizontal X axis
    // with multiple categories — render horizontal bars so labels lay
    // along the Y axis where there's room to breathe.
    return (
      <div className={styles.chartHost}>
        <ResponsiveContainer width="100%" height={Math.max(220, stackedData.length * 36 + 48)}>
          <BarChart
            data={stackedData}
            layout="vertical"
            margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="category"
              tick={{ fontSize: 11 }}
              width={170}
              interval={0}
            />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, idx) => (
              <Bar
                key={s}
                dataKey={s}
                stackId="a"
                fill={PALETTE[idx % PALETTE.length]}
              />
            ))}
          </BarChart>
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
