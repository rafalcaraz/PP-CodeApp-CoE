import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Combobox,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  Tab,
  TabList,
  Text,
  createTableColumn,
  makeStyles,
  mergeClasses,
  tokens,
  type InputOnChangeData,
  type OptionOnSelectData,
  type SelectTabData,
  type SelectTabEvent,
  type SelectionEvents,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  PlayRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import {
  friendlyConnectorName,
  listEnvironmentGroups,
  resourceTypeShort,
  type EnvironmentGroupRow,
  type ResourceTypeValue,
} from "../../data/inventory";
import {
  getEnvironmentGroupAcpStatus,
  type EnvironmentGroupAcpStatus,
} from "../../data/dlpPolicies";
import {
  queryAcpImpact,
  type AcpImpactResult,
  type AcpImpactRow,
} from "../../data/acpImpact";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";
import { downloadCsv, rowsToCsv } from "../../utils/csv";

const DlpImpact = lazy(() =>
  import("./DlpImpact").then((m) => ({ default: m.DlpImpact }))
);

// ---------------------------------------------------------------------------
// Subject tabs
// ---------------------------------------------------------------------------

type ImpactSubject = "dlp" | "acp";

const SUBJECTS: { value: ImpactSubject; label: string }[] = [
  { value: "dlp", label: "DLP policies" },
  { value: "acp", label: "Application Control Policies" },
];

const STORAGE_KEY = "ppcoe.impact.subject";

function loadSubject(): ImpactSubject {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dlp" || v === "acp") return v;
  } catch {
    // ignore
  }
  return "dlp";
}

