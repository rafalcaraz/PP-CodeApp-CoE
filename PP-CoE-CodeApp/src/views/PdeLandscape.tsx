import { useEffect, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Link,
  Button,
  Spinner,
  SearchBox,
  type SearchBoxChangeEvent,
  type InputOnChangeData,
  DataGrid,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridBody,
  DataGridRow,
  DataGridCell,
  type TableColumnDefinition,
  createTableColumn,
} from "@fluentui/react-components";
import {
  ChevronLeftRegular,
  ChevronRightRegular,
  ShieldCheckmarkRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import {
  listDeveloperEnvironments,
  countResourcesByEnvironmentForDeveloperEnvs,
  categorizePdeEnvironment,
  type EnvironmentRow,
  type PdeCategory,
} from "../data/inventory";
import {
  listDlpPolicies,
  policyAppliesToEnvironment,
} from "../data/dlpPolicies";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";

// ---------------------------------------------------------------------------
// PDE Landscape — v1 of the "personal developer environment" admin surface.
//
// Splits Developer-typed environments into three buckets that map to the
// three creation paths customers see today, and shows per-PDE asset counts
// (apps / flows / agents) plus an inferred dormancy badge derived from the
// environment's own lastModifiedAt.
//
// NOTE on dormancy: lastModifiedAt on the environment is the cheapest signal
// available from the bulk inventory. A future iteration could roll up
// max(lastModifiedAt) across all assets in the env for a stronger activity
// proxy, at the cost of one extra summarize query.
// ---------------------------------------------------------------------------

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
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    marginLeft: "auto",
  },
  dlpStatus: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  dlpError: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  searchBox: {
    minWidth: "320px",
  },
  summaryBar: {
    display: "flex",
    gap: tokens.spacingHorizontalL,
    flexWrap: "wrap",
  },
  summaryChip: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: "180px",
  },
  summaryChipLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  summaryChipValue: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalL,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  sectionTitleGroup: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  sectionTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  sectionDescription: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    maxWidth: "720px",
  },
  numericCell: {
    fontVariantNumeric: "tabular-nums",
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalM,
    paddingTop: tokens.spacingVerticalS,
  },
  pagerLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontVariantNumeric: "tabular-nums",
  },
});

const PAGE_SIZE = 25;

interface PdeRow extends EnvironmentRow {
  apps: number;
  flows: number;
  agents: number;
  daysSinceModified: number | null;
}

/** Per-env DLP coverage result. Map key is the lowercased env GUID;
 *  value is the count of DLP policies that apply (0 = uncovered). */
type DlpCoverageMap = Map<string, number>;

interface DlpCoverageState {
  phase: "idle" | "loading" | "ready" | "error";
  coverage: DlpCoverageMap | null;
  checkedAt: number | null;
  policyCount: number;
  error: string;
}

