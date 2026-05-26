import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Combobox,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  SearchBox,
  Switch,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  type InputOnChangeData,
  type OptionOnSelectData,
  type SearchBoxChangeEvent,
  type SelectTabData,
  type SelectTabEvent,
  type SelectionEvents,
} from "@fluentui/react-components";
import {
  ArrowSwapRegular,
  CheckmarkCircleFilled,
  ChevronDownRegular,
  ChevronRightRegular,
  WarningFilled,
} from "@fluentui/react-icons";
import { listEnvironmentGroups, type EnvironmentGroupRow } from "../../data/inventory";
import {
  getEnvironmentGroupAcpStatus,
  type EnvironmentGroupAcpStatus,
} from "../../data/dlpPolicies";
import {
  diffAcpStatuses,
  extractAcpSnapshot,
  type AcpActionsDiff,
  type AcpConnectorRow,
  type AcpDiffResult,
  type AcpMode,
  type AcpSnapshot,
} from "../../data/acpDiff";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";

// Lazy-load the DLP subview so the shared shell + ACP code stay light
// in the default-tab path. DlpComparator is the existing implementation
// (its outer page header was stripped when it became a tab body).
const DlpComparator = lazy(() =>
  import("./DlpComparator").then((m) => ({ default: m.DlpComparator }))
);

// ---------------------------------------------------------------------------
// Subject tabs
// ---------------------------------------------------------------------------

type ComparatorSubject = "dlp" | "acp";

const SUBJECTS: { value: ComparatorSubject; label: string }[] = [
  { value: "dlp", label: "DLP policies" },
  { value: "acp", label: "Application Control Policies" },
];

const STORAGE_KEY = "ppcoe.comparator.subject";

function loadSubject(): ComparatorSubject {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dlp" || v === "acp") return v;
  } catch {
    // ignore
  }
  return "dlp";
}

function saveSubject(s: ComparatorSubject): void {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {
    // ignore quota / privacy errors
  }
}

