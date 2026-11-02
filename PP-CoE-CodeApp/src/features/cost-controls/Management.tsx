import { useEffect, useRef, useState } from "react";
import {
  Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Input, Skeleton, SkeletonItem, Text,
} from "@fluentui/react-components";
import type { CreateSpendingPolicy, SpendingPolicyCollection } from "../../generated/models/CostControsl_CustomConnModel";
import { ErrorPane } from "../../components/Status";
import { formatApiError } from "../../shared/api-explorer/schema";
import {
  applyChange, concurrency, createPolicy, listPolicies, loadPolicy, validateChange,
  type PolicyChange, type PolicyContext, type Result,
} from "./data";
import { PolicyDetails } from "./PolicyDetails";
import { PolicyForm } from "./PolicyForms";
import { Diagnostics } from "./Diagnostics";
import { useCostStyles } from "./styles";

type Pending =
  | { kind: "create"; title: string; body: CreateSpendingPolicy }
  | { kind: "change"; title: string; policyId: string; policyName: string; etag: string; change: PolicyChange };

export function Management() {
  const styles = useCostStyles();
  const [policies, setPolicies] = useState<Result<SpendingPolicyCollection> | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [context, setContext] = useState<PolicyContext | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [knownId, setKnownId] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastAction, setLastAction] = useState<{ request: Pending; result: Result<unknown> } | null>(null);
  const detailVersion = useRef(0);
  const mounted = useRef(true);
  const running = useRef(false);
  const refreshing = useRef<Promise<Result<SpendingPolicyCollection>> | null>(null);
  const locked = busy || pending !== null;

  async function refreshList(afterWrite = false) {
    if (refreshing.current) {
      if (!afterWrite) return;
      await refreshing.current;
    }
    const request = listPolicies();
    refreshing.current = request;
    const result = await request;
    if (mounted.current) setPolicies(result);
    if (refreshing.current === request) refreshing.current = null;
  }
  useEffect(() => {
    const version = detailVersion;
    mounted.current = true;
    void refreshList();
    return () => { mounted.current = false; version.current++; };
  }, []);

  async function selectPolicy(id: string) {
    const version = ++detailVersion.current;
    setSelectedId(id);
    setCreating(false);
    setContext(null);
    setLoadingDetail(true);
    const result = await loadPolicy(id);
    if (mounted.current && version === detailVersion.current) { setContext(result); setDetailRevision((value) => value + 1); setLoadingDetail(false); }
  }

  function review(change: PolicyChange, title: string) {
    try {
      if (!context) throw new Error("Read policy details before making a change.");
      const token = concurrency(context);
      if (!token.etag) throw new Error(token.blocked ?? "No parent ETag available.");
      validateChange(change, context);
      setError("");
      setConfirmation("");
      setPending({
        kind: "change", title, policyId: context.id, policyName: context.policy.ok ? context.policy.data.displayName ?? context.id : context.id,
        etag: token.etag, change,
      });
    } catch (cause) { setError(formatApiError(cause)); }
  }

  async function confirm() {
    if (!pending || confirmation !== pending.title || running.current) return;
    const snapshot = pending;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setPending(null);
    try {
      const result = snapshot.kind === "create"
        ? await createPolicy(snapshot.body, true)
        : await applyChange(snapshot.policyId, snapshot.etag, snapshot.change, true);
      if (!mounted.current) return;
      setLastAction({ request: snapshot, result });
      if (!result.ok) setError(`${result.error} Refresh the policy and review before trying again; failed or timed-out writes are not retried automatically.`);
      else {
        setNotice(snapshot.kind === "create"
          ? "Policy creation completed. The SDK does not expose a typed creation body. Refresh the list or open the known policy ID to inspect provisioning; a new selected-group policy still needs an audience."
          : `${snapshot.title} completed. Current policy data has been refreshed.`);
        if (snapshot.kind === "create") setCreating(false);
      }
      await refreshList(true);
      if (snapshot.kind === "change") {
        if (result.ok && snapshot.change.kind === "deletePolicy") { setSelectedId(""); setContext(null); }
        else await selectPolicy(snapshot.policyId);
      }
    } catch (cause) {
      if (mounted.current) setError(formatApiError(cause));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const rows = policies?.ok ? policies.data.value ?? [] : [];
  const filtered = rows.filter((policy) => `${policy.displayName} ${policy.id} ${policy.status}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className={styles.root}>
    <div className={styles.spread}>
      <div><Text as="h2" size={500} weight="semibold">Spending policy management</Text>
        <Text as="p" className={styles.muted}>Choose a policy to manage its limits, audience, services and notifications. No changes happen until you review and confirm.</Text></div>
      <div className={styles.row}>
        <Button disabled={locked || loadingDetail} onClick={() => { void refreshList(); if (selectedId) void selectPolicy(selectedId); }}>Refresh policies</Button>
        <Button appearance="primary" disabled={locked} onClick={() => { detailVersion.current++; setCreating(true); setSelectedId(""); setContext(null); setLoadingDetail(false); setError(""); }}>Create policy</Button>
      </div>
    </div>
    {error && <ErrorPane title="Policy action needs attention" message={error} />}
    {notice && <Text role="status" className={styles.success}>{notice}</Text>}
    {lastAction && <Diagnostics label="Inspect submitted change and SDK response" data={lastAction} />}
    {busy && <Skeleton aria-label="Applying and refreshing policy change"><SkeletonItem size={32} /></Skeleton>}
    <div className={styles.management}>
      <aside className={styles.panel} aria-label="Policy selection">
        <Text weight="semibold">Available policies</Text>
        <Field label="Find a loaded policy"><Input value={filter} disabled={locked} onChange={(_, data) => setFilter(data.value)} /></Field>
        {!policies && <Skeleton aria-label="Loading policies"><SkeletonItem size={64} /></Skeleton>}
        {policies && !policies.ok && <ErrorPane title="Policy list unavailable" message={policies.error} />}
        {policies?.ok && !rows.length && <Text>No policies were returned. Create a policy to establish limits; this is not a consumption total.</Text>}
        {rows.length > 0 && !filtered.length && <Text>No loaded policies match. Clear your search or open a known ID below.</Text>}
        <div className={styles.list}>{filtered.map((policy, index) => <Button key={policy.id ?? `unidentified:${index}`}
          className={styles.policyButton} appearance={policy.id === selectedId ? "primary" : "subtle"}
          disabled={locked || !policy.id} aria-pressed={policy.id === selectedId}
          onClick={() => void selectPolicy(policy.id!)}>
          {policy.displayName ?? policy.id ?? "Policy ID not reported"} ({policy.status ?? "unknown"})
        </Button>)}</div>
        {policies?.ok && policies.data["@odata.nextLink"] && <Text className={styles.warning}>
          More policies exist. This is the returned page, not the complete tenant inventory. The connector has no continuation action; open a known policy ID below.
        </Text>}
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (knownId.trim()) void selectPolicy(knownId.trim()); }}>
          <Field label="Open a known policy ID"><Input value={knownId} disabled={locked} onChange={(_, data) => setKnownId(data.value)} /></Field>
          <Button type="submit" disabled={locked || !knownId.trim()}>Open policy</Button>
        </form>
      </aside>
      <div className={styles.root}>
        {creating ? <section className={styles.panel} aria-label="New policy">
          <PolicyForm locked={locked} onCancel={() => setCreating(false)} onReview={(body) => {
            if (!("@odata.type" in body)) { setError("New policies need a concrete audience type."); return; }
            setPending({ kind: "create", title: "Create spending policy", body });
            setConfirmation("");
          }} />
        </section> : loadingDetail ? <Skeleton aria-label="Loading policy details"><SkeletonItem size={32} /><SkeletonItem size={128} /></Skeleton>
          : context ? <PolicyDetails key={`${context.id}:${detailRevision}`} context={context} locked={locked} onReview={review} />
            : <section className={styles.panel}><Text as="h3" size={500} weight="semibold">Choose what to govern</Text>
              <Text>Select a spending policy or create one. Each policy groups a monthly credit limit, an audience, governed services and optional email alerts.</Text>
              <Text className={styles.muted}>Policy creation requires additional billing privileges. Other writes need the relevant delegated Graph permission, a qualifying runtime role and a current parent ETag.</Text>
            </section>}
      </div>
    </div>
    <Dialog open={pending !== null} onOpenChange={(_, data) => { if (!data.open && !busy) setPending(null); }}>
      <DialogSurface><DialogBody>
        <DialogTitle>{pending?.title ?? "Review policy change"}</DialogTitle>
        <DialogContent><div className={styles.form}>
          <Text>This is a real tenant change. Check the target and values; there is no automatic undo or retry.</Text>
          {pending?.kind === "change" ? <>
            <Text weight="semibold">{pending.policyName}</Text><Text>Policy ID: {pending.policyId}</Text>
            <Badge>Current parent ETag will be rechecked</Badge>
          </> : <Text>New policy: {pending?.body.displayName}. The service creates it disabled.</Text>}
          <pre className={styles.code}>{JSON.stringify(pending?.kind === "create" ? pending.body : pending?.change, null, 2)}</pre>
          <Field label={`Type ${pending?.title ?? ""} to confirm`}>
            <Input value={confirmation} autoComplete="off" onChange={(_, data) => setConfirmation(data.value)} />
          </Field>
        </div></DialogContent>
        <DialogActions><Button onClick={() => setPending(null)}>Cancel</Button>
          <Button appearance="primary" disabled={!pending || confirmation !== pending.title || busy} onClick={() => void confirm()}>Confirm change</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </div>;
}
