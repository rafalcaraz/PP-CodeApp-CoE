/**
 * Zone Reporting — opt-in resource analytics for one zone.
 *
 * Lives at `/zones/:zoneId/reporting`. Pulled out of `ZoneDetailView`
 * (which is the management Kanban) so the heavy aggregate query only
 * fires when the user explicitly navigates here — addresses the per-
 * tenant 429 ceiling we were hitting when the board + every zone
 * detail page auto-fetched resource counts on open.
 *
 * One zone-scoped `countResourcesByEnvAndType` call powers everything
 * on the page:
 *   - The zone-wide stat-grid card (derived via `rollupByType`)
 *   - Per-group subtotals listed alongside each group placed in the zone
 *   - The header meta "N groups · M envs · K resources" total
 *
 * Designed as the natural home for future expansions: per-section
 * sub-rollups, time-series trends, drill-down to filtered resource
 * lists, exports — none of which belong on the management Kanban.
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
  Divider,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular } from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import {
  countResourcesByEnvAndType,
  DASHBOARD_CACHE_TTL_MS,
  listEnvironmentGroups,
  listEnvironments,
  rollupByType,
  type EnvironmentGroupRow,
  type EnvironmentRow,
  type EnvResourceCountRow,
} from "../../data/inventory";
import { customRef, msRef, refToKey } from "../../data/zones";
import { useZones } from "../../hooks/useZones";
import { ErrorPane, LoadingPane } from "../../components/Status";
import {
  ResourceRollupCard,
  type ResourceRollupState,
} from "./_components/ResourceRollupCard";

interface GroupTotal {
  kind: "ms" | "custom";
  id: string;
  displayName: string;
  envCount: number;
  resourceCount: number;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    height: "100%",
    minHeight: 0,
  },
  backRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
  },
  colorStripe: {
    width: "6px",
    minHeight: "60px",
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  headerBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  zoneIcon: {
    fontSize: tokens.fontSizeBase600,
  },
  zoneTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  description: {
    color: tokens.colorNeutralForeground3,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalXS,
    flex: 1,
    minHeight: 0,
  },
  groupList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalL,
  },
  groupRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  groupNameCell: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  groupName: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  groupMeta: {
    color: tokens.colorNeutralForeground3,
  },
  rightAligned: {
    textAlign: "right",
    minWidth: "100px",
  },
  emptyZone: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
});

export function ZoneReportingView() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { zoneId = "" } = useParams<{ zoneId: string }>();
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

  const zone = useMemo(
    () => zones.find((z) => z.id === zoneId) ?? null,
    [zones, zoneId],
  );

  // Resolve all groups placed in this zone + their member envs.
  const groupsInZone = useMemo<
    Array<{
      kind: "ms" | "custom";
      id: string;
      displayName: string;
      envs: EnvironmentRow[];
    }>
  >(() => {
    if (
      !zone ||
      envsState.kind !== "ready" ||
      envGroupsState.kind !== "ready"
    ) {
      return [];
    }
    const result: Array<{
      kind: "ms" | "custom";
      id: string;
      displayName: string;
      envs: EnvironmentRow[];
    }> = [];
    for (const msGroup of envGroupsState.rows) {
      const placement = assignments[refToKey(msRef(msGroup.id))];
      if (placement?.zoneId !== zone.id) continue;
      const envs = envsState.rows.filter(
        (e) => e.environmentGroupId === msGroup.id,
      );
      result.push({
        kind: "ms",
        id: msGroup.id,
        displayName: msGroup.displayName,
        envs,
      });
    }
    for (const customGroup of standardGroups) {
      const placement = assignments[refToKey(customRef(customGroup.id))];
      if (placement?.zoneId !== zone.id) continue;
      const memberIds = new Set(customGroup.envIds);
      const envs = envsState.rows.filter((e) => memberIds.has(e.id));
      result.push({
        kind: "custom",
        id: customGroup.id,
        displayName: customGroup.displayName,
        envs,
      });
    }
    return result;
  }, [zone, envsState, envGroupsState, assignments, standardGroups]);

  const envIdsInZone = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groupsInZone) {
      for (const e of g.envs) ids.add(e.id);
    }
    return ids;
  }, [groupsInZone]);

  // Stable sorted fingerprint so the fetch effect only refires when
  // the actual env set changes.
  const envIdsKey = useMemo(
    () => [...envIdsInZone].sort().join("|"),
    [envIdsInZone],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const envIds = envIdsKey ? envIdsKey.split("|") : [];
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
  }, [envIdsKey]);

  // By-type rollup, derived from envCounts. Folds the
  // per-(env, type) rows down to the per-type totals the stat-grid
  // expects — no second connector call needed.
  const rollupState = useMemo<ResourceRollupState>(() => {
    if (envCounts.kind === "loading") return { kind: "loading" };
    if (envCounts.kind === "error") {
      return { kind: "error", message: envCounts.message };
    }
    return { kind: "ready", rows: rollupByType(envCounts.rows) };
  }, [envCounts]);

  // Per-env total → per-group total maps.
  const totalsByEnv = useMemo(() => {
    const map = new Map<string, number>();
    if (envCounts.kind !== "ready") return map;
    for (const row of envCounts.rows) {
      map.set(row.environmentId, (map.get(row.environmentId) ?? 0) + row.count);
    }
    return map;
  }, [envCounts]);

  const groupTotals = useMemo<GroupTotal[]>(() => {
    return groupsInZone
      .map((g) => {
        let resourceCount = 0;
        for (const env of g.envs) {
          resourceCount += totalsByEnv.get(env.id) ?? 0;
        }
        return {
          kind: g.kind,
          id: g.id,
          displayName: g.displayName,
          envCount: g.envs.length,
          resourceCount,
        };
      })
      .sort((a, b) => b.resourceCount - a.resourceCount);
  }, [groupsInZone, totalsByEnv]);

  const totalResources = useMemo(() => {
    let n = 0;
    for (const v of totalsByEnv.values()) n += v;
    return n;
  }, [totalsByEnv]);

  if (envsState.kind === "loading" || envGroupsState.kind === "loading") {
    return <LoadingPane label="Loading zone…" />;
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
  if (!zone) {
    return (
      <ErrorPane
        title="Zone not found"
        message="That zone may have been deleted. Go back to the Zones board."
      />
    );
  }

  const totalEnvs = envIdsInZone.size;

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
          <BreadcrumbButton onClick={() => navigate(`/zones/${zone.id}`)}>
            {zone.name}
          </BreadcrumbButton>
        </BreadcrumbItem>
        <BreadcrumbDivider />
        <BreadcrumbItem>
          <BreadcrumbButton current>Reporting</BreadcrumbButton>
        </BreadcrumbItem>
      </Breadcrumb>

      <div className={styles.backRow}>
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={() => navigate(`/zones/${zone.id}`)}
        >
          Back to zone
        </Button>
      </div>

      <div className={styles.header}>
        <div
          className={styles.colorStripe}
          style={{ backgroundColor: zone.color }}
          aria-hidden
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.zoneIcon} aria-hidden>
              {zone.icon}
            </span>
            <Text size={600} className={styles.zoneTitle}>
              {zone.name}
            </Text>
            <Badge appearance="outline" color="brand">
              Zone reporting
            </Badge>
          </div>
          {zone.description && (
            <Text className={styles.description}>{zone.description}</Text>
          )}
          <Text className={styles.meta}>
            {groupsInZone.length} group{groupsInZone.length === 1 ? "" : "s"} ·{" "}
            {totalEnvs} env{totalEnvs === 1 ? "" : "s"}
            {rollupState.kind === "ready" && totalEnvs > 0 && (
              <>
                {" · "}
                {totalResources.toLocaleString()} resource
                {totalResources === 1 ? "" : "s"}
              </>
            )}
          </Text>
        </div>
      </div>

      <div className={styles.body}>
        <ResourceRollupCard
          state={rollupState}
          description="Counts of every resource type across all environments inside the groups placed in this zone."
          emptyMessage={
            totalEnvs === 0
              ? "Add a group with environments to this zone to see resource counts."
              : "No resources found across these environments."
          }
        />

        {groupsInZone.length > 0 && (
          <Card>
            <CardHeader
              header={<Text weight="semibold">Breakdown by group</Text>}
              description={
                <Text size={200}>
                  Per-group resource totals across the env sets placed in this
                  zone, busiest first.
                </Text>
              }
            />
            <Divider />
            {envCounts.kind === "loading" && (
              <div style={{ padding: tokens.spacingHorizontalL }}>
                <LoadingPane label="Loading per-group counts…" />
              </div>
            )}
            {envCounts.kind === "error" && (
              <div style={{ padding: tokens.spacingHorizontalL }}>
                <ErrorPane
                  title="Couldn't load per-group counts"
                  message={envCounts.message}
                />
              </div>
            )}
            {envCounts.kind === "ready" && (
              <div className={styles.groupList}>
                {groupTotals.map((g) => (
                  <div key={`${g.kind}:${g.id}`} className={styles.groupRow}>
                    <div className={styles.groupNameCell}>
                      <Text className={styles.groupName}>
                        {g.kind === "ms" ? "🛡️ " : "📦 "}
                        {g.displayName}
                      </Text>
                      <Caption1 className={styles.groupMeta}>
                        {g.envCount} env{g.envCount === 1 ? "" : "s"} ·{" "}
                        {g.kind === "ms"
                          ? "Microsoft env group"
                          : "Standard custom group"}
                      </Caption1>
                    </div>
                    <Text className={styles.rightAligned} weight="semibold">
                      {g.resourceCount.toLocaleString()}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {groupsInZone.length === 0 && (
          <div className={styles.emptyZone}>
            No groups placed in this zone yet. Add some from the Zones board
            to see resource reporting here.
          </div>
        )}
      </div>
    </div>
  );
}
