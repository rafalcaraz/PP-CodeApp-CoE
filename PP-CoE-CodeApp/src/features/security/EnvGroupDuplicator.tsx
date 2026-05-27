import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Combobox,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
  type InputOnChangeData,
  type OptionOnSelectData,
  type SelectionEvents,
  type TextareaOnChangeData,
} from "@fluentui/react-components";
import { CheckmarkCircleFilled, CopyRegular, ErrorCircleFilled, OpenRegular } from "@fluentui/react-icons";
import {
  duplicateEnvironmentGroup,
  type DuplicateEnvironmentGroupResult,
} from "../../data/envGroupDuplicator";
import {
  getEnvironmentGroupRulesets,
  type EnvironmentGroupRulesetsResult,
} from "../../data/adminEnrichment";
import {
  listEnvironmentGroups,
  type EnvironmentGroupRow,
} from "../../data/inventory";
import { ppacEnvironmentGroupUrl } from "../../data/dlpPolicies";
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
  textarea: { width: "100%" },
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
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
  actionsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.spacingHorizontalM,
  },
  resultList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  resultItem: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  resultOk: { color: tokens.colorPaletteGreenForeground1 },
  resultErr: { color: tokens.colorPaletteRedForeground1 },
});

/** Count how many `parameters[]` entries (top-level buckets) the
 *  source rulesets contain in total. Helps the user see "duplication
 *  will clone X buckets across Y rulesets" at a glance. */
function countParameters(rulesets: EnvironmentGroupRulesetsResult | null): number {
  if (!rulesets) return 0;
  let total = 0;
  for (const rs of rulesets.matching.value ?? []) {
    total += rs.parameters?.length ?? 0;
  }
  return total;
}

/**
 * Env-group duplicator — pick a source group, give the copy a name +
 * description, click Duplicate. The orchestrator creates the new
 * group and re-PUTs every Model A ruleset rewired to it.
 *
 * Per-ruleset failures are reported individually in the success
 * panel so a partial clone is visible (rather than appearing as a
 * "succeeded" group with missing rules).
 */