function saveSubject(s: ImpactSubject): void {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {
    // ignore
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

/** Top-level multi-subject impact analyzer. DLP tab keeps the existing
 *  flow; ACP tab uses the env-group → connector → resources scope
 *  derivation in `queryAcpImpact`. Same shell pattern as `Comparator`. */
export function Impact() {
  const styles = useShellStyles();
  const [subject, setSubject] = useState<ImpactSubject>(() => loadSubject());

  const onSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    const next = data.value as ImpactSubject;
    setSubject(next);
    saveSubject(next);
  };

  const subtitle =
    subject === "dlp"
      ? "Pick a DLP policy and one of its currently allowed connectors to see which apps, flows, and agents in the policy's scope would be affected if you moved that connector to Blocked."
      : "Pick an environment group and a connector to see which apps, flows, and agents in the group's environments would lose access if that connector were removed from the ACP allow-list.";

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text size={700} weight="semibold">
          Impact
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
        <Suspense fallback={<LoadingPane label="Loading DLP impact…" />}>
          <DlpImpact />
        </Suspense>
      )}
      {subject === "acp" && <AcpImpactView />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ACP impact subview
// ---------------------------------------------------------------------------

const useAcpStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  pickerRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr auto auto",
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
  operationInputWrap: {
    display: "flex",
    flexDirection: "column",
  },
  operationInput: { minWidth: "160px" },
  analyzeButtonWrap: { paddingBottom: "1px" },
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
  beforeAfter: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
    flexWrap: "wrap",
  },
  arrow: {
    color: tokens.colorPaletteDarkOrangeForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  searchBox: { minWidth: "260px" },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
  },
  connectorOptionMain: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  connectorOptionSub: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
  },
});

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

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function AcpImpactView() {
  const styles = useAcpStyles();

  const [groups, setGroups] = useState<EnvironmentGroupRow[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [connectorSlug, setConnectorSlug] = useState<string | undefined>();
  const [operationId, setOperationId] = useState<string>("");

  // Auto-loaded when a group is selected — surfaces the current
  // allow-list as suggestions in the connector picker.
  const [acpStatus, setAcpStatus] = useState<EnvironmentGroupAcpStatus | null>(null);
  const [acpError, setAcpError] = useState<string | null>(null);

  const [result, setResult] = useState<AcpImpactResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");

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

  // Refetch ACP status when the picked group changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!groupId) {
        setAcpStatus(null);
        setAcpError(null);
        return;
      }
      setAcpStatus(null);
      setAcpError(null);
      const res = await getEnvironmentGroupAcpStatus(groupId);
      if (cancelled) return;
      if (!res.ok) {
        setAcpError(res.error);
        return;
      }
      setAcpStatus(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Reset downstream state when group changes (avoid stale results
  // bleeding through when switching groups).
  function changeGroup(id: string | undefined) {
    setGroupId(id);
    setConnectorSlug(undefined);
    setOperationId("");
    setResult(null);
    setAnalyzeError(null);
    setTableSearch("");
  }

  const group = useMemo(
    () => (groupId ? groups?.find((g) => g.id === groupId) : undefined),
    [groupId, groups]
  );

  // Suggestions for the connector picker — slugs from the group's
  // current ACP allow-list. Helpful so the user can click instead of
  // typing.
  const allowedSlugs = useMemo<Array<{ id: string; name: string }>>(() => {
    if (!acpStatus) return [];
    const slugs = new Set<string>();
    for (const p of acpStatus.policies) {
      for (const rule of p.ruleSets ?? []) {
        if (rule.id !== "ConnectorManagement") continue;
        const inputs = (rule.inputs ?? {}) as Record<string, unknown>;
        const list = inputs.AllowedConnectorList;
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
          if (!raw || typeof raw !== "object") continue;
          const arm =
            typeof (raw as Record<string, unknown>).AllowedConnector === "string"
              ? ((raw as Record<string, unknown>).AllowedConnector as string)
              : "";
          if (!arm) continue;
          const idx = arm.lastIndexOf("/");
          const slug = (idx >= 0 ? arm.substring(idx + 1) : arm).toLowerCase();
          if (slug) slugs.add(slug);
        }
      }
    }
    return Array.from(slugs)
      .map((id) => ({ id, name: friendlyConnectorName(id) || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [acpStatus]);

  async function analyze() {
    if (!group || !connectorSlug) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setResult(null);
    try {
      const res = await queryAcpImpact(
        group.id,
        group.displayName || group.id,
        connectorSlug,
        operationId.trim() || undefined
      );
      if (!res.ok) {
        setAnalyzeError(res.error);
        return;
      }
      setResult(res.data);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className={styles.root}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>What this covers</MessageBarTitle>
          Pick an environment group, then a connector. The query lists
          every app / flow / agent in any environment in that group
          that currently uses the connector — these are the resources
          that would lose access if the connector were removed from
          the group's <code>ConnectorManagement</code> allow-list (or
          if the group flipped to ACP-only mode without it). Optionally
          filter by a specific operation (e.g. <code>GetItems</code>)
          to see only resources that use that exact action. Suggestions
          in the connector picker come from the group's current
          allow-list; you can also type any slug to simulate adding +
          immediately removing one.
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
              groups={groups}
              value={groupId}
              onChange={changeGroup}
            />
            <AcpConnectorPicker
              key={groupId ?? "no-group"}
              suggestions={allowedSlugs}
              value={connectorSlug}
              onChange={setConnectorSlug}
              disabled={!groupId}
              groupName={group?.displayName ?? group?.id ?? ""}
            />
            <div className={styles.operationInputWrap}>
              <label className={styles.pickerLabel}>
                Operation (optional)
              </label>
              <Input
                placeholder="e.g. GetItems"
                value={operationId}
                onChange={(_e, data: InputOnChangeData) => setOperationId(data.value)}
                disabled={!connectorSlug}
                className={styles.operationInput}
              />
            </div>
            <div className={styles.analyzeButtonWrap}>
              <Button
                appearance="primary"
                icon={analyzing ? <Spinner size="tiny" /> : <PlayRegular />}
                disabled={!group || !connectorSlug || analyzing}
                onClick={analyze}
              >
                {analyzing ? "Analyzing…" : "Analyze impact"}
              </Button>
            </div>
          </div>

          {group && acpError && (
            <MessageBar intent="warning">
              <MessageBarBody>
                Couldn't load the group's ACP rules: {acpError}. You can
                still type any connector slug to analyze impact.
              </MessageBarBody>
            </MessageBar>
          )}
          {group && acpStatus && !acpStatus.configured && (
            <MessageBar intent="warning">
              <MessageBarBody>
                <strong>{group.displayName || group.id}</strong> doesn't have a{" "}
                <code>ConnectorManagement</code> rule configured. There's no
                ACP allow-list to remove from — analysis will still run, but
                the "before → after" framing is hypothetical.
              </MessageBarBody>
            </MessageBar>
          )}

          {analyzeError && (
            <ErrorPane title="Impact query failed" message={analyzeError} />
          )}

          {result && (
            <AcpResultView
              result={result}
              tableSearch={tableSearch}
              onSearchChange={setTableSearch}
            />
          )}

          {!result && !analyzing && !analyzeError && group && connectorSlug && (
            <EmptyPane message='Click "Analyze impact" to run the query.' />
          )}
        </>
      )}
    </div>
  );
}

function GroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: EnvironmentGroupRow[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const styles = useAcpStyles();
  const selected = value ? groups.find((g) => g.id === value) : undefined;
  const [query, setQuery] = useState(selected?.displayName ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    if (selected && q === (selected.displayName ?? "").toLowerCase()) return groups;
    return groups.filter(
      (g) =>
        (g.displayName ?? "").toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q)
    );
  }, [groups, query, selected]);

  return (
    <label>
      <span className={styles.pickerLabel}>Environment group</span>
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
          filtered.map((g) => (
            <Option key={g.id} value={g.id} text={g.displayName || g.id}>
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
                </span>
              </div>
            </Option>
          ))
        )}
      </Combobox>
    </label>
  );
}

