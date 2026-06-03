/**
 * <UsageCard> — fetches per-resource usage telemetry from the Power
 * Platform Licensing API and renders a bar chart of monthly active
 * users / sessions / runs.
 *
 * State machine:
 *   idle  ──click "Load usage"──▶ loading ──┬── success ──▶ ready (chart + totals)
 *                                           └── failure ──▶ error
 *   ready ──click "Refresh"────▶ loading ──(same as above)
 *
 * Stale-result guard: each click bumps a `requestEpoch`. Only the
 * most-recent request can update state — older requests are dropped.
 * Component unmount also stops any in-flight result from being applied.
 *
 * Card placement: lives in `src/components/` (shared-legacy) so it can
 * import `ErrorPane` / `LoadingPane` from `Status.tsx`. The data layer
 * it consumes (`src/shared/licensing/`) is properly in `src/shared/`.
 *
 * Empty state: `points.length === 0` is a SUCCESS with no buckets, not
 * an error. We render a muted message explaining the result so users
 * don't think the chart is broken.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Divider,
  makeStyles,
  Spinner,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  ChartMultipleRegular,
} from "@fluentui/react-icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getUsageTimeseries,
  type ProductCategory,
  type UsageSeries,
} from "../../shared/licensing";
import { ErrorPane } from "../Status";

const useStyles = makeStyles({
  body: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    minHeight: "320px",
  },
  loadingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spacingVerticalXXL,
    flex: 1,
  },
  idleRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalXL,
  },
  idleHint: {
    color: tokens.colorNeutralForeground3,
  },
  totalsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
  total: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  totalValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: 1,
  },
  totalLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  chartHost: {
    width: "100%",
    height: "260px",
  },
  emptyChart: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    padding: tokens.spacingVerticalXL,
    textAlign: "center",
  },
  headerBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: tokens.spacingHorizontalM,
  },
  windowMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

// Stable palette — keep the three series visually distinct from the
// dashboard tiles' default palette so users don't conflate them.
const COLOR_USERS = "#0078D4";
const COLOR_SESSIONS = "#107C10";
const COLOR_RUNS = "#5C2D91";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; series: UsageSeries };

export interface UsageCardProps {
  productCategory: ProductCategory;
  /** Human label for the badge ("Copilot Studio", "Power Automate", "Power Apps"). */
  productLabel: string;
  /** Tenant GUID — comes from the row (`row.tenantId`). */
  tenantId: string;
  /** Resource ID — the agent id, flow id, or app id. */
  resourceId: string;
  /** Optional note shown above the Load button (e.g. "Experimental — endpoint may not exist"). */
  experimentalNote?: string;
}

export function UsageCard(props: UsageCardProps) {
  const styles = useStyles();
  const [state, setState] = useState<State>({ kind: "idle" });

  // Stale-result guard. Every load bumps `epoch`; pending requests
  // captured an earlier epoch and skip state writes if they no longer
  // match the current value.
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const tenantMissing = !props.tenantId;
  const resourceMissing = !props.resourceId;
  const disabled = state.kind === "loading" || tenantMissing || resourceMissing;

  const load = useCallback(async () => {
    const myEpoch = ++epochRef.current;
    setState({ kind: "loading" });
    const res = await getUsageTimeseries({
      productCategory: props.productCategory,
      tenantId: props.tenantId,
      resourceId: props.resourceId,
    });
    if (!mountedRef.current || myEpoch !== epochRef.current) return;
    if (res.ok) {
      setState({ kind: "ready", series: res.data });
    } else {
      setState({ kind: "error", message: res.error });
    }
  }, [props.productCategory, props.tenantId, props.resourceId]);

  return (
    <Card>
      <CardHeader
        header={
          <div className={styles.headerBar}>
            <Text weight="semibold">Usage</Text>
            <Badge appearance="tint" color="informative" icon={<ChartMultipleRegular />}>
              {props.productLabel}
            </Badge>
          </div>
        }
        description={
          <Text size={200}>
            Active users, sessions, and runs from the Power Platform licensing API.
          </Text>
        }
      />
      <Divider />
      <div className={styles.body}>
        {state.kind === "idle" && (
          <IdleView
            disabled={disabled}
            onLoad={load}
            tenantMissing={tenantMissing}
            resourceMissing={resourceMissing}
            experimentalNote={props.experimentalNote}
          />
        )}

        {state.kind === "loading" && (
          <div className={styles.loadingRow}>
            <Spinner label="Loading usage…" />
          </div>
        )}

        {state.kind === "error" && (
          <>
            <ErrorPane title="Couldn't load usage" message={state.message} />
            <div>
              <Button onClick={load} icon={<ArrowClockwiseRegular />}>
                Retry
              </Button>
            </div>
          </>
        )}

        {state.kind === "ready" && (
          <ReadyView series={state.series} onRefresh={load} />
        )}
      </div>
    </Card>
  );
}

