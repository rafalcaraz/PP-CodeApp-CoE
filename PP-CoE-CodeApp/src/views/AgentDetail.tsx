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
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
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
import { PortalActionsBar } from "../components/PortalActions";

const useStyles = makeStyles({
  root: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalL,
    "@media (max-width: 900px)": {
      gridTemplateColumns: "1fr",
    },
  },
  colFull: {
    gridColumn: "1 / -1",
  },
  colHalf: {
    gridColumn: "span 1",
    minWidth: 0,
    height: "100%",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
  },
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
  metaGridTwo: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    "@media (max-width: 500px)": {
      gridTemplateColumns: "1fr",
    },
  },
  statsTight: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
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
  summaryLine: {
    color: tokens.colorNeutralForeground2,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    rowGap: tokens.spacingVerticalXXS,
  },
  summaryDot: {
    color: tokens.colorNeutralForeground4,
  },
  relative: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    marginLeft: tokens.spacingHorizontalXS,
  },
  mono: {
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    wordBreak: "break-all",
  },
  identifiersWrapper: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  identifiersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalM,
  },
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatRelative(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return "";
  const diffMs = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  let label: string;
  if (abs < minute) label = "just now";
  else if (abs < hour) {
    const n = Math.round(abs / minute);
    label = `${n} minute${n === 1 ? "" : "s"}`;
  } else if (abs < day) {
    const n = Math.round(abs / hour);
    label = `${n} hour${n === 1 ? "" : "s"}`;
  } else if (abs < 30 * day) {
    const n = Math.round(abs / day);
    label = n === 1 ? "yesterday" : `${n} days`;
  } else if (abs < 365 * day) {
    const n = Math.round(abs / (30 * day));
    label = `${n} month${n === 1 ? "" : "s"}`;
  } else {
    const n = Math.round(abs / (365 * day));
    label = `${n} year${n === 1 ? "" : "s"}`;
  }
  if (label === "just now" || label === "yesterday") return label;
  return future ? `in ${label}` : `${label} ago`;
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
  const styles = useStyles();
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
      {/* 1. Overview header — name, status, who/where summary */}
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
          <div className={styles.metaGridTight}>
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

      {/* 3. Channels — where it's reachable */}
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

      {/* 4. Tools & knowledge — counts + connectors */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Tools &amp; knowledge</Text>}
          description={<Text size={200}>What this agent can do.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.statsTight}>
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

      {/* 5. People & sharing — who owns it, who can see it */}
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
          <div className={styles.sharing}>
            <SharingBlock label="Editors" counts={row.sharedWithEditors} hideTenant />
            <SharingBlock label="Viewers" counts={row.sharedWithViewers} />
          </div>
        </div>
      </Card>

      {/* 6. Lifecycle — is it fresh or stale */}
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

      {/* 7. Identifiers — collapsed by default */}
      <div className={`${styles.identifiersWrapper} ${styles.colFull}`}>
        <Accordion collapsible>
          <AccordionItem value="ids">
            <AccordionHeader>
              <Text weight="semibold">Identifiers</Text>
            </AccordionHeader>
            <AccordionPanel>
              <div className={styles.identifiersGrid}>
                <Meta label="Agent ID">
                  <span className={styles.mono}>{row.id}</span>
                </Meta>
                <Meta label="Schema name">
                  <span className={styles.mono}>{row.schemaName || "—"}</span>
                </Meta>
                <Meta label="Environment ID">
                  <span className={styles.mono}>{row.environmentId || "—"}</span>
                </Meta>
                <Meta label="Entra app ID">
                  <span className={styles.mono}>{row.entraAppId || "—"}</span>
                </Meta>
                <Meta label="Title ID">
                  <span className={styles.mono}>{row.titleId || "—"}</span>
                </Meta>
                <Meta label="Tenant ID">
                  <span className={styles.mono}>{row.tenantId || "—"}</span>
                </Meta>
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>

      {/* 8. Raw JSON — unchanged */}
      <div className={styles.colFull}>
        <RawJsonAccordion data={raw} />
      </div>
    </>
  );
}

function DateWithRelative({ value }: { value: string }) {
  const styles = useStyles();
  if (!value) return <>—</>;
  const rel = formatRelative(value);
  return (
    <>
      {formatDate(value)}
      {rel && <span className={styles.relative}>({rel})</span>}
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
