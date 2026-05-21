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
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
import { PortalActionsBar } from "../components/PortalActions";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  headerBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  meta: {
    display: "flex",
    gap: tokens.spacingHorizontalXL,
    color: tokens.colorNeutralForeground3,
    flexWrap: "wrap",
    fontSize: tokens.fontSizeBase200,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: tokens.spacingHorizontalM,
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
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

interface AsyncSlot<T> {
  kind: "loading" | "error" | "ready";
  message?: string;
  data?: T;
}

const ALL_TYPES_KEY = "__all__";

export function EnvironmentDetail() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { envId = "" } = useParams<{ envId: string }>();

  const [env, setEnv] = useState<AsyncSlot<EnvironmentRow | null>>({ kind: "loading" });
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
      <Breadcrumb>
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/environments")}>
            Environments
          </BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>
            {env.kind === "ready" && env.data?.displayName ? env.data.displayName : envId}
          </BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      {env.kind === "loading" && <LoadingPane label="Loading environment…" />}

      {env.kind === "error" && (
        <ErrorPane title="Couldn't load environment" message={env.message ?? "Unknown error"} />
      )}

      {env.kind === "ready" && !env.data && (
        <EmptyPane message={`Environment "${envId}" was not found.`} />
      )}

      {env.kind === "ready" && env.data && (
        <>
          <PortalActionsBar
            context={{
              entityKind: "environment",
              entityId: env.data.id,
              environmentId: env.data.id,
            }}
          />
          <div className={styles.headerBlock}>
            <Text size={600} weight="semibold">
              {env.data.displayName || env.data.id}
            </Text>
            <div className={styles.meta}>
              <span>
                <strong>Type:</strong> {env.data.environmentType || "—"}
              </span>
              <span>
                <strong>Region:</strong> {env.data.region || "—"}
              </span>
              <span>
                <strong>Managed:</strong> {env.data.isManaged ? "Yes" : "No"}
              </span>
              <span>
                <strong>Group:</strong>{" "}
                {env.data.environmentGroupId ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/environment-groups/${encodeURIComponent(env.data!.environmentGroupId)}`);
                    }}
                  >
                    {env.data.environmentGroup || env.data.environmentGroupId}
                  </a>
                ) : (
                  "—"
                )}
              </span>
              <span>
                <strong>Created:</strong> {formatDate(env.data.createdAt)}
              </span>
              <span>
                <strong>ID:</strong> {env.data.id}
              </span>
            </div>
          </div>

          <Divider />

          <section className={styles.section}>
            <Text className={styles.sectionTitle} size={500}>
              Resource roll-up
            </Text>
            {counts.kind === "loading" && <LoadingPane label="Loading resource counts…" />}
            {counts.kind === "error" && (
              <ErrorPane title="Couldn't load resource roll-up" message={counts.message ?? "Unknown error"} />
            )}
            {counts.kind === "ready" && (counts.data?.length ?? 0) === 0 && (
              <EmptyPane message="No resources found in this environment." />
            )}
            {counts.kind === "ready" && counts.data && counts.data.length > 0 && (
              <div className={styles.statGrid}>
                {counts.data.map((c) => (
                  <Card key={c.type} className={styles.statCard} appearance="outline">
                    <CardHeader
                      header={<Text className={styles.statValue}>{c.count}</Text>}
                      description={
                        <Text className={styles.statLabel}>{friendlyResourceType(c.type)}</Text>
                      }
                    />
                  </Card>
                ))}
              </div>
            )}
          </section>

          <Divider />

          <section className={styles.section}>
            <Text className={styles.sectionTitle} size={500}>
              Resources
              {resources.kind === "ready" ? ` (${visibleResources.length})` : ""}
            </Text>

            {resources.kind === "ready" && resources.data && resources.data.length > 0 && (
              <div className={styles.toolbar}>
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
            {resources.kind === "ready" && visibleResources.length === 0 && (resources.data?.length ?? 0) > 0 && (
              <EmptyPane message={`No ${selectedTypeText.toLowerCase()} in this environment.`} />
            )}
            {resources.kind === "ready" && visibleResources.length > 0 && (
              <DataGrid
                items={visibleResources}
                columns={resourceColumns}
                getRowId={(row) => row.id}
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
          </section>
        </>
      )}
    </div>
  );
}
