/**
 * <AgentMessagesCard> — fetches and displays the current MCS Messages
 * consumption for a single agent (Copilot Studio bot) over a 30-day window.
 *
 * State machine, epoch guard, and unmount guard all mirror <UsageCard>.
 *
 * Empty result (`empty: true`) is a SUCCESS, not an error — we render a
 * muted "no usage reported in window" message alongside the zero so users
 * don't think the card is broken.
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
  ChatMultipleRegular,
} from "@fluentui/react-icons";
import {
  getAgentMessagesConsumed,
  type AgentMessagesConsumption,
} from "../../shared/licensing";
import { ErrorPane } from "../Status";

const useStyles = makeStyles({
  body: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    minHeight: "180px",
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
  kpiRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  kpiValue: {
    fontSize: tokens.fontSizeHero900,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: 1,
  },
  kpiUnit: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
    marginLeft: tokens.spacingHorizontalS,
  },
  metaLine: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  headerBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: tokens.spacingHorizontalM,
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
  | { kind: "ready"; data: AgentMessagesConsumption };

export interface AgentMessagesCardProps {
  /** Tenant GUID — comes from the row (`row.tenantId`). */
  tenantId: string;
  /** Agent's bot GUID (`row.id`). */
  resourceId: string;
}

export function AgentMessagesCard(props: AgentMessagesCardProps) {
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
  const resourceMissing = !props.resourceId;
  const disabled = state.kind === "loading" || tenantMissing || resourceMissing;

  const load = useCallback(async () => {
    const myEpoch = ++epochRef.current;
    setState({ kind: "loading" });
    const res = await getAgentMessagesConsumed({
      tenantId: props.tenantId,
      resourceId: props.resourceId,
    });
    if (!mountedRef.current || myEpoch !== epochRef.current) return;
    if (res.ok) {
      setState({ kind: "ready", data: res.data });
    } else {
      setState({ kind: "error", message: res.error });
    }
  }, [props.tenantId, props.resourceId]);

  return (
    <Card>
      <CardHeader
        header={
          <div className={styles.headerBar}>
            <Text weight="semibold">Messages consumed</Text>
            <Badge appearance="tint" color="informative" icon={<ChatMultipleRegular />}>
              MCS Messages
            </Badge>
          </div>
        }
        description={
          <Text size={200}>
            Current Copilot Studio message consumption from the Power Platform
            licensing API (last 30 days).
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
          />
        )}

        {state.kind === "loading" && (
          <div className={styles.loadingRow}>
            <Spinner label="Loading consumption…" />
          </div>
        )}

        {state.kind === "error" && (
          <>
            <ErrorPane title="Couldn't load consumption" message={state.message} />
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
  resourceMissing,
}: {
  disabled: boolean;
  onLoad: () => void;
  tenantMissing: boolean;
  resourceMissing: boolean;
}) {
  const styles = useStyles();
  let hint: string | null = null;
  if (tenantMissing) {
    hint = "Tenant ID is missing on this record — consumption can't be loaded.";
  } else if (resourceMissing) {
    hint = "Agent ID is missing on this record — consumption can't be loaded.";
  }
  return (
    <div className={styles.idleRow}>
      <Button
        appearance="primary"
        onClick={onLoad}
        disabled={disabled}
        icon={<ChatMultipleRegular />}
      >
        Load consumption
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
  data: AgentMessagesConsumption;
  onRefresh: () => void;
}) {
  const styles = useStyles();
  return (
    <>
      <div className={styles.kpiRow}>
        <div>
          <span className={styles.kpiValue}>{data.consumed.toLocaleString()}</span>
          <span className={styles.kpiUnit}>{data.unit}</span>
        </div>
        <Text size={200} className={styles.metaLine}>
          {data.empty
            ? "No usage reported for this agent in the window."
            : `Window: ${formatDate(data.fromDate)} → ${formatDate(data.toDate)}`}
        </Text>
        {data.asOfDate && (
          <Text size={200} className={styles.metaLine}>
            As of {formatDateTime(data.asOfDate)}
          </Text>
        )}
      </div>
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

function formatDate(iso: string): string {
  // iso is YYYY-MM-DD (date-only). Parse in UTC to avoid local-tz drift.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
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
