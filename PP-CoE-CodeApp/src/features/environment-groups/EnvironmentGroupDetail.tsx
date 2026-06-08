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
} from "./data";
import {
  getEnvironmentGroupGovernance,
  type EnvironmentGroupGovernanceResult,
} from "../../data/adminEnrichment";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";
import { PortalActionsBar } from "../../components/PortalActions";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import {
  getPolicyRuleItems,
  getRulesetBucketItems,
  GovernanceRulesGrid,
  type GovernanceRuleItem,
} from "../../components/ruleRenderers";
import {
  DateWithRelative,
  IdentifiersAccordion,
  Meta,
  SupplementalAdminCard,
  formatDate,
  useDetailStyles,
} from "../../components/detail";

// Group-specific styles (stat grid + envs body) not shared with the simpler
// resource detail pages.
const usePageStyles = makeStyles({
  description: {
    color: tokens.colorNeutralForeground2,
  },
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
  envsBody: {
    padding: tokens.spacingHorizontalL,
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
});

interface AsyncSlot<T> {
  kind: "loading" | "error" | "ready";
  message?: string;
  data?: T;
}

export function EnvironmentGroupDetail() {
  const styles = useDetailStyles();
  const navigate = useNavigate();
  const { groupId = "" } = useParams<{ groupId: string }>();

  const [group, setGroup] = useState<AsyncSlot<{ row: EnvironmentGroupRow; raw: unknown } | null>>({
    kind: "loading",
  });
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
      <div className={styles.colFull}>
        <Breadcrumb>
          <BreadcrumbItem>
            <BreadcrumbButton onClick={() => navigate("/environment-groups")}>
              Environment groups
            </BreadcrumbButton>
          </BreadcrumbItem>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <BreadcrumbButton current>
              {group.kind === "ready" && group.data?.row.displayName
                ? group.data.row.displayName
                : groupId}
            </BreadcrumbButton>
          </BreadcrumbItem>
        </Breadcrumb>
      </div>

      {group.kind === "loading" && (
        <div className={styles.colFull}>
          <LoadingPane label="Loading environment group…" />
        </div>
      )}

      {group.kind === "error" && (
        <div className={styles.colFull}>
          <ErrorPane title="Couldn't load environment group" message={group.message ?? "Unknown error"} />
        </div>
      )}

      {group.kind === "ready" && !group.data && (
        <div className={styles.colFull}>
          <EmptyPane message={`Environment group "${groupId}" was not found.`} />
        </div>
      )}

      {group.kind === "ready" && group.data && (
        <ReadyView
          row={group.data.row}
          raw={group.data.raw}
          envs={envs}
          counts={counts}
          envColumns={envColumns}
          navigate={navigate}
        />
      )}
    </div>
  );
}

interface ReadyViewProps {
  row: EnvironmentGroupRow;
  raw: unknown;
  envs: AsyncSlot<EnvironmentRow[]>;
  counts: AsyncSlot<ResourceCountRow[]>;
  envColumns: TableColumnDefinition<EnvironmentRow>[];
  navigate: ReturnType<typeof useNavigate>;
}

