import { useEffect, useRef, useState } from "react";
import { Button, Caption1, Checkbox, Field, Input, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import { AUTHORIZATION_NOTICE, groupCloneBackend, groupCloneStore, loadCloneOperations, prepareGroupClone } from "./groupCloneData";
import { executeGroupClone, newCloneOperation, reconcileGroupClone, type CloneOperation, type CloneOutcome, type ClonePlan } from "./groupClone";
import type { DataResult } from "./data";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0, overflowWrap: "anywhere" },
  list: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL },
  record: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, paddingBlock: tokens.spacingVerticalS, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
});

export function GroupClonePanel({ sourceId, sourceName, onCompleted }: { sourceId: string; sourceName: string; onCompleted: (outcome: CloneOutcome) => void }) {
  const styles = useStyles();
  const [name, setName] = useState("");
  const [result, setResult] = useState<DataResult<ClonePlan> | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<CloneOutcome | null>(null);
  const [records, setRecords] = useState<CloneOperation[]>([]);
  const [storageError, setStorageError] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const writeActive = useRef(false);
  useEffect(() => {
    const invalidate = () => { ++generation.current; controller.current?.abort(); };
    const reload = () => {
      try { setRecords(loadCloneOperations(sourceId)); setStorageError(""); }
      catch (error) { setStorageError(String(error)); }
    };
    reload();
    window.addEventListener("ppcoe:managed-apps:group-clone:changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      invalidate();
      window.removeEventListener("ppcoe:managed-apps:group-clone:changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, [sourceId]);
  const plan = result?.ok ? result.data : null;
  async function review() {
    const request = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true); setResult(null); setConfirmed(false); setOutcome(null);
    const next = await prepareGroupClone(sourceId, name, controller.current.signal);
    if (request !== generation.current) return;
    setResult(next); setBusy(false);
  }
  async function execute() {
    if (!plan || writeActive.current) return;
    writeActive.current = true; setBusy(true);
    try {
      const operation = await newCloneOperation(plan);
      groupCloneStore.save(operation);
      const next = await executeGroupClone(plan, operation, groupCloneBackend, groupCloneStore, confirmed);
      setOutcome(next);
      if (next.operation.phase === "verified" && next.destinationUrl) onCompleted(next);
    } catch (error) { setStorageError(`Copy could not be started safely: ${String(error)}`); }
    finally { writeActive.current = false; setBusy(false); }
  }
  async function reconcile(operation: CloneOperation) {
    if (!plan || writeActive.current) return;
    writeActive.current = true; setBusy(true);
    try {
      const next = await reconcileGroupClone(plan, operation, groupCloneBackend, groupCloneStore);
      setOutcome(next);
      if (next.operation.phase === "verified" && next.destinationUrl) onCompleted(next);
    } catch (error) { setStorageError(`Recovery read failed: ${String(error)}`); }
    finally { writeActive.current = false; setBusy(false); }
  }
  const unresolved = records.some((record) => !["blocked", "planned", "verified"].includes(record.phase));
  return <div className={styles.stack}>
    <Text as="h3" weight="semibold">Copy to an empty group</Text>
    <Text>Copy group properties, all Model A settings and every Model B module, including an independent ACP. No environments, PDEs, source assignments, hierarchy or permissions are copied. The source is never changed.</Text>
    <Field label="New group name"><Input value={name} disabled={busy} onChange={(_, data) => {
      ++generation.current; controller.current?.abort();
      setName(data.value); setResult(null); setConfirmed(false); setOutcome(null);
    }} /></Field>
    <Button disabled={!name.trim() || busy} onClick={() => void review()}>Review independent copy</Button>
    {busy && <LoadingPane label="Reading / verifying the independent group copy..." />}
    {result && !result.ok && <ErrorPane title="Copy preflight unavailable" message={result.error} />}
    {storageError && <ErrorPane title="Recovery storage unavailable" message={storageError} />}
    {plan && <>
      <Text weight="semibold">Source: {sourceName} ({plan.sourceId}) → New empty group: {plan.group.displayName}</Text>
      <Text>0 environments copied · 1 independent ACP copies proposed</Text>
      <Caption1>Source policy {plan.sourcePolicyId} → a newly returned policy ID. Module IDs, versions, connector/action identifiers and complete input values are preserved; group/policy/ruleset resource IDs are not reused.</Caption1>
      <Caption1>Fresh nontransactional source read: {new Date(plan.preparedAt).toLocaleTimeString()}. Source state: {plan.publication}. Writes would recheck this snapshot.</Caption1>
      <RawJsonAccordion title={`Exact copied properties and settings (${plan.copied.length})`} data={plan.copied} />
      <Caption1>Model A scope becomes destination-only Include. Model B assignment uses the documented empty body for the whole new group. Unknown input keys and explicit connection-type/action lists are preserved, not normalized away.</Caption1>
      {!!plan.blockers.length && <>
        <MessageBar intent="warning"><MessageBarBody>Full-copy fidelity is not established. No group, ruleset or ACP has been created. These are evidence-specific blockers, not a missing CreateRuleSet route.</MessageBarBody></MessageBar>
        <ul className={styles.list}>{plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
      </>}
      <Text>{AUTHORIZATION_NOTICE}</Text>
      <Checkbox checked={confirmed} disabled={busy || !!plan.blockers.length} label={`I confirm copying ${sourceName} (${plan.sourceId}) to NEW empty group "${plan.group.displayName}", with all listed settings and a separate ACP. Source state ${plan.publication} must be preserved; no membership or source changes. Partial resources may require manual admin recovery; no automatic deletion.`} onChange={(_, data) => setConfirmed(data.checked === true)} />
      {unresolved && <MessageBar intent="warning"><MessageBarBody>A previous copy has incomplete or uncertain writes. Reconcile its IDs; do not start another copy and create duplicate/orphan resources.</MessageBarBody></MessageBar>}
      <Button appearance="primary" disabled={busy || !confirmed || !!plan.blockers.length || !!storageError || unresolved || !!outcome}
        onClick={() => void execute()}>{plan.blockers.length ? "Create independent copy (unavailable)" : "Create independent copy"}</Button>
    </>}
    {outcome && <>
      <MessageBar intent={outcome.operation.phase === "verified" && outcome.destinationUrl ? "success" : "warning"}><MessageBarBody>{outcome.message}</MessageBarBody></MessageBar>
      <RawJsonAccordion title="This attempt's resource IDs and actual step outcomes" data={{
        operationId: outcome.operation.id, destinationId: outcome.operation.destinationId, policyId: outcome.operation.policyId,
        rules: outcome.operation.rules, steps: outcome.operation.steps,
      }} />
      {outcome.destinationUrl && <Link href={outcome.destinationUrl} target="_blank" rel="noopener noreferrer">Open verified destination group in admin center</Link>}
    </>}
    {!!records.length && <details><summary>Copy operation records and manual recovery ({records.length})</summary>
      <Caption1>Stored locally in this browser: IDs, fingerprints and step outcomes only, not credentials or copied settings. No automatic cleanup or creation retry. A lost response can leave an unidentifiable orphan; names are not ownership evidence.</Caption1>
      {records.map((record) => <div key={record.id} className={styles.record}>
        <Text weight="semibold">{record.phase} · operation {record.id}</Text>
        <Text>Destination group: {record.destinationId || "Not reconciled"} · independent policy: {record.policyId || "Not reconciled"}</Text>
        <RawJsonAccordion title="Returned resource IDs and actual step outcomes" data={{ rules: record.rules, steps: record.steps }} />
        <Caption1>Before read-only reconciliation, enter the original destination name and read a fresh preview. A changed source/plan cannot be treated as equivalent. Partially created group/rules/policy may need manual recovery; policy delete/unassignment and group-delete cascades are not verified.</Caption1>
        <Button disabled={!plan || busy} onClick={() => void reconcile(record)}>Reconcile known IDs (read only)</Button>
      </div>)}
    </details>}
  </div>;
}
