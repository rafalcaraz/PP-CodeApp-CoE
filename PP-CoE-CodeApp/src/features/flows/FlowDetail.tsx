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
import {
  getFlow,
  shortResourceType,
  type FlowRow,
  type FlowTrigger,
} from "./data";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { ConnectorsCard } from "../../components/ConnectorsCard";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import {
  PortalActionsBar,
  resourceTypeToEntityKind,
} from "../../components/PortalActions";
import {
  DateWithRelative,
  IdentifiersAccordion,
  Meta,
  useDetailStyles,
} from "../../components/detail";

const usePageStyles = makeStyles({
  triggerSummary: {
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalS,
  },
});

// Human-readable one-liner describing what fires a flow, based on the trigger
// type + operation ID. The inventory exposes mostly opaque codes here, so we
// translate the common ones into something a CoE admin can skim.
function describeTrigger(
  flowTriggerType: string,
  trigger: FlowTrigger | null
): string {
  const op = trigger?.operationId ?? "";
  const tt = flowTriggerType.toLowerCase();

  // Agent-invoked: cloud flow called by a Copilot Studio agent as a skill.
  if (op === "RequestSkills") {
    return "Invoked on demand by a Copilot Studio agent calling this flow as a skill.";
  }
  // Manual / button-style triggers.
  if (op === "RequestButton" || op === "manual") {
    return "Started manually by a user clicking the Run button.";
  }
  if (op === "RequestPowerAppV2" || op === "RequestPowerApp") {
    return "Started on demand when a Power App invokes this flow.";
  }

  switch (tt) {
    case "scheduled":
    case "recurrence":
      return "Runs on a recurring schedule.";
    case "automated":
      return "Fires automatically when an external event occurs.";
    case "instant":
      return "Started on demand (button, Power App, or other manual entry point).";
    case "manual":
      return "Started manually by a user.";
    default:
      return "";
  }
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; row: FlowRow; raw: unknown }
  | { kind: "missing" };

export function FlowDetail() {
  const styles = useDetailStyles();
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
      <div className={styles.colFull}>
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
      </div>

      {state.kind === "loading" && (
        <div className={styles.colFull}>
          <LoadingPane label="Loading flow…" />
        </div>
      )}

      {state.kind === "error" && (
        <div className={styles.colFull}>
          <ErrorPane title="Couldn't load flow" message={state.message} />
        </div>
      )}

      {state.kind === "missing" && (
        <div className={styles.colFull}>
          <ErrorPane
            title="Flow not found"
            message="No flow exists with this ID, or your account doesn't have visibility to it."
          />
        </div>
      )}

      {state.kind === "ready" && <ReadyView row={state.row} raw={state.raw} navigate={navigate} />}
    </div>
  );
}

