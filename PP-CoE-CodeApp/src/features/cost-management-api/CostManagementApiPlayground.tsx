import { useMemo, useRef, useState } from "react";
import {
  Badge, Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Field, Input, Link, Select, Text, Title2, makeStyles, mergeClasses, tokens,
} from "@fluentui/react-components";
import { ArrowReplyRegular, CodeRegular, PlayRegular, SearchRegular } from "@fluentui/react-icons";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { SchemaField } from "../../shared/api-explorer/SchemaField";
import { ResponseViewer } from "../../shared/api-explorer/ResponseViewer";
import { usePlaygroundStyles } from "../../shared/api-explorer/playgroundStyles";
import { formatApiError } from "../../shared/api-explorer/schema";
import {
  costActions, initialInputs, parameterSchema, parseInputs, requestPreview, schemaTools, type CostRequest,
} from "./catalog";
import { executeCostRequest, unsupportedReason, type CostResult } from "./data";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, minWidth: 0 },
  header: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  muted: { color: tokens.colorNeutralForeground2 },
  filters: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: tokens.spacingHorizontalM },
  search: { flex: "1 1 260px" },
  filter: { flex: "1 1 220px", minWidth: 0 },
  selector: { flex: "1 1 100%", minWidth: 0 },
  select: { width: "100%", minWidth: 0, "& select": { minWidth: 0, textOverflow: "ellipsis" } },
  workspace: {
    display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: tokens.spacingHorizontalXXL,
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  column: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, minWidth: 0 },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: tokens.spacingHorizontalS },
  code: {
    fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0,
    padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium, maxHeight: "560px", overflow: "auto",
  },
  warning: {
    padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorStatusWarningBackground1,
    color: tokens.colorStatusWarningForeground1, borderRadius: tokens.borderRadiusMedium,
  },
  empty: { paddingBlock: tokens.spacingVerticalXXL, color: tokens.colorNeutralForeground2 },
});

interface Snapshot {
  request: CostRequest;
  preview: ReturnType<typeof requestPreview>;
}

interface LastRun extends Snapshot {
  result: CostResult;
  elapsedMs: number;
}

const defaultAction = (() => {
  const action = costActions.find((entry) => entry.id === "GetTenantCreditBalance");
  if (!action) throw new Error("The Cost Management connector must include GetTenantCreditBalance.");
  return action;
})();

