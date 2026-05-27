/**
 * Zone Reporting Overview — tenant-wide view across every zone.
 *
 * Lives at `/zones/reporting`. Designed to answer "how big is each
 * zone?" in one place so the user doesn't have to click through every
 * zone detail page just to compare totals.
 *
 * One aggregate query (`countResourcesByEnvAndType` over the union of
 * every env placed in any zone) powers the whole page:
 *
 *   - Tenant-wide stat-grid card (rolled up via `rollupByType`)
 *   - Per-zone table: envs · resources · top resource type, sortable,
 *     each row clicks through to that zone's own reporting page
 *
 * Same `DASHBOARD_CACHE_TTL_MS` as the per-zone reporting page so a
 * round-trip from this overview into a zone detail + back is free.
 *
 * Cost model: one aggregate connector call covers every zone on the
 * page. Adding more zones doesn't scale the network cost — only the
 * client-side bucketing.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Caption1,
  Card,
  CardHeader,
  createTableColumn,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Divider,
  Link,
  makeStyles,
  Text,
  tokens,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import { ArrowLeftRegular, OpenRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import {
  countResourcesByEnvAndType,
  DASHBOARD_CACHE_TTL_MS,
  friendlyResourceType,
  listEnvironmentGroups,
  listEnvironments,
  rollupByType,
  type EnvironmentGroupRow,
  type EnvironmentRow,
  type EnvResourceCountRow,
  type ResourceCountRow,
} from "../../data/inventory";
import { customRef, msRef, refToKey } from "../../data/zones";
import { useZones } from "../../hooks/useZones";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";
import {
  ResourceRollupCard,
  type ResourceRollupState,
} from "./_components/ResourceRollupCard";

interface ZoneRow {
  zoneId: string;
  name: string;
  icon: string;
  color: string;
  groupCount: number;
  envCount: number;
  resourceCount: number;
  topType: ResourceCountRow | null;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    maxWidth: "780px",
    lineHeight: tokens.lineHeightBase300,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  zoneNameCell: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  colorStripe: {
    width: "4px",
    height: "20px",
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  zoneIcon: {
    fontSize: tokens.fontSizeBase400,
  },
  zoneName: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  numericCell: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  topTypeCell: {
    color: tokens.colorNeutralForeground2,
  },
  topTypeMuted: {
    color: tokens.colorNeutralForeground4,
    fontStyle: "italic",
  },
  tableCard: {
    overflow: "hidden",
  },
});

export function ZonesReportingOverviewView() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { zones, assignments, standardGroups } = useZones();

  const [envsState, setEnvsState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; rows: EnvironmentRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [envGroupsState, setEnvGroupsState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; rows: EnvironmentGroupRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [envCounts, setEnvCounts] = useState<
    | { kind: "loading" }
    | { kind: "ready"; rows: EnvResourceCountRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [envsRes, groupsRes] = await Promise.all([
        listEnvironments(),
        listEnvironmentGroups(),
      ]);
      if (cancelled) return;
      setEnvsState(
        envsRes.ok
          ? { kind: "ready", rows: envsRes.data }
          : { kind: "error", message: envsRes.error },
      );
      setEnvGroupsState(
        groupsRes.ok
          ? { kind: "ready", rows: groupsRes.data }
          : { kind: "error", message: groupsRes.error },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the per-zone group + env composition. Same logic as the
  // ZonesView board uses, kept local so the two views stay
  // independently testable.
  const zoneComposition = useMemo(() => {
    if (envsState.kind !== "ready" || envGroupsState.kind !== "ready") {
      return null;
    }
    const envsByGroupId = new Map<string, EnvironmentRow[]>();
    for (const e of envsState.rows) {
      if (!e.environmentGroupId) continue;
      const list = envsByGroupId.get(e.environmentGroupId) ?? [];
      list.push(e);
      envsByGroupId.set(e.environmentGroupId, list);
    }
    const perZone = new Map<
      string,
      { groupCount: number; envIds: Set<string> }
    >();
    for (const zone of zones) {
      perZone.set(zone.id, { groupCount: 0, envIds: new Set<string>() });
    }
    // MS env groups placed in any zone
    for (const msGroup of envGroupsState.rows) {
      const placement = assignments[refToKey(msRef(msGroup.id))];
      if (!placement) continue;
      const bucket = perZone.get(placement.zoneId);
      if (!bucket) continue;
      bucket.groupCount += 1;
      for (const env of envsByGroupId.get(msGroup.id) ?? []) {
        bucket.envIds.add(env.id);
      }
    }
    // Standard custom groups placed in any zone
    for (const g of standardGroups) {
      const placement = assignments[refToKey(customRef(g.id))];
      if (!placement) continue;
      const bucket = perZone.get(placement.zoneId);
      if (!bucket) continue;
      bucket.groupCount += 1;
      for (const id of g.envIds) bucket.envIds.add(id);
    }
    return perZone;
  }, [zones, assignments, envGroupsState, envsState, standardGroups]);

  // Union of every env placed in ANY zone — the smallest set we need
  // to query. Sorted-joined into a stable string fingerprint so the
  // fetch effect doesn't re-fire on identity-changed but value-equal
  // Maps.
  const allZonedEnvIdsKey = useMemo(() => {
    if (!zoneComposition) return "";
    const all = new Set<string>();
    for (const { envIds } of zoneComposition.values()) {
      for (const id of envIds) all.add(id);
    }
    return [...all].sort().join("|");
  }, [zoneComposition]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const envIds = allZonedEnvIdsKey ? allZonedEnvIdsKey.split("|") : [];
      if (envIds.length === 0) {
        setEnvCounts({ kind: "ready", rows: [] });
        return;
      }
      setEnvCounts({ kind: "loading" });
      const res = await countResourcesByEnvAndType(envIds, {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      });
      if (cancelled) return;
      setEnvCounts(
        res.ok
          ? { kind: "ready", rows: res.data }
          : { kind: "error", message: res.error },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [allZonedEnvIdsKey]);

  // Per-env totals across all types — used to derive per-zone totals.
  const totalByEnv = useMemo(() => {
    const map = new Map<string, number>();
    if (envCounts.kind !== "ready") return map;
    for (const row of envCounts.rows) {
      map.set(row.environmentId, (map.get(row.environmentId) ?? 0) + row.count);
    }
    return map;
  }, [envCounts]);

  // Per-env per-type counts — used to find each zone's busiest type.
  const byEnvAndType = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    if (envCounts.kind !== "ready") return map;
    for (const row of envCounts.rows) {
      const inner = map.get(row.environmentId) ?? new Map<string, number>();
      inner.set(row.type, (inner.get(row.type) ?? 0) + row.count);
      map.set(row.environmentId, inner);
    }
    return map;
  }, [envCounts]);

  const zoneRows = useMemo<ZoneRow[]>(() => {
    if (!zoneComposition) return [];
    return zones
      .map<ZoneRow>((zone) => {
        const composition = zoneComposition.get(zone.id);
        const envIds = composition?.envIds ?? new Set<string>();
        const groupCount = composition?.groupCount ?? 0;
        let resourceCount = 0;
        const typeTotals = new Map<string, number>();
        for (const envId of envIds) {
          resourceCount += totalByEnv.get(envId) ?? 0;
          const perType = byEnvAndType.get(envId);
          if (perType) {
            for (const [type, count] of perType) {
              typeTotals.set(type, (typeTotals.get(type) ?? 0) + count);
            }
          }
        }
        let topType: ResourceCountRow | null = null;
        for (const [type, count] of typeTotals) {
          if (!topType || count > topType.count) topType = { type, count };
        }
        return {
          zoneId: zone.id,
          name: zone.name,
          icon: zone.icon,
          color: zone.color,
          groupCount,
          envCount: envIds.size,
          resourceCount,
          topType,
        };
      })
      // Sort by resource count desc by default — the answer to "where
      // is the biggest concentration" is the most common question this
      // page exists to answer.
      .sort((a, b) => b.resourceCount - a.resourceCount);
  }, [zones, zoneComposition, totalByEnv, byEnvAndType]);

  // Tenant-wide rollup state — uses the same `rollupByType` fold as
  // the per-zone view, just over every zoned env at once.
  const tenantRollupState = useMemo<ResourceRollupState>(() => {
    if (envCounts.kind === "loading") return { kind: "loading" };
    if (envCounts.kind === "error") {
      return { kind: "error", message: envCounts.message };
    }
    return { kind: "ready", rows: rollupByType(envCounts.rows) };
  }, [envCounts]);

  const totals = useMemo(() => {
    let envs = 0;
    let resources = 0;
    let groups = 0;
    for (const row of zoneRows) {
      envs += row.envCount;
      resources += row.resourceCount;
      groups += row.groupCount;
    }
    return { envs, resources, groups };
  }, [zoneRows]);

  if (envsState.kind === "loading" || envGroupsState.kind === "loading") {
    return <LoadingPane label="Loading zones…" />;
  }
  if (envsState.kind === "error") {
    return (
      <ErrorPane
        title="Couldn't load environments"
        message={envsState.message}
      />
    );
  }
  if (envGroupsState.kind === "error") {
    return (
      <ErrorPane
        title="Couldn't load environment groups"
        message={envGroupsState.message}
      />
    );
  }

  const columns: TableColumnDefinition<ZoneRow>[] = [
    createTableColumn<ZoneRow>({
      columnId: "name",
      compare: (a, b) => a.name.localeCompare(b.name),
      renderHeaderCell: () => "Zone",
      renderCell: (row) => (
        <div className={styles.zoneNameCell}>
          <div
            className={styles.colorStripe}
            style={{ backgroundColor: row.color }}
            aria-hidden
          />
          <span className={styles.zoneIcon} aria-hidden>
            {row.icon}
          </span>
          <Link
            onClick={() => navigate(`/zones/${row.zoneId}/reporting`)}
            className={styles.zoneName}
          >
            {row.name}
          </Link>
        </div>
      ),
    }),
    createTableColumn<ZoneRow>({
      columnId: "groupCount",
      compare: (a, b) => a.groupCount - b.groupCount,
      renderHeaderCell: () => "Groups",
      renderCell: (row) => (
        <span className={styles.numericCell}>
          {row.groupCount.toLocaleString()}
        </span>
      ),
    }),
    createTableColumn<ZoneRow>({
      columnId: "envCount",
      compare: (a, b) => a.envCount - b.envCount,
      renderHeaderCell: () => "Environments",
      renderCell: (row) => (
        <span className={styles.numericCell}>
          {row.envCount.toLocaleString()}
        </span>
      ),
    }),
    createTableColumn<ZoneRow>({
      columnId: "resourceCount",
      compare: (a, b) => a.resourceCount - b.resourceCount,
      renderHeaderCell: () => "Resources",
      renderCell: (row) =>
        envCounts.kind === "ready" ? (
          <span className={styles.numericCell}>
            {row.resourceCount.toLocaleString()}
          </span>
        ) : (
          <span className={styles.topTypeMuted}>…</span>
        ),
    }),
    createTableColumn<ZoneRow>({
      columnId: "topType",
      compare: (a, b) => (b.topType?.count ?? 0) - (a.topType?.count ?? 0),
      renderHeaderCell: () => "Busiest type",
      renderCell: (row) =>
        envCounts.kind !== "ready" ? (
          <span className={styles.topTypeMuted}>…</span>
        ) : row.topType ? (
          <span className={styles.topTypeCell}>
            {friendlyResourceType(row.topType.type)} ·{" "}
            {row.topType.count.toLocaleString()}
          </span>
        ) : (
          <span className={styles.topTypeMuted}>—</span>
        ),
    }),
    createTableColumn<ZoneRow>({
      columnId: "open",
      renderHeaderCell: () => "",
      renderCell: (row) => (
        <Button
          size="small"
          appearance="subtle"
          icon={<OpenRegular />}
          onClick={() => navigate(`/zones/${row.zoneId}/reporting`)}
          aria-label={`Open ${row.name} reporting`}
        >
          Open
        </Button>
      ),
    }),
  ];

  return (
    <div className={styles.root}>
      <Breadcrumb>
        <BreadcrumbItem>
          <BreadcrumbButton onClick={() => navigate("/zones")}>
            Zones board
          </BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>Reporting overview</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <Button
        size="small"
        appearance="subtle"
        icon={<ArrowLeftRegular />}
        onClick={() => navigate("/zones")}
        style={{ alignSelf: "flex-start" }}
      >
        Back to Zones board
      </Button>

      <div className={styles.header}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.spacingHorizontalS,
          }}
        >
          <Text size={600} weight="semibold">
            Zone reporting
          </Text>
          <Badge appearance="outline" color="brand">
            Overview
          </Badge>
        </div>
        <Text className={styles.subtitle}>
          Resource totals across every zone. Click a row to drill into that
          zone's per-group breakdown.
        </Text>
        <Text className={styles.meta}>
          {zones.length} zone{zones.length === 1 ? "" : "s"} ·{" "}
          {totals.groups} placed group{totals.groups === 1 ? "" : "s"} ·{" "}
          {totals.envs} env{totals.envs === 1 ? "" : "s"}
          {envCounts.kind === "ready" && (
            <>
              {" · "}
              {totals.resources.toLocaleString()} resource
              {totals.resources === 1 ? "" : "s"}
            </>
          )}
        </Text>
      </div>

      <div className={styles.body}>
        <ResourceRollupCard
          state={tenantRollupState}
          title="Tenant roll-up (across every zoned environment)"
          description="Counts of every resource type, summed across the environments placed in any zone."
          emptyMessage={
            allZonedEnvIdsKey === ""
              ? "No environments are placed in any zone yet. Drag groups into zones on the board to see resource counts here."
              : "No resources found across these environments."
          }
        />

        <Card className={styles.tableCard}>
          <CardHeader
            header={<Text weight="semibold">Per-zone breakdown</Text>}
            description={
              <Text size={200}>
                Sort by any column. Click a zone name (or the Open button) to
                see its per-group breakdown.
              </Text>
            }
          />
          <Divider />
          {zones.length === 0 ? (
            <div style={{ padding: tokens.spacingHorizontalL }}>
              <EmptyPane message="No zones yet. Create your first zone from the Zones board." />
            </div>
          ) : (
            <DataGrid
              items={zoneRows}
              columns={columns}
              sortable
              defaultSortState={{
                sortColumn: "resourceCount",
                sortDirection: "descending",
              }}
              getRowId={(row) => row.zoneId}
            >
              <DataGridHeader>
                <DataGridRow>
                  {({ renderHeaderCell }) => (
                    <DataGridHeaderCell>
                      {renderHeaderCell()}
                    </DataGridHeaderCell>
                  )}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<ZoneRow>>
                {({ item, rowId }) => (
                  <DataGridRow<ZoneRow> key={rowId}>
                    {({ renderCell }) => (
                      <DataGridCell>{renderCell(item)}</DataGridCell>
                    )}
                  </DataGridRow>
                )}
              </DataGridBody>
            </DataGrid>
          )}
          {envCounts.kind === "error" && (
            <div style={{ padding: tokens.spacingHorizontalL }}>
              <Caption1
                style={{ color: tokens.colorPaletteRedForeground1 }}
              >
                Couldn't load resource counts: {envCounts.message}. The
                "Resources" and "Busiest type" columns will be empty.
              </Caption1>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
