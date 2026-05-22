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
import {
  getEnvironmentGroupDetails,
  getEnvironmentGroupGovernance,
  getEnvironmentGroupRoleAssignments,
  type EnvironmentGroupAdminDetails,
  type EnvironmentGroupGovernanceResult,
  type EnvironmentGroupRoleAssignmentsResult,
} from "../data/adminEnrichment";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
import { PortalActionsBar } from "../components/PortalActions";
import { RawJsonAccordion } from "../components/RawJsonAccordion";
import { PolicyRuleSetsAccordion, RulesetBucketsAccordion } from "../components/ruleRenderers";
import {
  DateWithRelative,
  IdentifiersAccordion,
  Meta,
  SupplementalAdminCard,
  formatDate,
  useDetailStyles,
} from "../components/detail";

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
  governanceHeading: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    marginTop: tokens.spacingVerticalM,
  },
  // Per-policy + per-rule-set vertical lists inside the Effective
  // Policies card body.
  policiesList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  policyBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
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
}

function ReadyView({ row, raw, envs, counts, envColumns }: ReadyViewProps) {
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
      <Card className={styles.colFull}>
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

      {/* 4b. Governance / admin enrichments — supplemental, on-demand.
          Each card fires a single read-only call to the Power Platform
          for Admins V2 connector. Phase 1 renders a minimal meta line
          + the raw JSON (defaultOpen) so we can validate payload shapes
          against the connector docs before designing friendly per-id
          renderers. See `docs/admin-payload-samples.md` for what each
          call returns and `docs/admin-connector-inventory.md` for the
          pattern. */}
      <div className={`${page.governanceHeading} ${styles.colFull}`}>
        <Text size={500} weight="semibold">
          Governance (supplemental)
        </Text>
        <Text size={200} className={page.description}>
          Read-only admin-connector calls scoped to this environment group. Each card fires
          independently when its button is clicked.
        </Text>
      </div>

      <SupplementalAdminCard
        className={styles.colHalf}
        title="Group basics"
        description="Admin-scope detail for this env group (parent group, children, lifecycle principals)."
        buttonLabel="Load group basics"
        loadingLabel="Loading group basics…"
        helpText={<>Calls <code>GetEnvironmentGroup</code>.</>}
        loadFn={() => getEnvironmentGroupDetails(row.id)}
        renderReady={(details) => <GroupBasicsBody details={details} mono={styles.mono} />}
      />

      <SupplementalAdminCard
        className={styles.colHalf}
        title="Group role assignments"
        description="Who has admin / contributor / reader roles on this env group."
        buttonLabel="Load role assignments"
        loadingLabel="Loading role assignments…"
        helpText={<>Calls <code>ListEnvironmentGroupRoleAssignments</code>.</>}
        loadFn={() => getEnvironmentGroupRoleAssignments(row.id)}
        renderReady={(result) => <RoleAssignmentsBody result={result} />}
      />

      <SupplementalAdminCard
        className={styles.colFull}
        title="Governance rules — all rules effective on this group"
        description={
          <>
            Every rule active on this group from both governance APIs — the named/versioned
            rule-based policies (Model B) and the parameter-bucket rulesets (Model A).
          </>
        }
        buttonLabel="View all rules"
        loadingLabel="Loading rules from both governance models…"
        helpText={
          <>
            Fires <code>GetRuleSetListForTenant</code> + filter (Model A) and{" "}
            <code>ListRuleAssignmentsByEnvironmentGroupId</code> → parallel{" "}
            <code>GetRuleBasedPolicyByID</code> per policy id (Model B) in parallel.
          </>
        }
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
// Phase 1: show a brief one-line summary + the raw payload (defaultOpen)
// so the user can validate live shapes against `admin-payload-samples.md`
// before we design friendly per-id renderers. Each body owns its own
// summary line — the SupplementalAdminCard shell handles padding.

function GroupBasicsBody({
  details,
  mono,
}: {
  details: EnvironmentGroupAdminDetails;
  mono: string;
}) {
  const styles = useDetailStyles();
  const d = details.data;
  const childrenCount = d.childrenGroupIds?.length ?? 0;
  return (
    <>
      <div className={styles.metaGridTwo}>
        <Meta label="Display name">{d.displayName || "—"}</Meta>
        <Meta label="Description">{d.description || "—"}</Meta>
        <Meta label="Parent group ID">
          {d.parentGroupId ? <span className={mono}>{d.parentGroupId}</span> : "—"}
        </Meta>
        <Meta label="Child group count">{childrenCount.toLocaleString()}</Meta>
        <Meta label="Created on">
          <DateWithRelative value={d.createdTime ?? ""} />
        </Meta>
        <Meta label="Last modified">
          <DateWithRelative value={d.lastModifiedTime ?? ""} />
        </Meta>
      </div>
      <RawJsonAccordion data={details.raw} title="Raw GetEnvironmentGroup payload" defaultOpen />
    </>
  );
}

function RoleAssignmentsBody({ result }: { result: EnvironmentGroupRoleAssignmentsResult }) {
  const rows = result.data.value ?? [];
  return (
    <>
      <Text size={300}>
        <strong>{rows.length}</strong> role assignment{rows.length === 1 ? "" : "s"} on this
        group.
      </Text>
      <RawJsonAccordion
        data={result.raw}
        title="Raw ListEnvironmentGroupRoleAssignments payload"
        defaultOpen
      />
    </>
  );
}

function GovernanceRulesBody({
  result,
  currentGroupId,
}: {
  result: EnvironmentGroupGovernanceResult;
  currentGroupId: string;
}) {
  const page = usePageStyles();

  // ── Top-level summary line aggregated across both models ──────────
  const policiesData = result.policies.ok ? result.policies.data : undefined;
  const rulesetsData = result.rulesets.ok ? result.rulesets.data : undefined;

  const policyCount = policiesData?.policies.length ?? 0;
  const policyRuleCount =
    policiesData?.policies.reduce((acc, p) => acc + (p.ruleSets?.length ?? 0), 0) ?? 0;
  const rulesetMatchCount = rulesetsData?.matching.value?.length ?? 0;
  const rulesetBucketCount =
    rulesetsData?.matching.value?.reduce((acc, r) => acc + (r.parameters?.length ?? 0), 0) ?? 0;

  const nothingApplies =
    policyCount === 0 &&
    (policiesData?.assignments.value?.length ?? 0) === 0 &&
    rulesetMatchCount === 0;

  return (
    <>
      <Text size={300}>
        <strong>{policyCount}</strong> rule-based polic{policyCount === 1 ? "y" : "ies"} (Model B)
        with <strong>{policyRuleCount}</strong> rule{policyRuleCount === 1 ? "" : "s"} · {" "}
        <strong>{rulesetMatchCount}</strong> ruleset{rulesetMatchCount === 1 ? "" : "s"}
        {" "}(Model A) with <strong>{rulesetBucketCount}</strong> bucket
        {rulesetBucketCount === 1 ? "" : "s"}.
      </Text>

      {nothingApplies && result.policies.ok && result.rulesets.ok && (
        <Text size={300}>No governance rules are currently applied to this group.</Text>
      )}

      {/* ── Section 1: Rule-based policies (Model B) ──────────────── */}
      <div className={page.section}>
        <Text size={500} weight="semibold">Rule-based policies</Text>
        <Text size={200} className={page.description}>
          Named, versioned policy modules.
        </Text>
        {!result.policies.ok ? (
          <ErrorPane title="Couldn't load rule-based policies" message={result.policies.error} />
        ) : policiesData!.policies.length === 0 && (policiesData!.assignments.value?.length ?? 0) === 0 ? (
          <Text size={300} className={page.empty}>
            No rule-based policies are assigned to this group.
          </Text>
        ) : (
          <div className={page.policiesList}>
            {policiesData!.policies.map((policy, policyIdx) => {
              const ruleSets = policy.ruleSets ?? [];
              return (
                <div
                  key={policy.id ?? policy.name ?? `policy-${policyIdx}`}
                  className={page.policyBlock}
                >
                  {ruleSets.length === 0 ? (
                    <Text size={300}>This policy has no rule sets.</Text>
                  ) : (
                    <PolicyRuleSetsAccordion policy={policy} />
                  )}
                </div>
              );
            })}
            {Object.entries(policiesData!.policyErrors).map(([policyId, message]) => (
              <ErrorPane
                key={policyId}
                title={`Couldn't load policy ${policyId}`}
                message={message}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Parameter rulesets (Model A) ───────────────── */}
      <div className={page.section}>
        <Text size={500} weight="semibold">Parameter rulesets</Text>
        <Text size={200} className={page.description}>
          Per-resource-type setting buckets.
        </Text>
        {!result.rulesets.ok ? (
          <ErrorPane title="Couldn't load parameter rulesets" message={result.rulesets.error} />
        ) : rulesetMatchCount === 0 ? (
          <Text size={300} className={page.empty}>
            No parameter rulesets apply to this group.{" "}
            <Text size={200}>
              ({rulesetsData!.totalInTenant.toLocaleString()} ruleset
              {rulesetsData!.totalInTenant === 1 ? "" : "s"} tenant-wide.)
            </Text>
          </Text>
        ) : (
          <>
            <Text size={200} className={page.description}>
              {rulesetMatchCount} of {rulesetsData!.totalInTenant.toLocaleString()} tenant-wide
              ruleset{rulesetsData!.totalInTenant === 1 ? "" : "s"} apply to this group.
            </Text>
            {rulesetsData!.matching.value?.map((rs, idx) => (
              <RulesetBucketsAccordion
                key={rs.id ?? `ruleset-${idx}`}
                ruleset={rs}
                currentGroupId={currentGroupId}
              />
            ))}
          </>
        )}
      </div>

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
