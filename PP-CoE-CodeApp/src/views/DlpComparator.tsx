import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Combobox,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  SearchBox,
  Spinner,
  Switch,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  type InputOnChangeData,
  type OptionOnSelectData,
  type SearchBoxChangeEvent,
  type SelectionEvents,
} from "@fluentui/react-components";
import {
  ArrowSwapRegular,
  CheckmarkCircleFilled,
  WarningFilled,
} from "@fluentui/react-icons";
import { listDlpPolicies } from "../data/dlpPolicies";
import {
  diffDlpPolicies,
  type ConnectorClassification,
  type ConnectorRow,
  type DlpDiffResult,
} from "../data/dlpDiff";
import type { PolicyV2 } from "../generated/models/PowerPlatformforAdminsModel";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";

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
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: tokens.spacingHorizontalL,
  },
  scopeCol: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  scopeLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  envList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  envRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
  },
  envBoth: { color: tokens.colorNeutralForeground2 },
  envOnly: { color: tokens.colorPaletteDarkOrangeForeground1 },
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
  rowDiff: {
    backgroundColor: tokens.colorStatusWarningBackground1,
  },
  bucketCell: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  defaultFlag: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontStyle: "italic",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  searchBox: {
    minWidth: "260px",
  },
  connectorName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  connectorId: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
  },
  changeCell: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
});

/** Map a DLP classification to a Fluent Badge color. Matches PPAC's
 *  visual language: Confidential = brand (business), General = success
 *  (non-business), Blocked = danger. */
function bucketAppearance(
  cls: ConnectorClassification
): { color: "brand" | "success" | "danger"; label: string } {
  switch (cls) {
    case "Confidential":
      return { color: "brand", label: "Business" };
    case "General":
      return { color: "success", label: "Non-business" };
    case "Blocked":
      return { color: "danger", label: "Blocked" };
  }
}