interface SectionDef {
  category: PdeCategory;
  title: string;
  description: string;
  showGroupColumn: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    category: "routed",
    title: "Routed PDEs",
    description:
      "Managed Developer environments that belong to an environment group — typically auto-provisioned by environment routing and governed by the group's rules.",
    showGroupColumn: true,
  },
  {
    category: "standaloneManaged",
    title: "Standalone managed PDEs",
    description:
      "Developer environments an admin has flipped to managed but that aren't in any environment group, so they don't inherit group-scoped rules.",
    showGroupColumn: false,
  },
  {
    category: "selfCreated",
    title: "Self-created PDEs",
    description:
      "Un-managed Developer environments (e.g. Power Apps Developer Plan). The owner is system administrator, group-scoped governance can't apply, and the env is subject to dormancy cleanup.",
    showGroupColumn: false,
  },
];

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function daysSince(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

interface DormancyBadgeProps {
  days: number | null;
}

function DormancyBadge({ days }: DormancyBadgeProps) {
  if (days === null) return <Text>—</Text>;
  let color: "success" | "informative" | "warning" = "success";
  let label = "Active";
  if (days >= 90) {
    color = "warning";
    label = "Dormant";
  } else if (days >= 30) {
    color = "informative";
    label = "Idle";
  }
  return (
    <Badge appearance="tint" color={color} title={`${days} day${days === 1 ? "" : "s"} since last modified`}>
      {label} · {days}d
    </Badge>
  );
}

export function PdeLandscape() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PdeRow[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [query, setQuery] = useState("");
  const [dlp, setDlp] = useState<DlpCoverageState>({
    phase: "idle",
    coverage: null,
    checkedAt: null,
    policyCount: 0,
    error: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setErrorMsg("");
      // Load envs + counts in parallel. The counts query is server-side
      // joined to Developer envs so we never download per-asset rows.
      const [envsRes, countsRes] = await Promise.all([
        listDeveloperEnvironments(),
        countResourcesByEnvironmentForDeveloperEnvs(),
      ]);
      if (cancelled) return;
      if (!envsRes.ok) {
        setErrorMsg(envsRes.error);
        setPhase("error");
        return;
      }
      // Tolerate a counts failure — envs alone are still useful. Surface
      // a zero count rather than blocking the whole page on an aggregate
      // hiccup.
      const counts = countsRes.ok ? countsRes.data : new Map();
      const merged: PdeRow[] = envsRes.data.map((env) => {
        const bucket = counts.get(env.id.toLowerCase()) ?? { apps: 0, flows: 0, agents: 0 };
        return {
          ...env,
          apps: bucket.apps,
          flows: bucket.flows,
          agents: bucket.agents,
          daysSinceModified: daysSince(env.lastModifiedAt),
        };
      });
      setRows(merged);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSearchChange = (_e: SearchBoxChangeEvent, data: InputOnChangeData) =>
    setQuery(data.value);

  // On-demand DLP coverage audit. Fetches all DLP policies once, then
  // evaluates each PDE row against every policy purely in JS (the
  // `policyAppliesToEnvironment` predicate is IO-free). Result is a
  // count of matching policies per env GUID — clicking into the env
  // detail page surfaces which specific policies match.
  const runDlpCheck = async () => {
    setDlp((prev) => ({ ...prev, phase: "loading", error: "" }));
    const res = await listDlpPolicies();
    if (!res.ok) {
      setDlp({
        phase: "error",
        coverage: null,
        checkedAt: null,
        policyCount: 0,
        error: res.error,
      });
      return;
    }
    const policies = res.data;
    const coverage: DlpCoverageMap = new Map();
    for (const env of rows) {
      let count = 0;
      for (const policy of policies) {
        if (policyAppliesToEnvironment(policy, env.id).applies) count++;
      }
      coverage.set(env.id.toLowerCase(), count);
    }
    setDlp({
      phase: "ready",
      coverage,
      checkedAt: Date.now(),
      policyCount: policies.length,
      error: "",
    });
  };

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.createdBy || "").toLowerCase().includes(q) ||
        (r.environmentGroup || "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const grouped = useMemo(() => {
    const map = new Map<PdeCategory, PdeRow[]>([
      ["routed", []],
      ["standaloneManaged", []],
      ["selfCreated", []],
    ]);
    for (const row of filteredRows) {
      const cat = categorizePdeEnvironment(row);
      map.get(cat)!.push(row);
    }
    return map;
  }, [filteredRows]);

  const totals = useMemo(() => {
    const t = { routed: 0, standaloneManaged: 0, selfCreated: 0 };
    for (const row of rows) {
      t[categorizePdeEnvironment(row)] += 1;
    }
    return t;
  }, [rows]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          PDE Landscape
        </Text>
        <Text className={styles.subtitle}>
          Personal Developer Environments grouped by how they came to exist and how they're governed today.
        </Text>
      </div>

      {phase === "loading" && <LoadingPane label="Loading PDEs…" />}

      {phase === "error" && (
        <ErrorPane title="Couldn't load PDEs" message={errorMsg} />
      )}

      {phase === "ready" && (
        <>
          <div className={styles.summaryBar}>
            <SummaryChip label="Total PDEs" value={rows.length} />
            <SummaryChip label="Routed" value={totals.routed} />
            <SummaryChip label="Standalone managed" value={totals.standaloneManaged} />
            <SummaryChip label="Self-created (un-managed)" value={totals.selfCreated} />
          </div>

          <div className={styles.toolbar}>
            <SearchBox
              className={styles.searchBox}
              placeholder="Search by name, ID, owner, or group"
              value={query}
              onChange={onSearchChange}
              dismiss={null}
            />
            <Text className={styles.subtitle}>
              {query
                ? `${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()} match`
                : `${rows.length.toLocaleString()} total`}
            </Text>
            <div className={styles.toolbarRight}>
              {dlp.phase === "ready" && dlp.checkedAt && (
                <Text className={styles.dlpStatus}>
                  Checked {new Date(dlp.checkedAt).toLocaleTimeString()} · {dlp.policyCount} policies evaluated
                </Text>
              )}
              {dlp.phase === "error" && (
                <Text className={styles.dlpError} title={dlp.error}>
                  DLP check failed
                </Text>
              )}
              <Button
                appearance={dlp.phase === "ready" ? "subtle" : "primary"}
                icon={
                  dlp.phase === "loading" ? (
                    <Spinner size="tiny" />
                  ) : (
                    <ShieldCheckmarkRegular />
                  )
                }
                onClick={runDlpCheck}
                disabled={dlp.phase === "loading" || rows.length === 0}
              >
                {dlp.phase === "loading"
                  ? "Checking…"
                  : dlp.phase === "ready"
                    ? "Re-check DLP coverage"
                    : "Check DLP coverage"}
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyPane message="No Developer-type environments found in this tenant." />
          ) : (
            SECTIONS.map((section) => (
              <PdeSection
                key={section.category}
                section={section}
                rows={grouped.get(section.category) ?? []}
                dlpCoverage={dlp.coverage}
                onOpenEnv={(id) => navigate(`/environments/${encodeURIComponent(id)}`)}
                onOpenGroup={(id) =>
                  navigate(`/environment-groups/${encodeURIComponent(id)}`)
                }
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

interface SummaryChipProps {
  label: string;
  value: number;
}

function SummaryChip({ label, value }: SummaryChipProps) {
  const styles = useStyles();
  return (
    <div className={styles.summaryChip}>
      <Text className={styles.summaryChipLabel}>{label}</Text>
      <Text className={styles.summaryChipValue}>{value.toLocaleString()}</Text>
    </div>
  );
}

interface PdeSectionProps {
  section: SectionDef;
  rows: PdeRow[];
  dlpCoverage: DlpCoverageMap | null;
  onOpenEnv: (envId: string) => void;
  onOpenGroup: (groupId: string) => void;
}

function PdeSection({
  section,
  rows,
  dlpCoverage,
  onOpenEnv,
  onOpenGroup,
}: PdeSectionProps) {
  const styles = useStyles();
  const [page, setPage] = useState(0);

  // Clamp the requested page to the valid range. If the row set shrinks
  // (e.g. user typed in the search box and this category now has fewer
  // pages), the clamp falls back to the last page automatically — no
  // effect-driven reset needed.
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * PAGE_SIZE;
  const pageRows = useMemo(
    () => rows.slice(startIdx, startIdx + PAGE_SIZE),
    [rows, startIdx],
  );

  const columns: TableColumnDefinition<PdeRow>[] = useMemo(() => {
    const cols: TableColumnDefinition<PdeRow>[] = [
      createTableColumn<PdeRow>({
        columnId: "name",
        renderHeaderCell: () => "Name",
        renderCell: (row) => (
          <Link onClick={() => onOpenEnv(row.id)}>{row.displayName || row.id}</Link>
        ),
      }),
      createTableColumn<PdeRow>({
        columnId: "createdBy",
        renderHeaderCell: () => "Created by",
        renderCell: (row) => row.createdBy || "—",
      }),
    ];
    if (section.showGroupColumn) {
      cols.push(
        createTableColumn<PdeRow>({
          columnId: "group",
          renderHeaderCell: () => "Group",
          renderCell: (row) =>
            row.environmentGroupId ? (
              <Link onClick={() => onOpenGroup(row.environmentGroupId)}>
                {row.environmentGroup || row.environmentGroupId}
              </Link>
            ) : (
              "—"
            ),
        }),
      );
    }
    cols.push(
      createTableColumn<PdeRow>({
        columnId: "apps",
        renderHeaderCell: () => "Apps",
        renderCell: (row) => (
          <span className={styles.numericCell}>{row.apps.toLocaleString()}</span>
        ),
      }),
      createTableColumn<PdeRow>({
        columnId: "flows",
        renderHeaderCell: () => "Flows",
        renderCell: (row) => (
          <span className={styles.numericCell}>{row.flows.toLocaleString()}</span>
        ),
      }),
      createTableColumn<PdeRow>({
        columnId: "agents",
        renderHeaderCell: () => "Agents",
        renderCell: (row) => (
          <span className={styles.numericCell}>{row.agents.toLocaleString()}</span>
        ),
      }),
    );
    if (dlpCoverage) {
      cols.push(
        createTableColumn<PdeRow>({
          columnId: "dlp",
          renderHeaderCell: () => "DLP",
          renderCell: (row) => {
            const count = dlpCoverage.get(row.id.toLowerCase()) ?? 0;
            if (count === 0) {
              return (
                <Badge
                  appearance="tint"
                  color="danger"
                  title="No DLP policy applies to this environment"
                >
                  Uncovered
                </Badge>
              );
            }
            return (
              <Badge
                appearance="tint"
                color="informative"
                title={`${count} DLP polic${count === 1 ? "y" : "ies"} apply — open env to view`}
              >
                {count.toLocaleString()}
              </Badge>
            );
          },
        }),
      );
    }
    cols.push(
      createTableColumn<PdeRow>({
        columnId: "activity",
        renderHeaderCell: () => "Last activity",
        renderCell: (row) => <DormancyBadge days={row.daysSinceModified} />,
      }),
      createTableColumn<PdeRow>({
        columnId: "createdAt",
        renderHeaderCell: () => "Created on",
        renderCell: (row) => formatDate(row.createdAt),
      }),
    );
    return cols;
  }, [section.showGroupColumn, onOpenEnv, onOpenGroup, styles.numericCell, dlpCoverage]);

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitleGroup}>
          <div className={styles.sectionTitleRow}>
            <Text size={500} weight="semibold">
              {section.title}
            </Text>
            <Badge appearance="tint" shape="rounded">
              {rows.length.toLocaleString()}
            </Badge>
          </div>
          <Text className={styles.sectionDescription}>{section.description}</Text>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyPane message="No PDEs in this category." />
      ) : (
        <>
          <DataGrid
            items={pageRows}
            columns={columns}
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
            <DataGridBody<PdeRow>>
              {({ item, rowId }) => (
                <DataGridRow<PdeRow> key={rowId}>
                  {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>

          {rows.length > PAGE_SIZE && (
            <div className={styles.pager}>
              <Text className={styles.pagerLabel}>
                {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, rows.length)} of{" "}
                {rows.length.toLocaleString()}
              </Text>
              <Button
                size="small"
                appearance="subtle"
                icon={<ChevronLeftRegular />}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                Previous
              </Button>
              <Button
                size="small"
                appearance="subtle"
                iconPosition="after"
                icon={<ChevronRightRegular />}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