function AcpConnectorPicker({
  suggestions,
  value,
  onChange,
  disabled,
  groupName,
}: {
  suggestions: Array<{ id: string; name: string }>;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  disabled: boolean;
  groupName: string;
}) {
  const styles = useAcpStyles();
  const selected = value ? suggestions.find((s) => s.id === value) : undefined;
  const [query, setQuery] = useState(selected?.name ?? value ?? "");

  const candidateSlug = query.trim().toLowerCase().replace(/\s+/g, "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suggestions;
    if (selected && q === selected.name.toLowerCase()) return suggestions;
    return suggestions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
  }, [suggestions, query, selected]);

  const showFreeform =
    !disabled &&
    candidateSlug.length > 0 &&
    candidateSlug !== value &&
    !suggestions.some((s) => s.id === candidateSlug);

  const placeholder = disabled
    ? "Choose a group first"
    : suggestions.length === 0
      ? "Type a connector ID, e.g. shared_sql"
      : `Pick from ${groupName}'s allow-list, or type any connector ID…`;

  return (
    <label>
      <span className={styles.pickerLabel}>
        Connector to simulate removing
      </span>
      <Combobox
        className={styles.combobox}
        freeform
        placeholder={placeholder}
        value={query}
        selectedOptions={value ? [value] : []}
        disabled={disabled}
        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
        onOptionSelect={(_e: SelectionEvents, data: OptionOnSelectData) => {
          const picked = suggestions.find((s) => s.id === data.optionValue);
          onChange(data.optionValue || undefined);
          setQuery(picked?.name ?? data.optionValue ?? "");
        }}
      >
        {showFreeform && (
          <Option key="__freeform" value={candidateSlug} text={candidateSlug}>
            <div className={styles.connectorOptionMain}>
              <Badge appearance="outline" color="warning" size="small">
                Not in allow-list
              </Badge>
              <span>Use connector ID</span>
              <span className={styles.connectorOptionSub}>{candidateSlug}</span>
            </div>
          </Option>
        )}
        {filtered.length === 0 && !showFreeform ? (
          <Option key="no-match" value="" disabled text="">
            No connectors match "{query}"
          </Option>
        ) : (
          filtered.map((s) => (
            <Option key={s.id} value={s.id} text={s.name}>
              <div className={styles.connectorOptionMain}>
                <Badge appearance="filled" color="success" size="small">
                  Allowed
                </Badge>
                <span>{s.name}</span>
                <span className={styles.connectorOptionSub}>{s.id}</span>
              </div>
            </Option>
          ))
        )}
      </Combobox>
    </label>
  );
}

