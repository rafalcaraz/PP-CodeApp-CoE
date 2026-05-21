import { useEffect, useMemo, useState } from "react";
import {
  makeStyles,
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
  Divider,
  Badge,
} from "@fluentui/react-components";
import { MoreHorizontalRegular } from "@fluentui/react-icons";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  buildClausesFromSpec,
  friendlyConnectorName,
  runAggregateCount,
  runRawQuery,
  shortResourceType,
} from "../data/inventory";
import type { DashboardTile } from "../data/dashboards";

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
  },
  kpi: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: tokens.spacingVerticalXS,
  },
  kpiValue: {
    fontSize: "56px",
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: 1,
  },
  kpiLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
  chartHost: {
    flex: 1,
    minHeight: "200px",
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
}

interface QueryState {
  phase: "loading" | "ready" | "error";
  /** Raw items — populated for table tiles. */
  items: Array<Record<string, unknown>>;
  /** Tenant-wide total — populated for KPI tiles. */
  total: number;
  /** Pre-aggregated buckets — populated for bar/pie tiles. */
  chart: ChartDatum[];
  error: string;
}

interface ChartDatum {
  name: string;
  value: number;
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

export function TileView({ tile, editable, onEdit, onDelete, onDuplicate }: TileViewProps) {
  const styles = useStyles();
  const [state, setState] = useState<QueryState>({
    phase: "loading",
    items: [],
    total: 0,
    chart: [],
    error: "",
  });

  const specKey = useMemo(() => JSON.stringify(tile.spec), [tile.spec]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ phase: "loading", items: [], total: 0, chart: [], error: "" });

      if (tile.viz.type === "kpi") {
        // KPI only needs totalRecords — fetch just one row.
        const res = await runRawQuery(buildClausesFromSpec(tile.spec), { Top: 1 });
        if (cancelled) return;
        if (!res.ok) {
          setState({ phase: "error", items: [], total: 0, chart: [], error: res.error });
          return;
        }
        setState({
          phase: "ready",
          items: [],
          total: res.data.totalRecords,
          chart: [],
          error: "",
        });
        return;
      }

      if (tile.viz.type === "table") {
        const rows = Math.max(1, Math.min(50, tile.viz.tableRows ?? 10));
        const res = await runRawQuery(buildClausesFromSpec(tile.spec), { Top: rows });
        if (cancelled) return;
        if (!res.ok) {
          setState({ phase: "error", items: [], total: 0, chart: [], error: res.error });
          return;
        }
        setState({
          phase: "ready",
          items: res.data.items as Array<Record<string, unknown>>,
          total: res.data.totalRecords,
          chart: [],
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
          error: "",
        });
        return;
      }
      const res = await runAggregateCount(tile.spec, tile.viz.groupBy);
      if (cancelled) return;
      if (!res.ok) {
        setState({ phase: "error", items: [], total: 0, chart: [], error: res.error });
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
        error: "",
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, tile.viz.type, tile.viz.groupBy, tile.viz.maxCategories, tile.viz.tableRows]);

  return (
    <Card className={styles.root}>
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
      <Divider />
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
        <Badge appearance="outline" size="small">
          tenant-wide
        </Badge>
      </div>
    );
  }

  if (viz.type === "table") {
    const rows = state.items.slice(0, viz.tableRows ?? 10);
    if (rows.length === 0) return <div className={styles.empty}>No items.</div>;
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Display name</th>
              <th className={styles.th}>Type</th>
              <th className={styles.th}>Environment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, idx) => (
              <tr key={idx}>
                <td className={styles.td}>
                  {toCellString(readPath(it, "properties.displayName")) ||
                    toCellString(readPath(it, "name"))}
                </td>
                <td className={styles.td}>
                  {toCellString(readPath(it, "type"))}
                </td>
                <td className={styles.td}>
                  {toCellString(readPath(it, "properties.environmentId"))}
                </td>
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
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              outerRadius="75%"
              labelLine={false}
              label={(props: { name?: string | number; value?: string | number }) => {
                const v = Number(props.value) || 0;
                if (v / total < LABEL_THRESHOLD) return "";
                const pct = Math.round((v / total) * 100);
                return `${props.name ?? ""} · ${pct}%`;
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
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value">
            {data.map((_, idx) => (
              <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
