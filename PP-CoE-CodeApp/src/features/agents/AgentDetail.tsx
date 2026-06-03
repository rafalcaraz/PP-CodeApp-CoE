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
  getAgent,
  shortResourceType,
  type AgentRow,
  type AgentSharingCounts,
} from "./data";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { ConnectorsCard } from "../../components/ConnectorsCard";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import { PortalActionsBar } from "../../components/PortalActions";
import { UsageCard } from "../../components/UsageCard";
import { AgentMessagesCard } from "../../components/AgentMessagesCard";
import {
  DateWithRelative,
  IdentifiersAccordion,
  Meta,
  useDetailStyles,
} from "../../components/detail";

// Agent-specific styles that aren't shared with the other detail pages
// (channels chip strip, "tools & knowledge" stat blocks, sharing chip grid).
const usePageStyles = makeStyles({
  metaGridTight: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    "@media (max-width: 1100px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
    "@media (max-width: 700px)": {
      gridTemplateColumns: "1fr",
    },
  },
  statsTight: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  statValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  sharing: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXL,
  },
  sharingBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    minWidth: "180px",
  },
});

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; row: AgentRow; raw: unknown }
  | { kind: "missing" };

export function AgentDetail() {
  const styles = useDetailStyles();
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      const res = await getAgent(agentId);
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
  }, [agentId]);

  return (
    <div className={styles.root}>
      <div className={styles.colFull}>
        <Breadcrumb size="medium">
          <BreadcrumbItem>
            <BreadcrumbButton onClick={() => navigate("/agents")}>Agents</BreadcrumbButton>
          </BreadcrumbItem>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <BreadcrumbButton current>
              {state.kind === "ready" ? state.row.displayName || agentId : agentId}
            </BreadcrumbButton>
          </BreadcrumbItem>
        </Breadcrumb>
      </div>

      {state.kind === "loading" && (
        <div className={styles.colFull}>
          <LoadingPane label="Loading agent…" />
        </div>
      )}

      {state.kind === "error" && (
        <div className={styles.colFull}>
          <ErrorPane title="Couldn't load agent" message={state.message} />
        </div>
      )}

      {state.kind === "missing" && (
        <div className={styles.colFull}>
          <ErrorPane
            title="Agent not found"
            message="No agent exists with this ID, or your account doesn't have visibility to it."
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
  row: AgentRow;
  raw: unknown;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const styles = useDetailStyles();
  const page = usePageStyles();
  const ownerLabel = row.ownerDisplayName || row.ownerId;
  return (
    <>
      <div className={styles.colFull}>
        <PortalActionsBar
          context={{
            entityKind: "agent",
            entityId: row.id,
            environmentId: row.environmentId,
          }}
        />
      </div>

      {/* 1. Overview header */}
      <div className={`${styles.header} ${styles.colFull}`}>
        <Text size={700} weight="semibold">
          {row.displayName || row.id}
        </Text>
        <div className={styles.badgeRow}>
          <Badge appearance="filled" color="brand">
            {shortResourceType(row.type)}
          </Badge>
          {row.isManaged && (
            <Badge appearance="outline" color="success">
              Managed
            </Badge>
          )}
          {row.isQuarantined && (
            <Badge appearance="filled" color="danger">
              Quarantined
            </Badge>
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

      {/* 2. Configuration — how the agent is built */}
      <Card className={styles.colFull}>
        <CardHeader
          header={<Text weight="semibold">Configuration</Text>}
          description={<Text size={200}>How this agent is built.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={page.metaGridTight}>
            <Meta label="Model">{row.model || "—"}</Meta>
            <Meta label="Orchestration">{row.orchestration || "—"}</Meta>
            <Meta label="Authentication">{row.authentication || "—"}</Meta>
            <Meta label="Created in">{row.createdIn || "—"}</Meta>
            <Meta label="Instructions">
              {row.instructionsCharactersCount > 0
                ? `${row.instructionsCharactersCount.toLocaleString()} chars`
                : "—"}
            </Meta>
            <Meta label="Web search on knowledge">
              {row.isWebSearchEnabledForKnowledge ? "Enabled" : "Disabled"}
            </Meta>
          </div>
        </div>
      </Card>

      {/* 3. Channels */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={
            <Text weight="semibold">
              Channels{row.channels.length > 0 && ` (${row.channels.length})`}
            </Text>
          }
          description={<Text size={200}>Where this agent is reachable.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          {row.channels.length === 0 ? (
            <span className={styles.empty}>No channels reported.</span>
          ) : (
            <div className={page.chips}>
              {row.channels.map((ch) => (
                <Badge key={ch} appearance="tint" color="brand" size="medium">
                  {ch}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 4. Tools & knowledge */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Tools &amp; knowledge</Text>}
          description={<Text size={200}>What this agent can do.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={page.statsTight}>
            <Stat
              label="Distinct connectors"
              value={row.distinctConnectors.toLocaleString()}
            />
            <Stat
              label="Distinct operations"
              value={row.distinctConnectorOperations.toLocaleString()}
            />
          </div>
        </div>
      </Card>
      <div className={styles.colFull}>
        <ConnectorsCard connectors={row.connectors} />
      </div>

      {/* 4b. Usage telemetry (licensing API) */}
      <div className={styles.colFull}>
        <UsageCard
          productCategory="CopilotStudio"
          productLabel="Copilot Studio"
          tenantId={row.tenantId}
          resourceId={row.id}
        />
      </div>

      {/* 4c. MCS Messages entitlement (per-agent, current consumption). */}
      <div className={styles.colFull}>
        <AgentMessagesCard tenantId={row.tenantId} resourceId={row.id} />
      </div>

      {/* 5. People & sharing */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">People &amp; sharing</Text>}
          description={<Text size={200}>Who owns this agent and who it's shared with.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Owner">{ownerLabel || "—"}</Meta>
            <Meta label="Created by">{row.createdBy || "—"}</Meta>
          </div>
          <div style={{ height: tokens.spacingVerticalL }} />
          <div className={page.sharing}>
            <SharingBlock label="Editors" counts={row.sharedWithEditors} hideTenant />
            <SharingBlock label="Viewers" counts={row.sharedWithViewers} />
          </div>
        </div>
      </Card>

      {/* 6. Lifecycle */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Lifecycle</Text>}
          description={<Text size={200}>When this agent was created and last published.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Created on">
              <DateWithRelative value={row.createdAt} />
            </Meta>
            <Meta label="Last published">
              <DateWithRelative value={row.lastPublishedAt} />
            </Meta>
          </div>
        </div>
      </Card>

      {/* 7. Identifiers — collapsed */}
      <IdentifiersAccordion
        className={styles.colFull}
        items={[
          { label: "Agent ID", value: row.id },
          { label: "Schema name", value: row.schemaName },
          { label: "Environment ID", value: row.environmentId },
          { label: "Entra app ID", value: row.entraAppId },
          { label: "Title ID", value: row.titleId },
          { label: "Tenant ID", value: row.tenantId },
        ]}
      />

      {/* 8. Raw JSON */}
      <div className={styles.colFull}>
        <RawJsonAccordion data={raw} />
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const page = usePageStyles();
  return (
    <div className={page.stat}>
      <Text className={page.statValue}>{value}</Text>
      <Text className={page.statLabel}>{label}</Text>
    </div>
  );
}

function SharingBlock({
  label,
  counts,
  hideTenant,
}: {
  label: string;
  counts: AgentSharingCounts;
  hideTenant?: boolean;
}) {
  const styles = useDetailStyles();
  const page = usePageStyles();
  return (
    <div className={page.sharingBlock}>
      <Text className={styles.metaLabel}>{label}</Text>
      <div className={page.chips}>
        <Badge appearance="outline">
          {counts.userCount.toLocaleString()} user{counts.userCount === 1 ? "" : "s"}
        </Badge>
        <Badge appearance="outline">
          {counts.groupCount.toLocaleString()} group{counts.groupCount === 1 ? "" : "s"}
        </Badge>
        {!hideTenant && counts.entireTenant && (
          <Badge appearance="filled" color="warning">
            Entire tenant
          </Badge>
        )}
      </div>
    </div>
  );
}