function IdleView({
  disabled,
  onLoad,
  tenantMissing,
  resourceMissing,
  experimentalNote,
}: {
  disabled: boolean;
  onLoad: () => void;
  tenantMissing: boolean;
  resourceMissing: boolean;
  experimentalNote?: string;
}) {
  const styles = useStyles();
  let hint: string | null = null;
  if (tenantMissing) {
    hint = "Tenant ID is missing on this record — usage can't be loaded.";
  } else if (resourceMissing) {
    hint = "Resource ID is missing on this record — usage can't be loaded.";
  } else if (experimentalNote) {
    hint = experimentalNote;
  }
  return (
    <div className={styles.idleRow}>
      <Button
        appearance="primary"
        onClick={onLoad}
        disabled={disabled}
        icon={<ChartMultipleRegular />}
      >
        Load usage
      </Button>
      {hint && (
        <Text size={200} className={styles.idleHint}>
          {hint}
        </Text>
      )}
    </div>
  );
}

function ReadyView({
  series,
  onRefresh,
}: {
  series: UsageSeries;
  onRefresh: () => void;
}) {
  const styles = useStyles();
  const chartData = series.points.map((p) => ({
    label: formatBucketLabel(p.date, series.interval),
    activeUsers: p.metrics.activeUsers,
    activeSessions: p.metrics.activeSessions,
    activeRuns: p.metrics.activeRuns,
  }));
  return (
    <>
      <div className={styles.totalsRow}>
        <Total label="Active users (total)" value={series.totals.activeUsers} />
        <Total label="Active sessions (total)" value={series.totals.activeSessions} />
        <Total label="Active runs (total)" value={series.totals.activeRuns} />
      </div>
      {chartData.length === 0 ? (
        <div className={styles.emptyChart}>
          No usage data returned for this resource in the selected period.
        </div>
      ) : (
        <div className={styles.chartHost}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="activeUsers" name="Active users" fill={COLOR_USERS} />
              <Bar dataKey="activeSessions" name="Active sessions" fill={COLOR_SESSIONS} />
              <Bar dataKey="activeRuns" name="Active runs" fill={COLOR_RUNS} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className={styles.headerBar}>
        <Text size={200} className={styles.windowMeta}>
          {formatWindow(series)}
        </Text>
        <Button
          appearance="subtle"
          icon={<ArrowClockwiseRegular />}
          onClick={onRefresh}
        >
          Refresh
        </Button>
      </div>
    </>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return (
    <div className={styles.total}>
      <Text className={styles.totalValue}>{value.toLocaleString()}</Text>
      <Text className={styles.totalLabel}>{label}</Text>
    </div>
  );
}

const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatBucketLabel(iso: string, interval: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (interval === "Daily") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(d);
  }
  return MONTH_FORMATTER.format(d);
}

function formatWindow(series: UsageSeries): string {
  const from = formatDate(series.fromDate);
  const to = formatDate(series.toDate);
  if (!from && !to) return `${series.interval} buckets`;
  return `${series.interval} · ${from} → ${to}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
