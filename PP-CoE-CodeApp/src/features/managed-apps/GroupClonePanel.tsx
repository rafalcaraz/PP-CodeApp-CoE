import { useEffect, useRef, useState } from "react";
import { Button, Caption1, Checkbox, Field, Input, Link, MessageBar, MessageBarBody, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import { AUTHORIZATION_NOTICE, groupCloneBackend, groupCloneStore, loadCloneOperations, prepareGroupClone, withGroupCloneLock } from "./groupCloneData";
import { cloneHistory, cloneIntent, executeGroupClone, GROUP_RULE_TRIAL_NOTICE, hasIncompleteCloneWrites, INDEPENDENT_RULE_NOTICE, inspectGroupClone, isCompletedClone, newCloneOperation, recordedCloneGroupId, reconcileGroupClone, type CloneInspection, type CloneOperation, type CloneOutcome, type ClonePlan } from "./groupClone";
import type { DataResult } from "./data";
import { groupPortalUrl } from "./governance";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0, overflowWrap: "anywhere" },
  list: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL },
  record: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, paddingBlock: tokens.spacingVerticalS, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
});

interface GroupClonePanelProps {
  sourceId: string;
  sourceName: string;
  sourceDescription?: string;
  onCompleted: (outcome: CloneOutcome) => void;
}

export function GroupClonePanel(props: GroupClonePanelProps) {
  return <GroupCloneForm key={props.sourceId} {...props} />;
}

