import { useMemo, useRef, useState } from "react";
import {
  Badge, Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Field, Input, Link, Select, Text, Title2, makeStyles, mergeClasses, tokens,
} from "@fluentui/react-components";
import { PlayRegular, SearchRegular, CodeRegular, ArrowReplyRegular } from "@fluentui/react-icons";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { SchemaField } from "../../shared/api-explorer/SchemaField";
import { ResponseViewer } from "../../shared/api-explorer/ResponseViewer";
import { usePlaygroundStyles } from "../../shared/api-explorer/playgroundStyles";
import { formatApiError } from "../../shared/api-explorer/schema";
import {
  apiCatalog, apiOperations, buildApiRequest, initialApiInputs, isReadOnly,
  parameterKey, schemaTools, unsupportedReason,
} from "./catalog";
import { executeApiRequest } from "./data";
import type { ApiRequestInputs, ApiResult, FlowHttpRequest } from "./types";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, minWidth: 0 },
  header: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  muted: { color: tokens.colorNeutralForeground2 },
  filters: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: tokens.spacingHorizontalM },
  search: { flex: "1 1 320px" },
  filter: { flex: "1 1 220px", minWidth: 0 },
  operation: { flex: "1 1 100%", minWidth: 0 },
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
    backgroundColor: tokens.colorStatusWarningBackground1, color: tokens.colorStatusWarningForeground1,
    padding: tokens.spacingHorizontalM, borderRadius: tokens.borderRadiusMedium,
  },
  empty: { paddingBlock: tokens.spacingVerticalXXL, color: tokens.colorNeutralForeground2 },
});

interface PendingRequest {
  inputs: ApiRequestInputs;
  request: FlowHttpRequest;
  title: string;
}

interface LastRun {
  operation: string;
  request: FlowHttpRequest;
  result: ApiResult;
  elapsedMs: number;
}

const defaultOperation = (() => {
  const operation = apiOperations.find((entry) => entry.method === "GET" && entry.path.endsWith("/resourceThresholds"));
  if (!operation) throw new Error("The API catalog must include Get All Resource Thresholds.");
  return operation;
})();

