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
import { getApp, shortResourceType, type AppRow } from "../data/inventory";
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
  | { kind: "ready"; row: AppRow; raw: unknown }
  | { kind: "missing" };

export function AppDetail() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { appId } = useParams<{ appId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      const res = await getApp(appId);
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
  }, [appId]);

  return (
    <div className={styles.root}>
      <Breadcrumb size="medium">
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/apps")}>Apps</BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>
            {state.kind === "ready" ? state.row.displayName || appId : appId}
          </BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      {state.kind === "loading" && <LoadingPane label="Loading app…" />}

      {state.kind === "error" && (
        <ErrorPane title="Couldn't load app" message={state.message} />
      )}

      {state.kind === "missing" && (
        <ErrorPane
          title="App not found"
          message="No app exists with this ID, or your account doesn't have visibility to it."
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
              {state.row.isFeatured && (
                <Badge appearance="outline" color="success">
                  Featured
                </Badge>
              )}
              {state.row.bypassConsent && (
                <Badge appearance="outline" color="warning">
                  Bypass consent
                </Badge>
              )}
              {state.row.isQuarantined && (
                <Badge appearance="filled" color="danger">
                  Quarantined
                </Badge>
              )}
              {state.row.appType && (
                <Badge appearance="outline">{state.row.appType}</Badge>
              )}
              {state.row.subType && (
                <Badge appearance="outline">{state.row.subType}</Badge>
              )}
            </div>
          </div>

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
                <Meta label="Created on">{formatDate(state.row.createdAt)}</Meta>
                <Meta label="Created by">{state.row.createdBy || "—"}</Meta>
                <Meta label="Last modified">{formatDate(state.row.lastModifiedAt)}</Meta>
                <Meta label="Last modified by">{state.row.lastModifiedBy || "—"}</Meta>
                <Meta label="Last launched">{formatDate(state.row.lastLaunchedAt)}</Meta>
                <Meta label="Shared users">
                  {state.row.sharedUsersCount.toLocaleString()}
                </Meta>
                <Meta label="Shared groups">
                  {state.row.sharedGroupsCount.toLocaleString()}
                </Meta>
                <Meta label="Sub-type">{state.row.subType || "—"}</Meta>
                <Meta label="App type">{state.row.appType || "—"}</Meta>
                <Meta label="Logical name">{state.row.logicalName || "—"}</Meta>
                <Meta label="App module ID">{state.row.appModuleId || "—"}</Meta>
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

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <div className={styles.metaItem}>
      <Text className={styles.metaLabel}>{label}</Text>
      <Text>{children}</Text>
    </div>
  );
}