export function CostManagementApiPlayground() {
  const styles = useStyles();
  const explorer = usePlaygroundStyles();
  const [actionId, setActionId] = useState(defaultAction.id);
  const [inputs, setInputs] = useState(() => initialInputs(defaultAction));
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [readOnlyOnly, setReadOnlyOnly] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [pending, setPending] = useState<Snapshot | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const locked = busy || pending !== null;
  const groups = useMemo(() => [...new Set(costActions.map((entry) => entry.group))].sort(), []);
  const matches = useMemo(() => costActions.filter((entry) =>
    (!group || entry.group === group) && (!readOnlyOnly || entry.readOnly) &&
    `${entry.id} ${entry.title} ${entry.group} ${entry.method} ${entry.path} ${entry.description}`.toLowerCase().includes(search.toLowerCase()),
  ), [group, search, readOnlyOnly]);
  const action = matches.find((entry) => entry.id === actionId);
  const blocked = action ? unsupportedReason(action.id) : undefined;
  const preview = useMemo(() => {
    if (!action) return {};
    try {
      return { request: requestPreview(action, parseInputs(action, inputs)) };
    } catch (cause) {
      return { error: formatApiError(cause) };
    }
  }, [action, inputs]);

  function chooseAction(id: string) {
    const next = costActions.find((entry) => entry.id === id);
    if (!next) return;
    setActionId(next.id);
    setInputs(initialInputs(next));
    setError("");
  }

  async function run(snapshot: Snapshot, confirmedWrite = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const started = performance.now();
    try {
      const result = await executeCostRequest(snapshot.request, confirmedWrite);
      setLastRun({ ...snapshot, result, elapsedMs: Math.round(performance.now() - started) });
    } catch (cause) {
      setLastRun({ ...snapshot, result: { ok: false, error: formatApiError(cause) }, elapsedMs: Math.round(performance.now() - started) });
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  function submit() {
    if (!action || blocked || running.current) return;
    try {
      const parameters = parseInputs(action, inputs);
      const snapshot: Snapshot = {
        request: { actionId: action.id, parameters },
        preview: requestPreview(action, parameters),
      };
      setError("");
      if (action.readOnly) void run(snapshot);
      else {
        setConfirmation("");
        setPending(snapshot);
      }
    } catch (cause) {
      setError(formatApiError(cause));
    }
  }

  return (
    <div className={styles.root}>
      <header className={mergeClasses(styles.header, explorer.header)}>
        <div className={styles.row}>
          <Title2 as="h1">Cost Management API playground</Title2>
          <Badge color="warning">Beta</Badge>
        </div>
        <Text className={styles.muted}>
          {costActions.length} connector actions. Runs directly through your registered custom connector and its generated service,
          using your connection and permissions. No passthrough flow. Nothing runs automatically.
        </Text>
        <Text size={200} className={styles.muted}>
          Credit balances, historical usage, credit requests and policy governance — not currency costs or per-agent attribution.{" "}
          <Link href="https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/overview"
            target="_blank" rel="noopener noreferrer">Microsoft Learn reference</Link>
        </Text>
        <Text className={styles.warning}>
          Microsoft Graph beta is not supported for production. List actions return one page only:
          inspect @odata.nextLink; no automatic continuation, polling or retry is performed.
        </Text>
      </header>
      <div className={mergeClasses(styles.filters, explorer.filters)}>
        <Field label="Action category" className={styles.filter}>
          <Select className={styles.select} value={group} disabled={locked} onChange={(_, data) => { setGroup(data.value); setError(""); }}>
            <option value="">All categories</option>
            {groups.map((name) => <option key={name}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Find a Cost Management action" className={styles.search}>
          <Input contentBefore={<SearchRegular />} value={search} disabled={locked} placeholder="Search names, routes, or descriptions"
            onChange={(_, data) => { setSearch(data.value); setError(""); }} />
        </Field>
        <Checkbox label="Read-only actions only" checked={readOnlyOnly} disabled={locked}
          onChange={(_, data) => { setReadOnlyOnly(data.checked === true); setError(""); }} />
        <Button appearance="subtle" disabled={locked || (!search && !group && !readOnlyOnly)}
          onClick={() => { setSearch(""); setGroup(""); setReadOnlyOnly(false); setError(""); }}>Clear filters</Button>
        <Field label={`Action (${matches.length} matching)`} className={styles.selector}>
          <Select className={styles.select} value={action?.id ?? ""} disabled={locked} onChange={(_, data) => chooseAction(data.value)}>
            <option value="">{matches.length ? "Select an action" : "No matching actions"}</option>
            {matches.map((entry) => <option key={entry.id} value={entry.id}>{entry.group} / {entry.method} {entry.title} - {entry.id}</option>)}
          </Select>
        </Field>
      </div>
      <div className={styles.workspace}>
        <section className={mergeClasses(styles.column, explorer.panel)} aria-label="Cost Management request">
          <div className={explorer.panelHeading}>
            <CodeRegular /><Text as="h2" size={500} weight="semibold">Request</Text>
          </div>
          {action ? <>
            <div className={styles.row}>
              <Text as="h3" size={500} weight="semibold">{action.title}</Text>
              <Badge color={action.readOnly ? "informative" : "warning"}>{action.readOnly ? "Read-only" : "Write-capable"}</Badge>
            </div>
            <Text>{action.description}</Text>
            {action.docUrl && <Link href={action.docUrl} target="_blank" rel="noopener noreferrer">Operation documentation</Link>}
            <div className={explorer.endpoint}>
              <Badge appearance="tint" color={action.readOnly ? "informative" : "warning"}>{action.method}</Badge>
              <code>{action.path}</code>
            </div>
            {!action.readOnly && <Text className={styles.warning}>
              {action.id.includes("CreditRequest")
                ? "This records access decisions, not credit allocations. Each request requires its own current strong ETag; policy ETags are not interchangeable. Batch HTTP 200 can contain per-item failures. Never replay a partial batch."
                : "This request can change policies, audiences, alerting or service availability. Existing-policy changes require a fresh parent ETag, including child and reference edits."}
              {" "}Review every input before confirming. No automatic undo or retry.
            </Text>}
            {["CreateSpendingPolicy", "CreateServiceSetting"].includes(action.id) && <Text className={styles.warning}>
              The generated service types this creation response as void. Any runtime data exposed by the SDK is shown unchanged;
              a response body or ETag header is not guaranteed by this SDK contract.
            </Text>}
            {blocked && <ErrorPane title="Connector action unavailable" message={blocked} />}
            <Text weight="semibold">Parameters</Text>
            <div className={explorer.fields}>
              {action.parameters.map((parameter) => (
                <div key={`${action.id}:${parameter.name}`} className={parameter.in === "body" ? explorer.body : undefined}>
                  <SchemaField label={`${parameter.name} (${parameter.in})`} required={parameter.required}
                    hint={parameter.description} schema={parameterSchema(parameter)} tools={schemaTools}
                    json={parameter.in === "body"} includeOptional={parameter.in === "body" && action.method === "PATCH"}
                    value={inputs[parameter.name] ?? ""} disabled={locked}
                    onChange={(value) => { setInputs((previous) => ({ ...previous, [parameter.name]: value })); setError(""); }} />
                </div>
              ))}
              {!action.parameters.length && <Text>This action has no inputs.</Text>}
            </div>
            <details className={explorer.details} open={Boolean(preview.request)}>
              <summary>Exact connector request preview</summary>
              <Text size={200} className={styles.muted}>
                Graph request values passed to the generated service. Authorization and connection routing are supplied by Power Apps, not this page.
              </Text>
              {preview.request ? <pre className={styles.code}>{JSON.stringify(preview.request, null, 2)}</pre> : <Text>{preview.error}</Text>}
            </details>
            {error && <ErrorPane title="Check the request" message={error} />}
            <div className={mergeClasses(styles.row, explorer.actions)}>
              <Button appearance="primary" icon={<PlayRegular />} disabled={locked || Boolean(blocked)} onClick={submit}>
                {action.readOnly ? "Run action" : "Review and run"}
              </Button>
              <Button disabled={locked} onClick={() => { setInputs(initialInputs(action)); setError(""); }}>Reset inputs</Button>
            </div>
            <details className={explorer.details}>
              <summary>Documented responses and schemas</summary>
              {action.responses.map((response) => <div key={response.status} className={styles.column}>
                <Text weight="semibold">{response.status}: {response.description}</Text>
                {response.schema && <pre className={styles.code}>{JSON.stringify(schemaTools.schemaDocument(response.schema), null, 2)}</pre>}
                {response.headers && <pre className={styles.code}>{JSON.stringify({ headers: response.headers }, null, 2)}</pre>}
              </div>)}
            </details>
          </> : <Text className={styles.empty}>
            {matches.length ? "Select a matching action to enter its inputs." : "No matching actions. Clear filters or include write-capable actions."}
          </Text>}
        </section>
        <section className={mergeClasses(styles.column, explorer.panel, explorer.response)} aria-label="Cost Management results">
          <div className={explorer.panelHeading}>
            <ArrowReplyRegular /><Text as="h2" size={500} weight="semibold">Last response</Text>
          </div>
          <details className={explorer.details}>
            <summary>About responses and ETags</summary>
            <Text size={200} className={styles.muted}>
              One request per run. Only data and headers exposed by the SDK are available here. HTTP response headers may be unavailable;
              inspect service-setting parentEtag when returned. Never fabricate an ETag. Next links and partial-result diagnostics stay unchanged.
              Inputs and responses stay in page memory, not browser storage.
            </Text>
          </details>
          <div aria-busy={busy}>
            {busy ? <LoadingPane label="Running Cost Management action..." /> : lastRun ? <div className={styles.column}>
              <div className={styles.row} role="status">
                <Badge color={lastRun.result.ok ? "success" : "danger"}>{lastRun.result.ok ? "Succeeded" : lastRun.result.partial ? "Partial result" : "Failed"}</Badge>
                <Text>{lastRun.request.actionId} &middot; {lastRun.elapsedMs} ms</Text>
              </div>
              {!lastRun.result.ok && <ErrorPane title="Connector call failed" message={lastRun.result.error} />}
              <ResponseViewer key={`${lastRun.request.actionId}:${lastRun.elapsedMs}`} sources={[{
                label: "Raw SDK result", ariaLabel: "Raw connector response",
                text: JSON.stringify(lastRun.result.data ?? lastRun.result, null, 2),
              }]} />
              <details className={explorer.details}>
                <summary>Submitted request</summary>
                <pre className={styles.code}>{JSON.stringify({ ...lastRun.preview, sdkRequest: lastRun.request }, null, 2)}</pre>
              </details>
              <Button appearance="subtle" disabled={locked} onClick={() => setLastRun(null)}>Clear response</Button>
            </div> : <div className={explorer.empty}>
              <ArrowReplyRegular />
              <Text weight="semibold">Your response will appear here</Text>
              <Text>Run an action to inspect the raw connector result. Nothing runs automatically.</Text>
            </div>}
          </div>
        </section>
      </div>
      <Dialog open={pending !== null} onOpenChange={(_, data) => { if (!data.open) setPending(null); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Confirm Cost Management action</DialogTitle>
            <DialogContent>
              <div className={styles.column}>
                <Text>This sends a real tenant write. Check the target IDs, the applicable parent or request ETags and body. There is no automatic undo.</Text>
                <pre className={styles.code}>{JSON.stringify(pending?.preview, null, 2)}</pre>
                <Field label={`Type ${pending?.request.actionId ?? ""} to confirm`}>
                  <Input value={confirmation} autoComplete="off" onChange={(_, data) => setConfirmation(data.value)} />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button appearance="primary" disabled={!pending || confirmation !== pending.request.actionId} onClick={() => {
                if (!pending || confirmation !== pending.request.actionId) return;
                const snapshot = pending;
                setPending(null);
                void run(snapshot, true);
              }}>Confirm and run</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