function GroupCloneForm({ sourceId, sourceName, sourceDescription, onCompleted }: GroupClonePanelProps) {
  const styles = useStyles();
  const [name, setName] = useState("");
  const [description, setDescription] = useState(sourceDescription ?? "");
  const descriptionEdited = useRef(false);
  const [result, setResult] = useState<DataResult<ClonePlan> | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [separateConfirmed, setSeparateConfirmed] = useState(false);
  const [intent, setIntent] = useState<Awaited<ReturnType<typeof cloneIntent>> | null>(null);
  const [outcome, setOutcome] = useState<CloneOutcome | null>(null);
  const [records, setRecords] = useState<CloneOperation[]>([]);
  const [storageError, setStorageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [inspections, setInspections] = useState<Record<string, CloneInspection>>({});
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const writeActive = useRef(false);
  useEffect(() => {
    if (descriptionEdited.current || writeActive.current) return;
    ++generation.current; controller.current?.abort();
    setDescription(sourceDescription ?? "");
    setResult(null); setIntent(null); setConfirmed(false); setSeparateConfirmed(false); setOutcome(null); setBusy(false);
  }, [sourceDescription]);
  useEffect(() => {
    const invalidate = () => { ++generation.current; controller.current?.abort(); };
    const reload = () => {
      try { setRecords(loadCloneOperations(sourceId)); setStorageError(""); setConfirmed(false); setSeparateConfirmed(false); }
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
  const historyRisk = intent ? cloneHistory(records, sourceId, intent) : null;
  const sameIntent = !!historyRisk?.same.length;
  const needsSeparateConfirmation = !!historyRisk?.separate.length;
  function invalidate() {
    ++generation.current; controller.current?.abort();
    setResult(null); setIntent(null); setConfirmed(false); setSeparateConfirmed(false); setOutcome(null); setActionError("");
  }
  async function review() {
    const request = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true); setResult(null); setIntent(null); setConfirmed(false); setSeparateConfirmed(false); setOutcome(null); setActionError("");
    const next = await prepareGroupClone(sourceId, name, controller.current.signal, description);
    if (request !== generation.current) return;
    const nextIntent = next.ok ? await cloneIntent(next.data) : null;
    if (request !== generation.current) return;
    setIntent(nextIntent);
    setResult(next); setBusy(false);
  }
  async function execute() {
    if (!plan || writeActive.current || !confirmed || sameIntent || (needsSeparateConfirmation && !separateConfirmed)) return;
    writeActive.current = true; setBusy(true); setActionError("");
    try {
      const next = await withGroupCloneLock(async () => {
        const operation = await newCloneOperation(plan);
        groupCloneStore.save(operation);
        return executeGroupClone(plan, operation, groupCloneBackend, groupCloneStore, confirmed,
          confirmed && !!plan.skipped?.length, confirmed && !!plan.trialRules?.length, separateConfirmed);
      });
      setOutcome(next);
      if (isCompletedClone(next.operation.phase) && next.destinationUrl) onCompleted(next);
    } catch (error) { setActionError(`Copy could not be started safely: ${String(error)}`); }
    finally { writeActive.current = false; setBusy(false); }
  }
  async function reconcile(operation: CloneOperation) {
    if (!plan || writeActive.current) return;
    writeActive.current = true; setBusy(true);
    try {
      const next = await reconcileGroupClone(plan, operation, groupCloneBackend, groupCloneStore);
      setOutcome(next);
      if (isCompletedClone(next.operation.phase) && next.destinationUrl) onCompleted(next);
    } catch (error) { setActionError(`Recovery read failed: ${String(error)}`); }
    finally { writeActive.current = false; setBusy(false); }
  }
  async function inspect(operation: CloneOperation) {
    if (writeActive.current) return;
    writeActive.current = true; setBusy(true); setActionError("");
    try {
      const next = await inspectGroupClone(operation, groupCloneBackend, groupCloneStore);
      setInspections((current) => ({ ...current, [operation.id]: next }));
    } catch (error) { setActionError(`Recorded resource inspection failed: ${String(error)}`); }
    finally { writeActive.current = false; setBusy(false); }
  }
  const unresolved = records.some(hasIncompleteCloneWrites);
  const outcomeNeedsRecovery = outcome && !isCompletedClone(outcome.operation.phase)
    && (!!outcome.operation.destinationId || outcome.operation.steps.length > 0);
  const outcomeEvidence = outcome && <RawJsonAccordion title="This attempt's resource IDs and actual step outcomes" data={{
    operationId: outcome.operation.id, destinationId: outcome.operation.destinationId, policyId: outcome.operation.policyId,
    rules: outcome.operation.rules, steps: outcome.operation.steps,
  }} />;
  const history = !!records.length && <details><summary>Copy history and recovery ({records.length})</summary>
    <Caption1>Stored locally: IDs, fingerprints and outcomes, not credentials or copied settings. No automatic cleanup or creation retry.</Caption1>
    {records.map((record) => <div key={record.id} className={styles.record}>
      <Text weight="semibold">{record.phase} · operation {record.id}</Text>
      {recordedCloneGroupId(record) && <Link href={groupPortalUrl(recordedCloneGroupId(record)!)} target="_blank" rel="noopener noreferrer">Open recorded destination group</Link>}
      <Button disabled={busy} onClick={() => void inspect(record)}>Review existing copy (read only)</Button>
      {plan && intent?.planFingerprint === record.planFingerprint && <Button disabled={busy}
        onClick={() => void reconcile(record)}>Verify against reviewed settings (read only)</Button>}
      {inspections[record.id] && <div className={styles.stack}>
        <Text role="status">{inspections[record.id].message}</Text>
        <ul className={styles.list}>{inspections[record.id].observations.map((entry) => <li key={entry.resource}>
          {entry.resource}: {entry.ok ? entry.detail : `Read failed: ${entry.detail}`}
        </li>)}</ul>
      </div>}
      <details><summary>Operation details</summary>
        <Text>Destination group: {record.destinationId || "No ID recorded"} · independent policy: {record.policyId || "No ID recorded"}</Text>
        {!!record.trialRules?.length && <Text>Sharing/MicrosoftApp trial; source management was not copied. Verify this operation's recorded IDs and exact stored settings before treating it as complete.</Text>}
        {!!record.independentRules?.length && <Text>{INDEPENDENT_RULE_NOTICE} Rules: {record.independentRules.map((rule) => rule.id).join(", ")}.</Text>}
      {!!record.skipped?.length && <ul className={styles.list}>{record.skipped.map((entry) => <li key={`${entry.kind}:${entry.id}`}>
        Skipped {entry.kind === "group-rule" ? "group settings" : entry.id}: {entry.reasons.join(" ")} Governance is incomplete.
      </li>)}</ul>}
      <RawJsonAccordion title="Returned resource IDs and actual step outcomes" data={{ rules: record.rules, steps: record.steps }} />
      <Caption1>Inspection needs only recorded IDs, not the original form. Exact completion verification still requires the original plan; an inspection never marks a copy complete or retries writes.</Caption1>
      </details>
    </div>)}
  </details>;
  return <div className={styles.stack}>
    <Text as="h3" weight="semibold">Duplicate environment group</Text>
    <Text>Copy settings from {sourceName} into a new empty group with its own ACP. No environments are copied; the source stays unchanged.</Text>
    <Field label="New group name"><Input value={name} disabled={busy} onChange={(_, data) => {
      invalidate(); setName(data.value);
    }} /></Field>
    <Field label="Description" hint="Optional. Starts with the source group's description.">
      <Textarea value={description} rows={3} disabled={busy} onChange={(_, data) => {
        descriptionEdited.current = true;
        invalidate(); setDescription(data.value);
      }} />
    </Field>
    <Button disabled={!name.trim() || busy} onClick={() => void review()}>Review copy</Button>
    {busy && <LoadingPane label="Checking group copy..." />}
    {result && !result.ok && <ErrorPane title="Couldn't review this copy" message={result.error} />}
    {storageError && <ErrorPane title="Recovery storage unavailable" message={storageError} />}
    {actionError && <ErrorPane title="Copy action couldn't finish" message={actionError} />}
    {unresolved && <MessageBar intent="warning"><MessageBarBody>{sameIntent
      ? "An incomplete copy already has this destination request. Review its recorded resources instead of creating it again."
      : "An earlier copy is incomplete. You can inspect it or explicitly start a separate new copy; its resources remain recorded."}</MessageBarBody></MessageBar>}
    {plan && <>
      <Text weight="semibold">{sourceName} → {plan.group.displayName}</Text>
      <Caption1>{plan.copied.length} settings · Independent ACP · 0 environments copied</Caption1>
      <Caption1>Independent settings; source-managed updates are not copied.{plan.publication === "applied" ? " Applied settings only; pending admin-center changes aren't copied." : ""}</Caption1>
      {!!plan.trialRules?.length && <Caption1>Managed app sharing is checked after creation. Other configurations may still be rejected by the service.</Caption1>}
      {!!plan.skipped?.length && <>
        <MessageBar intent="warning"><MessageBarBody>Partial copy: {plan.skipped.length} {plan.skipped.length === 1 ? "rule" : "rules"} skipped. Review the list below; governance won't match the source.</MessageBarBody></MessageBar>
        <ul className={styles.list}>{plan.skipped.map((entry) => <li key={`${entry.kind}:${entry.id}`}>
          <Text weight="semibold">{entry.kind === "group-rule" ? "Group settings" : entry.id}</Text>: {entry.reasons.join(" ")}
        </li>)}</ul>
      </>}
      {!!plan.blockers.length && <>
        <MessageBar intent="warning"><MessageBarBody>Copy isn't ready: {plan.blockers[0]} This review hasn't created resources.</MessageBarBody></MessageBar>
      </>}
      {!plan.blockers.length && !sameIntent && !storageError && !outcome && <>
        {needsSeparateConfirmation && <Checkbox checked={separateConfirmed} disabled={busy}
          label="Start a separate new copy, not a retry or continuation. Earlier resources may remain orphaned and still need review."
          onChange={(_, data) => setSeparateConfirmed(data.checked === true)} />}
        <Checkbox checked={confirmed} disabled={busy}
          label={`Create "${plan.group.displayName}" from "${sourceName}" with the reviewed independent settings and a separate ACP.`
            + (plan.skipped?.length ? " I accept the listed skipped rules: governance will be incomplete." : "")}
          onChange={(_, data) => setConfirmed(data.checked === true)} />
        <Caption1>Incomplete writes may need manual recovery. No environments or source changes.</Caption1>
        <Button appearance="primary" disabled={busy || !confirmed || (needsSeparateConfirmation && !separateConfirmed)}
          onClick={() => void execute()}>{plan.skipped?.length ? "Create partial copy" : "Create independent copy"}</Button>
      </>}
    </>}
    {outcome && <>
      <MessageBar intent={outcome.operation.phase === "verified" && outcome.destinationUrl ? "success" : "warning"}><MessageBarBody>{outcome.message}</MessageBarBody></MessageBar>
      {outcome.destinationUrl && <Link href={outcome.destinationUrl} target="_blank" rel="noopener noreferrer">Open verified destination group in admin center</Link>}
    </>}
    {unresolved && history}
    {outcomeNeedsRecovery && <details open><summary>Recovery resource IDs</summary>
      <Text>Retain these IDs. Reconcile recorded resources read-only; do not retry creation or delete resources automatically.</Text>
      {outcomeEvidence}
    </details>}
    <details><summary>Technical details</summary><div className={styles.stack}>
      {plan && <>
        <Caption1>Source group: {plan.sourceId} · Source policy: {plan.sourcePolicyId}</Caption1>
        <Caption1>Read {new Date(plan.preparedAt).toLocaleTimeString()} · Stored source state: {plan.publication}. Source settings are checked again before writes.</Caption1>
        {!!plan.blockers.length && <ul className={styles.list}>{plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
        {!!plan.trialRules?.length && <Text>{GROUP_RULE_TRIAL_NOTICE}</Text>}
        {!!plan.independentRules?.length && <Text>{INDEPENDENT_RULE_NOTICE} Rules: {plan.independentRules.map((rule) => rule.id).join(", ")}.</Text>}
        {!!plan.connectionTypeModes?.omitted && <Caption1>{plan.connectionTypeModes.omitted} of {plan.connectionTypeModes.total} connectors omit the connection-type mode. Fields stay omitted; no default is assumed. Exact read-back is required.</Caption1>}
        <RawJsonAccordion title={`Copied settings (${plan.copied.length})`} data={plan.copied} />
        {!!plan.unsupported?.length && <RawJsonAccordion title="Unmapped fields (exact returned values)" data={plan.unsupported} />}
        {!!plan.skippedEvidence?.length && <RawJsonAccordion title="Skipped rules (exact source configuration)" data={plan.skippedEvidence} />}
        {!!plan.independentRules?.length && <RawJsonAccordion title="Source management attribution (not copied)" data={plan.independentRules} />}
        {!!plan.trialRules?.length && <RawJsonAccordion title="Group-rule trial evidence (source attribution not copied)" data={plan.trialRules} />}
        <Text>{AUTHORIZATION_NOTICE}</Text>
      </>}
      {!outcomeNeedsRecovery && outcomeEvidence}
      {!unresolved && history}
    </div></details>
  </div>;
}
