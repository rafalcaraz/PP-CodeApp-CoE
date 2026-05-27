import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  SearchBox,
  Spinner,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  type InputOnChangeData,
  type OptionOnSelectData,
  type SearchBoxChangeEvent,
  type SelectionEvents,
} from "@fluentui/react-components";
import { CopyRegular, OpenRegular } from "@fluentui/react-icons";
import {
  buildDuplicatePolicyBody,
  createDlpPolicy,
  listDlpPolicies,
  ppacDlpPolicyUrl,
} from "../../data/dlpPolicies";
import {
  listEnvironments,
  type EnvironmentRow,
} from "../../data/inventory";
import type {
  PolicyV2,
} from "../../generated/models/PowerPlatformforAdminsModel";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  pickerRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
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
  input: { width: "100%" },
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
    gap: tokens.spacingHorizontalM,
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
  },
  sectionSub: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
  summaryItem: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  summaryLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  summaryValue: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  envList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    maxHeight: "300px",
    overflowY: "auto",
    padding: tokens.spacingHorizontalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  envRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingBlock: tokens.spacingVerticalXXS,
  },
  envName: {
    fontSize: tokens.fontSizeBase300,
  },
  envMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
  },
  envHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
  envHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  envSearch: {
    minWidth: "240px",
  },
  actionsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalM,
  },
});

/** Pick the most-used bucket label to show as a hint. Pure helper extracted
 *  so the summary card stays declarative. */
function summarizeBuckets(policy: PolicyV2): { bucket: string; count: number }[] {
  const out: { bucket: string; count: number }[] = [];
  for (const g of policy.connectorGroups ?? []) {
    out.push({ bucket: g.classification, count: g.connectors?.length ?? 0 });
  }
  return out;
}

function totalConnectors(policy: PolicyV2): number {
  let total = 0;
  for (const g of policy.connectorGroups ?? []) {
    total += g.connectors?.length ?? 0;
  }
  return total;
}

/** Map a DLP default classification to Fluent badge color, mirroring
 *  DlpComparator so the visual language is consistent across the
 *  Security area. */
function defaultBucketAppearance(cls: string): {
  color: "brand" | "success" | "danger" | "informative";
  label: string;
} {
  switch (cls) {
    case "Confidential":
      return { color: "brand", label: "Business" };
    case "General":
      return { color: "success", label: "Non-business" };
    case "Blocked":
      return { color: "danger", label: "Blocked" };
    default:
      return { color: "informative", label: cls || "Unknown" };
  }
}

/**
 * DLP duplicator — pick a source policy, name the copy, choose the
 * environments it should apply to, then call `CreatePolicyV2`.
 *
 * Scope is forced to `OnlyEnvironments` for Stage 1 (see
 * `buildDuplicatePolicyBody`). The page guarantees at least one
 * environment is selected before the duplicate button enables.
 */
