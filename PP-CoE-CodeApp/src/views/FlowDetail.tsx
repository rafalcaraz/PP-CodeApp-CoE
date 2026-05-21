import { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbButton,
  BreadcrumbDivider,
  Card,
  CardHeader,
  Badge,
  Link,
  Divider,
} from "@fluentui/react-components";
import { useNavigate, useParams } from "react-router-dom";
import { getFlow, shortResourceType, type FlowRow } from "../data/inventory";
import { ErrorPane, LoadingPane } from "../components/Status";
import { ConnectorsCard } from "../components/ConnectorsCard";
import { RawJsonAccordion } from "../components/RawJsonAccordion";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
  },
  metaItem: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  metaLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  rawJson: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "auto",
    maxHeight: "480px",
    whiteSpace: "pre",
  },
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; row: FlowRow; raw: unknown }
  | { kind: "missing" };

export function FlowDetail() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { flowId } = useParams<{ flowId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!flowId) return;
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      const res = await getFlow(flowId);
      if (cancelled) return;
      if (!res.ok) {
        setState({ kind: "error", message: res.error });
        return;
      }
      if (!res.data) {
        setState({ kind: "missing" });
        return;
      }
      setState({ kind: "ready", row: res.data.row, raw: res.data.raw });
    })();
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  return (
    <div className={styles.root}>
      <Breadcrumb size="medium">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/flows")}>Flows</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>
            {state.kind === "ready" ? state.row.displayName || flowId : flowId}
          </BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      {state.kind === "loading" && <LoadingPane label="Loading flow…" />}

      {state.kind === "error" && (
        <ErrorPane title="Couldn't load flow" message={state.message} />
      )}

      {state.kind === "missing" && (
        <ErrorPane
          title="Flow not found"
          message="No flow exists with this ID, or your account doesn't have visibility to it."
        />
      )}

      {state.kind === "ready" && (
        <>
          <div className={styles.header}>
            <Text size={700} weight="semibold">
              {state.row.displayName || state.row.id}
            </Text>
            <div className={styles.badgeRow}>
              <Badge appearance="filled" color="brand">
                {shortResourceType(state.row.type)}
              </Badge>
              {state.row.status && (
                <Badge appearance="filled" color={statusColor(state.row.status)}>
                  {state.row.status}
                </Badge>
              )}
              {state.row.flowTriggerType && (
                <Badge appearance="outline">{state.row.flowTriggerType} trigger</Badge>
              )}
            </div>
          </div>

          <Card>
            <CardHeader
              header={<Text weight="semibold">Trigger</Text>}
              description={<Text size={200}>What starts a run of this flow.</Text>}
            />
            <Divider />
            <div style={{ padding: tokens.spacingHorizontalL }}>
              {state.row.trigger || state.row.flowTriggerType ? (
                <div className={styles.metaGrid}>
                  <Meta label="Trigger type">{state.row.flowTriggerType || "—"}</Meta>
                  <Meta label="Connector">
                    {state.row.trigger?.connectorDisplayName ||
                      state.row.trigger?.connectorId ||
                      "—"}
                  </Meta>
                  <Meta label="Operation">
                    {state.row.trigger?.operationDisplayName || "—"}
                  </Meta>
                  <Meta label="Operation ID">
                    {state.row.trigger?.operationId || "—"}
                  </Meta>
                </div>
              ) : (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  No trigger metadata reported.
                </Text>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader header={<Text weight="semibold">Details</Text>} />
            <Divider />
            <div style={{ padding: tokens.spacingHorizontalL }}>
              <div className={styles.metaGrid}>
                <Meta label="Environment">
                  {state.row.environmentId ? (
                    <Link
                      onClick={() =>
                        navigate(`/environments/${encodeURIComponent(state.row.environmentId)}`)
                      }
                    >
                      {state.row.environmentName || state.row.environmentId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Meta>
                <Meta label="Region">{state.row.region || "—"}</Meta>
                <Meta label="Owner">
                  {state.row.ownerDisplayName || state.row.ownerId || "—"}
                </Meta>
                <Meta label="Status">{state.row.status || "—"}</Meta>
                <Meta label="Created on">{formatDate(state.row.createdAt)}</Meta>
                <Meta label="Created by">{state.row.createdBy || "—"}</Meta>
                <Meta label="Last modified">{formatDate(state.row.lastModifiedAt)}</Meta>
                <Meta label="Last modified by">{state.row.lastModifiedBy || "—"}</Meta>
                <Meta label="Workflow entity ID">{state.row.workflowEntityId || "—"}</Meta>
                <Meta label="Tenant ID">{state.row.tenantId || "—"}</Meta>
                <Meta label="ID">{state.row.id}</Meta>
              </div>
            </div>
          </Card>

          <ConnectorsCard connectors={state.row.connectors} />

          <RawJsonAccordion data={state.raw} />
        </>
      )}
    </div>
  );
}

function statusColor(status: string): "success" | "danger" | "warning" | "informative" | "subtle" {
  const s = status.toLowerCase();
  if (s === "activated" || s === "started") return "success";
  if (s === "stopped") return "danger";
  if (s === "suspended") return "warning";
  if (s === "notstarted") return "informative";
  return "subtle";
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <div className={styles.metaItem}>
      <Text className={styles.metaLabel}>{label}</Text>
      <Text>{children}</Text>
    </div>
  );
}