const useShellStyles = makeStyles({
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
  tabRow: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

/** Top-level multi-subject comparator. Picks "what do you want to
 *  compare?" first — DLP policies (existing behavior) or Application
 *  Control Policies on env groups — then renders the right sub-view.
 *
 *  Last-used subject is remembered in localStorage so an admin who
 *  lives in ACPs doesn't have to reselect every navigation. */
export function Comparator() {
  const styles = useShellStyles();
  const [subject, setSubject] = useState<ComparatorSubject>(() => loadSubject());

  const onSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    const next = data.value as ComparatorSubject;
    setSubject(next);
    saveSubject(next);
  };

  const subtitle =
    subject === "dlp"
      ? "Pick two DLP policies to see how their scope, default classification, and connector buckets differ."
      : "Pick two environment groups to see how their Application Control Policy allow-lists and ACP-only mode differ.";

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text size={700} weight="semibold">
          Comparator
        </Text>
        <Text className={styles.subtitle}>{subtitle}</Text>
      </header>

      <div className={styles.tabRow}>
        <TabList selectedValue={subject} onTabSelect={onSelect} size="large">
          {SUBJECTS.map((s) => (
            <Tab key={s.value} value={s.value}>
              {s.label}
            </Tab>
          ))}
        </TabList>
      </div>

      {subject === "dlp" && (
        <Suspense fallback={<LoadingPane label="Loading DLP comparator…" />}>
          <DlpComparator />
        </Suspense>
      )}
      {subject === "acp" && <AcpComparatorView />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ACP comparator subview
// ---------------------------------------------------------------------------

const useAcpStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  pickerRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "end",
    gap: tokens.spacingHorizontalL,
  },
  pickerLabel: {
    display: "block",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    marginBottom: tokens.spacingVerticalXS,
    fontWeight: tokens.fontWeightSemibold,
  },
  combobox: { width: "100%" },
  swapButtonWrap: { paddingBottom: tokens.spacingVerticalXS },
  summaryRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
  },
  kpi: {
    display: "flex",
    flexDirection: "column",
    minWidth: "140px",
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  kpiLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  kpiValue: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase600,
  },
  kpiWarn: { color: tokens.colorPaletteRedForeground1 },
  kpiOk: { color: tokens.colorPaletteGreenForeground1 },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
  },
  acpOnlyGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: tokens.spacingHorizontalL,
  },
  acpOnlyCol: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  acpOnlyLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  diffTable: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  td: {
    padding: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: "middle",
  },
  rowDiff: { backgroundColor: tokens.colorStatusWarningBackground1 },
  connectorName: { fontWeight: tokens.fontWeightSemibold },
  connectorId: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  searchBox: { minWidth: "260px" },
  changeCell: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  modeBadgeRow: {
    display: "inline-flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXXS,
  },
  expandToggle: {
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase200,
    border: "none",
    background: "none",
    padding: 0,
  },
  actionDetailRow: {
    backgroundColor: tokens.colorNeutralBackground3,
  },
  actionDetailCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    fontSize: tokens.fontSizeBase200,
  },
  actionDiffGrid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalM}`,
    alignItems: "baseline",
  },
  actionRemoved: {
    color: tokens.colorPaletteRedForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  actionAdded: {
    color: tokens.colorPaletteGreenForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  actionCommon: {
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  actionLabel: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
  },
});

function modeAppearance(
  mode: AcpMode | null
): { color: "success" | "warning" | "subtle" | "danger"; label: string } {
  if (mode === null) return { color: "danger", label: "Not in list" };
  if (mode === "AllAllowed") return { color: "success", label: "All allowed" };
  if (mode === "SomeAllowed") return { color: "warning", label: "Some allowed" };
  return { color: "subtle", label: mode };
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn";
}) {
  const styles = useAcpStyles();
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span
        className={mergeClasses(
          styles.kpiValue,
          tone === "warn" && styles.kpiWarn,
          tone === "ok" && styles.kpiOk
        )}
      >
        {value}
      </span>
    </div>
  );
}

interface AcpSlot {
  kind: "idle" | "loading" | "error" | "ready";
  data?: AcpSnapshot;
  status?: EnvironmentGroupAcpStatus;
  error?: string;
}

function AcpComparatorView() {
  const styles = useAcpStyles();
  const [groups, setGroups] = useState<EnvironmentGroupRow[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [aId, setAId] = useState<string | undefined>();
  const [bId, setBId] = useState<string | undefined>();
  const [snapA, setSnapA] = useState<AcpSlot>({ kind: "idle" });
  const [snapB, setSnapB] = useState<AcpSlot>({ kind: "idle" });
  const [showMatches, setShowMatches] = useState(false);
  const [connectorSearch, setConnectorSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listEnvironmentGroups();
      if (cancelled) return;
      if (!res.ok) {
        setGroupsError(res.error);
        return;
      }
      setGroups(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch each side's ACP snapshot when its id changes. Each side is
  // independent so a failure on one doesn't hide the other.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!aId) {
        setSnapA({ kind: "idle" });
        return;
      }
      setSnapA({ kind: "loading" });
      const res = await getEnvironmentGroupAcpStatus(aId);
      if (cancelled) return;
      if (!res.ok) {
        setSnapA({ kind: "error", error: res.error });
        return;
      }
      setSnapA({
        kind: "ready",
        status: res.data,
        data: extractAcpSnapshot(res.data.policies),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [aId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!bId) {
        setSnapB({ kind: "idle" });
        return;
      }
      setSnapB({ kind: "loading" });
      const res = await getEnvironmentGroupAcpStatus(bId);
      if (cancelled) return;
      if (!res.ok) {
        setSnapB({ kind: "error", error: res.error });
        return;
      }
      setSnapB({
        kind: "ready",
        status: res.data,
        data: extractAcpSnapshot(res.data.policies),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [bId]);

  const diff: AcpDiffResult | null = useMemo(() => {
    if (snapA.kind !== "ready" || snapB.kind !== "ready") return null;
    if (!snapA.data || !snapB.data) return null;
    return diffAcpStatuses(snapA.data, snapB.data);
  }, [snapA, snapB]);

  const visibleRows: AcpConnectorRow[] = useMemo(() => {
    if (!diff) return [];
    const base = showMatches
      ? diff.connectors
      : diff.connectors.filter((c) => c.membershipDiffers || c.modeDiffers);
    const q = connectorSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
  }, [diff, showMatches, connectorSearch]);

  function swap() {
    setAId(bId);
    setBId(aId);
  }

  const a = aId ? groups?.find((g) => g.id === aId) : undefined;
  const b = bId ? groups?.find((g) => g.id === bId) : undefined;

  return (
    <div className={styles.root}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>What this covers</MessageBarTitle>
          The diff compares the <strong>allow-list membership</strong>,{" "}
          per-connector <strong>AllowedActionsMode</strong> /{" "}
          <strong>AllowedConnectionTypesMode</strong>, and the{" "}
          <strong>per-action allowed sets</strong> (which specific operations
          are permitted under <code>SomeAllowed</code>) from the{" "}
          <code>ConnectorManagement</code> rule, plus the{" "}
          <strong>ACP-only mode</strong> flag from{" "}
          <code>AdvancedConnectorPoliciesOnly</code>. Expand a row to see
          which operations were added or removed.
        </MessageBarBody>
      </MessageBar>

      {groupsError && (
        <ErrorPane title="Couldn't load environment groups" message={groupsError} />
      )}
      {!groupsError && groups === null && (
        <LoadingPane label="Loading environment groups…" />
      )}
      {!groupsError && groups && groups.length === 0 && (
        <EmptyPane message="No environment groups returned for this tenant." />
      )}

      {groups && groups.length > 0 && (
        <>
          <div className={styles.pickerRow}>
            <GroupPicker
              label="Environment group A"
              groups={groups}
              value={aId}
              otherValue={bId}
              onChange={setAId}
            />
            <div className={styles.swapButtonWrap}>
              <Tooltip content="Swap A and B" relationship="label">
                <Button
                  icon={<ArrowSwapRegular />}
                  appearance="subtle"
                  aria-label="Swap groups"
                  onClick={swap}
                  disabled={!aId && !bId}
                />
              </Tooltip>
            </div>
            <GroupPicker
              label="Environment group B"
              groups={groups}
              value={bId}
              otherValue={aId}
              onChange={setBId}
            />
          </div>

          {(snapA.kind === "loading" || snapB.kind === "loading") && (
            <LoadingPane label="Loading ACP rules…" />
          )}
          {snapA.kind === "error" && (
            <ErrorPane title="Couldn't load ACPs for group A" message={snapA.error ?? "Unknown error"} />
          )}
          {snapB.kind === "error" && (
            <ErrorPane title="Couldn't load ACPs for group B" message={snapB.error ?? "Unknown error"} />
          )}

          {!diff && snapA.kind !== "loading" && snapB.kind !== "loading" && (
            <EmptyPane message="Select two environment groups above to see the comparison." />
          )}

          {diff && a && b && (
            <AcpDiffView
              diff={diff}
              nameA={a.displayName || a.id}
              nameB={b.displayName || b.id}
              showMatches={showMatches}
              onToggleMatches={setShowMatches}
              connectorSearch={connectorSearch}
              onSearchChange={setConnectorSearch}
              visibleRows={visibleRows}
            />
          )}
        </>
      )}
    </div>
  );
}

function GroupPicker({
  label,
  groups,
  value,
  otherValue,
  onChange,
}: {
  label: string;
  groups: EnvironmentGroupRow[];
  value: string | undefined;
  otherValue: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const styles = useAcpStyles();
  const selected = value ? groups.find((g) => g.id === value) : undefined;
  const [query, setQuery] = useState(selected?.displayName ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    if (selected && q === selected.displayName.toLowerCase()) return groups;
    return groups.filter(
      (g) =>
        g.displayName.toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q)
    );
  }, [groups, query, selected]);

  return (
    <label>
      <span className={styles.pickerLabel}>{label}</span>
      <Combobox
        className={styles.combobox}
        freeform
        placeholder="Choose an environment group…"
        value={query}
        selectedOptions={value ? [value] : []}
        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
        onOptionSelect={(_e: SelectionEvents, data: OptionOnSelectData) => {
          const picked = groups.find((g) => g.id === data.optionValue);
          onChange(data.optionValue || undefined);
          setQuery(picked?.displayName ?? "");
        }}
      >
        {filtered.length === 0 ? (
          <Option key="no-match" value="" disabled text="">
            No groups match "{query}"
          </Option>
        ) : (
          filtered.map((g) => {
            const isOther = g.id === otherValue;
            return (
              <Option
                key={g.id}
                value={g.id}
                text={g.displayName || g.id}
                disabled={isOther}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span>{g.displayName || g.id}</span>
                  <span
                    style={{
                      color: tokens.colorNeutralForeground3,
                      fontSize: tokens.fontSizeBase100,
                      fontFamily: tokens.fontFamilyMonospace,
                    }}
                  >
                    {g.id}
                    {isOther ? " · already selected on the other side" : ""}
                  </span>
                </div>
              </Option>
            );
          })
        )}
      </Combobox>
    </label>
  );
}

function AcpDiffView({
  diff,
  nameA,
  nameB,
  showMatches,
  onToggleMatches,
  connectorSearch,
  onSearchChange,
  visibleRows,
}: {
  diff: AcpDiffResult;
  nameA: string;
  nameB: string;
  showMatches: boolean;
  onToggleMatches: (v: boolean) => void;
  connectorSearch: string;
  onSearchChange: (v: string) => void;
  visibleRows: AcpConnectorRow[];
}) {
  const styles = useAcpStyles();
  const s = diff.summary;
  const anyDiff = s.aOnly + s.bOnly + s.modeChanged > 0 || !s.acpOnlySame;

  return (
    <>
      <div className={styles.summaryRow}>
        <Kpi
          label="Connectors differing"
          value={s.aOnly + s.bOnly + s.modeChanged}
          tone={s.aOnly + s.bOnly + s.modeChanged > 0 ? "warn" : "ok"}
        />
        <Kpi label="In both" value={s.inBoth} tone="ok" />
        <Kpi label="A only" value={s.aOnly} tone={s.aOnly > 0 ? "warn" : undefined} />
        <Kpi label="B only" value={s.bOnly} tone={s.bOnly > 0 ? "warn" : undefined} />
        <Kpi
          label="Mode changed"
          value={s.modeChanged}
          tone={s.modeChanged > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Actions changed"
          value={s.actionsChanged}
          tone={s.actionsChanged > 0 ? "warn" : undefined}
        />
        <Kpi
          label="ACP-only mode"
          value={s.acpOnlySame ? "Same" : "Different"}
          tone={s.acpOnlySame ? "ok" : "warn"}
        />
      </div>

      {!s.configuredA && (
        <MessageBar intent="warning">
          <MessageBarBody>
            Group <strong>{nameA}</strong> has no <code>ConnectorManagement</code>{" "}
            rule configured — its ACP allow-list is effectively empty (no
            connector is allowed via ACP).
          </MessageBarBody>
        </MessageBar>
      )}
      {!s.configuredB && (
        <MessageBar intent="warning">
          <MessageBarBody>
            Group <strong>{nameB}</strong> has no <code>ConnectorManagement</code>{" "}
            rule configured — its ACP allow-list is effectively empty (no
            connector is allowed via ACP).
          </MessageBarBody>
        </MessageBar>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>ACP-only mode</span>
        </div>
        <div className={styles.acpOnlyGrid}>
          <div className={styles.acpOnlyCol}>
            <span className={styles.acpOnlyLabel}>{nameA}</span>
            <AcpOnlyBadge enabled={s.acpOnlyA} />
          </div>
          <div className={styles.acpOnlyCol}>
            <span className={styles.acpOnlyLabel}>{nameB}</span>
            <AcpOnlyBadge enabled={s.acpOnlyB} />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            Allowed connectors ({visibleRows.length}
            {showMatches ? "" : ` of ${s.totalConnectors}`})
          </span>
          <div className={styles.toolbar}>
            <SearchBox
              className={styles.searchBox}
              placeholder="Search connectors…"
              value={connectorSearch}
              onChange={(_e: SearchBoxChangeEvent, data: InputOnChangeData) =>
                onSearchChange(data.value)
              }
            />
            <Switch
              checked={showMatches}
              onChange={(_e, data) => onToggleMatches(data.checked)}
              label={showMatches ? "Showing all" : "Showing only differences"}
            />
          </div>
        </div>
        {visibleRows.length === 0 ? (
          <EmptyPane
            message={
              connectorSearch.trim()
                ? `No connectors match "${connectorSearch}".`
                : !anyDiff
                  ? "Both groups have identical ACP allow-lists."
                  : "No connectors to show with the current filter."
            }
          />
        ) : (
          <table className={styles.diffTable}>
            <thead>
              <tr>
                <th className={styles.th}>Connector</th>
                <th className={styles.th}>{nameA}</th>
                <th className={styles.th}>{nameB}</th>
                <th className={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((c) => (
                <ConnectorDiffRow key={c.id} row={c} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function AcpOnlyBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge appearance="filled" color="warning" shape="rounded">
      Enabled — DLPs ignored on this group
    </Badge>
  ) : (
    <Badge appearance="outline" color="subtle" shape="rounded">
      Disabled — DLPs apply alongside ACP
    </Badge>
  );
}

function ModeCell({
  mode,
  connTypesMode,
}: {
  mode: AcpMode | null;
  connTypesMode: AcpMode | null;
}) {
  const styles = useAcpStyles();
  if (mode === null) {
    return (
      <Badge appearance="outline" color="danger">
        Not in list
      </Badge>
    );
  }
  const a = modeAppearance(mode);
  const c = modeAppearance(connTypesMode);
  return (
    <div className={styles.modeBadgeRow}>
      <Badge appearance="filled" color={a.color} size="small">
        Actions: {a.label}
      </Badge>
      {connTypesMode && connTypesMode !== mode && (
        <Badge appearance="outline" color={c.color} size="small">
          Conn types: {c.label}
        </Badge>
      )}
    </div>
  );
}

function StatusCell({ row }: { row: AcpConnectorRow }) {
  const styles = useAcpStyles();
  if (!row.membershipDiffers && !row.modeDiffers) {
    return (
      <span className={styles.changeCell}>
        <CheckmarkCircleFilled
          style={{ color: tokens.colorPaletteGreenForeground1 }}
        />
        <span>Same</span>
      </span>
    );
  }
  if (row.membershipDiffers) {
    return (
      <span className={styles.changeCell}>
        <WarningFilled style={{ color: tokens.colorPaletteDarkOrangeForeground1 }} />
        <span>{row.presentInA ? "Only in A" : "Only in B"}</span>
      </span>
    );
  }
  const label = row.actionsDiffer ? "Actions differ" : "Mode differs";
  return (
    <span className={styles.changeCell}>
      <WarningFilled style={{ color: tokens.colorPaletteDarkOrangeForeground1 }} />
      <span>{label}</span>
    </span>
  );
}

/** A connector row that optionally expands to show per-action diff. */
function ConnectorDiffRow({ row }: { row: AcpConnectorRow }) {
  const styles = useAcpStyles();
  const [expanded, setExpanded] = useState(false);
  const same = !row.membershipDiffers && !row.modeDiffers;
  const hasActionDetail = row.actionsDiffer && row.actionsDiff !== null;

  return (
    <>
      <tr className={same ? undefined : styles.rowDiff}>
        <td className={styles.td}>
          <div className={styles.connectorName}>
            {hasActionDetail && (
              <button
                className={styles.expandToggle}
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} action details for ${row.name}`}
              >
                {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
              </button>
            )}{" "}
            {row.name}
          </div>
          <div className={styles.connectorId}>{row.id}</div>
        </td>
        <td className={styles.td}>
          <ModeCell mode={row.modeA} connTypesMode={row.connTypesModeA} />
        </td>
        <td className={styles.td}>
          <ModeCell mode={row.modeB} connTypesMode={row.connTypesModeB} />
        </td>
        <td className={styles.td}>
          <StatusCell row={row} />
        </td>
      </tr>
      {expanded && hasActionDetail && (
        <tr className={styles.actionDetailRow}>
          <td colSpan={4} className={styles.actionDetailCell}>
            <ActionsDiffDetail diff={row.actionsDiff!} modeA={row.modeA} modeB={row.modeB} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Renders the per-action set diff inside the expanded row. */
function ActionsDiffDetail({
  diff,
  modeA,
  modeB,
}: {
  diff: AcpActionsDiff;
  modeA: AcpMode | null;
  modeB: AcpMode | null;
}) {
  const styles = useAcpStyles();

  const modeTransition =
    modeA === "AllAllowed" && modeB !== "AllAllowed"
      ? "Restricted: AllAllowed → SomeAllowed"
      : modeA !== "AllAllowed" && modeB === "AllAllowed"
      ? "Opened: SomeAllowed → AllAllowed"
      : null;

  return (
    <div className={styles.actionDiffGrid}>
      {modeTransition && (
        <>
          <span className={styles.actionLabel}>Mode change:</span>
          <span>{modeTransition}</span>
        </>
      )}
      {diff.removedInB.length > 0 && (
        <>
          <span className={styles.actionLabel}>Removed in B:</span>
          <span className={styles.actionRemoved}>
            {diff.removedInB.map((op) => `−${op}`).join(", ")}
          </span>
        </>
      )}
      {diff.addedInB.length > 0 && (
        <>
          <span className={styles.actionLabel}>Added in B:</span>
          <span className={styles.actionAdded}>
            {diff.addedInB.map((op) => `+${op}`).join(", ")}
          </span>
        </>
      )}
      {diff.common.length > 0 && (
        <>
          <span className={styles.actionLabel}>
            {modeTransition ? "Operations:" : "Common:"}
          </span>
          <span className={styles.actionCommon}>{diff.common.join(", ")}</span>
        </>
      )}
    </div>
  );
}
