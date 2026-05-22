import { useEffect, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbButton,
  BreadcrumbDivider,
  DataGrid,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridBody,
  DataGridRow,
  DataGridCell,
  type TableColumnDefinition,
  createTableColumn,
  Card,
  CardHeader,
  Divider,
  Dropdown,
  Option,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  type OptionOnSelectData,
  type SelectionEvents,
} from "@fluentui/react-components";
import { useNavigate, useParams } from "react-router-dom";
import {
  countResourcesByTypeForEnvironment,
  friendlyResourceType,
  getEnvironment,
  listResourcesInEnvironment,
  type EnvironmentRow,
  type ResourceCountRow,
  type ResourceRow,
} from "../data/inventory";
import {
  getEnvironmentAdminDetails,
  type EnvironmentAdminDetails,
} from "../data/adminEnrichment";
import {
  getEnvironmentDlpAndAcpStatus,
  type DlpAndAcpStatus,
  type DlpScopeMatchReason,
  type EnvironmentGroupAcpStatus,
} from "../data/dlpPolicies";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
import { PortalActionsBar } from "../components/PortalActions";
import { RawJsonAccordion } from "../components/RawJsonAccordion";
import {
  DateWithRelative,
  IdentifiersAccordion,
  Meta,
  SupplementalAdminCard,
  formatDate,
  useDetailStyles,
} from "../components/detail";

// Environment-specific styles (stat-card grid + resources-card body) that
// aren't shared with the simpler resource detail pages.
const usePageStyles = makeStyles({
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalL,
  },
  statCard: {
    padding: tokens.spacingVerticalM,
  },
  statValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  resourcesBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
});

interface AsyncSlot<T> {
  kind: "loading" | "error" | "ready";
  message?: string;
  data?: T;
}

const ALL_TYPES_KEY = "__all__";

