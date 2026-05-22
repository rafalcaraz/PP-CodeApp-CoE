import { useEffect, useState } from "react";
import {
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
import {
  PortalActionsBar,
  resourceTypeToEntityKind,
} from "../components/PortalActions";
import {
  DateWithRelative,
  IdentifiersAccordion,
  Meta,
  useDetailStyles,
} from "../components/detail";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; row: AppRow; raw: unknown }
  | { kind: "missing" };

export function AppDetail() {
  const styles = useDetailStyles();
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
      <div className={styles.colFull}>
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
      </div>

      {state.kind === "loading" && (
        <div className={styles.colFull}>
          <LoadingPane label="Loading app…" />
        </div>
      )}

      {state.kind === "error" && (
        <div className={styles.colFull}>
          <ErrorPane title="Couldn't load app" message={state.message} />
        </div>
      )}

      {state.kind === "missing" && (
        <div className={styles.colFull}>
          <ErrorPane
            title="App not found"
            message="No app exists with this ID, or your account doesn't have visibility to it."
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
  row: AppRow;
  raw: unknown;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const styles = useDetailStyles();
  const ownerLabel = row.ownerDisplayName || row.ownerId;
  const entityKind = resourceTypeToEntityKind(row.type);
  const hasConfig = !!(row.appType || row.subType || row.logicalName || row.appModuleId);

  return (
    <>
      {entityKind && (
        <div className={styles.colFull}>
          <PortalActionsBar
            context={{
              entityKind,
              entityId: row.id,
              environmentId: row.environmentId,
              logicalName: row.logicalName || undefined,
              appModuleId: row.appModuleId || undefined,
            }}
          />
        </div>
      )}

      {/* 1. Overview header */}
      <div className={`${styles.header} ${styles.colFull}`}>
        <Text size={700} weight="semibold">
          {row.displayName || row.id}
        </Text>
        <div className={styles.badgeRow}>
          <Badge appearance="filled" color="brand">
            {shortResourceType(row.type)}
          </Badge>
          {row.isFeatured && (
            <Badge appearance="outline" color="success">
              Featured
            </Badge>
          )}
          {row.bypassConsent && (
            <Badge appearance="outline" color="warning">
              Bypass consent
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

      {/* 2. Configuration — kind, sub-type, Dataverse refs (MDA) */}
      {hasConfig && (
        <Card className={styles.colFull}>
          <CardHeader
            header={<Text weight="semibold">Configuration</Text>}
            description={<Text size={200}>How this app is classified and wired up.</Text>}
          />
          <Divider />
          <div className={styles.cardBody}>
            <div className={styles.metaGrid}>
              {row.appType && <Meta label="App type">{row.appType}</Meta>}
              {row.subType && <Meta label="Sub-type">{row.subType}</Meta>}
              {row.logicalName && (
                <Meta label="Logical name">
                  <span className={styles.mono}>{row.logicalName}</span>
                </Meta>
              )}
              {row.appModuleId && (
                <Meta label="App module ID">
                  <span className={styles.mono}>{row.appModuleId}</span>
                </Meta>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* 3. Connectors & actions */}
      <div className={styles.colFull}>
        <ConnectorsCard connectors={row.connectors} />
      </div>

      {/* 4. People & sharing */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">People &amp; sharing</Text>}
          description={<Text size={200}>Who owns this app and who it's shared with.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Owner">{ownerLabel || "—"}</Meta>
            <Meta label="Created by">{row.createdBy || "—"}</Meta>
            <Meta label="Last modified by">{row.lastModifiedBy || "—"}</Meta>
            <Meta label="Shared users">{row.sharedUsersCount.toLocaleString()}</Meta>
            <Meta label="Shared groups">{row.sharedGroupsCount.toLocaleString()}</Meta>
          </div>
        </div>
      </Card>

      {/* 5. Lifecycle */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Lifecycle</Text>}
          description={
            <Text size={200}>When this app was created, last modified, and last opened.</Text>
          }
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
            <Meta label="Last launched">
              <DateWithRelative value={row.lastLaunchedAt} />
            </Meta>
          </div>
        </div>
      </Card>

      {/* 6. Identifiers — collapsed */}
      <IdentifiersAccordion
        className={styles.colFull}
        items={[
          { label: "App ID", value: row.id },
          ...(row.logicalName ? [{ label: "Logical name", value: row.logicalName }] : []),
          ...(row.appModuleId ? [{ label: "App module ID", value: row.appModuleId }] : []),
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
