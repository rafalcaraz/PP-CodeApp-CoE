import { useEffect, useMemo, useState } from "react";
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
  Text,
  Tooltip,
  createTableColumn,
  makeStyles,
  mergeClasses,
  tokens,
  type InputOnChangeData,
  type OptionOnSelectData,
  type SelectionEvents,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  PlayRegular,
  WarningFilled,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { listDlpPolicies } from "../data/dlpPolicies";
import {
  countExcludedConnectors,
  extractHiddenConnectors,
  extractNonBlockedConnectors,
  queryDlpImpact,
  synthesizeFreeformConnectorOption,
  type DlpConnectorOption,
  type DlpHiddenConnector,
  type DlpImpactResult,
  type DlpImpactRow,
} from "../data/dlpImpact";
import {
  getEnvironmentNameMap,
  resourceTypeShort,
  type ResourceTypeValue,
} from "../data/inventory";
import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
import { downloadCsv, rowsToCsv } from "../utils/csv";

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
  pickerRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr auto",
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
  analyzeButtonWrap: { paddingBottom: "1px" },
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
  scopeSummary: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
  },
  scopeBadgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  envList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    marginTop: tokens.spacingVerticalS,
    maxHeight: "200px",
    overflowY: "auto",
    paddingInlineStart: tokens.spacingHorizontalM,
  },
  envRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
  },
  envMono: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
  },
  toggle: {
    background: "none",
    border: "none",
    padding: 0,
    color: tokens.colorBrandForegroundLink,
    cursor: "pointer",
    fontSize: tokens.fontSizeBase200,
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
    ":hover": { textDecoration: "underline" },
  },
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
  beforeAfter: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
  },
  arrow: {
    color: tokens.colorPaletteDarkOrangeForeground1,
    fontWeight: tokens.fontWeightSemibold,
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

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function classificationLabel(c: "Confidential" | "General" | "Blocked"): string {
  if (c === "Confidential") return "Business";
  if (c === "General") return "Non-business";
  return "Blocked";
}

function classificationColor(
  c: "Confidential" | "General" | "Blocked"
): "brand" | "success" | "danger" {
  if (c === "Confidential") return "brand";
  if (c === "General") return "success";
  return "danger";
}

function describeScopeMode(rawType: string, envCount: number): string {
  switch (rawType) {
    case "AllEnvironments":
      return "All environments in the tenant";
    case "SingleEnvironment":
      return "One environment";
    case "OnlyEnvironments":
      return `${envCount} included environment${envCount === 1 ? "" : "s"}`;
    case "ExceptEnvironments":
      return `Every environment except ${envCount} excluded`;
    default:
      return rawType || "Unknown scope";
  }
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
  const styles = useStyles();
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

// ---------------------------------------------------------------------------
// Top-level view
// ---------------------------------------------------------------------------

export function DlpImpact() {
  const styles = useStyles();

  // Policy list
  const [policies, setPolicies] = useState<PolicyV2[] | null>(null);
  const [policiesError, setPoliciesError] = useState<string | null>(null);

  // Selections
  const [policyId, setPolicyId] = useState<string | undefined>();
  const [connectorSlug, setConnectorSlug] = useState<string | undefined>();

  // Analysis state
  const [result, setResult] = useState<DlpImpactResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // UI state
  const [tableSearch, setTableSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listDlpPolicies();
      if (cancelled) return;
      if (!res.ok) {
        setPoliciesError(res.error);
        return;
      }
      setPolicies(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset downstream state when the policy changes. Done inline (vs.
  // useEffect) so we never trigger a cascade of effect-driven setState
  // calls — react-hooks lint complains about that pattern.
  function changePolicy(id: string | undefined) {
    setPolicyId(id);
    setConnectorSlug(undefined);
    setResult(null);
    setAnalyzeError(null);
    setTableSearch("");
  }

  const policiesById = useMemo(() => {
    const map = new Map<string, PolicyV2>();
    for (const p of policies ?? []) map.set(p.name, p);
    return map;
  }, [policies]);

  const policy = policyId ? policiesById.get(policyId) : undefined;

  const connectorOptions = useMemo<DlpConnectorOption[]>(
    () => (policy ? extractNonBlockedConnectors(policy) : []),
    [policy]
  );
  // Resolve the selected connector. Three sources, in priority order:
  //  1. Explicit entry in `connectorOptions` (the picker's built-in list).
  //  2. Freeform slug the user typed that isn't in the policy's
  //     `connectorGroups` — synthesized using the policy's default
  //     classification so the before → after UI still works.
  //  3. Nothing selected yet → undefined.
  const connectorOption = useMemo(() => {
    if (!connectorSlug) return undefined;
    const explicit = connectorOptions.find((c) => c.id === connectorSlug);
    if (explicit) return explicit;
    if (!policy) return undefined;
    return synthesizeFreeformConnectorOption(policy, connectorSlug);
  }, [connectorSlug, connectorOptions, policy]);

  const hiddenConnectors = useMemo(
    () => (policy ? extractHiddenConnectors(policy) : []),
    [policy]
  );
  const excluded = useMemo(
    () =>
      policy
        ? countExcludedConnectors(policy)
        : { blocked: 0, custom: 0 },
    [policy]
  );

  async function analyze() {
    if (!policy || !connectorSlug) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setResult(null);
    try {
      const res = await queryDlpImpact(policy, connectorSlug);
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
          <MessageBarTitle>What this V1 covers</MessageBarTitle>
          The picker lists only <strong>non-Blocked first-party</strong>{" "}
          connectors from the selected policy — blocking an already-blocked
          connector is a no-op, and custom connectors aren't matched against
          inventory yet. The impact query crosses{" "}
          <code>QueryResources</code> with the policy's scope (
          <code>AllEnvironments</code> / <code>OnlyEnvironments</code> /{" "}
          <code>ExceptEnvironments</code> / <code>SingleEnvironment</code>).
        </MessageBarBody>
      </MessageBar>

      {policiesError && (
        <ErrorPane title="Couldn't load policies" message={policiesError} />
      )}
      {!policiesError && policies === null && (
        <LoadingPane label="Loading DLP policies…" />
      )}
      {!policiesError && policies && policies.length === 0 && (
        <EmptyPane message="No DLP policies returned for this tenant." />
      )}

      {policies && policies.length > 0 && (
        <>
          <div className={styles.pickerRow}>
            <PolicyPicker
              policies={policies}
              value={policyId}
              onChange={changePolicy}
            />
            <ConnectorPicker
              key={policyId ?? "no-policy"}
              options={connectorOptions}
              value={connectorSlug}
              onChange={setConnectorSlug}
              disabled={!policy}
              defaultClassification={policy?.defaultConnectorsClassification}
            />
            <div className={styles.analyzeButtonWrap}>
              <Button
                appearance="primary"
                icon={analyzing ? <Spinner size="tiny" /> : <PlayRegular />}
                disabled={!policy || !connectorSlug || analyzing}
                onClick={analyze}
              >
                {analyzing ? "Analyzing…" : "Analyze impact"}
              </Button>
            </div>
          </div>

          {policy && (
            <>
              {hiddenConnectors.length > 0 && (
                <HiddenConnectorsSection
                  hidden={hiddenConnectors}
                  blockedCount={excluded.blocked}
                  customCount={excluded.custom}
                />
              )}

              <ScopeCard policy={policy} />
            </>
          )}

          {analyzeError && (
            <ErrorPane title="Impact query failed" message={analyzeError} />
          )}

          {result && connectorOption && (
            <ResultView
              result={result}
              connector={connectorOption}
              tableSearch={tableSearch}
              onSearchChange={setTableSearch}
            />
          )}

          {!result && !analyzing && !analyzeError && policy && connectorSlug && (
            <EmptyPane message='Click "Analyze impact" to run the query.' />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickers
//
// Fluent's `Combobox` accepts typed input but does NOT filter its
// children based on that input out of the box. The pickers below add
// the missing piece: a controlled `query` state that filters the
// rendered `<Option>` list as the user types. Selecting an option
// resets the query to the chosen item's display name so the field
// reads back the selection cleanly.
//
// ConnectorPicker uses `key={policyId}` from the parent to remount on
// policy change — that resets the internal `query` state without us
// having to plumb it through props or wrestle with sync effects.
// ---------------------------------------------------------------------------

function PolicyPicker({
  policies,
  value,
  onChange,
}: {
  policies: PolicyV2[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const styles = useStyles();
  const selected = value ? policies.find((p) => p.name === value) : undefined;
  const [query, setQuery] = useState(selected?.displayName ?? "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // No filter when empty, or when the input still matches the picked
    // option exactly (user hasn't started typing a new search yet).
    if (!q) return policies;
    if (selected && q === selected.displayName.toLowerCase()) return policies;
    return policies.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.environmentType ?? "").toLowerCase().includes(q)
    );
  }, [policies, query, selected]);

  return (
    <label>
      <span className={styles.pickerLabel}>DLP policy</span>
      <Combobox
        className={styles.combobox}
        freeform
        placeholder="Choose a policy…"
        value={query}
        selectedOptions={value ? [value] : []}
        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
        onOptionSelect={(_e: SelectionEvents, data: OptionOnSelectData) => {
          const picked = policies.find((p) => p.name === data.optionValue);
          onChange(data.optionValue || undefined);
          setQuery(picked?.displayName ?? "");
        }}
      >
        {filtered.length === 0 ? (
          <Option key="no-match" value="" disabled text="">
            No policies match "{query}"
          </Option>
        ) : (
          filtered.map((p) => (
            <Option key={p.name} value={p.name} text={p.displayName}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span>{p.displayName}</span>
                <span
                  style={{
                    color: tokens.colorNeutralForeground3,
                    fontSize: tokens.fontSizeBase100,
                  }}
                >
                  {p.environmentType}
                </span>
              </div>
            </Option>
          ))
        )}
      </Combobox>
    </label>
  );
}

function ConnectorPicker({
  options,
  value,
  onChange,
  disabled,
  defaultClassification,
}: {
  options: DlpConnectorOption[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  disabled: boolean;
  defaultClassification?: string;
}) {
  const styles = useStyles();
  const selected = value ? options.find((c) => c.id === value) : undefined;
  // When `value` is set but not in `options` (a freeform entry the
  // parent synthesized), seed `query` with the slug so the input
  // reads back what the user picked.
  const [query, setQuery] = useState(selected?.name ?? value ?? "");

  // Normalize the typed text to a candidate connector slug. Trim +
  // lowercase + drop any whitespace, since slugs never contain spaces.
  // Used to (a) show the "Use this connector ID" synthetic option when
  // the query doesn't match the list, and (b) commit on Enter.
  const candidateSlug = query.trim().toLowerCase().replace(/\s+/g, "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    if (selected && q === selected.name.toLowerCase()) return options;
    return options.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [options, query, selected]);

  // Only offer the synthetic "Use this connector ID" option when the
  // typed candidate is a plausible slug (non-empty, doesn't already
  // match any option), and isn't already the selected value.
  const showFreeform =
    !disabled &&
    candidateSlug.length > 0 &&
    candidateSlug !== value &&
    !options.some((c) => c.id === candidateSlug);

  const placeholder = disabled
    ? "Choose a policy first"
    : options.length === 0
      ? "Type a connector ID, e.g. shared_sql"
      : "Type to filter or type any connector ID…";
  return (
    <label>
      <span className={styles.pickerLabel}>
        Connector to simulate blocking
        {defaultClassification && (
          <Tooltip
            content={`Connectors not explicitly listed in this policy fall through to "${defaultClassification}". Type any connector ID (e.g. shared_sql) to simulate blocking it.`}
            relationship="description"
          >
            <span
              style={{
                color: tokens.colorNeutralForeground3,
                fontWeight: tokens.fontWeightRegular,
                marginInlineStart: tokens.spacingHorizontalXS,
              }}
            >
              · default = {defaultClassification}
            </span>
          </Tooltip>
        )}
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
          const picked = options.find((c) => c.id === data.optionValue);
          onChange(data.optionValue || undefined);
          // For explicit options, show the friendly name; for freeform
          // picks (value === candidateSlug), keep the slug they typed.
          setQuery(picked?.name ?? data.optionValue ?? "");
        }}
      >
        {showFreeform && (
          <Option
            key="__freeform"
            value={candidateSlug}
            text={candidateSlug}
          >
            <div className={styles.connectorOptionMain}>
              <Badge appearance="outline" color="warning" size="small">
                default = {defaultClassification ?? "?"}
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
          filtered.map((c) => (
            <Option key={c.id} value={c.id} text={c.name}>
              <div className={styles.connectorOptionMain}>
                <Badge
                  color={classificationColor(c.classification)}
                  appearance="filled"
                  shape="rounded"
                  size="small"
                >
                  {classificationLabel(c.classification)}
                </Badge>
                <span>{c.name}</span>
                <span className={styles.connectorOptionSub}>{c.id}</span>
              </div>
            </Option>
          ))
        )}
      </Combobox>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Hidden connectors (collapsible)
//
// The picker filters out two classes of connectors — already-Blocked
// (no-op to simulate) and Custom (V1 doesn't match these against
// inventory). Earlier versions just showed a count in a warn
// MessageBar; this section gives users a way to *see* what's actually
// hidden so they can verify their assumptions.
// ---------------------------------------------------------------------------

function HiddenConnectorsSection({
  hidden,
  blockedCount,
  customCount,
}: {
  hidden: DlpHiddenConnector[];
  blockedCount: number;
  customCount: number;
}) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);

  const parts: string[] = [];
  if (blockedCount > 0) {
    parts.push(`${blockedCount} already Blocked`);
  }
  if (customCount > 0) {
    parts.push(`${customCount} custom`);
  }
  const subtitle = parts.length > 0 ? parts.join(" · ") : "";

  return (
    <section
      className={styles.section}
      aria-label="Connectors hidden from the picker"
    >
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        {hidden.length} connector{hidden.length === 1 ? "" : "s"} hidden from
        the picker
        {subtitle && (
          <span
            style={{
              color: tokens.colorNeutralForeground3,
              fontWeight: tokens.fontWeightRegular,
              marginInlineStart: tokens.spacingHorizontalXS,
            }}
          >
            ({subtitle})
          </span>
        )}
      </button>
      {expanded && (
        <ul className={styles.envList}>
          {hidden.map((h) => (
            <li key={h.rawId} className={styles.envRow}>
              <Badge
                color={h.reason === "blocked" ? "danger" : "warning"}
                appearance="filled"
                shape="rounded"
                size="small"
              >
                {h.reason === "blocked" ? "Blocked" : "Custom"}
              </Badge>
              <span>{h.name}</span>
              <span className={styles.envMono}>{h.id}</span>
              {h.reason === "custom" && h.classification && (
                <span
                  style={{
                    color: tokens.colorNeutralForeground3,
                    fontSize: tokens.fontSizeBase100,
                  }}
                >
                  · currently {h.classification}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scope card
// ---------------------------------------------------------------------------

function ScopeCard({ policy }: { policy: PolicyV2 }) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  const [envNameMap, setEnvNameMap] = useState<Map<string, string>>(new Map());

  const rawType = policy.environmentType;
  const envs = useMemo(() => policy.environments ?? [], [policy]);

  useEffect(() => {
    // Resolve current env display names; falls back gracefully if the
    // call fails (we still have the policy-time `name`).
    let cancelled = false;
    if (envs.length === 0) return;
    (async () => {
      const map = await getEnvironmentNameMap();
      if (!cancelled) setEnvNameMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [envs]);

  const usesList = rawType !== "AllEnvironments";

  return (
    <section className={styles.section} aria-label="Policy scope">
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Policy scope</span>
      </div>
      <div className={styles.scopeSummary}>
        <Badge
          color={rawType === "ExceptEnvironments" ? "warning" : "informative"}
          appearance="outline"
        >
          {rawType}
        </Badge>
        <Text size={300}>{describeScopeMode(rawType, envs.length)}</Text>
      </div>
      {usesList && envs.length > 0 && (
        <>
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
            {expanded ? "Hide" : "Show"} {envs.length} environment
            {envs.length === 1 ? "" : "s"}
          </button>
          {expanded && (
            <ul className={styles.envList}>
              {envs.map((e) => {
                const currentName = envNameMap.get(e.id);
                const policyName = e.name;
                const display = currentName || policyName || e.id;
                const drifted =
                  currentName && policyName && currentName !== policyName;
                return (
                  <li key={e.id} className={styles.envRow}>
                    <span>{display}</span>
                    {drifted && (
                      <Tooltip
                        content={`Renamed since policy was authored — original name: "${policyName}"`}
                        relationship="description"
                      >
                        <WarningFilled
                          style={{
                            color: tokens.colorPaletteDarkOrangeForeground1,
                          }}
                        />
                      </Tooltip>
                    )}
                    <span className={styles.envMono}>{e.id}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Result view (KPIs + table)
// ---------------------------------------------------------------------------

function ResultView({
  result,
  connector,
  tableSearch,
  onSearchChange,
}: {
  result: DlpImpactResult;
  connector: DlpConnectorOption;
  tableSearch: string;
  onSearchChange: (v: string) => void;
}) {
  const styles = useStyles();
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

  const columns: TableColumnDefinition<DlpImpactRow>[] = useMemo(
    () => [
      createTableColumn<DlpImpactRow>({
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
      createTableColumn<DlpImpactRow>({
        columnId: "type",
        compare: (a, b) => a.type.localeCompare(b.type),
        renderHeaderCell: () => "Type",
        renderCell: (row) => (
          <Badge appearance="outline" color="informative">
            {resourceTypeShort(row.type as ResourceTypeValue)}
          </Badge>
        ),
      }),
      createTableColumn<DlpImpactRow>({
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
      createTableColumn<DlpImpactRow>({
        columnId: "owner",
        compare: (a, b) =>
          (a.ownerDisplayName || a.ownerId).localeCompare(
            b.ownerDisplayName || b.ownerId
          ),
        renderHeaderCell: () => "Owner",
        renderCell: (row) => row.ownerDisplayName || row.ownerId || "—",
      }),
      createTableColumn<DlpImpactRow>({
        columnId: "lastModifiedAt",
        compare: (a, b) => a.lastModifiedAt.localeCompare(b.lastModifiedAt),
        renderHeaderCell: () => "Modified",
        renderCell: (row) => formatDate(row.lastModifiedAt),
      }),
    ],
    [navigate]
  );

  function exportCsv() {
    const csv = rowsToCsv(
      visibleRows.map((r) => ({
        id: r.id,
        type: r.type,
        displayName: r.displayName,
        environmentId: r.environmentId,
        environmentName: r.environmentName,
        ownerId: r.ownerId,
        ownerDisplayName: r.ownerDisplayName,
        lastModifiedAt: r.lastModifiedAt,
      }))
    );
    downloadCsv(`dlp-impact-${connector.id}`, csv);
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
          label="Environments"
          value={result.summary.environmentCount}
        />
        <Kpi label="Unique owners" value={result.summary.ownerCount} />
      </div>

      <section className={styles.section}>
        <div className={styles.scopeBadgeRow}>
          <span className={styles.beforeAfter}>
            <Badge
              color={classificationColor(connector.classification)}
              appearance="filled"
              shape="rounded"
            >
              {classificationLabel(connector.classification)}
            </Badge>
            <span className={styles.arrow}>→</span>
            <Badge color="danger" appearance="filled" shape="rounded">
              Blocked
            </Badge>
          </span>
          <Text size={300}>
            Simulating <strong>{connector.name}</strong>{" "}
            <code>{connector.id}</code> moving to Blocked.
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
                ? `No apps, flows, or agents in this policy's scope are currently using ${connector.name}. Blocking it would have no impact today.`
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
            <DataGridBody<DlpImpactRow>>
              {({ item, rowId }) => (
                <DataGridRow<DlpImpactRow> key={rowId}>
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