function BucketBadge({
  classification,
  source,
}: {
  classification: ConnectorClassification;
  source: "explicit" | "default";
}) {
  const styles = useStyles();
  const a = bucketAppearance(classification);
  const badge = (
    <Badge color={a.color} appearance="filled" shape="rounded">
      {a.label}
    </Badge>
  );
  return (
    <span className={styles.bucketCell}>
      {badge}
      {source === "default" && (
        <Tooltip
          content="Connector isn't explicitly listed — falls through to the default classification."
          relationship="description"
        >
          <span className={styles.defaultFlag}>default</span>
        </Tooltip>
      )}
    </span>
  );
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

export function DlpComparator() {
  const styles = useStyles();
  const [policies, setPolicies] = useState<PolicyV2[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aId, setAId] = useState<string | undefined>();
  const [bId, setBId] = useState<string | undefined>();
  const [showMatches, setShowMatches] = useState(false);
  const [connectorSearch, setConnectorSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listDlpPolicies();
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setPolicies(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const policiesById = useMemo(() => {
    const map = new Map<string, PolicyV2>();
    for (const p of policies ?? []) map.set(p.name, p);
    return map;
  }, [policies]);

  const a = aId ? policiesById.get(aId) : undefined;
  const b = bId ? policiesById.get(bId) : undefined;
  const diff: DlpDiffResult | null = useMemo(
    () => (a && b ? diffDlpPolicies(a, b) : null),
    [a, b]
  );

  const visibleConnectors: ConnectorRow[] = useMemo(() => {
    if (!diff) return [];
    const base = showMatches
      ? diff.connectors
      : diff.connectors.filter((c) => !c.sameBucket);
    const q = connectorSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
  }, [diff, showMatches, connectorSearch]);

  function swap() {
    setAId(bId);
    setBId(aId);
  }

  return (
    <div className={styles.root}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>What this V1 covers</MessageBarTitle>
          The diff compares <strong>scope</strong>, <strong>default classification</strong>, and{" "}
          <strong>connector bucket placement</strong> from `ListPoliciesV2` /{" "}
          `GetPolicyV2`. It does <strong>not yet cover</strong> custom connectors,
          connector-specific blocked actions, or endpoint configurations — those live on a
          different connector endpoint and will be folded in later.
        </MessageBarBody>
      </MessageBar>

      {loadError && <ErrorPane title="Couldn't load policies" message={loadError} />}
      {!loadError && policies === null && <LoadingPane label="Loading DLP policies…" />}
      {!loadError && policies && policies.length === 0 && (
        <EmptyPane message="No DLP policies returned for this tenant." />
      )}

      {policies && policies.length > 0 && (
        <>
          <div className={styles.pickerRow}>
            <PolicyPicker
              label="Policy A"
              policies={policies}
              value={aId}
              otherValue={bId}
              onChange={setAId}
            />
            <div className={styles.swapButtonWrap}>
              <Tooltip content="Swap A and B" relationship="label">
                <Button
                  icon={<ArrowSwapRegular />}
                  appearance="subtle"
                  aria-label="Swap policies"
                  onClick={swap}
                  disabled={!aId && !bId}
                />
              </Tooltip>
            </div>
            <PolicyPicker
              label="Policy B"
              policies={policies}
              value={bId}
              otherValue={aId}
              onChange={setBId}
            />
          </div>

          {!diff && (
            <EmptyPane message="Select two policies above to see the comparison." />
          )}

          {diff && a && b && (
            <DiffView
              diff={diff}
              a={a}
              b={b}
              showMatches={showMatches}
              onToggleMatches={setShowMatches}
              connectorSearch={connectorSearch}
              onSearchChange={setConnectorSearch}
              visibleConnectors={visibleConnectors}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function PolicyPicker({
  label,
  policies,
  value,
  otherValue,
  onChange,
}: {
  label: string;
  policies: PolicyV2[];
  value: string | undefined;
  otherValue: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const styles = useStyles();
  const selected = value ? policies.find((p) => p.name === value) : undefined;
  const onSelect = (_e: SelectionEvents, data: OptionOnSelectData) => {
    onChange(data.optionValue || undefined);
  };
  return (
    <label>
      <span className={styles.pickerLabel}>{label}</span>
      <Combobox
        className={styles.combobox}
        placeholder="Choose a policy…"
        value={selected?.displayName ?? ""}
        selectedOptions={value ? [value] : []}
        onOptionSelect={onSelect}
      >
        {policies.map((p) => {
          const isOther = p.name === otherValue;
          return (
            <Option
              key={p.name}
              value={p.name}
              text={p.displayName}
              disabled={isOther}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span>{p.displayName}</span>
                <span
                  style={{
                    color: tokens.colorNeutralForeground3,
                    fontSize: tokens.fontSizeBase100,
                  }}
                >
                  {p.environmentType}
                  {isOther ? " · already selected on the other side" : ""}
                </span>
              </div>
            </Option>
          );
        })}
      </Combobox>
    </label>
  );
}

function DiffView({
  diff,
  a,
  b,
  showMatches,
  onToggleMatches,
  connectorSearch,
  onSearchChange,
  visibleConnectors,
}: {
  diff: DlpDiffResult;
  a: PolicyV2;
  b: PolicyV2;
  showMatches: boolean;
  onToggleMatches: (v: boolean) => void;
  connectorSearch: string;
  onSearchChange: (v: string) => void;
  visibleConnectors: ConnectorRow[];
}) {
  const styles = useStyles();
  return (
    <>
      <div className={styles.summaryRow}>
        <Kpi
          label="Connectors differing"
          value={diff.summary.differingConnectors}
          tone={diff.summary.differingConnectors > 0 ? "warn" : "ok"}
        />
        <Kpi label="Connectors matching" value={diff.summary.matchingConnectors} tone="ok" />
        <Kpi
          label="Default classification"
          value={diff.summary.defaultClassificationSame ? "Same" : "Different"}
          tone={diff.summary.defaultClassificationSame ? "ok" : "warn"}
        />
        <Kpi
          label="Scope"
          value={diff.summary.scopeSame ? "Same" : "Different"}
          tone={diff.summary.scopeSame ? "ok" : "warn"}
        />
      </div>

      <ScopeSection diff={diff} />

      <DefaultSection
        defaultA={diff.defaultA}
        defaultB={diff.defaultB}
        nameA={a.displayName}
        nameB={b.displayName}
      />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>
            Connector classifications ({visibleConnectors.length}
            {showMatches ? "" : ` of ${diff.summary.totalConnectors}`})
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
        {visibleConnectors.length === 0 ? (
          <EmptyPane
            message={
              connectorSearch.trim()
                ? `No connectors match "${connectorSearch}".`
                : showMatches
                  ? "Neither policy lists any explicit connectors."
                  : "All listed connectors are classified the same way in both policies."
            }
          />
        ) : (
          <table className={styles.diffTable}>
            <thead>
              <tr>
                <th className={styles.th}>Connector</th>
                <th className={styles.th}>{a.displayName}</th>
                <th className={styles.th}>{b.displayName}</th>
                <th className={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleConnectors.map((c) => (
                <tr
                  key={c.id}
                  className={c.sameBucket ? undefined : styles.rowDiff}
                >
                  <td className={styles.td}>
                    <div className={styles.connectorName}>{c.name}</div>
                    <div className={styles.connectorId}>{c.id}</div>
                  </td>
                  <td className={styles.td}>
                    <BucketBadge classification={c.bucketA} source={c.sourceA} />
                  </td>
                  <td className={styles.td}>
                    <BucketBadge classification={c.bucketB} source={c.sourceB} />
                  </td>
                  <td className={styles.td}>
                    {c.sameBucket ? (
                      <span className={styles.changeCell}>
                        <CheckmarkCircleFilled
                          style={{ color: tokens.colorPaletteGreenForeground1 }}
                        />
                        <span>Same</span>
                      </span>
                    ) : (
                      <span className={styles.changeCell}>
                        <WarningFilled
                          style={{ color: tokens.colorPaletteDarkOrangeForeground1 }}
                        />
                        <span>
                          {bucketAppearance(c.bucketA).label} →{" "}
                          {bucketAppearance(c.bucketB).label}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function ScopeSection({ diff }: { diff: DlpDiffResult }) {
  const styles = useStyles();
  const { scope } = diff;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>
          Scope {scope.typeSame ? "" : "(differs)"}
        </span>
      </div>
      <div className={styles.scopeGrid}>
        <div className={styles.scopeCol}>
          <span className={styles.scopeLabel}>Policy A</span>
          <ScopeBadge type={scope.typeA} highlight={!scope.typeSame} />
          {scope.usesEnvListA && (
            <EnvList
              both={scope.envsBoth}
              only={scope.envsAOnly}
              onlySide="A"
            />
          )}
        </div>
        <div className={styles.scopeCol}>
          <span className={styles.scopeLabel}>Policy B</span>
          <ScopeBadge type={scope.typeB} highlight={!scope.typeSame} />
          {scope.usesEnvListB && (
            <EnvList
              both={scope.envsBoth}
              only={scope.envsBOnly}
              onlySide="B"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ScopeBadge({ type, highlight }: { type: string; highlight: boolean }) {
  return (
    <Badge
      color={highlight ? "danger" : "informative"}
      appearance="outline"
      shape="rounded"
    >
      {type}
    </Badge>
  );
}

function EnvList({
  both,
  only,
  onlySide,
}: {
  both: PolicyV2["environments"];
  only: PolicyV2["environments"];
  onlySide: "A" | "B";
}) {
  const styles = useStyles();
  if (both.length === 0 && only.length === 0) {
    return (
      <span
        style={{
          color: tokens.colorNeutralForeground3,
          fontSize: tokens.fontSizeBase200,
        }}
      >
        No environments in scope.
      </span>
    );
  }
  return (
    <div className={styles.envList}>
      {both.map((e) => (
        <span key={`both-${e.id}`} className={mergeClasses(styles.envRow, styles.envBoth)}>
          <CheckmarkCircleFilled
            style={{ color: tokens.colorPaletteGreenForeground1 }}
          />
          {e.name}
        </span>
      ))}
      {only.map((e) => (
        <span key={`only-${e.id}`} className={mergeClasses(styles.envRow, styles.envOnly)}>
          <WarningFilled
            style={{ color: tokens.colorPaletteDarkOrangeForeground1 }}
          />
          {e.name} <em style={{ fontSize: tokens.fontSizeBase100 }}>(only in {onlySide})</em>
        </span>
      ))}
    </div>
  );
}

function DefaultSection({
  defaultA,
  defaultB,
  nameA,
  nameB,
}: {
  defaultA: ConnectorClassification;
  defaultB: ConnectorClassification;
  nameA: string;
  nameB: string;
}) {
  const styles = useStyles();
  const same = defaultA === defaultB;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>
          Default classification {same ? "" : "(differs)"}
        </span>
      </div>
      <div className={styles.scopeGrid}>
        <div className={styles.scopeCol}>
          <span className={styles.scopeLabel}>{nameA}</span>
          <BucketBadge classification={defaultA} source="explicit" />
          <Spinner size="tiny" style={{ display: "none" }} />
        </div>
        <div className={styles.scopeCol}>
          <span className={styles.scopeLabel}>{nameB}</span>
          <BucketBadge classification={defaultB} source="explicit" />
        </div>
      </div>
    </section>
  );
}