export function EnvGroupDuplicator() {
  const styles = useStyles();
  const [groups, setGroups] = useState<EnvironmentGroupRow[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const [sourceId, setSourceId] = useState<string | undefined>();
  const [newName, setNewName] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [nameTouched, setNameTouched] = useState(false);
  const [descTouched, setDescTouched] = useState(false);

  // Source-rulesets preview (read on source change so the user knows
  // what they're about to clone).
  const [rulesets, setRulesets] =
    useState<EnvironmentGroupRulesetsResult | null>(null);
  const [rulesetsLoading, setRulesetsLoading] = useState(false);
  const [rulesetsError, setRulesetsError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<DuplicateEnvironmentGroupResult | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await listEnvironmentGroups();
      if (cancelled) return;
      if (r.ok) setGroups(r.data);
      else setGroupsError(r.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const source = useMemo(
    () => groups?.find((g) => g.id === sourceId),
    [groups, sourceId],
  );

  function onSourceChange(nextId: string | undefined) {
    setSourceId(nextId);
    if (nextId) {
      const next = groups?.find((g) => g.id === nextId);
      if (next) {
        if (!nameTouched) setNewName(`Copy of ${next.displayName}`);
        if (!descTouched && next.description) setNewDescription(next.description);
      }
      // Refresh the rulesets preview.
      setRulesetsLoading(true);
      setRulesetsError(null);
      setRulesets(null);
      (async () => {
        const r = await getEnvironmentGroupRulesets(nextId);
        if (r.ok) setRulesets(r.data);
        else setRulesetsError(r.error);
        setRulesetsLoading(false);
      })();
    } else {
      setRulesets(null);
      setRulesetsError(null);
    }
  }

  const canSubmit = !!source && newName.trim().length > 0 && !submitting;

  async function onDuplicate() {
    if (!source) return;
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const r = await duplicateEnvironmentGroup({
        sourceGroupId: source.id,
        displayName: newName,
        description: newDescription,
      });
      if (!r.ok) {
        setSubmitError(r.error);
      } else {
        setResult(r.data);
        setNewName("");
        setNewDescription("");
        setNameTouched(false);
        setDescTouched(false);
        setSourceId(undefined);
        setRulesets(null);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>How duplication works</MessageBarTitle>
          The new group copies the source's <strong>governance rulesets</strong>{" "}
          (Model A — the <code>parameters</code>-bucket rules surfaced under
          "Rules" on the env-group detail page). Each ruleset is re-created
          via <code>UpdateRuleSet</code> as a REST upsert pointed at the new
          group.
        </MessageBarBody>
      </MessageBar>

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>Not copied</MessageBarTitle>
          <strong>Rule-based policies</strong> (Model B — those assigned via
          <code> PolicyAssignment</code>, e.g. DLPs scoped to the group),{" "}
          <strong>role assignments</strong>, and <strong>child groups</strong>{" "}
          are <em>not</em> cloned — the connector lacks a writable
          "create-on-group" endpoint for those. Re-apply them manually from
          the admin center after duplication.
        </MessageBarBody>
      </MessageBar>

      {/* Success summary */}
      {result && (
        <MessageBar
          intent={
            result.rulesets.every((r) => r.ok) ? "success" : "warning"
          }
        >
          <MessageBarBody>
            <MessageBarTitle>
              {result.rulesets.every((r) => r.ok)
                ? "Group duplicated"
                : "Group duplicated with warnings"}
            </MessageBarTitle>
            <div>
              <strong>{result.newGroup.displayName}</strong> was created.
              {result.newGroup.id && (
                <>
                  {" "}
                  <a
                    href={ppacEnvironmentGroupUrl(result.newGroup.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in admin center <OpenRegular />
                  </a>
                </>
              )}
            </div>
            {result.rulesets.length > 0 && (
              <div className={styles.resultList} style={{ marginTop: 8 }}>
                {result.rulesets.map((r) => (
                  <div key={r.newRuleSetId} className={styles.resultItem}>
                    {r.ok ? (
                      <CheckmarkCircleFilled className={styles.resultOk} />
                    ) : (
                      <ErrorCircleFilled className={styles.resultErr} />
                    )}
                    <span>
                      Ruleset <code>{r.sourceRuleSetId.slice(0, 8)}…</code>{" "}
                      → <code>{r.newRuleSetId.slice(0, 8)}…</code>
                      {r.error ? ` — ${r.error}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </MessageBarBody>
        </MessageBar>
      )}

      {/* Step 1 — pick source + name + description */}
      {groupsError && (
        <ErrorPane title="Couldn't load environment groups" message={groupsError} />
      )}
      {!groupsError && groups === null && (
        <LoadingPane label="Loading environment groups…" />
      )}
      {!groupsError && groups && groups.length === 0 && (
        <EmptyPane message="No environment groups returned for this tenant. There is nothing to duplicate." />
      )}

      {groups && groups.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Text className={styles.sectionTitle}>1. Source &amp; new group</Text>
          </div>
          <div className={styles.pickerRow}>
            <GroupPicker
              label="Source group"
              groups={groups}
              value={sourceId}
              onChange={onSourceChange}
            />
            <label>
              <span className={styles.pickerLabel}>New group name</span>
              <Input
                className={styles.input}
                value={newName}
                onChange={(_e, data: InputOnChangeData) => {
                  setNewName(data.value);
                  setNameTouched(true);
                }}
                placeholder="e.g. Copy of My Group"
                disabled={!source}
              />
            </label>
          </div>
          <label>
            <span className={styles.pickerLabel}>Description (optional)</span>
            <Textarea
              className={styles.textarea}
              value={newDescription}
              onChange={(_e, data: TextareaOnChangeData) => {
                setNewDescription(data.value);
                setDescTouched(true);
              }}
              placeholder="What is this group for?"
              disabled={!source}
              rows={3}
            />
          </label>
        </div>
      )}

      {/* Step 2 — preview of what will be cloned */}
      {source && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Text className={styles.sectionTitle}>2. What will be cloned</Text>
            <Text className={styles.sectionSub}>
              From <strong>{source.displayName}</strong>
            </Text>
          </div>
          {rulesetsError && (
            <ErrorPane
              title="Couldn't read source rulesets"
              message={rulesetsError}
            />
          )}
          {rulesetsLoading && <LoadingPane label="Reading source rulesets…" />}
          {!rulesetsLoading && !rulesetsError && rulesets && (
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Rulesets on source</span>
                <span className={styles.summaryValue}>
                  {rulesets.matching.value?.length ?? 0}
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Total parameters</span>
                <span className={styles.summaryValue}>
                  {countParameters(rulesets)}
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Tenant rulesets scanned</span>
                <span className={styles.summaryValue}>
                  {rulesets.totalInTenant}
                </span>
              </div>
            </div>
          )}
          {!rulesetsLoading &&
            !rulesetsError &&
            rulesets &&
            (rulesets.matching.value?.length ?? 0) === 0 && (
              <Badge appearance="tint" color="informative">
                Source group has no governance rulesets — only the empty
                group itself will be created.
              </Badge>
            )}
        </div>
      )}

      {/* Submit */}
      {submitError && (
        <ErrorPane title="Couldn't duplicate group" message={submitError} />
      )}
      <div className={styles.actionsRow}>
        {submitting && <Spinner size="tiny" label="Duplicating group…" />}
        <Tooltip
          content={
            !source
              ? "Pick a source group first."
              : newName.trim().length === 0
                ? "Enter a name for the new group."
                : "Create the duplicated environment group."
          }
          relationship="description"
        >
          <Button
            appearance="primary"
            icon={<CopyRegular />}
            onClick={onDuplicate}
            disabled={!canSubmit}
          >
            Duplicate group
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function GroupPicker({
  label,
  groups,
  value,
  onChange,
}: {
  label: string;
  groups: EnvironmentGroupRow[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const styles = useStyles();
  const selected = value ? groups.find((g) => g.id === value) : undefined;
  const onSelect = (_e: SelectionEvents, data: OptionOnSelectData) => {
    onChange(data.optionValue || undefined);
  };
  return (
    <label>
      <span className={styles.pickerLabel}>{label}</span>
      <Combobox
        className={styles.combobox}
        placeholder="Choose a group to duplicate…"
        value={selected?.displayName ?? ""}
        selectedOptions={value ? [value] : []}
        onOptionSelect={onSelect}
      >
        {groups.map((g) => (
          <Option key={g.id} value={g.id} text={g.displayName}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span>{g.displayName}</span>
              {g.description && (
                <span
                  style={{
                    color: tokens.colorNeutralForeground3,
                    fontSize: tokens.fontSizeBase100,
                  }}
                >
                  {g.description}
                </span>
              )}
            </div>
          </Option>
        ))}
      </Combobox>
    </label>
  );
}
