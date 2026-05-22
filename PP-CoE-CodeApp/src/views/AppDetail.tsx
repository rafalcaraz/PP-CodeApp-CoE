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
  Button,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useNavigate, useParams } from "react-router-dom";
import { getApp, shortResourceType, type AppRow } from "../data/inventory";
import {
  getAppAdminDetails,
  isAppAdminDetailsSupported,
  type AppAdminDetails,
} from "../data/adminEnrichment";
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

// Page-specific styles for the supplemental admin-details card. Mirrors
// the equivalent block in EnvironmentDetail.tsx; once a third detail page
// adopts the same pattern we should hoist these onto `useDetailStyles`
// (or extract a `<SupplementalActionCard>` component).
const usePageStyles = makeStyles({
  adminCta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
  },
  adminCtaHelp: {
    color: tokens.colorNeutralForeground3,
  },
  adminReady: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
  },
  adminRawWrap: {
    paddingInline: tokens.spacingHorizontalL,
    paddingBottom: tokens.spacingVerticalL,
  },
});

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
  const page = usePageStyles();
  const ownerLabel = row.ownerDisplayName || row.ownerId;
  const entityKind = resourceTypeToEntityKind(row.type);
  const hasConfig = !!(row.appType || row.subType || row.logicalName || row.appModuleId);
  const adminSupported = isAppAdminDetailsSupported(row.type);

  // ── Supplemental admin enrichment ──────────────────────────────────────
  // Lazy, click-only call to `Get_AdminApp` on the Power Platform for
  // Admins V2 connector. Same state-machine shape as EnvironmentDetail's
  // supplemental card. Gated on `adminSupported` because model-driven
  // apps don't have a classic PowerApps admin endpoint.
  type AdminSlot =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; details: AppAdminDetails };
  const [admin, setAdmin] = useState<AdminSlot>({ kind: "idle" });

  const loadAdmin = async () => {
    setAdmin({ kind: "loading" });
    const res = await getAppAdminDetails(row.environmentId, row.id);
    setAdmin(
      res.ok
        ? { kind: "ready", details: res.data }
        : { kind: "error", message: res.error }
    );
  };

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

      {/* 5b. Admin details — supplemental, on-demand. Only meaningful
          for canvas/code/app-builder apps; model-driven apps live in
          Dataverse and have no equivalent on this connector. */}
      {adminSupported && (
        <Card className={styles.colFull}>
          <CardHeader
            header={<Text weight="semibold">Admin details (supplemental)</Text>}
            description={
              <Text size={200}>
                Live admin-scope fields not in the inventory graph (version, launch URL, document
                URI, device targeting, …). Fetched on demand from the Power Platform for Admins
                V2 connector — never auto-loaded.{" "}
                {admin.kind === "ready" && <Link onClick={loadAdmin}>Refresh</Link>}
              </Text>
            }
          />
          <Divider />
          {admin.kind === "idle" && (
            <div className={page.adminCta}>
              <Text size={200} className={page.adminCtaHelp}>
                Click to call <code>Get_AdminApp</code> for this app.
              </Text>
              <Button appearance="primary" onClick={loadAdmin}>
                Load admin details
              </Button>
            </div>
          )}
          {admin.kind === "loading" && (
            <div className={styles.cardBody}>
              <LoadingPane label="Loading admin details…" />
            </div>
          )}
          {admin.kind === "error" && (
            <div className={page.adminReady}>
              <ErrorPane title="Couldn't load admin details" message={admin.message} />
              <div>
                <Button onClick={loadAdmin}>Retry</Button>
              </div>
            </div>
          )}
          {admin.kind === "ready" && (
            <AdminDetailsBody details={admin.details} stylesMono={styles.mono} pageStyles={page} />
          )}
        </Card>
      )}

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

// ── AdminDetailsBody ───────────────────────────────────────────────────────
// Renders the `PowerApp` payload from the supplemental `Get_AdminApp`
// call. Surfaces only fields *not* already shown by the inventory-derived
// cards above (skips owner, createdBy, lastModifiedBy, shared counts,
// isFeatured, bypassConsent — those are all in the inventory row). The
// raw payload sits inside the same card so anything the meta grid omits
// is one click away.
function AdminDetailsBody({
  details,
  stylesMono,
  pageStyles,
}: {
  details: AppAdminDetails;
  stylesMono: string;
  pageStyles: ReturnType<typeof usePageStyles>;
}) {
  const styles = useDetailStyles();
  const props = details.data.properties ?? {};
  const tags = details.data.tags ?? {};
  const documentUri = props.appUris?.documentUri?.value;
  return (
    <>
      <div className={pageStyles.adminReady}>
        <div className={styles.metaGrid}>
          <Meta label="App version">{props.appVersion || "—"}</Meta>
          <Meta label="Description">{props.description || "—"}</Meta>
          <Meta label="Hero app">{props.isHeroApp ? "Yes" : "No"}</Meta>
          <Meta label="Launch URL">
            {props.appOpenUri ? (
              <Link href={props.appOpenUri} target="_blank" rel="noopener noreferrer">
                Open in Power Apps
              </Link>
            ) : (
              "—"
            )}
          </Meta>
          <Meta label="Document URI">
            {documentUri ? <span className={stylesMono}>{documentUri}</span> : "—"}
          </Meta>
          <Meta label="Primary form factor">{tags.primaryFormFactor || "—"}</Meta>
          <Meta label="Supports portrait">{tags.supportsPortrait || "—"}</Meta>
          <Meta label="Supports landscape">{tags.supportsLandscape || "—"}</Meta>
          <Meta label="Device capabilities">{tags.deviceCapabilities || "—"}</Meta>
          <Meta label="Primary device size">
            {tags.primaryDeviceWidth || tags.primaryDeviceHeight
              ? `${tags.primaryDeviceWidth ?? "?"} × ${tags.primaryDeviceHeight ?? "?"}`
              : "—"}
          </Meta>
          <Meta label="Siena version">{tags.sienaVersion || "—"}</Meta>
          <Meta label="Publisher version">{tags.publisherVersion || "—"}</Meta>
          <Meta label="Minimum API version">{tags.minimumRequiredApiVersion || "—"}</Meta>
        </div>
      </div>
      <div className={pageStyles.adminRawWrap}>
        <RawJsonAccordion data={details.raw} title="Raw admin payload" />
      </div>
    </>
  );
}