export function EnvironmentDetail() {
  const styles = useDetailStyles();
  const navigate = useNavigate();
  const { envId = "" } = useParams<{ envId: string }>();

  const [env, setEnv] = useState<AsyncSlot<{ row: EnvironmentRow; raw: unknown } | null>>({
    kind: "loading",
  });
  const [counts, setCounts] = useState<AsyncSlot<ResourceCountRow[]>>({ kind: "loading" });
  const [resources, setResources] = useState<AsyncSlot<ResourceRow[]>>({ kind: "loading" });
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES_KEY);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setEnv({ kind: "loading" });
      setCounts({ kind: "loading" });
      setResources({ kind: "loading" });
      setTypeFilter(ALL_TYPES_KEY);

      const [envRes, countsRes, resourcesRes] = await Promise.all([
        getEnvironment(envId),
        countResourcesByTypeForEnvironment(envId),
        listResourcesInEnvironment(envId),
      ]);
      if (cancelled) return;

      setEnv(envRes.ok ? { kind: "ready", data: envRes.data } : { kind: "error", message: envRes.error });
      setCounts(
        countsRes.ok ? { kind: "ready", data: countsRes.data } : { kind: "error", message: countsRes.error }
      );
      setResources(
        resourcesRes.ok
          ? { kind: "ready", data: resourcesRes.data }
          : { kind: "error", message: resourcesRes.error }
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [envId]);

  const visibleResources = useMemo(() => {
    if (resources.kind !== "ready" || !resources.data) return [];
    if (typeFilter === ALL_TYPES_KEY) return resources.data;
    return resources.data.filter((r) => r.type === typeFilter);
  }, [resources, typeFilter]);

  const onTypeFilterSelect = (_e: SelectionEvents, data: OptionOnSelectData) => {
    setTypeFilter(data.optionValue ?? ALL_TYPES_KEY);
  };

  const typeOptions = useMemo(() => {
    if (counts.kind !== "ready" || !counts.data) return [];
    return counts.data.filter((c) => c.count > 0);
  }, [counts]);

  const resourceColumns: TableColumnDefinition<ResourceRow>[] = [
    createTableColumn<ResourceRow>({
      columnId: "displayName",
      renderHeaderCell: () => "Name",
      renderCell: (row) => row.displayName || row.id,
    }),
    createTableColumn<ResourceRow>({
      columnId: "type",
      renderHeaderCell: () => "Type",
      renderCell: (row) => friendlyResourceType(row.type),
    }),
    createTableColumn<ResourceRow>({
      columnId: "ownerId",
      renderHeaderCell: () => "Owner ID",
      renderCell: (row) => row.ownerId || "—",
    }),
    createTableColumn<ResourceRow>({
      columnId: "lastModifiedAt",
      renderHeaderCell: () => "Modified",
      renderCell: (row) => formatDate(row.lastModifiedAt),
    }),
    createTableColumn<ResourceRow>({
      columnId: "isQuarantined",
      renderHeaderCell: () => "Status",
      renderCell: (row) =>
        row.isQuarantined ? (
          <Badge appearance="filled" color="danger">
            Quarantined
          </Badge>
        ) : (
          <Badge appearance="outline">Active</Badge>
        ),
    }),
  ];

  const selectedTypeText =
    typeFilter === ALL_TYPES_KEY ? "All types" : friendlyResourceType(typeFilter);

  return (
    <div className={styles.root}>
      <div className={styles.colFull}>
        <Breadcrumb>
          <BreadcrumbItem>
            <BreadcrumbButton onClick={() => navigate("/environments")}>
              Environments
            </BreadcrumbButton>
          </BreadcrumbItem>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <BreadcrumbButton current>
              {env.kind === "ready" && env.data?.row.displayName ? env.data.row.displayName : envId}
            </BreadcrumbButton>
          </BreadcrumbItem>
        </Breadcrumb>
      </div>

      {env.kind === "loading" && (
        <div className={styles.colFull}>
          <LoadingPane label="Loading environment…" />
        </div>
      )}

      {env.kind === "error" && (
        <div className={styles.colFull}>
          <ErrorPane title="Couldn't load environment" message={env.message ?? "Unknown error"} />
        </div>
      )}

      {env.kind === "ready" && !env.data && (
        <div className={styles.colFull}>
          <EmptyPane message={`Environment "${envId}" was not found.`} />
        </div>
      )}

      {env.kind === "ready" && env.data && (
        <ReadyView
          row={env.data.row}
          raw={env.data.raw}
          navigate={navigate}
          counts={counts}
          resources={resources}
          visibleResources={visibleResources}
          typeFilter={typeFilter}
          typeOptions={typeOptions}
          selectedTypeText={selectedTypeText}
          onTypeFilterSelect={onTypeFilterSelect}
          resourceColumns={resourceColumns}
        />
      )}
    </div>
  );
}

interface ReadyViewProps {
  row: EnvironmentRow;
  raw: unknown;
  navigate: ReturnType<typeof useNavigate>;
  counts: AsyncSlot<ResourceCountRow[]>;
  resources: AsyncSlot<ResourceRow[]>;
  visibleResources: ResourceRow[];
  typeFilter: string;
  typeOptions: ResourceCountRow[];
  selectedTypeText: string;
  onTypeFilterSelect: (e: SelectionEvents, data: OptionOnSelectData) => void;
  resourceColumns: TableColumnDefinition<ResourceRow>[];
}

