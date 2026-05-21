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
} from "../data/inventory";
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
  cardBody: {
    padding: tokens.spacingHorizontalL,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
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
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    fontSize: tokens.fontSizeBase200,
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
  | { kind: "ready"; row: AgentRow; raw: unknown }
  | { kind: "missing" };

export function AgentDetail() {
  const styles = useStyles();
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

      {state.kind === "loading" && <LoadingPane label="Loading agent…" />}

      {state.kind === "error" && (
        <ErrorPane title="Couldn't load agent" message={state.message} />
      )}

      {state.kind === "missing" && (
        <ErrorPane
          title="Agent not found"
          message="No agent exists with this ID, or your account doesn't have visibility to it."
        />
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
  const styles = useStyles();
  return (
    <>
      <div className={styles.header}>
        <Text size={700} weight="semibold">
          {row.displayName || row.id}
        </Text>
        <div className={styles.badgeRow}>
          <Badge appearance="filled" color="brand">
            {shortResourceType(row.type)}
          </Badge>
          {row.model && (
            <Badge appearance="filled" color="informative">
              {row.model}
            </Badge>
          )}
          {row.orchestration && (
            <Badge appearance="outline">{row.orchestration} orchestration</Badge>
          )}
          {row.authentication && (
            <Badge appearance="outline">{row.authentication}</Badge>
          )}
          {row.publishState && <Badge appearance="outline">{row.publishState}</Badge>}
          {row.createdIn && (
            <Badge appearance="outline">Created in {row.createdIn}</Badge>
          )}
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
      </div>

      <Card>
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
            <div className={styles.chips}>
              {row.channels.map((ch) => (
                <Badge key={ch} appearance="tint" color="brand" size="medium">
                  {ch}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader header={<Text weight="semibold">Sharing</Text>} />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.sharing}>
            <SharingBlock label="Editors" counts={row.sharedWithEditors} hideTenant />
            <SharingBlock label="Viewers" counts={row.sharedWithViewers} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader header={<Text weight="semibold">Capabilities</Text>} />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.stats}>
            <Stat
              label="Distinct connectors"
              value={row.distinctConnectors.toLocaleString()}
            />
            <Stat
              label="Distinct operations"
              value={row.distinctConnectorOperations.toLocaleString()}
            />
            <Stat
              label="Instructions"
              value={
                row.instructionsCharactersCount > 0
                  ? `${row.instructionsCharactersCount.toLocaleString()} chars`
                  : "—"
              }
            />
            <Stat
              label="Web search on knowledge"
              value={row.isWebSearchEnabledForKnowledge ? "Enabled" : "Disabled"}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader header={<Text weight="semibold">Details</Text>} />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGrid}>
            <Meta label="Environment">
              {row.environmentId ? (
                <Link
                  onClick={() =>
                    navigate(`/environments/${encodeURIComponent(row.environmentId)}`)
                  }
                >
                  {row.environmentName || row.environmentId}
                </Link>
              ) : (
                "—"
              )}
            </Meta>
            <Meta label="Region">{row.region || "—"}</Meta>
            <Meta label="Owner">{row.ownerDisplayName || row.ownerId || "—"}</Meta>
            <Meta label="Schema name">{row.schemaName || "—"}</Meta>
            <Meta label="Entra app ID">{row.entraAppId || "—"}</Meta>
            <Meta label="Title ID">{row.titleId || "—"}</Meta>
            <Meta label="Publish state">{row.publishState || "—"}</Meta>
            <Meta label="Last published">{formatDate(row.lastPublishedAt)}</Meta>
            <Meta label="Created on">{formatDate(row.createdAt)}</Meta>
            <Meta label="Created by">{row.createdBy || "—"}</Meta>
            <Meta label="Last modified">{formatDate(row.lastModifiedAt)}</Meta>
            <Meta label="Last modified by">{row.lastModifiedBy || "—"}</Meta>
            <Meta label="Tenant ID">{row.tenantId || "—"}</Meta>
            <Meta label="ID">{row.id}</Meta>
          </div>
        </div>
      </Card>

      <ConnectorsCard connectors={row.connectors} />

      <RawJsonAccordion data={raw} />
    </>
  );
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

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.stat}>
      <Text className={styles.statValue}>{value}</Text>
      <Text className={styles.statLabel}>{label}</Text>
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
  const styles = useStyles();
  return (
    <div className={styles.sharingBlock}>
      <Text className={styles.metaLabel}>{label}</Text>
      <div className={styles.chips}>
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
