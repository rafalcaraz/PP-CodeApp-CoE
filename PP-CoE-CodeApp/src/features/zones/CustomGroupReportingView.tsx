/**
 * Standard Custom Group Reporting — opt-in resource analytics for one
 * Standard custom group.
 *
 * Lives at `/zones/custom-groups/:groupId/reporting`. Sibling of
 * `ZoneReportingView`; same rationale (keep the management detail page
 * fast, fire the aggregate query only when the user navigates here).
 *
 * One `countResourcesByTypeForEnvironments` call against the group's
 * `envIds` is all this page needs — there are no sub-groups to break
 * down, so we don't need the per-env shape.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular } from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import {
  countResourcesByTypeForEnvironments,
  DASHBOARD_CACHE_TTL_MS,
} from "../../data/inventory";
import { getStandardGroup } from "../../data/standardGroups";
import { ErrorPane } from "../../components/Status";
import {
  ResourceRollupCard,
  type ResourceRollupState,
} from "./_components/ResourceRollupCard";

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
  groupIcon: {
    fontSize: tokens.fontSizeBase600,
  },
  groupTitle: {
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
});

export function CustomGroupReportingView() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { groupId = "" } = useParams<{ groupId: string }>();

  // Read directly from storage — this view is small, doesn't mutate,
  // and useZones() would over-subscribe to unrelated changes.
  const group = useMemo(() => getStandardGroup(groupId), [groupId]);

  const [rollupState, setRollupState] = useState<ResourceRollupState>({
    kind: "loading",
  });

  const memberKey = useMemo(
    () => [...(group?.envIds ?? [])].sort().join("|"),
    [group?.envIds],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const envIds = memberKey ? memberKey.split("|") : [];
      if (envIds.length === 0) {
        setRollupState({ kind: "ready", rows: [] });
        return;
      }
      setRollupState({ kind: "loading" });
      const res = await countResourcesByTypeForEnvironments(envIds, {
        cacheTtlMs: DASHBOARD_CACHE_TTL_MS,
      });
      if (cancelled) return;
      setRollupState(
        res.ok
          ? { kind: "ready", rows: res.data }
          : { kind: "error", message: res.error },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [memberKey]);

  if (!group) {
    return (
      <ErrorPane
        title="Custom group not found"
        message="That Standard custom group may have been deleted. Go back to the Zones board."
      />
    );
  }

  const totalResources =
    rollupState.kind === "ready"
      ? rollupState.rows.reduce((sum, row) => sum + row.count, 0)
      : null;

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
          <BreadcrumbButton
            onClick={() => navigate(`/zones/custom-groups/${group.id}`)}
          >
            {group.displayName}
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
          onClick={() => navigate(`/zones/custom-groups/${group.id}`)}
        >
          Back to group
        </Button>
      </div>

      <div className={styles.header}>
        <div
          className={styles.colorStripe}
          style={{ backgroundColor: group.color }}
          aria-hidden
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.groupIcon} aria-hidden>
              {group.icon}
            </span>
            <Text size={600} className={styles.groupTitle}>
              {group.displayName}
            </Text>
            <Badge appearance="outline" color="subtle">
              Group reporting
            </Badge>
          </div>
          {group.description && (
            <Text className={styles.description}>{group.description}</Text>
          )}
          <Text className={styles.meta}>
            {group.envIds.length} env{group.envIds.length === 1 ? "" : "s"}
            {totalResources !== null && group.envIds.length > 0 && (
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
          description="Counts of every resource type across all environments in this Standard custom group."
          emptyMessage={
            group.envIds.length === 0
              ? "Add environments to this group to see resource counts."
              : "No resources found across these environments."
          }
        />
      </div>
    </div>
  );
}