function ReadyView({
  row,
  raw,
  navigate,
}: {
  row: FlowRow;
  raw: unknown;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const styles = useDetailStyles();
  const page = usePageStyles();
  const ownerLabel = row.ownerDisplayName || row.ownerId;
  const entityKind = resourceTypeToEntityKind(row.type);
  const triggerSummary = describeTrigger(row.flowTriggerType, row.trigger);
  const hasTriggerMeta = !!(row.trigger || row.flowTriggerType);

  return (
    <>
      {entityKind && (
        <div className={styles.colFull}>
          <PortalActionsBar
            context={{
              entityKind,
              entityId: row.id,
              environmentId: row.environmentId,
              workflowEntityId: row.workflowEntityId || undefined,
            }}
          />
        </div>
      )}

      {/* 1. Overview header — name, type/status/trigger badges, who/where */}
      <div className={`${styles.header} ${styles.colFull}`}>
        <Text size={700} weight="semibold">
          {row.displayName || row.id}
        </Text>
        <div className={styles.badgeRow}>
          <Badge appearance="filled" color="brand">
            {shortResourceType(row.type)}
          </Badge>
          {row.status && (
            <Badge appearance="filled" color={statusColor(row.status)}>
              {row.status}
            </Badge>
          )}
          {row.flowTriggerType && (
            <Badge appearance="outline">{row.flowTriggerType} trigger</Badge>
          )}
        </div>
        <div className={styles.summaryLine}>
          {ownerLabel && (
            <>
              <Text size={300}>Owned by</Text>
              <Text size={300} weight="semibold">
                {ownerLabel}
              </Text>
            </>
          )}
          {row.environmentId && (
            <>
              {ownerLabel && <span className={styles.summaryDot} aria-hidden>·</span>}
              <Text size={300}>in</Text>
              <Link
                onClick={() =>
                  navigate(`/environments/${encodeURIComponent(row.environmentId)}`)
                }
              >
                {row.environmentName || row.environmentId}
              </Link>
            </>
          )}
          {row.region && (
            <>
              <span className={styles.summaryDot} aria-hidden>·</span>
              <Text size={300}>{row.region}</Text>
            </>
          )}
        </div>
      </div>

      {/* 2. Trigger — what starts a run */}
      <Card className={styles.colFull}>
        <CardHeader
          header={<Text weight="semibold">Trigger</Text>}
          description={<Text size={200}>What starts a run of this flow.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          {hasTriggerMeta ? (
            <>
              <div className={styles.metaGrid}>
                <Meta label="Trigger type">{row.flowTriggerType || "—"}</Meta>
                <Meta label="Connector">
                  {row.trigger?.connectorDisplayName ||
                    row.trigger?.connectorId ||
                    "—"}
                </Meta>
                <Meta label="Operation">
                  {row.trigger?.operationDisplayName || "—"}
                </Meta>
                <Meta label="Operation ID">
                  {row.trigger?.operationId ? (
                    <span className={styles.mono}>{row.trigger.operationId}</span>
                  ) : (
                    "—"
                  )}
                </Meta>
              </div>
              {triggerSummary && (
                <Text size={200} className={page.triggerSummary}>
                  {triggerSummary}
                </Text>
              )}
            </>
          ) : (
            <span className={styles.empty}>No trigger metadata reported.</span>
          )}
        </div>
      </Card>

      {/* 3. Connectors & actions */}
      <div className={styles.colFull}>
        <ConnectorsCard connectors={row.connectors} />
      </div>

      {/* 4. People & ownership */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">People &amp; ownership</Text>}
          description={<Text size={200}>Who owns this flow and last touched it.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Owner">{ownerLabel || "—"}</Meta>
            <Meta label="Created by">{row.createdBy || "—"}</Meta>
            <Meta label="Last modified by">{row.lastModifiedBy || "—"}</Meta>
          </div>
        </div>
      </Card>

      {/* 5. Lifecycle */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Lifecycle</Text>}
          description={<Text size={200}>When this flow was created and last modified.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Created on">
              <DateWithRelative value={row.createdAt} />
            </Meta>
            <Meta label="Last modified">
              <DateWithRelative value={row.lastModifiedAt} />
            </Meta>
          </div>
        </div>
      </Card>

      {/* 6. Identifiers — collapsed */}
      <IdentifiersAccordion
        className={styles.colFull}
        items={[
          { label: "Flow ID", value: row.id },
          { label: "Workflow entity ID", value: row.workflowEntityId },
          { label: "Environment ID", value: row.environmentId },
          { label: "Tenant ID", value: row.tenantId },
          { label: "Resource type", value: row.type },
        ]}
      />

      {/* 7. Raw JSON */}
      <div className={styles.colFull}>
        <RawJsonAccordion data={raw} />
      </div>
    </>
  );
}

function statusColor(
  status: string
): "success" | "danger" | "warning" | "informative" | "subtle" {
  const s = status.toLowerCase();
  if (s === "activated" || s === "started") return "success";
  if (s === "stopped") return "danger";
  if (s === "suspended") return "warning";
  if (s === "notstarted") return "informative";
  return "subtle";
}