export function PowerPlatformApiPlayground() {
  const styles = useStyles();
  const explorer = usePlaygroundStyles();
  const [section, setSection] = useState(defaultOperation.section);
  const [group, setGroup] = useState(defaultOperation.group);
  const [search, setSearch] = useState("");
  const [readOnlyOnly, setReadOnlyOnly] = useState(false);
  const [inputs, setInputs] = useState(() => initialApiInputs(defaultOperation));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const locked = busy || pending !== null;
  const sections = useMemo(() => [...new Set(apiOperations.map((operation) => operation.section))].sort(), []);
  const groups = useMemo(() => [...new Set(apiOperations
    .filter((operation) => !section || operation.section === section).map((operation) => operation.group))].sort(), [section]);
  const matches = useMemo(() => apiOperations.filter((operation) =>
    (!section || operation.section === section) && (!group || operation.group === group) &&
    (!readOnlyOnly || isReadOnly(operation)) &&
    `${operation.section} ${operation.group} ${operation.title} ${operation.method} ${operation.path} ${operation.description}`
      .toLowerCase().includes(search.toLowerCase()),
  ), [section, group, readOnlyOnly, search]);
  const operation = matches.find((entry) => entry.id === inputs.operationId);
  const blocked = operation ? unsupportedReason(operation) : undefined;
  const preview = useMemo(() => {
    if (!operation) return {};
    try {
      return { request: buildApiRequest(inputs) };
    } catch (cause) {
      return { error: formatApiError(cause) };
    }
  }, [operation, inputs]);

  function chooseOperation(id: string) {
    const next = apiOperations.find((entry) => entry.id === id);
    if (!next) return;
    setInputs(initialApiInputs(next));
    setError("");
  }

  async function run(snapshot: PendingRequest, confirmedWrite = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const started = performance.now();
    try {
      const result = await executeApiRequest(snapshot.inputs, confirmedWrite);
      setLastRun({ operation: snapshot.title, request: snapshot.request, result, elapsedMs: Math.round(performance.now() - started) });
    } catch (cause) {
      setLastRun({
        operation: snapshot.title, request: snapshot.request,
        result: { ok: false, error: formatApiError(cause) }, elapsedMs: Math.round(performance.now() - started),
      });
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  function submit() {
    if (!operation) return;
    try {
      const snapshot: PendingRequest = {
        inputs: { ...inputs, parameters: { ...inputs.parameters } },
        request: buildApiRequest(inputs), title: operation.title,
      };
      setError("");
      if (isReadOnly(operation)) void run(snapshot);
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
        <Title2 as="h1">Power Platform API playground</Title2>
        <Text className={styles.muted}>
          Browse {apiOperations.length} documented operations. Every request runs only through PP-API-Wrapper-Flow,
          using that flow&apos;s connection and permissions. Nothing runs automatically.
        </Text>
        <Text size={200} className={styles.muted}>
          Documentation snapshot: {apiCatalog.source.generatedAt.slice(0, 10)}.{" "}
          <Link href="https://learn.microsoft.com/en-us/rest/api/power-platform/" target="_blank" rel="noopener noreferrer">Microsoft Learn reference</Link>
        </Text>
      </header>
      <div className={mergeClasses(styles.filters, explorer.filters)}>
        <Field label="API section" className={styles.filter}>
          <Select className={styles.select} value={section} disabled={locked} onChange={(_, data) => {
            setSection(data.value); setGroup(""); setInputs({ operationId: "", parameters: {}, body: "" }); setError("");
          }}>
            <option value="">All sections</option>
            {sections.map((name) => <option key={name}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Resource group" className={styles.filter}>
          <Select className={styles.select} value={group} disabled={locked} onChange={(_, data) => {
            setGroup(data.value); setInputs({ operationId: "", parameters: {}, body: "" }); setError("");
          }}>
            <option value="">All resource groups</option>
            {groups.map((name) => <option key={name}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Find an API operation" className={styles.search}>
          <Input contentBefore={<SearchRegular />} value={search} disabled={locked} placeholder="Search names, routes, or descriptions"
            onChange={(_, data) => setSearch(data.value)} />
        </Field>
        <Checkbox label="Read-only operations only" checked={readOnlyOnly} disabled={locked}
          onChange={(_, data) => setReadOnlyOnly(data.checked === true)} />
        <Button appearance="subtle" disabled={locked || (!search && !section && !group && !readOnlyOnly)}
          onClick={() => { setSearch(""); setSection(""); setGroup(""); setReadOnlyOnly(false); setError(""); }}>
          Clear filters
        </Button>
        <Field label={`API operation (${matches.length} matching)`} className={styles.operation}>
          <Select className={styles.select} value={operation?.id ?? ""} disabled={locked} onChange={(_, data) => chooseOperation(data.value)}>
            <option value="">{matches.length ? "Select an operation" : "No matching operations"}</option>
            {matches.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.section} / {entry.group} / {entry.method} {entry.title}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className={styles.workspace}>
        <section className={mergeClasses(styles.column, explorer.panel)} aria-label="API request">
          <div className={explorer.panelHeading}>
            <CodeRegular /><Text as="h2" size={500} weight="semibold">Request</Text>
          </div>
          {operation ? <>
            <div className={styles.row}>
              <Text as="h3" size={500} weight="semibold">{operation.title}</Text>
              <Badge color={isReadOnly(operation) ? "informative" : "warning"}>{isReadOnly(operation) ? "Read-only" : "Write-capable"}</Badge>
            </div>
            <Text>{operation.description}</Text>
            <Link href={operation.docUrl} target="_blank" rel="noopener noreferrer">Operation documentation</Link>
            <div className={explorer.endpoint}>
              <Badge appearance="tint" color={isReadOnly(operation) ? "informative" : "warning"}>{operation.method}</Badge>
              <code>{operation.path}</code>
            </div>
            {operation.warnings.length > 0 && <div className={styles.warning}>
              <Text weight="semibold">Documentation schema gaps</Text>
              {operation.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>}
            {!isReadOnly(operation) && <div className={styles.warning}>
              This request can change tenant resources, permissions, billing, or availability.
              Review the exact request before confirming. There is no automatic undo or retry.
            </div>}
            {blocked && <ErrorPane title="Flow contract needs extending" message={blocked} />}
            <Text weight="semibold">Parameters</Text>
            <div className={explorer.fields}>
              {operation.parameters.map((parameter) => (
                <SchemaField key={`${operation.id}:${parameterKey(parameter)}`}
                  label={`${parameter.name} (${parameter.in})`}
                  hint={parameter.in === "header" ? `${parameter.description} Custom headers cannot be forwarded by this flow.` : parameter.description}
                  required={parameter.required} schema={parameter.schema} tools={schemaTools}
                  value={inputs.parameters[parameterKey(parameter)] ?? ""} disabled={locked || parameter.in === "header"}
                  onChange={(value) => {
                    setInputs((previous) => ({ ...previous, parameters: { ...previous.parameters, [parameterKey(parameter)]: value } }));
                    setError("");
                  }} />
              ))}
              {operation.body ? (
                <div className={explorer.body}>
                <SchemaField label="Request body (JSON)" hint={operation.body.description} required={operation.body.required}
                  schema={operation.body.schema} tools={schemaTools} json includeOptional
                  value={inputs.body} disabled={locked} onChange={(body) => { setInputs((previous) => ({ ...previous, body })); setError(""); }} />
                </div>
              ) : <Text className={mergeClasses(styles.muted, explorer.body)}>No request body is documented. The flow&apos;s Body input is sent as an empty string.</Text>}
            </div>
            <details className={explorer.details} open={Boolean(preview.request)}>
              <summary>Flow request preview</summary>
              {preview.request ? <pre className={styles.code}>{JSON.stringify(preview.request, null, 2)}</pre>
                : <Text>{preview.error}</Text>}
            </details>
            {error && <ErrorPane title="Check the request" message={error} />}
            <div className={mergeClasses(styles.row, explorer.actions)}>
              <Button appearance="primary" icon={<PlayRegular />} disabled={locked || Boolean(blocked)} onClick={submit}>
                {isReadOnly(operation) ? "Run API request" : "Review API request"}
              </Button>
              <Button disabled={locked} onClick={() => { setInputs(initialApiInputs(operation)); setError(""); }}>Reset request</Button>
            </div>
            <details className={explorer.details}>
              <summary>Documented responses and schemas</summary>
              {operation.responses.map((response) => (
                <div key={response.status} className={styles.column}>
                  <Text weight="semibold">{response.status}: {response.description}</Text>
                  {response.schema && <pre className={styles.code}>{JSON.stringify(schemaTools.schemaDocument(response.schema), null, 2)}</pre>}
                </div>
              ))}
            </details>
          </> : <Text className={styles.empty}>
            {matches.length ? "Select an operation to see its required parameters and request body." : "No operations match. Change the section, resource group, or search."}
          </Text>}
        </section>
        <section className={mergeClasses(styles.column, explorer.panel, explorer.response)} aria-label="API response">
          <div className={explorer.panelHeading}>
            <ArrowReplyRegular /><Text as="h2" size={500} weight="semibold">Last response</Text>
          </div>
          <details className={explorer.details}>
          <summary>About responses</summary>
          <Text className={styles.muted} size={200}>
            Requests and results stay in page memory. Pagination and long-running operations are not followed automatically.
            The flow returns response text; HTTP status and headers are shown only if the flow includes them.
          </Text>
          </details>
          <div aria-busy={busy}>
            {busy ? <LoadingPane label="Running PP-API-Wrapper-Flow..." /> : lastRun ? (
              <div className={styles.column}>
                <div className={styles.row} role="status">
                  <Badge color={lastRun.result.ok ? "success" : "danger"}>{lastRun.result.ok ? "Response received" : "Failed"}</Badge>
                  <Text>{lastRun.operation} &middot; {lastRun.elapsedMs} ms</Text>
                  {lastRun.result.data?.status !== undefined && <Text>HTTP {lastRun.result.data.status}</Text>}
                </div>
                {!lastRun.result.ok && <ErrorPane title="API request failed" message={lastRun.result.error} />}
                <ResponseViewer key={lastRun.elapsedMs + lastRun.operation} sources={[
                  {
                    label: "Response body", ariaLabel: "API response body",
                    text: lastRun.result.data ? JSON.stringify(lastRun.result.data.body, null, 2)
                      : JSON.stringify({ error: lastRun.result.ok ? undefined : lastRun.result.error }, null, 2),
                  },
                  ...(lastRun.result.data ? [{
                    label: "Raw flow response", ariaLabel: "Raw flow response text",
                    text: lastRun.result.data.raw || "(empty response)",
                  }] : []),
                ]} />
                {lastRun.result.data?.headers !== undefined && <details className={explorer.details}>
                  <summary>Response headers</summary>
                  <pre className={styles.code}>{JSON.stringify(lastRun.result.data.headers, null, 2)}</pre>
                </details>}
                <details className={explorer.details}>
                  <summary>Submitted flow request</summary>
                  <pre className={styles.code}>{JSON.stringify(lastRun.request, null, 2)}</pre>
                </details>
                <Button appearance="subtle" disabled={locked} onClick={() => setLastRun(null)}>Clear API response</Button>
              </div>
            ) : <div className={explorer.empty}>
              <ArrowReplyRegular />
              <Text weight="semibold">Your response will appear here</Text>
              <Text>Run a request to inspect its JSON or text response here.</Text>
              <Text size={200} className={styles.muted}>Search results without leaving the playground.</Text>
            </div>}
          </div>
        </section>
      </div>
      <Dialog open={pending !== null} onOpenChange={(_, data) => { if (!data.open) setPending(null); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Confirm Power Platform API request</DialogTitle>
            <DialogContent>
              <div className={styles.column}>
                <Text>This is a live request through PP-API-Wrapper-Flow. Changes may be irreversible. Verify the method, URL, target IDs, and body.</Text>
                <pre className={styles.code}>{JSON.stringify(pending?.request, null, 2)}</pre>
                <Field label={`Type ${pending?.title ?? ""} to confirm`}>
                  <Input value={confirmation} autoComplete="off" onChange={(_, data) => setConfirmation(data.value)} />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button appearance="primary" disabled={!pending || confirmation !== pending.title} onClick={() => {
                if (!pending || confirmation !== pending.title) return;
                const snapshot = pending;
                setPending(null);
                void run(snapshot, true);
              }}>Confirm and run API request</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
