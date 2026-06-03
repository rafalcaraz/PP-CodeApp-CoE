/**
 * <EnvironmentEntitlementCard> — fetches and displays the per-environment
 * MCS Messages entitlement (capacity + pay-as-you-go) for a single
 * environment, from the licensing API's v0.1-alpha endpoint.
 *
 * This is flagged "Experimental" in the header because the underlying
 * endpoint is on the alpha route — the shape and availability may
 * change without notice.
 *
 * State machine, epoch guard, and unmount guard mirror <UsageCard>.
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
  BeakerRegular,
  KeyMultipleRegular,
} from "@fluentui/react-icons";
import {
  getEnvironmentMcsEntitlement,
  type EnvironmentEntitlement,
} from "../../shared/licensing";
import { ErrorPane } from "../Status";

const useStyles = makeStyles({
  body: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    minHeight: "220px",
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
  headerBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: tokens.spacingHorizontalM,
  },
  headerBadges: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    "@media (max-width: 600px)": {
      gridTemplateColumns: "1fr",
    },
  },
  metricBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  metricBlockTitle: {
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  metricRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  metricLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  metricValue: {
    fontWeight: tokens.fontWeightSemibold,
  },
  metaLine: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  footerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto",
  },
});

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: EnvironmentEntitlement };

export interface EnvironmentEntitlementCardProps {
  /** Tenant GUID — comes from the row (`row.tenantId`). */
  tenantId: string;
  /** Environment GUID (`row.id` on EnvironmentDetail). */
  environmentId: string;
}

export function EnvironmentEntitlementCard(props: EnvironmentEntitlementCardProps) {
  const styles = useStyles();
  const [state, setState] = useState<State>({ kind: "idle" });

  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const tenantMissing = !props.tenantId;
  const envMissing = !props.environmentId;
  const disabled = state.kind === "loading" || tenantMissing || envMissing;

  const load = useCallback(async () => {
    const myEpoch = ++epochRef.current;
    setState({ kind: "loading" });
    const res = await getEnvironmentMcsEntitlement({
      tenantId: props.tenantId,
      environmentId: props.environmentId,
    });
    if (!mountedRef.current || myEpoch !== epochRef.current) return;
    if (res.ok) {
      setState({ kind: "ready", data: res.data });
    } else {
      setState({ kind: "error", message: res.error });
    }
  }, [props.tenantId, props.environmentId]);

  return (
    <Card>
      <CardHeader
        header={
          <div className={styles.headerBar}>
            <Text weight="semibold">MCS Messages entitlement</Text>
            <div className={styles.headerBadges}>
              <Badge
                appearance="tint"
                color="warning"
                icon={<BeakerRegular />}
                title="Sourced from the licensing API's v0.1-alpha route; shape may change."
              >
                Experimental
              </Badge>
              <Badge appearance="tint" color="informative" icon={<KeyMultipleRegular />}>
                MCSMessages
              </Badge>
            </div>
          </div>
        }
        description={
          <Text size={200}>
            Capacity, consumption, and pay-as-you-go status for this environment.
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
            envMissing={envMissing}
          />
        )}

        {state.kind === "loading" && (
          <div className={styles.loadingRow}>
            <Spinner label="Loading entitlement…" />
          </div>
        )}

        {state.kind === "error" && (
          <>
            <ErrorPane title="Couldn't load entitlement" message={state.message} />
            <div>
              <Button onClick={load} icon={<ArrowClockwiseRegular />}>
                Retry
              </Button>
            </div>
          </>
        )}

        {state.kind === "ready" && <ReadyView data={state.data} onRefresh={load} />}
      </div>
    </Card>
  );
}

function IdleView({
  disabled,
  onLoad,
  tenantMissing,
  envMissing,
}: {
  disabled: boolean;
  onLoad: () => void;
  tenantMissing: boolean;
  envMissing: boolean;
}) {
  const styles = useStyles();
  let hint: string | null = null;
  if (tenantMissing) {
    hint = "Tenant ID is missing on this record — entitlement can't be loaded.";
  } else if (envMissing) {
    hint = "Environment ID is missing on this record — entitlement can't be loaded.";
  }
  return (
    <div className={styles.idleRow}>
      <Button
        appearance="primary"
        onClick={onLoad}
        disabled={disabled}
        icon={<KeyMultipleRegular />}
      >
        Load entitlement
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
  data,
  onRefresh,
}: {
  data: EnvironmentEntitlement;
  onRefresh: () => void;
}) {
  const styles = useStyles();
  const statusColor = statusToColor(data.capacity.status);
  return (
    <>
      <div className={styles.statusRow}>
        {data.capacity.status && (
          <Badge appearance="filled" color={statusColor}>
            {data.capacity.status}
          </Badge>
        )}
        <Text size={200} className={styles.metaLine}>
          {data.unit}
        </Text>
      </div>

      <div className={styles.metricsGrid}>
        <div className={styles.metricBlock}>
          <span className={styles.metricBlockTitle}>Capacity</span>
          <Metric
            styles={styles}
            label="Allocated"
            value={data.capacity.allocated}
          />
          <Metric
            styles={styles}
            label="Consumed"
            value={data.capacity.consumed}
          />
          <Metric
            styles={styles}
            label="Available"
            value={data.capacity.available}
          />
          {data.capacity.writeOff > 0 && (
            <Metric
              styles={styles}
              label="Write-off"
              value={data.capacity.writeOff}
            />
          )}
        </div>
        <div className={styles.metricBlock}>
          <span className={styles.metricBlockTitle}>Pay-as-you-go</span>
          <Metric styles={styles} label="Entitled" value={data.payGo.entitled} />
          <Metric styles={styles} label="Consumed" value={data.payGo.consumed} />
          {data.payGo.writeOff > 0 && (
            <Metric
              styles={styles}
              label="Write-off"
              value={data.payGo.writeOff}
            />
          )}
        </div>
      </div>

      {(data.capacity.lastUpdatedOn || data.enforcementRules.length > 0) && (
        <div className={styles.metricBlock}>
          {data.capacity.lastUpdatedOn && (
            <Text size={200} className={styles.metaLine}>
              Last updated {formatDateTime(data.capacity.lastUpdatedOn)}
              {data.capacity.consumptionType && ` · ${data.capacity.consumptionType}`}
            </Text>
          )}
          {data.enforcementRules.length > 0 && (
            <Text size={200} className={styles.metaLine}>
              Enforcement:{" "}
              {data.enforcementRules
                .map((r) => `${r.ruleType}${r.enabled ? "" : " (off)"}`)
                .join(", ")}
            </Text>
          )}
        </div>
      )}

      <div className={styles.footerRow}>
        <span />
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

type Styles = ReturnType<typeof useStyles>;

function Metric({
  styles,
  label,
  value,
}: {
  styles: Styles;
  label: string;
  value: number;
}) {
  return (
    <div className={styles.metricRow}>
      <Text className={styles.metricLabel}>{label}</Text>
      <Text className={styles.metricValue}>{value.toLocaleString()}</Text>
    </div>
  );
}

function statusToColor(
  status: string | undefined,
): "success" | "warning" | "danger" | "informative" {
  if (!status) return "informative";
  const s = status.toLowerCase();
  if (s.includes("over") || s.includes("exceeded") || s.includes("blocked")) {
    return "danger";
  }
  if (s.includes("approaching") || s.includes("near")) return "warning";
  if (s.includes("within")) return "success";
  return "informative";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
