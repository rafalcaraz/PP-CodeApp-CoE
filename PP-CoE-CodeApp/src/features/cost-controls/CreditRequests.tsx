import { useEffect, useRef, useState } from "react";
import {
  Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Input, Select, Text, mergeClasses,
} from "@fluentui/react-components";
import type { CreditRequest, CreditRequestCollection, CreditRequestUpdateResponse } from "../../generated/models/CostControsl_CustomConnModel";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { formatApiError } from "../../shared/api-explorer/schema";
import { reviewDecision, type RequestDecision, type ReviewedDecision } from "../../shared/cost-controls/wave2";
import { decideRequests, getRequest, listRequests } from "./requestData";
import { Diagnostics } from "./Diagnostics";
import { numberText } from "./domain";
import { useCostRead } from "./useCostRead";
import { useCostStyles } from "./styles";
import type { Result } from "./data";

interface Review { items: ReviewedDecision[]; details: CreditRequest[]; state: RequestDecision }

export function CreditRequests() {
  const styles = useCostStyles();
  const read = useCostRead<CreditRequestCollection>();
  const { load } = read;
  const [state, setState] = useState("pending");
  const [serviceId, setServiceId] = useState("");
  const [knownId, setKnownId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Review | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [phase, setPhase] = useState<"review" | "write" | null>(null);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ review: Review; result: Result<CreditRequestUpdateResponse> }>();
  const running = useRef(false);
  const mounted = useRef(true);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refreshTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreReviewFocus = useRef(false);
  const busy = phase !== null;
  const locked = busy || read.busy || pending !== null;
  useEffect(() => {
    mounted.current = true;
    void load("MAC requests · state pending · all services", () => listRequests());
    return () => { mounted.current = false; };
  }, [load]);
  useEffect(() => {
    if (pending) restoreReviewFocus.current = true;
    else if (!busy && restoreReviewFocus.current) {
      restoreReviewFocus.current = false;
      (trigger.current?.disabled ? refreshTrigger.current : trigger.current)?.focus();
    }
  }, [pending, busy]);

  function refresh() {
    setSelected([]);
    void load(`MAC requests · state ${state || "all"} · ${serviceId.trim() || "all services"}`, () => listRequests(state, serviceId));
  }
  async function review(decision: RequestDecision, button: HTMLButtonElement) {
    if (running.current || !selected.length) return;
    trigger.current = button;
    running.current = true;
    setPhase("review");
    setError("");
    try {
      const results = await Promise.all(selected.map((id) => getRequest(id)));
      const details = results.map((result) => {
        if (!result.ok) throw new Error(result.error);
        return result.data;
      });
      const items = details.map((request) => reviewDecision(request, decision));
      if (mounted.current) { setConfirmation(""); setPending({ items, details, state: decision }); }
    } catch (cause) { if (mounted.current) setError(formatApiError(cause)); }
    finally { running.current = false; if (mounted.current) setPhase(null); }
  }
  async function confirm() {
    if (!pending || confirmation !== pending.state || running.current) return;
    const snapshot = pending;
    running.current = true;
    setPhase("write");
    setPending(null);
    setError("");
    try {
      const result = await decideRequests(snapshot.items, true);
      if (!mounted.current) return;
      setOutcome({ review: snapshot, result });
      if (!result.ok) setError(`${result.error} Decisions may be ambiguous after a timeout. Reread affected IDs and review again; no automatic retry runs.`);
      else setSelected(result.data.responses?.filter((item) => item.status !== "succeeded").flatMap((item) => item.requestId ? [item.requestId] : []) ?? []);
      await load(`MAC requests · state ${state || "all"} · ${serviceId.trim() || "all services"}`, () => listRequests(state, serviceId));
    } finally { running.current = false; if (mounted.current) setPhase(null); }
  }
  const rows = read.response?.data.value ?? [];
  return <section className={styles.panel} aria-labelledby="requests-title">
    <Text as="h2" id="requests-title" size={500} weight="semibold">Credit requests</Text>
    <Text>Review access requests, not credit allocations. Approval records a decision; it does not assign a credit amount or change a spending policy.</Text>
    <Text size={200} className={styles.muted}>Global cloud only. Reads need CreditReq.Read.All or CreditReq.ReadWrite.All. Decisions need CreditReq.ReadWrite.All and Global, Billing or AI Administrator. Refreshing the SDK alone does not grant consent or roles.</Text>
    <form className={styles.row} onSubmit={(event) => { event.preventDefault(); refresh(); }}>
      <Field label="Request state"><Select value={state} disabled={locked} onChange={(_, data) => setState(data.value)}>
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="">All returned states</option>
      </Select></Field>
      <Field label="Request service ID" hint="Optional service category, not an agent ID."><Input value={serviceId} disabled={locked} onChange={(_, data) => setServiceId(data.value)} /></Field>
      <Button ref={refreshTrigger} type="submit" disabled={locked}>Load requests</Button>
    </form>
    <form className={styles.row} onSubmit={(event) => {
      event.preventDefault();
      setSelected([]);
      void load(`MAC request · ${knownId.trim()}`, async () => {
        const result = await getRequest(knownId);
        return result.ok ? { ok: true, data: { value: [result.data] }, raw: result.raw } : result;
      });
    }}>
      <Field label="Known credit request ID" hint="Audit-only records may be readable by ID even when excluded from the list."><Input value={knownId} disabled={locked} onChange={(_, data) => setKnownId(data.value)} /></Field>
      <Button type="submit" disabled={locked || !knownId.trim()}>Open request</Button>
    </form>
    {read.busy && <LoadingPane label="Loading credit requests..." />}
    {busy && <LoadingPane label={phase === "review" ? "Reading requests for review; nothing is being written..." : "Rechecking request ETags and recording confirmed decisions..."} />}
    {read.error && <ErrorPane title="Credit requests unavailable" message={`${read.error} Check credit-request consent, runtime roles and rollout. This is not an empty queue.`} />}
    {error && <ErrorPane title="Credit request action needs attention" message={error} />}
    {read.response && <>
      <Text weight="semibold" role="status">{read.response.label}</Text>
      {read.error && <Text className={styles.warning}>Refresh failed; showing the previous successful request selection.</Text>}
      <Text>{rows.length} loaded requests; server count: {numberText(read.response.data["@odata.count"])}. Audit-only records are excluded from collection counts.</Text>
      {read.response.data["@odata.nextLink"] && <Text className={styles.warning}>Partial queue: more requests exist. No supported nextLink replay is available in this SDK. Open a known ID; do not treat loaded rows as the complete queue.</Text>}
      {!rows.length ? <Text>No requests were returned for this selection. This does not establish that the tenant has no requests.</Text> : <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Credit request table scroll area"><table className={mergeClasses(styles.table, styles.wideTable)}>
        <caption>Loaded credit requests — select pending rows to review</caption>
        <thead><tr><th>Select</th><th>Request ID / requester</th><th>Service</th><th>Type</th><th>State</th><th>Requested UTC</th><th>Expires UTC</th></tr></thead>
        <tbody>{rows.map((request, i) => <tr key={`${request.id}:${i}`}>
          <td><Checkbox aria-label={`Select request ${request.id ?? i}`} disabled={locked || !request.id || request.state !== "pending" || (!selected.includes(request.id) && selected.length >= 100)}
            checked={!!request.id && selected.includes(request.id)} onChange={(_, data) => { const id = request.id; if (id) setSelected((value) => data.checked ? [...new Set([...value, id])] : value.filter((item) => item !== id)); }} /></td>
          <td>{request.id ?? "Not reported"}<br />{request.requestedBy?.user?.displayName ?? request.requestedBy?.user?.id ?? "Requester not reported"}</td>
          <td>{request.serviceId ?? "Not reported"}</td><td>{request.requestType ?? "Not reported"}</td><td>{request.state ?? "Not reported"}</td>
          <td>{request.createdDateTime ?? "Not reported"}</td><td>{request.expirationDateTime ?? "Not reported"}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
    <div className={styles.row}>
      <Text>{selected.length} selected (maximum 100)</Text>
      <Button disabled={locked || !selected.length} onClick={() => setSelected([])}>Clear selection</Button>
      <Button appearance="primary" disabled={locked || !selected.length} onClick={(event) => void review("approved", event.currentTarget)}>Review approval</Button>
      <Button disabled={locked || !selected.length} onClick={(event) => void review("rejected", event.currentTarget)}>Review rejection</Button>
    </div>
    {outcome && <>
      {outcome.result.ok && <div className={outcome.result.data.failedCount ? styles.warning : styles.success} role="status">
        {outcome.result.data.failedCount ? "Partial or failed batch" : "Decisions recorded"}: {outcome.result.data.succeededCount} succeeded, {outcome.result.data.failedCount} failed. Approval does not allocate credits. Failed items require a fresh read and review.
      </div>}
      {outcome.result.ok && <div className={styles.tableWrap}><table className={styles.table}>
        <caption>Results of the last reviewed batch — not atomic</caption>
        <thead><tr><th>Request ID</th><th>Result</th><th>Explanation</th></tr></thead>
        <tbody>{outcome.result.data.responses?.map((row, i) => <tr key={`${row.requestId}:${i}`}><td>{row.requestId}</td><td>{row.status}</td><td>{row.message ?? (row.status === "succeeded" ? "Decision recorded" : "Reread and review before retrying")}</td></tr>)}</tbody>
      </table></div>}
      <Diagnostics label="Inspect reviewed credit decisions and SDK result" data={outcome} />
    </>}
    {read.attempt && <Diagnostics label="Inspect credit request SDK response" data={read.attempt} />}
    <Dialog open={pending !== null} onOpenChange={(_, data) => { if (!data.open && !busy) setPending(null); }}>
      <DialogSurface><DialogBody><DialogTitle>Review credit request decisions</DialogTitle>
        <DialogContent><div className={styles.form}>
          <Text>This records {pending?.state} for {pending?.items.length} requests. It does not allocate credits. Request states and strong ETags will be checked again before the write.</Text>
          <ul>{pending?.details.map((request) => <li key={request.id}>{request.id} · {request.requestedBy?.user?.displayName ?? request.requestedBy?.user?.id ?? "Requester not reported"} · {request.serviceId ?? "Service not reported"} · pending → {pending.state}</li>)}</ul>
          <Text className={styles.warning}>Batch decisions are non-atomic. Some can succeed while others fail; the full batch is never retried automatically.</Text>
          <Field label={`Type ${pending?.state ?? ""} to confirm decisions`}><Input value={confirmation} autoComplete="off" onChange={(_, data) => setConfirmation(data.value)} /></Field>
        </div></DialogContent>
        <DialogActions><Button onClick={() => setPending(null)}>Cancel</Button><Button appearance="primary" disabled={!pending || confirmation !== pending.state || busy} onClick={() => void confirm()}>Confirm decisions</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </section>;
}
