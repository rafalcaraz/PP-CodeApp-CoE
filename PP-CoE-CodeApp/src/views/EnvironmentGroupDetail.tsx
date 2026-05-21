import { useEffect, useState } from "react";
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
  Link,
} from "@fluentui/react-components";
import { useNavigate, useParams } from "react-router-dom";
import {
  countResourcesByTypeForGroup,
  friendlyResourceType,
  getEnvironmentGroup,
  listEnvironmentsInGroup,
  type EnvironmentGroupRow,
  type EnvironmentRow,
  type ResourceCountRow,
} from "../data/inventory";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";

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

export function EnvironmentGroupDetail() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { groupId = "" } = useParams<{ groupId: string }>();

  const [group, setGroup] = useState<AsyncSlot<EnvironmentGroupRow | null>>({ kind: "loading" });
  const [envs, setEnvs] = useState<AsyncSlot<EnvironmentRow[]>>({ kind: "loading" });
  const [counts, setCounts] = useState<AsyncSlot<ResourceCountRow[]>>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setGroup({ kind: "loading" });
      setEnvs({ kind: "loading" });
      setCounts({ kind: "loading" });

      const [groupRes, envsRes, countsRes] = await Promise.all([
        getEnvironmentGroup(groupId),
        listEnvironmentsInGroup(groupId),
        countResourcesByTypeForGroup(groupId),
      ]);
      if (cancelled) return;

      setGroup(groupRes.ok ? { kind: "ready", data: groupRes.data } : { kind: "error", message: groupRes.error });
      setEnvs(envsRes.ok ? { kind: "ready", data: envsRes.data } : { kind: "error", message: envsRes.error });
      setCounts(countsRes.ok ? { kind: "ready", data: countsRes.data } : { kind: "error", message: countsRes.error });
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const envColumns: TableColumnDefinition<EnvironmentRow>[] = [
    createTableColumn<EnvironmentRow>({
      columnId: "displayName",
      renderHeaderCell: () => "Name",
      renderCell: (row) => (
        <Link onClick={() => navigate(`/environments/${encodeURIComponent(row.id)}`)}>
          {row.displayName || row.id}
        </Link>
      ),
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "environmentType",
      renderHeaderCell: () => "Type",
      renderCell: (row) => row.environmentType || "—",
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "region",
      renderHeaderCell: () => "Region",
      renderCell: (row) => row.region || "—",
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "isManaged",
      renderHeaderCell: () => "Managed",
      renderCell: (row) =>
        row.isManaged ? (
          <Badge appearance="filled" color="brand">
            Managed
          </Badge>
        ) : (
          <Badge appearance="outline">Standard</Badge>
        ),
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "createdAt",
      renderHeaderCell: () => "Created on",
      renderCell: (row) => formatDate(row.createdAt),
    }),
  ];

  return (
    <div className={styles.root}>
      <Breadcrumb>
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/environment-groups")}>
            Environment groups
          </BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>
            {group.kind === "ready" && group.data?.displayName ? group.data.displayName : groupId}
          </BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      {group.kind === "loading" && <LoadingPane label="Loading environment group…" />}

      {group.kind === "error" && (
        <ErrorPane title="Couldn't load environment group" message={group.message ?? "Unknown error"} />
      )}

      {group.kind === "ready" && !group.data && (
        <EmptyPane message={`Environment group "${groupId}" was not found.`} />
      )}

      {group.kind === "ready" && group.data && (
        <>
          <div className={styles.headerBlock}>
            <Text size={600} weight="semibold">
              {group.data.displayName || group.data.id}
            </Text>
            {group.data.description && <Text>{group.data.description}</Text>}
            <div className={styles.meta}>
              <span>
                <strong>Created:</strong> {formatDate(group.data.createdAt)}
              </span>
              <span>
                <strong>Location:</strong> {group.data.location || "—"}
              </span>
              <span>
                <strong>ID:</strong> {group.data.id}
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
              <EmptyPane message="No resources found across environments in this group." />
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
              Environments in this group
              {envs.kind === "ready" ? ` (${envs.data?.length ?? 0})` : ""}
            </Text>
            {envs.kind === "loading" && <LoadingPane label="Loading environments…" />}
            {envs.kind === "error" && (
              <ErrorPane title="Couldn't load environments" message={envs.message ?? "Unknown error"} />
            )}
            {envs.kind === "ready" && (envs.data?.length ?? 0) === 0 && (
              <EmptyPane message="No environments are assigned to this group." />
            )}
            {envs.kind === "ready" && envs.data && envs.data.length > 0 && (
              <DataGrid
                items={envs.data}
                columns={envColumns}
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
                <DataGridBody<EnvironmentRow>>
                  {({ item, rowId }) => (
                    <DataGridRow<EnvironmentRow> key={rowId}>
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