function ReadyView({ row, raw, envs, counts, envColumns, navigate }: ReadyViewProps) {
  const styles = useDetailStyles();
  const page = usePageStyles();
  return (
    <>
      <div className={styles.colFull}>
        <PortalActionsBar
          context={{
            entityKind: "environmentGroup",
            entityId: row.id,
          }}
        />
      </div>

      {/* 1. Overview header */}
      <div className={`${styles.header} ${styles.colFull}`}>
        <Text size={700} weight="semibold">
          {row.displayName || row.id}
        </Text>
        <div className={styles.badgeRow}>
          <Badge appearance="filled" color="brand">
            Environment group
          </Badge>
          {row.location && <Badge appearance="outline">{row.location}</Badge>}
        </div>
        {row.description && (
          <Text size={300} className={page.description}>
            {row.description}
          </Text>
        )}
        <div className={styles.summaryLine}>
          <Text size={300}>Explore usage for this group's environments</Text>
          <Link
            onClick={() =>
              navigate(
                `/zones/usage?groupKind=ms&groupId=${encodeURIComponent(row.id)}`,
              )
            }
          >
            Usage
          </Link>
        </div>
      </div>

      {/* 2. Details */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Details</Text>}
          description={<Text size={200}>How this group is positioned in the tenant.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Location">{row.location || "—"}</Meta>
            <Meta label="Environments">
              {envs.kind === "ready" ? (envs.data?.length ?? 0).toLocaleString() : "…"}
            </Meta>
          </div>
        </div>
      </Card>

      {/* 3. Lifecycle */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Lifecycle</Text>}
          description={<Text size={200}>When this group was created.</Text>}
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.metaGridTwo}>
            <Meta label="Created on">
              <DateWithRelative value={row.createdAt} />
            </Meta>
            <Meta label="Created by">{row.createdBy || "—"}</Meta>
          </div>
        </div>
      </Card>

      {/* 4. Resource roll-up */}
      <Card className={styles.colHalf}>
        <CardHeader
          header={<Text weight="semibold">Resource roll-up</Text>}
          description={
            <Text size={200}>Totals across every environment in this group.</Text>
          }
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
            <EmptyPane message="No resources found across environments in this group." />
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

      {/* 4b. Governance rules — supplemental, on-demand. Single card
          that fires both governance APIs in parallel, then renders the
          unified rules grid. See `docs/admin-payload-samples.md` and
          `docs/admin-connector-inventory.md`. */}
      <SupplementalAdminCard
        className={styles.colHalf}
        title="Governance rules — all rules effective on this group"
        buttonLabel="View all rules"
        loadingLabel="Loading rules from both governance models…"
        loadFn={() => getEnvironmentGroupGovernance(row.id)}
        renderReady={(result) => <GovernanceRulesBody result={result} currentGroupId={row.id} />}
      />

      {/* 5. Environments table */}
      <Card className={styles.colFull}>
        <CardHeader
          header={
            <Text weight="semibold">
              Environments in this group
              {envs.kind === "ready" ? ` (${envs.data?.length ?? 0})` : ""}
            </Text>
          }
          description={<Text size={200}>Every environment assigned to this group.</Text>}
        />
        <Divider />
        <div className={page.envsBody}>
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
              <DataGridBody<EnvironmentRow>>
                {({ item, rowId }) => (
                  <DataGridRow<EnvironmentRow> key={rowId}>
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
          { label: "Environment group ID", value: row.id },
          { label: "Resource type", value: "microsoft.powerplatform/environmentgroups" },
        ]}
      />

      {/* 7. Raw JSON */}
      <div className={styles.colFull}>
        <RawJsonAccordion data={raw} />
      </div>
    </>
  );
}

// ─── Supplemental admin-card bodies ──────────────────────────────────────
// The shell handles padding; each body owns its own summary line.

function GovernanceRulesBody({
  result,
  currentGroupId,
}: {
  result: EnvironmentGroupGovernanceResult;
  currentGroupId: string;
}) {
  const page = usePageStyles();

  const policiesData = result.policies.ok ? result.policies.data : undefined;
  const rulesetsData = result.rulesets.ok ? result.rulesets.data : undefined;

  // ── Flatten both governance models into one unified card list ─────
  const items: GovernanceRuleItem[] = [
    ...(policiesData?.policies.flatMap(getPolicyRuleItems) ?? []),
    ...(rulesetsData?.matching.value?.flatMap((rs) =>
      getRulesetBucketItems(rs, currentGroupId),
    ) ?? []),
  ];

  const hasPolicyErrors = Object.keys(policiesData?.policyErrors ?? {}).length > 0;
  const nothingApplies =
    items.length === 0 &&
    result.policies.ok &&
    result.rulesets.ok &&
    !hasPolicyErrors;

  return (
    <>
      {!result.policies.ok && (
        <ErrorPane title="Couldn't load rule-based policies" message={result.policies.error} />
      )}
      {!result.rulesets.ok && (
        <ErrorPane title="Couldn't load parameter rulesets" message={result.rulesets.error} />
      )}
      {Object.entries(policiesData?.policyErrors ?? {}).map(([policyId, message]) => (
        <ErrorPane key={policyId} title={`Couldn't load policy ${policyId}`} message={message} />
      ))}

      {nothingApplies ? (
        <Text size={300} className={page.empty}>
          No governance rules are currently applied to this group.
        </Text>
      ) : items.length > 0 ? (
        <>
          <Text size={300}>
            <strong>{items.length}</strong> governance rule{items.length === 1 ? "" : "s"} apply
            to this group.
          </Text>
          <GovernanceRulesGrid items={items} />
        </>
      ) : null}

      {/* ── Raw payloads (collapsed by default — friendly view is primary) ── */}
      <RawJsonAccordion
        data={{
          rulesets: result.rulesets.ok ? result.rulesets.data.raw : { error: result.rulesets.error },
          policies: result.policies.ok ? result.policies.data.raw : { error: result.policies.error },
        }}
        title="Raw governance payloads (both models)"
      />
    </>
  );
}