function AcpResultView({
  result,
  tableSearch,
  onSearchChange,
}: {
  result: AcpImpactResult;
  tableSearch: string;
  onSearchChange: (v: string) => void;
}) {
  const styles = useAcpStyles();
  const navigate = useNavigate();

  const visibleRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return result.rows;
    return result.rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.environmentName.toLowerCase().includes(q) ||
        r.environmentId.toLowerCase().includes(q) ||
        r.ownerDisplayName.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }, [result.rows, tableSearch]);

  const total = result.summary.totalResources;
  const apps =
    (result.summary.byType["microsoft.powerapps/canvasapps"] ?? 0) +
    (result.summary.byType["microsoft.powerapps/modeldrivenapps"] ?? 0) +
    (result.summary.byType["microsoft.powerapps/codeapps"] ?? 0) +
    (result.summary.byType["microsoft.powerapps/apps"] ?? 0);
  const flows =
    (result.summary.byType["microsoft.powerautomate/cloudflows"] ?? 0) +
    (result.summary.byType["microsoft.powerautomate/agentflows"] ?? 0) +
    (result.summary.byType["microsoft.powerautomate/m365agentflows"] ?? 0);
  const agents =
    result.summary.byType["microsoft.copilotstudio/agents"] ?? 0;

  const hasOperationFilter = Boolean(result.ranAgainst.operationId);
  const hasAnyUsedAs = result.rows.some((r) => r.usedAs);

  const columns: TableColumnDefinition<AcpImpactRow>[] = useMemo(
    () => {
      const base: TableColumnDefinition<AcpImpactRow>[] = [
        createTableColumn<AcpImpactRow>({
          columnId: "displayName",
          compare: (a, b) => a.displayName.localeCompare(b.displayName),
          renderHeaderCell: () => "Name",
          renderCell: (row) =>
            row.detailHref ? (
              <Link onClick={() => navigate(row.detailHref)}>
                {row.displayName || row.id}
              </Link>
            ) : (
              row.displayName || row.id
            ),
        }),
        createTableColumn<AcpImpactRow>({
          columnId: "type",
          compare: (a, b) => a.type.localeCompare(b.type),
          renderHeaderCell: () => "Type",
          renderCell: (row) => (
            <Badge appearance="outline" color="informative">
              {resourceTypeShort(row.type as ResourceTypeValue)}
            </Badge>
          ),
        }),
      ];
      if (hasOperationFilter || hasAnyUsedAs) {
        base.push(
          createTableColumn<AcpImpactRow>({
            columnId: "usedAs",
            compare: (a, b) => a.usedAs.localeCompare(b.usedAs),
            renderHeaderCell: () => "Used as",
            renderCell: (row) => {
              if (row.usedAs) {
                const color = row.usedAs === "Knowledge" ? "subtle" : "informative";
                return (
                  <Badge appearance="tint" color={color}>
                    {row.usedAs}
                  </Badge>
                );
              }
              const isAgent = row.type.includes("botcomponents");
              return isAgent ? (
                <Badge appearance="outline" color="subtle">
                  connector-only
                </Badge>
              ) : (
                "—"
              );
            },
          })
        );
      }
      base.push(
        createTableColumn<AcpImpactRow>({
          columnId: "environment",
          compare: (a, b) =>
            (a.environmentName || a.environmentId).localeCompare(
              b.environmentName || b.environmentId
            ),
          renderHeaderCell: () => "Environment",
          renderCell: (row) =>
            row.environmentId ? (
              <Link
                onClick={() =>
                  navigate(`/environments/${encodeURIComponent(row.environmentId)}`)
                }
              >
                {row.environmentName || row.environmentId}
              </Link>
            ) : (
              "—"
            ),
        }),
        createTableColumn<AcpImpactRow>({
          columnId: "owner",
          compare: (a, b) =>
            (a.ownerDisplayName || a.ownerId).localeCompare(
              b.ownerDisplayName || b.ownerId
            ),
          renderHeaderCell: () => "Owner",
          renderCell: (row) => row.ownerDisplayName || row.ownerId || "—",
        }),
        createTableColumn<AcpImpactRow>({
          columnId: "lastModifiedAt",
          compare: (a, b) => a.lastModifiedAt.localeCompare(b.lastModifiedAt),
          renderHeaderCell: () => "Modified",
          renderCell: (row) => formatDate(row.lastModifiedAt),
        })
      );
      return base;
    },
    [navigate, hasOperationFilter, hasAnyUsedAs]
  );

  function exportCsv() {
    const csv = rowsToCsv(
      visibleRows.map((r) => ({
        id: r.id,
        type: r.type,
        displayName: r.displayName,
        ...(hasOperationFilter ? { usedAs: r.usedAs } : {}),
        environmentId: r.environmentId,
        environmentName: r.environmentName,
        ownerId: r.ownerId,
        ownerDisplayName: r.ownerDisplayName,
        lastModifiedAt: r.lastModifiedAt,
      }))
    );
    downloadCsv(`acp-impact-${result.ranAgainst.connectorSlug}`, csv);
  }

  return (
    <>
      <div className={styles.summaryRow}>
        <Kpi
          label="Impacted resources"
          value={total}
          tone={total > 0 ? "warn" : "ok"}
        />
        <Kpi label="Apps" value={apps} />
        <Kpi label="Flows" value={flows} />
        <Kpi label="Agents" value={agents} />
        <Kpi
          label="Environments in group"
          value={result.ranAgainst.effectiveEnvCount}
        />
        <Kpi label="Unique owners" value={result.summary.ownerCount} />
      </div>

      <section className={styles.section}>
        <div className={styles.beforeAfter}>
          <Badge appearance="filled" color="success" shape="rounded">
            Currently allowed via ACP
          </Badge>
          <span className={styles.arrow}>→</span>
          <Badge appearance="filled" color="danger" shape="rounded">
            Removed from allow-list
          </Badge>
          <Text size={300}>
            Simulating <strong>{result.ranAgainst.connectorDisplayName}</strong>{" "}
            <code>{result.ranAgainst.connectorSlug}</code> being removed from{" "}
            <strong>{result.ranAgainst.groupDisplayName}</strong>'s ACP
            allow-list ({result.ranAgainst.effectiveEnvCount} environment
            {result.ranAgainst.effectiveEnvCount === 1 ? "" : "s"} in scope).
            {result.ranAgainst.operationId && (
              <>{" "}Filtered to operation: <code>{result.ranAgainst.operationId}</code>.</>
            )}
          </Text>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <Text className={styles.sectionTitle}>
              Impacted resources ({visibleRows.length}
              {visibleRows.length !== total ? ` of ${total}` : ""})
            </Text>
            <Input
              className={styles.searchBox}
              placeholder="Filter by name, env, owner…"
              value={tableSearch}
              onChange={(_e, data: InputOnChangeData) =>
                onSearchChange(data.value)
              }
            />
          </div>
          <Button
            icon={<ArrowDownloadRegular />}
            appearance="secondary"
            onClick={exportCsv}
            disabled={visibleRows.length === 0}
          >
            Export CSV
          </Button>
        </div>

        {visibleRows.length === 0 ? (
          <EmptyPane
            message={
              total === 0
                ? `No apps, flows, or agents in this group's environments are currently using ${result.ranAgainst.connectorDisplayName}. Removing it from the ACP allow-list would have no impact today.`
                : `No rows match "${tableSearch}".`
            }
          />
        ) : (
          <DataGrid
            items={visibleRows}
            columns={columns}
            getRowId={(row) => row.id}
            sortable
            focusMode="composite"
          >
            <DataGridHeader>
              <DataGridRow>
                {({ renderHeaderCell }) => (
                  <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                )}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody<AcpImpactRow>>
              {({ item, rowId }) => (
                <DataGridRow<AcpImpactRow> key={rowId}>
                  {({ renderCell }) => (
                    <DataGridCell>{renderCell(item)}</DataGridCell>
                  )}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>
        )}
      </section>
    </>
  );
}