export function DlpDuplicator() {
  const styles = useStyles();
  const [policies, setPolicies] = useState<PolicyV2[] | null>(null);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvironmentRow[] | null>(null);
  const [envsError, setEnvsError] = useState<string | null>(null);

  const [sourceId, setSourceId] = useState<string | undefined>();
  const [newName, setNewName] = useState<string>("");
  const [selectedEnvs, setSelectedEnvs] = useState<Set<string>>(new Set());
  const [envSearch, setEnvSearch] = useState<string>("");

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdPolicy, setCreatedPolicy] = useState<PolicyV2 | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pRes, eRes] = await Promise.all([
        listDlpPolicies(),
        listEnvironments(),
      ]);
      if (cancelled) return;
      if (pRes.ok) setPolicies(pRes.data);
      else setPoliciesError(pRes.error);
      if (eRes.ok) setEnvs(eRes.data);
      else setEnvsError(eRes.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const source = useMemo(
    () => policies?.find((p) => p.name === sourceId),
    [policies, sourceId],
  );

  // Track whether the user has manually edited the name. We default the
  // name to "Copy of <source>" when the source is picked, but only if
  // the user hasn't typed anything explicit yet. This avoids the React
  // anti-pattern of syncing state from an effect — the default is
  // applied in the onChange handler directly.
  const [nameTouched, setNameTouched] = useState(false);

  function onSourceChange(nextId: string | undefined) {
    setSourceId(nextId);
    if (!nameTouched && nextId) {
      const next = policies?.find((p) => p.name === nextId);
      if (next) setNewName(`Copy of ${next.displayName}`);
    }
  }

  function onNameChange(value: string) {
    setNewName(value);
    setNameTouched(true);
  }

  const filteredEnvs = useMemo(() => {
    if (!envs) return [];
    const q = envSearch.trim().toLowerCase();
    if (!q) return envs;
    return envs.filter(
      (e) =>
        e.displayName.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q),
    );
  }, [envs, envSearch]);

  function toggleEnv(envId: string, checked: boolean) {
    setSelectedEnvs((prev) => {
      const next = new Set(prev);
      if (checked) next.add(envId);
      else next.delete(envId);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedEnvs((prev) => {
      const next = new Set(prev);
      for (const e of filteredEnvs) next.add(e.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedEnvs(new Set());
  }

  const canSubmit =
    !!source && newName.trim().length > 0 && selectedEnvs.size > 0 && !submitting;

  async function onDuplicate() {
    if (!source) return;
    setSubmitting(true);
    setSubmitError(null);
    setCreatedPolicy(null);
    try {
      const body = buildDuplicatePolicyBody(source, {
        displayName: newName,
        environmentIds: Array.from(selectedEnvs),
      });
      const res = await createDlpPolicy(body);
      if (!res.ok) {
        setSubmitError(res.error);
      } else {
        setCreatedPolicy(res.data);
        // Reset selections so a follow-up duplicate doesn't accidentally
        // reuse this run's environments.
        setSelectedEnvs(new Set());
        setNewName("");
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      // After a successful create we cleared `newName`; allow auto-naming
      // again so picking a different source pre-fills the field.
      setNameTouched(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>How duplication works</MessageBarTitle>
          The new policy copies the source's <strong>connector buckets</strong> and{" "}
          <strong>default classification</strong> verbatim. Scope is set to{" "}
          <strong>Only environments</strong> — pick at least one below. The
          connector enforces uniqueness of the display name; rename if it
          already exists in your tenant.
        </MessageBarBody>
      </MessageBar>

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>Not copied</MessageBarTitle>
          <strong>Endpoint filtering</strong> rules and{" "}
          <strong>custom connector</strong> patterns are <em>not</em> copied
          as part of duplication — <code>ListPoliciesV2</code> /{" "}
          <code>GetPolicyV2</code> don't return them, so we can't replay
          them onto the new policy. After the new policy is created,
          open it in the admin center and re-apply those rules manually
          if the source had any.
        </MessageBarBody>
      </MessageBar>

      {/* Created-policy confirmation. Stays visible until the user dismisses
          (by picking another source / leaving the page) so they can grab the
          PPAC link without racing the spinner. */}
      {createdPolicy && (
        <MessageBar intent="success">
          <MessageBarBody>
            <MessageBarTitle>Policy created</MessageBarTitle>
            <strong>{createdPolicy.displayName}</strong> was created
            successfully.{" "}
            <a
              href={ppacDlpPolicyUrl(createdPolicy.name)}
              target="_blank"
              rel="noreferrer"
            >
              Open in admin center <OpenRegular />
            </a>
          </MessageBarBody>
        </MessageBar>
      )}

      {/* Step 1 — pick source + name */}
      {policiesError && (
        <ErrorPane title="Couldn't load policies" message={policiesError} />
      )}
      {!policiesError && policies === null && (
        <LoadingPane label="Loading DLP policies…" />
      )}
      {!policiesError && policies && policies.length === 0 && (
        <EmptyPane message="No DLP policies returned for this tenant. There is nothing to duplicate." />
      )}

      {policies && policies.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Text className={styles.sectionTitle}>1. Source &amp; name</Text>
          </div>
          <div className={styles.pickerRow}>
            <PolicyPicker
              label="Source policy"
              policies={policies}
              value={sourceId}
              onChange={onSourceChange}
            />
            <label>
              <span className={styles.pickerLabel}>New policy name</span>
              <Input
                className={styles.input}
                value={newName}
                onChange={(_e, data: InputOnChangeData) => onNameChange(data.value)}
                placeholder="e.g. Copy of My Policy"
                disabled={!source}
              />
            </label>
          </div>

          {source && (
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Default classification</span>
                <span className={styles.summaryValue}>
                  <Badge
                    appearance="filled"
                    shape="rounded"
                    color={
                      defaultBucketAppearance(source.defaultConnectorsClassification)
                        .color
                    }
                  >
                    {
                      defaultBucketAppearance(source.defaultConnectorsClassification)
                        .label
                    }
                  </Badge>
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Total connectors</span>
                <span className={styles.summaryValue}>
                  {totalConnectors(source)}
                </span>
              </div>
              {summarizeBuckets(source).map((b) => (
                <div className={styles.summaryItem} key={b.bucket}>
                  <span className={styles.summaryLabel}>{b.bucket}</span>
                  <span className={styles.summaryValue}>{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2 — pick environments */}
      {policies && policies.length > 0 && (
        <div className={styles.section}>
          <div className={styles.envHeader}>
            <div>
              <Text className={styles.sectionTitle}>2. Target environments</Text>
              <div className={styles.sectionSub}>
                The new policy will apply only to the environments you select
                here. At least one is required.
              </div>
            </div>
            <div className={styles.envHeaderActions}>
              <Badge appearance="tint">
                {selectedEnvs.size} selected
              </Badge>
              <Button
                appearance="subtle"
                onClick={selectAllVisible}
                disabled={!envs || filteredEnvs.length === 0}
              >
                Select all{envSearch ? " filtered" : ""}
              </Button>
              <Button
                appearance="subtle"
                onClick={clearSelection}
                disabled={selectedEnvs.size === 0}
              >
                Clear
              </Button>
            </div>
          </div>

          <SearchBox
            className={styles.envSearch}
            placeholder="Search environments by name or id…"
            value={envSearch}
            onChange={(_e: SearchBoxChangeEvent, data) =>
              setEnvSearch(data.value)
            }
          />

          {envsError && (
            <ErrorPane title="Couldn't load environments" message={envsError} />
          )}
          {!envsError && envs === null && (
            <LoadingPane label="Loading environments…" />
          )}
          {!envsError && envs && envs.length === 0 && (
            <EmptyPane message="No environments returned." />
          )}
          {!envsError && envs && envs.length > 0 && (
            <div
              className={styles.envList}
              role="listbox"
              aria-label="Target environments"
            >
              {filteredEnvs.length === 0 && (
                <EmptyPane message="No environments match the current search." />
              )}
              {filteredEnvs.map((e) => {
                const checked = selectedEnvs.has(e.id);
                return (
                  <div key={e.id} className={styles.envRow}>
                    <Checkbox
                      checked={checked}
                      onChange={(_e, data) =>
                        toggleEnv(e.id, Boolean(data.checked))
                      }
                      label={
                        <span>
                          <span className={styles.envName}>{e.displayName}</span>
                          <span className={styles.envMeta}>
                            {" "}
                            · {e.environmentType}
                            {e.region ? ` · ${e.region}` : ""}
                          </span>
                        </span>
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      {submitError && (
        <ErrorPane title="Couldn't create policy" message={submitError} />
      )}
      <div className={styles.actionsRow}>
        {submitting && <Spinner size="tiny" label="Creating policy…" />}
        <Tooltip
          content={
            !source
              ? "Pick a source policy first."
              : newName.trim().length === 0
                ? "Enter a name for the new policy."
                : selectedEnvs.size === 0
                  ? "Select at least one target environment."
                  : "Create the duplicated policy."
          }
          relationship="description"
        >
          <Button
            appearance="primary"
            icon={<CopyRegular />}
            onClick={onDuplicate}
            disabled={!canSubmit}
          >
            Duplicate policy
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function PolicyPicker({
  label,
  policies,
  value,
  onChange,
}: {
  label: string;
  policies: PolicyV2[];
  value: string | undefined;
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
        placeholder="Choose a policy to duplicate…"
        value={selected?.displayName ?? ""}
        selectedOptions={value ? [value] : []}
        onOptionSelect={onSelect}
      >
        {policies.map((p) => (
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
        ))}
      </Combobox>
    </label>
  );
}
