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
    <Text as="h3" weight="semibold">Duplicate environment group</Text>
    <Text>Copy settings from {sourceName} into a new empty group with its own ACP. No environments are copied; the source stays unchanged.</Text>
    <Field label="New group name"><Input value={name} disabled={busy} onChange={(_, data) => {
      ++generation.current; controller.current?.abort();
      setName(data.value); setResult(null); setConfirmed(false); setOutcome(null);
    }} /></Field>
    <Button disabled={!name.trim() || busy} onClick={() => void review()}>Review copy</Button>
    {busy && <LoadingPane label="Checking group copy..." />}
    {result && !result.ok && <ErrorPane title="Couldn't review this copy" message={result.error} />}
    {storageError && <ErrorPane title="Recovery storage unavailable" message={storageError} />}
    {plan && <>
      <Text weight="semibold">{sourceName} → {plan.group.displayName}</Text>
      <Caption1>{plan.copied.length} settings · Independent ACP · 0 environments copied</Caption1>
      {plan.publication === "applied" && <Caption1>Copies applied settings. Pending changes in admin center aren't copied.</Caption1>}
      {!!plan.blockers.length && <>
        <MessageBar intent="warning"><MessageBarBody>Copy isn't ready: {plan.blockers[0]} This review hasn't created resources.</MessageBarBody></MessageBar>
      </>}
      <details><summary>Copy details{plan.blockers.length ? ` and checks (${plan.blockers.length})` : ""}</summary>
        <div className={styles.stack}>
          <Caption1>Source group: {plan.sourceId} · Source policy: {plan.sourcePolicyId}</Caption1>
          <Caption1>Read {new Date(plan.preparedAt).toLocaleTimeString()} · Stored source state: {plan.publication}. Source settings are checked again before writes.</Caption1>
          {!!plan.blockers.length && <ul className={styles.list}>{plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
          <RawJsonAccordion title={`Copied settings (${plan.copied.length})`} data={plan.copied} />
          {!!plan.unsupported?.length && <RawJsonAccordion title="Unmapped fields (exact returned values)" data={plan.unsupported} />}
          <Text>{AUTHORIZATION_NOTICE}</Text>
          <Caption1>Setting and module identifiers, versions and complete input values are preserved. New resource identities and destination-only assignment are verified. No hierarchy, roles or membership are copied.</Caption1>
        </div>
      </details>
      {unresolved && <MessageBar intent="warning"><MessageBarBody>A previous copy has incomplete or uncertain writes. Reconcile its IDs; do not start another copy and create duplicate/orphan resources.</MessageBarBody></MessageBar>}
      {!plan.blockers.length && !unresolved && !storageError && !outcome && <>
        <Checkbox checked={confirmed} disabled={busy || unresolved}
          label={`Create "${plan.group.displayName}" from "${sourceName}" with all reviewed ${plan.publication} settings and a separate ACP. No environments or source changes. Incomplete writes may need manual recovery.`}
          onChange={(_, data) => setConfirmed(data.checked === true)} />
        <Button appearance="primary" disabled={busy || !confirmed}
          onClick={() => void execute()}>Create independent copy</Button>
      </>}
    </>}
    {outcome && <>
      <MessageBar intent={outcome.operation.phase === "verified" && outcome.destinationUrl ? "success" : "warning"}><MessageBarBody>{outcome.message}</MessageBarBody></MessageBar>
      <RawJsonAccordion title="This attempt's resource IDs and actual step outcomes" data={{
        operationId: outcome.operation.id, destinationId: outcome.operation.destinationId, policyId: outcome.operation.policyId,
        rules: outcome.operation.rules, steps: outcome.operation.steps,
      }} />
      {outcome.destinationUrl && <Link href={outcome.destinationUrl} target="_blank" rel="noopener noreferrer">Open verified destination group in admin center</Link>}
    </>}
    {!!records.length && <details open={unresolved}><summary>Copy history and recovery ({records.length})</summary>
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