function ReadyView({
  row,
  raw,
  navigate,
  counts,
  resources,
  visibleResources,
  typeFilter,
  typeOptions,
  selectedTypeText,
  onTypeFilterSelect,
  resourceColumns,
}: ReadyViewProps) {
  const styles = useDetailStyles();
  const page = usePageStyles();

  return (
    <>
      <div className={styles.colFull}>
        <PortalActionsBar
          context={{
            entityKind: "environment",
            entityId: row.id,
            environmentId: row.id,
          }}
        />
      </div>

      {/* 1. Overview header */}
      <div className={`${styles.header} ${styles.colFull}`}>
        <Text size={700} weight="semibold">
          {row.displayName || row.id}
        </Text>
        <div className={styles.badgeRow}>
          {row.environmentType && (
            <Badge appearance="filled" color="brand">
              {row.environmentType}
            </Badge>
          )}
          {row.isManaged ? (
            <Badge appearance="outline" color="success">
              Managed
            </Badge>
          ) : (
            <Badge appearance="outline">Standard</Badge>
          )}
        </div>
        <div className={styles.summaryLine}>
          {row.environmentGroupId ? (
            <>
              <Text size={300}>in group</Text>
              <Link
                onClick={() =>
                  navigate(`/environment-groups/${encodeURIComponent(row.environmentGroupId)}`)
                }
              >
                {row.environmentGroup || row.environmentGroupId}
              </Link>
            </>
          ) : (
            <Text size={300}>No environment group assigned</Text>
          )}
          {row.region && (
            <>
              <span className={styles.summaryDot} aria-hidden>·</span>
              <Text size={300}>{row.region}</Text>
            </>
          )}
        </div>
      </div>

      {/* 2. Details */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Details</Text>}
          description={<Text size={200}>Shape and management posture of this environment.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Type">{row.environmentType || "—"}</Meta>
            <Meta label="Region">{row.region || "—"}</Meta>
            <Meta label="Managed">{row.isManaged ? "Yes" : "No"}</Meta>
            <Meta label="Group">
              {row.environmentGroupId ? (
                <Link
                  onClick={() =>
                    navigate(`/environment-groups/${encodeURIComponent(row.environmentGroupId)}`)
                  }
                >
                  {row.environmentGroup || row.environmentGroupId}
                </Link>
              ) : (
                "—"
              )}
            </Meta>
          </div>
        </div>
      </Card>

      {/* 3. Lifecycle */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Lifecycle</Text>}
          description={<Text size={200}>When this environment was created and last modified.</Text>}
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
            <Meta label="Created by">{row.createdBy || "—"}</Meta>
          </div>
        </div>
      </Card>

      {/* 3b. Admin details — supplemental, on-demand */}
      <SupplementalAdminCard
        className={styles.colFull}
        title="Admin details (supplemental)"
        description="Live admin-scope fields not in the inventory graph (state, version, URL, retention, …). Fetched on demand from the Power Platform for Admins V2 connector — never auto-loaded."
        helpText={<>Click to call <code>GetEnvironmentByIdForUser</code> for this environment.</>}
        loadFn={() => getEnvironmentAdminDetails(row.id)}
        renderReady={(details) => <AdminDetailsBody details={details} />}
      />

      {/* 3c. DLP policy coverage — supplemental, on-demand.
          Same shell as Admin details so the UX (idle → load → list /
          error) is identical. The helper fetches every policy in the
          tenant then filters client-side, plus — when the env is both
          managed AND in an environment group — calls the env-group
          rule API in parallel to detect Application Control Policy
          (ACP) configuration and the "advanced connector policies
          only" override. All gated behind the button to avoid drumming
          `ListPoliciesV2` on every page nav. */}
      <SupplementalAdminCard
        className={styles.colFull}
        title="DLP policy coverage (supplemental)"
        description="Tenant DLP policies that target this environment, plus — when applicable — the Application Control Policy (ACP) posture from the parent environment group. Fetched on demand from the Power Platform for Admins connector — never auto-loaded."
        helpText={<>Click to call <code>ListPoliciesV2</code> and (for managed envs in a group) the env-group rule API.</>}
        buttonLabel="Load DLP policy coverage"
        loadingLabel="Loading DLP policies…"
        loadFn={() =>
          getEnvironmentDlpAndAcpStatus({
            id: row.id,
            isManaged: row.isManaged,
            environmentGroupId: row.environmentGroupId,
          })
        }
        renderReady={(status) => <DlpCoverageBody status={status} env={row} />}
      />

      {/* 4. Resource roll-up */}
      <Card className={styles.colFull}>
        <CardHeader
          header={<Text weight="semibold">Resource roll-up</Text>}
          description={<Text size={200}>Count of each resource type inside this environment.</Text>}
        />
        <Divider />
        {counts.kind === "loading" && (
          <div className={styles.cardBody}>
            <LoadingPane label="Loading resource counts…" />
          </div>
        )}
        {counts.kind === "error" && (
          <div className={styles.cardBody}>
            <ErrorPane
              title="Couldn't load resource roll-up"
              message={counts.message ?? "Unknown error"}
            />
          </div>
        )}
        {counts.kind === "ready" && (counts.data?.length ?? 0) === 0 && (
          <div className={styles.cardBody}>
            <EmptyPane message="No resources found in this environment." />
          </div>
        )}
        {counts.kind === "ready" && counts.data && counts.data.length > 0 && (
          <div className={page.statGrid}>
            {counts.data.map((c) => (
              <Card key={c.type} className={page.statCard} appearance="outline">
                <CardHeader
                  header={<Text className={page.statValue}>{c.count}</Text>}
                  description={
                    <Text className={page.statLabel}>{friendlyResourceType(c.type)}</Text>
                  }
                />
              </Card>
            ))}
          </div>
        )}
      </Card>

      {/* 5. Resources table */}
      <Card className={styles.colFull}>
        <CardHeader
          header={
            <Text weight="semibold">
              Resources
              {resources.kind === "ready" ? ` (${visibleResources.length})` : ""}
            </Text>
          }
          description={<Text size={200}>Apps, flows, and agents living in this environment.</Text>}
        />
        <Divider />
        <div className={page.resourcesBody}>
          {resources.kind === "ready" && resources.data && resources.data.length > 0 && (
            <div className={page.toolbar}>
              <Dropdown
                value={selectedTypeText}
                selectedOptions={[typeFilter]}
                onOptionSelect={onTypeFilterSelect}
              >
                <Option value={ALL_TYPES_KEY}>All types</Option>
                {typeOptions.map((t) => (
                  <Option key={t.type} value={t.type} text={friendlyResourceType(t.type)}>
                    {friendlyResourceType(t.type)} ({t.count})
                  </Option>
                ))}
              </Dropdown>
            </div>
          )}

          {resources.kind === "loading" && <LoadingPane label="Loading resources…" />}
          {resources.kind === "error" && (
            <ErrorPane title="Couldn't load resources" message={resources.message ?? "Unknown error"} />
          )}
          {resources.kind === "ready" && (resources.data?.length ?? 0) === 0 && (
            <EmptyPane message="No resources found in this environment." />
          )}
          {resources.kind === "ready" &&
            visibleResources.length === 0 &&
            (resources.data?.length ?? 0) > 0 && (
              <EmptyPane message={`No ${selectedTypeText.toLowerCase()} in this environment.`} />
            )}
          {resources.kind === "ready" && visibleResources.length > 0 && (
            <DataGrid
              items={visibleResources}
              columns={resourceColumns}
              getRowId={(r) => r.id}
              sortable={false}
              focusMode="composite"
            >
              <DataGridHeader>
                <DataGridRow>
                  {({ renderHeaderCell }) => (
                    <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                  )}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<ResourceRow>>
                {({ item, rowId }) => (
                  <DataGridRow<ResourceRow> key={rowId}>
                    {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                  </DataGridRow>
                )}
              </DataGridBody>
            </DataGrid>
          )}
        </div>
      </Card>

      {/* 6. Identifiers — collapsed */}
      <IdentifiersAccordion
        className={styles.colFull}
        items={[
          { label: "Environment ID", value: row.id },
          { label: "Environment group ID", value: row.environmentGroupId },
          { label: "Resource type", value: "microsoft.powerplatform/environments" },
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
// Renders the `EnvironmentResponse` payload from the supplemental
// `GetEnvironmentByIdForUser` call. Only surfaces fields *not* already
// shown by the inventory-derived cards above (no id/displayName/tenantId/
// type/createdDateTime/environmentGroupId duplication). Includes the raw
// payload inside the same card so the user can inspect anything the
// generated model doesn't enumerate.
function AdminDetailsBody({ details }: { details: EnvironmentAdminDetails }) {
  const styles = useDetailStyles();
  const d = details.data;
  const retention = d.retentionDetails;
  return (
    <>
      <div className={styles.metaGridTwo}>
        <Meta label="State">{d.state || "—"}</Meta>
        <Meta label="Admin mode">{d.adminMode || "—"}</Meta>
        <Meta label="Background operations">{d.backgroundOperationsState || "—"}</Meta>
        <Meta label="Protection level">{d.protectionLevel || "—"}</Meta>
        <Meta label="Version">{d.version || "—"}</Meta>
        <Meta label="Domain name">
          {d.domainName ? <span className={styles.mono}>{d.domainName}</span> : "—"}
        </Meta>
        <Meta label="URL">
          {d.url ? (
            <Link href={d.url} target="_blank" rel="noopener noreferrer">
              {d.url}
            </Link>
          ) : (
            "—"
          )}
        </Meta>
        <Meta label="Azure region">{d.azureRegion || "—"}</Meta>
        <Meta label="Geo">{d.geo || "—"}</Meta>
        <Meta label="Dataverse ID">
          {d.dataverseId ? <span className={styles.mono}>{d.dataverseId}</span> : "—"}
        </Meta>
        <Meta label="Deleted on">
          <DateWithRelative value={d.deletedDateTime ?? ""} />
        </Meta>
        <Meta label="Retention period">{retention?.retentionPeriod || "—"}</Meta>
        <Meta label="Restore available from">
          <DateWithRelative value={retention?.availableFromDateTime ?? ""} />
        </Meta>
      </div>
      <RawJsonAccordion data={details.raw} title="Raw admin payload" />
    </>
  );
}

// ── DlpCoverageBody ────────────────────────────────────────────────────────
// Renders the combined DLP coverage + ACP posture for an environment.
//
// The matrix the component handles is documented in the planning doc;
// short version:
//
//                                  empty DLPs                  with DLPs
//   not managed                    error: wide open            (rare; render DLPs)
//   managed, no group              error: no DLP + no ACPs     (rare; render DLPs)
//   managed, in group, no ACP      error: no DLP + no ACP      DLP list (no banner)
//   managed, in group, ACP cfg     success: ACP applies        DLP + info "both apply"
//   managed, in group, ACP only    success: ACP applies        DLP + warn "ignored"
//
// ACP-only mode is best-effort detected — see `summarizeAcpStatus` in
// `data/dlpPolicies.ts`. When it lands on a real tenant we'll confirm
// the exact rule shape; for now the UI is honest about the heuristic.
function DlpCoverageBody({
  status,
  env,
}: {
  status: DlpAndAcpStatus;
  env: EnvironmentRow;
}) {
  const styles = useDetailStyles();
  const dlpStyles = useDlpCoverageStyles();
  const navigate = useNavigate();

  const { coverage, acp } = status;
  const acpData = acp && "configured" in acp ? acp : null;
  const acpError = acp && "error" in acp ? acp.error : null;

  if (coverage.length === 0) {
    return (
      <NoDlpCoverageWarning
        env={env}
        acp={acpData}
        acpError={acpError}
        onNavigate={navigate}
      />
    );
  }

  return (
    <div className={dlpStyles.list}>
      {/* When DLPs DO match and the env-group has ACPs in play, surface
          the interaction at the top of the list so users don't read the
          DLP table and assume it's the whole story. */}
      {acpData?.configured && (
        <AcpInteractionBanner
          acp={acpData}
          groupId={env.environmentGroupId}
          groupName={env.environmentGroup}
          onNavigate={navigate}
        />
      )}
      {acpError && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Couldn't check ACP status on the environment group</MessageBarTitle>
            DLP coverage below is accurate, but we couldn't load the
            environment group's rule set to check whether Application
            Control Policies might override it. {acpError}
          </MessageBarBody>
        </MessageBar>
      )}

      <Text size={200} className={dlpStyles.subtle}>
        {coverage.length} polic{coverage.length === 1 ? "y" : "ies"} applies to this
        environment.
      </Text>
      {coverage.map(({ policy, reason }) => (
        <Card
          key={policy.name}
          className={dlpStyles.row}
          appearance="outline"
        >
          <div className={dlpStyles.rowHeader}>
            <Text className={dlpStyles.policyName}>
              {policy.displayName || policy.name}
            </Text>
            <Badge
              appearance="filled"
              color={matchReasonColor(reason)}
              shape="rounded"
              size="small"
            >
              {matchReasonLabel(reason)}
            </Badge>
            <Badge appearance="outline" size="small">
              {policy.environmentType}
            </Badge>
            <Badge
              appearance="tint"
              color={defaultClassificationColor(
                policy.defaultConnectorsClassification
              )}
              size="small"
            >
              Default: {policy.defaultConnectorsClassification || "—"}
            </Badge>
            {acpData?.only && (
              <Badge appearance="filled" color="warning" size="small">
                Overridden by ACP-only mode
              </Badge>
            )}
          </div>
          <div className={dlpStyles.rowMeta}>
            <span className={styles.mono}>{policy.name}</span>
            <span>
              Modified <DateWithRelative value={policy.lastModifiedTime ?? ""} />
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Banner shown above the DLP list when the env-group has ACPs
 *  configured. Two variants depending on whether ACPs *override* DLPs
 *  ("AdvancedConnectorPoliciesOnly") or just stack with them ("most
 *  restrictive wins"). */
function AcpInteractionBanner({
  acp,
  groupId,
  groupName,
  onNavigate,
}: {
  acp: EnvironmentGroupAcpStatus;
  groupId: string;
  groupName: string;
  onNavigate: ReturnType<typeof useNavigate>;
}) {
  const groupLink = (
    <Link onClick={() => onNavigate(`/environment-groups/${encodeURIComponent(groupId)}`)}>
      {groupName || groupId}
    </Link>
  );
  if (acp.only) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>DLP policies below are overridden by ACP-only mode</MessageBarTitle>
          {groupLink} has Application Control Policies configured with the
          "Advanced connector policies only" toggle. While the DLP policies
          listed here technically target this environment, governance is
          enforced exclusively by the group's ACP rules ({acp.allowedConnectorCount}
          {" "}allowed connector{acp.allowedConnectorCount === 1 ? "" : "s"}).
          Review the ACP allow-list on the group to understand what makers
          can actually use here.
        </MessageBarBody>
      </MessageBar>
    );
  }
  return (
    <MessageBar intent="info">
      <MessageBarBody>
        <MessageBarTitle>Both DLP and ACP apply — most restrictive wins</MessageBarTitle>
        The DLP policies below target this environment, and {groupLink} also
        has Application Control Policies configured ({acp.allowedConnectorCount}
        {" "}allowed connector{acp.allowedConnectorCount === 1 ? "" : "s"}).
        Effective access is the intersection: a connector is usable only when
        permitted by every applicable policy and listed in the ACP allow-list.
      </MessageBarBody>
    </MessageBar>
  );
}

/** Empty-state warning that varies by Managed-Environment + env-group
 *  membership + ACP posture. See `DlpCoverageBody` for the decision
 *  table. */
function NoDlpCoverageWarning({
  env,
  acp,
  acpError,
  onNavigate,
}: {
  env: EnvironmentRow;
  acp: EnvironmentGroupAcpStatus | null;
  acpError: string | null;
  onNavigate: ReturnType<typeof useNavigate>;
}) {
  const inGroup = Boolean(env.environmentGroupId);
  const groupLink = inGroup ? (
    <Link
      onClick={() =>
        onNavigate(`/environment-groups/${encodeURIComponent(env.environmentGroupId)}`)
      }
    >
      {env.environmentGroup || env.environmentGroupId}
    </Link>
  ) : null;

  if (!env.isManaged) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          <MessageBarTitle>No DLP coverage on an unmanaged environment</MessageBarTitle>
          No tenant DLP policy currently targets this environment, and{" "}
          <strong>Managed Environments is not enabled</strong>. Without DLP,
          makers in this environment can use any connector the tenant allows —
          there is no enforcement at all. Either bring it under an existing
          policy (or scope an existing one to include it), or enable Managed
          Environments and place it in an environment group with the
          appropriate Application Control Policies (ACPs).
        </MessageBarBody>
      </MessageBar>
    );
  }

  if (!inGroup) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          <MessageBarTitle>No DLP coverage and not in an environment group</MessageBarTitle>
          No tenant DLP policy currently targets this environment, and it is
          not a member of any environment group — so{" "}
          <strong>no Application Control Policies (ACPs) apply either</strong>.
          Either scope a DLP policy to include it, or add it to an environment
          group that has the appropriate ACP rules configured.
        </MessageBarBody>
      </MessageBar>
    );
  }

  // Managed + in group. We now know whether the group has ACPs.
  if (acp?.configured) {
    return (
      <MessageBar intent="success">
        <MessageBarBody>
          <MessageBarTitle>
            No DLP coverage, but ACPs apply via {groupLink}
            {acp.only && " (ACP-only mode)"}
          </MessageBarTitle>
          No tenant DLP policy targets this environment directly, but its
          environment group has{" "}
          <strong>
            {acp.allowedConnectorCount} allowed connector
            {acp.allowedConnectorCount === 1 ? "" : "s"}
          </strong>{" "}
          configured via Application Control Policies. Makers in this
          environment can only use connectors on that allow-list.
          {acp.only && (
            <>
              {" "}This group is configured in <strong>"Advanced connector
              policies only"</strong> mode — even if a DLP policy were
              scoped here later, it would be overridden by the ACPs.
            </>
          )}
        </MessageBarBody>
      </MessageBar>
    );
  }

  // Managed + in group, but the group has no ACPs (or we couldn't tell).
  return (
    <MessageBar intent="error">
      <MessageBarBody>
        <MessageBarTitle>No DLP coverage and no ACPs on the environment group</MessageBarTitle>
        No tenant DLP policy targets this environment, and {groupLink} does
        not have any Application Control Policy rules configured either.
        Either scope a DLP policy to include this environment, or add ACP
        rules to the environment group.
        {acpError && (
          <>
            {" "}(Note: we couldn't load the group's rules — <em>{acpError}</em> —
            so the ACP check above may be incomplete.)
          </>
        )}
      </MessageBarBody>
    </MessageBar>
  );
}

const useDlpCoverageStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  subtle: {
    color: tokens.colorNeutralForeground3,
  },
  row: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  rowHeader: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  rowMeta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  policyName: {
    fontWeight: tokens.fontWeightSemibold,
  },
});

function matchReasonLabel(r: DlpScopeMatchReason): string {
  switch (r) {
    case "all":
      return "All environments";
    case "included":
      return "Explicitly included";
    case "not-excluded":
      return "Not excluded";
    case "none":
      return "Does not apply";
  }
}

function matchReasonColor(
  r: DlpScopeMatchReason
): "brand" | "informative" | "warning" | "subtle" {
  switch (r) {
    case "all":
      return "brand";
    case "included":
      return "informative";
    case "not-excluded":
      return "warning";
    case "none":
      return "subtle";
  }
}

function defaultClassificationColor(
  v: string
): "brand" | "success" | "danger" | "subtle" {
  switch (v) {
    case "Confidential":
      return "brand";
    case "General":
      return "success";
    case "Blocked":
      return "danger";
    default:
      return "subtle";
  }
}
