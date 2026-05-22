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
  Button,
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
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
import { PortalActionsBar } from "../components/PortalActions";
import { RawJsonAccordion } from "../components/RawJsonAccordion";
import {
  DateWithRelative,
  IdentifiersAccordion,
  Meta,
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
  // ── Supplemental admin-details card ──────────────────────────────────────
  // The idle state collapses to a centered call-to-action; the ready state
  // expands to a meta grid + raw JSON. Spacing matches the surrounding
  // card bodies (`useDetailStyles().cardBody`).
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

  // ── Supplemental admin enrichment ──────────────────────────────────────
  // Lazy, click-only call to `GetEnvironmentByIdForUser` on the
  // Power Platform for Admins V2 connector. State is component-local and
  // resets when the user navigates to a different environment (parent
  // unmounts ReadyView on envId change because env transitions through
  // `loading`). See `docs/admin-connector-inventory.md` for the pattern.
  type AdminSlot =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; details: EnvironmentAdminDetails };
  const [admin, setAdmin] = useState<AdminSlot>({ kind: "idle" });

  const loadAdmin = async () => {
    setAdmin({ kind: "loading" });
    const res = await getEnvironmentAdminDetails(row.id);
    setAdmin(
      res.ok
        ? { kind: "ready", details: res.data }
        : { kind: "error", message: res.error }
    );
  };

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
      <Card className={styles.colFull}>
        <CardHeader
          header={<Text weight="semibold">Admin details (supplemental)</Text>}
          description={
            <Text size={200}>
              Live admin-scope fields not in the inventory graph (state, version, URL, retention,
              …). Fetched on demand from the Power Platform for Admins V2 connector — never
              auto-loaded. {admin.kind === "ready" && (
                <Link onClick={loadAdmin}>Refresh</Link>
              )}
            </Text>
          }
        />
        <Divider />
        {admin.kind === "idle" && (
          <div className={page.adminCta}>
            <Text size={200} className={page.adminCtaHelp}>
              Click to call <code>GetEnvironmentByIdForUser</code> for this environment.
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
        {admin.kind === "ready" && <AdminDetailsBody details={admin.details} />}
      </Card>

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
  const page = usePageStyles();
  const d = details.data;
  const retention = d.retentionDetails;
  return (
    <>
      <div className={page.adminReady}>
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
      </div>
      <div className={page.adminRawWrap}>
        <RawJsonAccordion data={details.raw} title="Raw admin payload" />
      </div>
    </>
  );
}
