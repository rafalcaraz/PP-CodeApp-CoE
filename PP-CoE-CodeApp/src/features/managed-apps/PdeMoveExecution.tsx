import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Checkbox, Caption1, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import { ErrorPane } from "../../components/Status";
import { MOVE_NOTICE, pdeMoveStore, checkPreviousPdeMoves } from "./pdeMoveData";
import { liveMoveTask } from "./liveMoveTask";
import { moveBlockers, moveCanResume, moveEntryUnresolved, moveOutcomeLabel, PreviousMoveNeedsCheck, type MoveOutcome, type MoveRecord } from "./pdeMoves";
import type { MovePreview } from "./governance";

export function PdeMoveExecution({ preview, selectedEnvironmentIds = [], statusOnly = false, environmentNames = {}, groupNames = {}, onBusyChange, onStatusChecked, onReviewRecovery }: {
  preview: MovePreview | null; onBusyChange: (busy: boolean) => void;
  statusOnly?: boolean;
  selectedEnvironmentIds?: string[];
  environmentNames?: Record<string, string>; groupNames?: Record<string, string>;
  onStatusChecked?: (outcomes: MoveOutcome[]) => void;
  onReviewRecovery?: (environmentIds: string[], destinationId: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const task = useSyncExternalStore(liveMoveTask.subscribe, liveMoveTask.getSnapshot);
  const mounted = useRef(false);
  const checkController = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; checkController.current?.abort(); }; }, []);
  const [initial] = useState(() => {
    try { return { records: pdeMoveStore.list(), error: "" }; }
    catch (failure) { return { records: [] as MoveRecord[], error: String(failure) }; }
  });
  const [records, setRecords] = useState<MoveRecord[]>(initial.records);
  const [error, setError] = useState(initial.error);
  const [outcome, setOutcome] = useState<MoveOutcome | null>(null);
  const [checked, setChecked] = useState(false);
  const [checkResults, setCheckResults] = useState<MoveOutcome[]>([]);
  const blockers = preview ? moveBlockers(preview) : ["Read a fresh impact preview."];
  const scopeIds = preview?.pdes.map((pde) => pde.environmentId) ?? selectedEnvironmentIds;
  const inScope = (id: string) => statusOnly || scopeIds.some((selected) => selected.trim().toLowerCase() === id.trim().toLowerCase());
  const unresolved = records.flatMap((record) => record.pdes.filter((entry) => inScope(entry.environmentId)
    && moveEntryUnresolved(record, entry, records)).map((entry) => ({ record, entry })));
  const recoverable = unresolved.filter(({ entry }) => moveCanResume(entry));
  const pending = unresolved.some(({ entry }) => !moveCanResume(entry));
  const canRecover = recoverable.length > 0 && !pending && !!preview && recoverable.every(({ entry }) =>
    preview.pdes.some((pde) => pde.environmentId.toLowerCase() === entry.environmentId.toLowerCase() && pde.environment?.environmentGroupId === ""));
  const needsFreshPreview = checked && !canRecover;
  async function checkPrevious(signal?: AbortSignal, automatic = false) {
    if (busy || liveMoveTask.getSnapshot()?.running) return;
    const controller = new AbortController();
    checkController.current = controller;
    const activeSignal = signal ?? controller.signal;
    setBusy(true); if (!automatic) onBusyChange(true); setError("");
    try {
      const results = await checkPreviousPdeMoves(statusOnly ? [] : scopeIds, activeSignal);
      if (activeSignal.aborted || !mounted.current) return;
      setRecords(pdeMoveStore.list()); setConfirmed(false);
      setChecked(true); setCheckResults(results);
      onStatusChecked?.(results);
    } catch (failure) { if (!activeSignal.aborted && mounted.current) setError(String(failure)); }
    finally { if (!activeSignal.aborted && mounted.current) { setBusy(false); if (!automatic) onBusyChange(false); } }
  }
  const checkOnOpen = useRef({ pending: unresolved.length > 0, checkPrevious });
  useEffect(() => {
    if (!checkOnOpen.current.pending) return;
    const controller = new AbortController();
    // Defer one microtask so React StrictMode's discarded mount never starts a read.
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return checkOnOpen.current.checkPrevious(controller.signal, true);
    });
    return () => controller.abort();
  }, []);
  async function run() {
    if (busy || !preview || liveMoveTask.getSnapshot()?.running) return;
    setError("");
    try {
      const next = await liveMoveTask.start(preview, confirmed, canRecover ? [...new Set(recoverable.map(({ record }) => record.id))] : []);
      if (mounted.current) { setOutcome(next); setRecords(pdeMoveStore.list()); }
    } catch (failure) {
      if (mounted.current) {
        setError(String(failure));
        if (failure instanceof PreviousMoveNeedsCheck) setRecords(pdeMoveStore.list());
      }
    } finally { if (mounted.current) setConfirmed(false); }
  }
  const environmentName = (id: string) => preview?.pdes.find((pde) => pde.environmentId.toLowerCase() === id.toLowerCase())?.environment?.displayName || environmentNames[id.toLowerCase()] || id;
  const destinationName = preview?.destination.displayName || (preview ? groupNames[preview.destination.id.toLowerCase()] || preview.destination.id : "");
  const moveLabel = canRecover ? `Move to ${destinationName}` : preview?.pdes.length === 1 ? "Move PDE" : `Move ${preview?.pdes.length ?? 0} PDEs`;
  const retainedOutcome = outcome ?? task?.outcome;
  const currentProblems = [
    ...(retainedOutcome?.record.pdes.some((entry) => inScope(entry.environmentId) && moveEntryUnresolved(retainedOutcome.record, entry, records))
      ? retainedOutcome.messages.filter((message) => retainedOutcome.record.pdes.some((entry) => inScope(entry.environmentId) && message.startsWith(`${entry.environmentId}:`))) : []),
    ...checkResults.flatMap((result) => result.record.pdes.some((entry) => inScope(entry.environmentId) && moveEntryUnresolved(result.record, entry, records)) ? result.messages.filter((message) =>
      result.record.pdes.some((entry) => inScope(entry.environmentId) && moveEntryUnresolved(result.record, entry, records) && message.startsWith(`${entry.environmentId}:`))) : []),
  ];
  if (task?.running) return <section><Text>Moving and checking status. You can continue in background below.</Text></section>;
  return <section>
    {preview && <Text>{MOVE_NOTICE}</Text>}
    {checked && !pending && !recoverable.length && <MessageBar intent="success"><MessageBarBody>
      {statusOnly ? "No moves need checking. Close this window and select the PDEs for your next move." : "Status checked. Refresh the impact preview to continue."}
    </MessageBarBody></MessageBar>}
    {pending && <MessageBar intent="warning"><MessageBarBody>
      {busy ? "Checking move status automatically..." : checked ? "The move is not yet verified. No move was retried." : "Checking the previous move before another move."}
      {checkResults.flatMap((result) => result.record.pdes.filter((entry) => inScope(entry.environmentId) && moveEntryUnresolved(result.record, entry, records)).map((entry) => <p key={`${result.record.id}:${entry.environmentId}`}>
        {environmentName(entry.environmentId)}: {moveOutcomeLabel(result, entry)}.
      </p>))}
      <Button disabled={busy} onClick={() => void checkPrevious()}>{busy ? "Checking status..." : "Check move status"}</Button>
      <Caption1>Read only. Does not move, retry or restore a PDE.</Caption1>
    </MessageBarBody></MessageBar>}
    {!!recoverable.length && !pending && <MessageBar intent="warning"><MessageBarBody>
      {recoverable.map(({ record, entry }) => <p key={`${record.id}:${entry.environmentId}`}>{environmentName(entry.environmentId)}: the previous removal completed; {entry.add === "none" ? "no add was requested" : "the add was rejected"}. The PDE is outside any group.</p>)}
      {preview ? "Confirm below to add it to the selected group. No removal will be repeated." : "Review impact for your destination, then confirm the add-only recovery."}
      {statusOnly && onReviewRecovery && <Button disabled={busy} onClick={() => onReviewRecovery(
        [...new Set(recoverable.filter(({ record }) => record.destinationId === recoverable[0].record.destinationId).map(({ entry }) => entry.environmentId))],
        recoverable[0].record.destinationId,
      )}>Review add-only recovery</Button>}
    </MessageBarBody></MessageBar>}
    {statusOnly && !unresolved.length && !checked && <Text>No moves need checking.</Text>}
    {preview && !!blockers.length && <ErrorPane title="Move execution blocked" message={blockers.join(" ")} />}
    {preview && <><Checkbox checked={confirmed} disabled={busy || needsFreshPreview || pending || (recoverable.length > 0 && !canRecover) || !!blockers.length || !!outcome}
      onChange={(_, data) => setConfirmed(data.checked === true)}
      label={`${canRecover ? "Continue the previous move: add" : "Move"} ${preview.pdes.map((pde) => environmentName(pde.environmentId)).join(", ")}, including all apps and resources, to ${destinationName}.`} />
    <Button appearance="primary" disabled={busy || needsFreshPreview || pending || (recoverable.length > 0 && !canRecover) || !confirmed || !!blockers.length || !!error || !!outcome} onClick={() => void run()}>
      {busy ? "Moving and checking status..." : moveLabel}
    </Button></>}
    {error && <MessageBar intent="error"><MessageBarBody>Could not complete the move or status check. No automatic retry was made. See technical details.</MessageBarBody></MessageBar>}
    {outcome && <div role="status"><Text weight="semibold">This move</Text>
      <ul>{outcome.record.pdes.map((entry) => <li key={entry.environmentId}>
        {environmentName(entry.environmentId)}: {moveOutcomeLabel(outcome, entry)}.
      </li>)}</ul>
    </div>}
    {(error || currentProblems.length > 0 || recoverable.length > 0) && <details><summary>Move error details</summary>
      {error && <Text>{error}</Text>}
      {currentProblems.map((message, index) => <p key={index}>{message}</p>)}
      {recoverable.length > 0 && !currentProblems.some((message) => message.includes("Phase:")) && <Text>The original stop reason is not available in this session. The saved request flags and fresh membership reads support add-only recovery, but do not identify which check stopped the original move.</Text>}
    </details>}
  </section>;
}
