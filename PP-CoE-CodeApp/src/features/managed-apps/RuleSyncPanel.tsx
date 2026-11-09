import { useEffect, useRef, useState } from "react";
import { Button, Caption1, Checkbox, Field, Input, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import { formatApiError } from "../../shared/api-explorer/schema";
import { loadRuleSyncGroups, membershipId, type DataResult, type EnvironmentGroupRow } from "./data";
import { ruleSyncCatalog, unresolvedSync, type SyncCatalog, type SyncOutcome, type SyncPlan, type SyncRecord } from "./ruleSync";
import { prepareRuleSync, readRuleSyncSource, reconcileRuleSyncRecord, ruleSyncRuntimeBlocker, ruleSyncStore, runRuleSync } from "./ruleSyncData";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0, overflowWrap: "anywhere", paddingBlock: tokens.spacingVerticalS },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, paddingBlock: tokens.spacingVerticalS, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  list: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL },
});
export function RuleSyncPanel(props: { sourceId: string }) {
  return <SelectedRuleSync key={props.sourceId} {...props} />;
}
function SelectedRuleSync({ sourceId }: { sourceId: string }) {
  const styles = useStyles();
  const [catalog, setCatalog] = useState<SyncCatalog>();
  const [groups, setGroups] = useState<EnvironmentGroupRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [result, setResult] = useState<DataResult<SyncPlan>>();
  const [reviewing, setReviewing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome>();
  const [records, setRecords] = useState<SyncRecord[]>([]);
  const generation = useRef(0);
  const preview = useRef<AbortController | null>(null);
  const execution = useRef<AbortController | null>(null);
  const active = useRef(false);
  const mounted = useRef(false);
  function invalidate() {
    if (active.current) return;
    ++generation.current; preview.current?.abort(); setResult(undefined); setConfirmed(false); setReviewing(false);
  }
  useEffect(() => {
    mounted.current = true;
    const cancelPreview = () => { ++generation.current; preview.current?.abort(); };
    const reload = () => {
      try { setRecords(ruleSyncStore.all()); setStorageError(""); }
      catch (failure) { setStorageError(formatApiError(failure)); }
    };
    const stale = () => {
      if (active.current) return;
      cancelPreview(); setResult(undefined); setConfirmed(false); setReviewing(false);
    };
    reload();
    window.addEventListener("storage", reload);
    window.addEventListener("ppcoe:managed-apps:rule-sync:changed", reload);
    window.addEventListener("focus", stale);
    return () => {
      mounted.current = false; cancelPreview(); execution.current?.abort();
      window.removeEventListener("storage", reload);
      window.removeEventListener("ppcoe:managed-apps:rule-sync:changed", reload);
      window.removeEventListener("focus", stale);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [source, destinations] = await Promise.all([readRuleSyncSource(sourceId, controller.signal), loadRuleSyncGroups(controller.signal)]);
        if (!source.ok) throw new Error(source.error);
        if (!destinations.ok) throw new Error(destinations.error);
        const next = await ruleSyncCatalog(source.data);
        if (controller.signal.aborted) return;
        setCatalog(next); setGroups(destinations.data.filter((group) => membershipId(group.id) !== membershipId(sourceId)));
      } catch (failure) { if (!controller.signal.aborted) setError(formatApiError(failure)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [sourceId, attempt]);
  const plan = result?.ok ? result.data : undefined;
  const runtimeBlocker = ruleSyncRuntimeBlocker();
  const currentScope = new Set([sourceId, ...targets].map(membershipId));
  const relevantRecords = records.filter((record) => membershipId(record.sourceId) === membershipId(sourceId)
    || unresolvedSync(record) && [record.sourceId, ...record.targets.map((target) => target.id)].some((id) => currentScope.has(membershipId(id))));
  const overlaps = relevantRecords.some(unresolvedSync);
  async function review() {
    const request = ++generation.current;
    preview.current?.abort(); preview.current = new AbortController();
    setReviewing(true); setResult(undefined); setConfirmed(false);
    const next = await prepareRuleSync(sourceId, selected, targets, preview.current.signal);
    if (request !== generation.current || !mounted.current) return;
    setResult(next); setReviewing(false);
  }
  async function apply() {
    if (!plan || active.current) return;
    active.current = true; setWriting(true); setOutcome(undefined);
    execution.current = new AbortController();
    try {
      const next = await runRuleSync(plan, confirmed, execution.current.signal);
      notifyWrittenTargets(next);
      if (mounted.current) { setOutcome(next); setResult(undefined); setConfirmed(false); }
    } catch (failure) { if (mounted.current) setError(formatApiError(failure)); }
    finally { active.current = false; if (mounted.current) setWriting(false); }
  }
  async function reconcile(record: SyncRecord) {
    if (active.current) return;
    active.current = true; setWriting(true);
    try {
      const next = await reconcileRuleSyncRecord(record);
      notifyWrittenTargets(next);
      if (mounted.current) { setOutcome(next); setResult(undefined); setConfirmed(false); }
    } catch (failure) { if (mounted.current) setError(formatApiError(failure)); }
    finally { active.current = false; if (mounted.current) setWriting(false); }
  }
  function notifyWrittenTargets(next: SyncOutcome) {
    const targetIds = next.record.targets.filter((target) => target.steps.some((step) => step.phase !== "pending")).map((target) => target.id);
    if (targetIds.length) window.dispatchEvent(new CustomEvent("ppcoe:managed-apps:rule-sync:written", { detail: { targetIds } }));
  }
  const toggle = (values: string[], key: string, checked: boolean) => checked ? [...values, key] : values.filter((value) => value !== key);
  return <div className={styles.stack}>
    <Text>Apply checked rules once to checked groups. Nothing is selected by default. No ongoing link, schedule or membership changes.</Text>
    <Caption1>Named policy rules include all their settings. Group settings can be checked individually. Only applied settings are used, not pending admin-center edits.</Caption1>
    {loading && <LoadingPane label="Reading sync rules and destination groups..." />}
    {error && <ErrorPane title="Sync unavailable" message={error} />}
    {!loading && <Button disabled={writing} onClick={() => {
      invalidate(); setSelected([]); setTargets([]); setCatalog(undefined); setError(""); setLoading(true); setAttempt((value) => value + 1);
    }}>Refresh sync choices</Button>}
    {catalog && <>
      {!!catalog.blockers.length && <ErrorPane title="Source rules cannot be synced" message={catalog.blockers.join(" ")} />}
      <Text weight="semibold">Rules to apply</Text>
      {!catalog.rules.length && <Text>No supported applied rules are available for selective sync.</Text>}
      {catalog.rules.map((rule) => <Checkbox key={rule.key} label={rule.label} checked={selected.includes(rule.key)} disabled={writing}
        onChange={(_, data) => { invalidate(); setSelected(toggle(selected, rule.key, data.checked === true)); }} />)}
      {!!catalog.exclusions.length && <details><summary>Unavailable rules ({catalog.exclusions.length})</summary>
        <ul className={styles.list}>{catalog.exclusions.map((entry, index) => <li key={index}>{entry.label}: {entry.reason}</li>)}</ul>
      </details>}
      <Text weight="semibold">Destination groups</Text>
      <Field label="Find destination groups"><Input value={search} disabled={writing} onChange={(_, data) => setSearch(data.value)} /></Field>
      <Caption1>{targets.length} checked groups. Searching does not clear checked groups.</Caption1>
      {!groups.length && <Text>No other environment groups were returned.</Text>}
      {groups.filter((group) => `${group.displayName} ${group.id}`.toLowerCase().includes(search.toLowerCase())).map((group) =>
        <Checkbox key={group.id} label={group.displayName || group.id} checked={targets.includes(group.id)} disabled={writing}
          onChange={(_, data) => { invalidate(); setTargets(toggle(targets, group.id, data.checked === true)); }} />)}
      <Button disabled={!selected.length || !targets.length || writing || reviewing || !!catalog.blockers.length}
        onClick={() => void review()}>Preview selected changes</Button>
    </>}
    {reviewing && <LoadingPane label="Reading fresh source, target settings, assignment scope and affected environments..." />}
    {result && !result.ok && <ErrorPane title="Couldn't preview sync" message={result.error} />}
    {storageError && <ErrorPane title="Sync recovery storage unavailable" message={storageError} />}
    {overlaps && <ErrorPane title="Previous sync needs reconciliation" message="Review known resource IDs below before starting overlapping writes." />}
    {runtimeBlocker && <Text>{runtimeBlocker}</Text>}
    {plan && <>
      <Text weight="semibold">{plan.sourceName}: {plan.selected.length} checked rules → {plan.targets.length} checked groups</Text>
      {plan.targets.map((target) => <section key={target.id} className={styles.section}>
        <Text weight="semibold">{target.name} · {target.before.environments.length} affected environments</Text>
        {!!target.before.environments.length && <details><summary>Affected environments</summary><ul className={styles.list}>
          {target.before.environments.map((environment) => <li key={environment.id}>{environment.displayName || environment.id}</li>)}
        </ul></details>}
        {target.changes.map((change) => <Text key={change.key}>{change.action === "add" ? "Add" : change.action === "replace" ? "Replace" : "No change"}: {change.label}
          {typeof change.after === "string" && ` · ${String(change.before ?? "Not configured")} → ${change.after}`}</Text>)}
        <RawJsonAccordion title="Exact selected-rule differences and target scope" data={{ changes: target.changes, policyAssignments: target.before.policyScope }} />
      </section>)}
      {!!plan.blockers.length && <ErrorPane title="These selections cannot be applied" message={plan.blockers.join(" ")} />}
      <Caption1>Unselected settings are retained. Avoid simultaneous governance edits; these APIs are not transactional. Failed or uncertain writes require read-only reconciliation, not automatic retry or rollback.</Caption1>
      <Checkbox checked={confirmed} disabled={writing || !!plan.blockers.length || !!storageError || overlaps || !!runtimeBlocker}
        label={`Apply only these ${plan.selected.length} rules once to these ${plan.targets.length} groups, including the listed environments. Keep other settings, source and memberships unchanged. I have reviewed the exact changes.`}
        onChange={(_, data) => setConfirmed(data.checked === true)} />
      <Button appearance="primary" disabled={!confirmed || writing || !!plan.blockers.length || !!storageError || overlaps || !!runtimeBlocker}
        onClick={() => void apply()}>Apply selected rules once</Button>
    </>}
    {writing && <LoadingPane label="Applying or checking known outcomes. Closing stops remaining writes, not an in-flight request..." />}
    {outcome && <MessageBar intent={outcome.record.phase === "verified" ? "success" : "warning"}><MessageBarBody>{outcome.message}</MessageBarBody></MessageBar>}
    {!!relevantRecords.length && <details open={overlaps}>
      <summary>Sync history and recovery</summary>
      <Caption1>Only IDs, fingerprints and step outcomes are stored in this browser. No rule payloads or credentials. No automatic retries or cleanup.</Caption1>
      {relevantRecords.map((record) => <section key={record.id} className={styles.section}>
        <Text weight="semibold">{record.phase} · {record.id}</Text>
        {record.targets.map((target) => <Text key={target.id}>{groups.find((group) => group.id === target.id)?.displayName || target.id}: {target.phase}</Text>)}
        <RawJsonAccordion title="Recorded resource IDs and step outcomes" data={record} />
        <Button disabled={writing} onClick={() => void reconcile(record)}>Reconcile sync (read only)</Button>
      </section>)}
    </details>}
  </div>;
}
