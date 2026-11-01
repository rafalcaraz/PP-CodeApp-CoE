import { useMemo, useRef, useState } from "react";
import {
  Badge, Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent,
  DialogSurface, DialogTitle, Field, Input, Select, Text, Title2,
  makeStyles, mergeClasses, tokens,
} from "@fluentui/react-components";
import { PlayRegular, SearchRegular, CodeRegular, ArrowReplyRegular } from "@fluentui/react-icons";
import { ErrorPane, LoadingPane } from "../../components/Status";
import {
  connectorActions, initialInputs, parameterSchema, parseInputs,
  resolveSchema, schemaDocument, schemaTemplate, validateValue, type ActionParameter,
} from "./catalog";
import { SchemaField } from "../../shared/api-explorer/SchemaField";
import { ResponseViewer } from "../../shared/api-explorer/ResponseViewer";
import { usePlaygroundStyles } from "../../shared/api-explorer/playgroundStyles";
import { executeAction, type PlaygroundRequest } from "./data";
import type { DataResult } from "../../data/inventory";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, minWidth: 0 },
  header: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  muted: { color: tokens.colorNeutralForeground2 },
  filters: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "end", flexWrap: "wrap" },
  search: { flex: "1 1 260px" },
  filter: { flex: "1 1 220px", minWidth: 0 },
  selector: { flex: "1 1 100%", minWidth: 0 },
  select: { minWidth: 0, width: "100%", "& select": { minWidth: 0, textOverflow: "ellipsis" } },
  workspace: {
    display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: tokens.spacingHorizontalXXL,
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  column: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, minWidth: 0 },
  sectionHeader: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  code: {
    fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap", overflowWrap: "anywhere",
    padding: tokens.spacingHorizontalM, margin: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "560px", overflow: "auto",
  },
  warning: {
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorStatusWarningBackground1,
    color: tokens.colorStatusWarningForeground1,
    borderRadius: tokens.borderRadiusMedium,
  },
  tools: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  empty: { paddingBlock: tokens.spacingVerticalXXL, color: tokens.colorNeutralForeground2 },
});

interface RunResult {
  request: PlaygroundRequest;
  result: DataResult<unknown>;
  elapsedMs: number;
}

function ParameterInput({ parameter, value, disabled, onChange }: {
  parameter: ActionParameter;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const schema = resolveSchema(parameterSchema(parameter));
  const label = `${parameter.name} (${parameter.in}, ${schema.type ?? "JSON"})`;
  return (
    <SchemaField label={label} required={parameter.required} hint={parameter.description}
      schema={parameterSchema(parameter)}
      tools={{ resolveSchema, schemaDocument, schemaTemplate, validateValue }}
      json={parameter.in === "body"} value={value} disabled={disabled} onChange={onChange} />
  );
}

export function ConnectorPlayground() {
  const styles = useStyles();
  const explorer = usePlaygroundStyles();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [readOnlyOnly, setReadOnlyOnly] = useState(false);
  const [actionId, setActionId] = useState("ListEnvironmentGroups");
  const action = connectorActions.find((entry) => entry.id === actionId)!;
  const [inputs, setInputs] = useState<Record<string, string>>(() => initialInputs(action));
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PlaygroundRequest | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const groups = useMemo(() => [...new Set(connectorActions.map((entry) => entry.group))].sort(), []);
  const actions = useMemo(() => connectorActions.filter((entry) =>
    (!group || entry.group === group) &&
    (!readOnlyOnly || entry.readOnly) &&
    `${entry.id} ${entry.title} ${entry.description} ${entry.group}`.toLowerCase().includes(search.toLowerCase()),
  ), [search, group, readOnlyOnly]);
  const locked = busy || pending !== null;
  const selectedVisible = actions.some((entry) => entry.id === actionId);

  function chooseAction(id: string) {
    const next = connectorActions.find((entry) => entry.id === id);
    if (!next) return;
    setActionId(id);
    setInputs(initialInputs(next));
    setError("");
  }

  async function run(request: PlaygroundRequest, confirmedWrite = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const started = performance.now();
    try {
      const result = await executeAction(request, confirmedWrite);
      setLastRun({ request, result, elapsedMs: Math.round(performance.now() - started) });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function submit() {
    try {
      const request = { actionId: action.id, parameters: parseInputs(action, inputs) };
      setError("");
      if (action.readOnly) void run(request);
      else {
        setConfirmation("");
        setPending(request);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className={styles.root}>
      <header className={mergeClasses(styles.header, explorer.header)}>
        <Title2 as="h1">Connector playground</Title2>
        <Text className={styles.muted}>
          Power Platform for Admins V2 &middot; {connectorActions.length} actions from the app&apos;s bundled connector metadata.
          Real calls, using your current Power Apps connection and permissions.
        </Text>
      </header>
      <div className={mergeClasses(styles.filters, explorer.filters)}>
        <Field label="Action category" className={styles.filter}>
          <Select className={styles.select} value={group} disabled={locked}
            onChange={(_, data) => setGroup(data.value)}>
            <option value="">All categories</option>
            {groups.map((name) => <option key={name}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Find an action" className={styles.search}>
          <Input contentBefore={<SearchRegular />} value={search} disabled={locked}
            placeholder="Search by name, operation ID, or category"
            onChange={(_, data) => setSearch(data.value)} />
        </Field>
        <Checkbox label="Read-only actions only" checked={readOnlyOnly} disabled={locked}
          onChange={(_, data) => setReadOnlyOnly(data.checked === true)} />
        <Button appearance="subtle" disabled={locked || (!search && !group && !readOnlyOnly)}
          onClick={() => { setSearch(""); setGroup(""); setReadOnlyOnly(false); }}>Clear filters</Button>
        <Field label={`Action (${actions.length} matching)`} className={styles.selector}>
          <Select className={styles.select} value={selectedVisible ? actionId : ""} disabled={locked}
            onChange={(_, data) => chooseAction(data.value)}>
            <option value="">{actions.length ? "Select an action" : "No matching actions"}</option>
            {actions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title} - {entry.id} [{entry.readOnly ? "Read" : "Write-capable"}]
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className={styles.workspace}>
        <section className={mergeClasses(styles.column, explorer.panel)} aria-label="Action inputs">
          <div className={explorer.panelHeading}>
            <CodeRegular /><Text as="h2" size={500} weight="semibold">Request</Text>
          </div>
          {selectedVisible ? <>
          <div className={styles.sectionHeader}>
            <Text as="h3" size={500} weight="semibold">{action.title}</Text>
            <Badge color={action.readOnly ? "informative" : "warning"}>{action.readOnly ? "Read-only" : "Write-capable"}</Badge>
          </div>
          <Text>{action.description}</Text>
          <Text size={200} className={styles.muted}>{action.id}</Text>
          <div className={explorer.endpoint}>
            <Badge appearance="tint" color={action.readOnly ? "informative" : "warning"}>{action.method}</Badge>
            <code>{action.path}</code>
          </div>
          {!action.readOnly && (
            <div className={styles.warning}>
              This action can change tenant data, permissions, billing, or availability.
              Review the request carefully; there is no automatic undo or retry.
            </div>
          )}
          <Text weight="semibold">Parameters</Text>
          <div className={explorer.fields}>
            {action.parameters.map((parameter) => (
              <div key={`${action.id}:${parameter.name}`} className={parameter.in === "body" ? explorer.body : undefined}>
              <ParameterInput parameter={parameter}
                value={inputs[parameter.name] ?? ""} disabled={locked}
                onChange={(value) => {
                  setInputs((previous) => ({ ...previous, [parameter.name]: value }));
                  setError("");
                }} />
              </div>
            ))}
            {!action.parameters.length && <Text>This action has no inputs.</Text>}
          </div>
          {error && <ErrorPane title="Check the inputs" message={error} />}
          <div className={mergeClasses(styles.tools, explorer.actions)}>
            <Button appearance="primary" icon={<PlayRegular />} disabled={locked} onClick={submit}>
              {action.readOnly ? "Run action" : "Review and run"}
            </Button>
            <Button disabled={locked} onClick={() => { setInputs(initialInputs(action)); setError(""); }}>Reset inputs</Button>
          </div>
          </> : <Text className={styles.empty}>{actions.length ? "Select a matching action to enter its inputs." : "No matching actions. Try a different search or include write-capable actions."}</Text>}
        </section>
        <section className={mergeClasses(styles.column, explorer.panel, explorer.response)} aria-label="Action results">
          <div className={explorer.panelHeading}>
            <ArrowReplyRegular /><Text as="h2" size={500} weight="semibold">Last response</Text>
          </div>
          <details className={explorer.details}>
            <summary>About responses</summary>
            <Text className={styles.muted} size={200}>One request per run. Pagination tokens are returned as-is; submit the next token manually. Inputs and results stay in page memory, not browser storage.</Text>
          </details>
          <div aria-busy={busy}>
            {busy ? <LoadingPane label={`Running ${action.id}...`} /> : lastRun ? (
              <div className={styles.column}>
                <div className={styles.sectionHeader} role="status">
                  <Badge color={lastRun.result.ok ? "success" : "danger"}>{lastRun.result.ok ? "Succeeded" : "Failed"}</Badge>
                  <Text>{lastRun.request.actionId} &middot; {lastRun.elapsedMs} ms</Text>
                </div>
                {!lastRun.result.ok && <ErrorPane title="Connector call failed" message={lastRun.result.error} />}
                <ResponseViewer key={lastRun.request.actionId + lastRun.elapsedMs} sources={[{
                  label: "Response body", ariaLabel: "JSON response",
                  text: JSON.stringify(lastRun.result.ok ? lastRun.result.data : { error: lastRun.result.error }, null, 2),
                }]} />
                <details className={explorer.details}>
                  <summary>Submitted request</summary>
                  <pre className={styles.code}>{JSON.stringify(lastRun.request, null, 2)}</pre>
                </details>
                <Button appearance="subtle" disabled={locked} onClick={() => setLastRun(null)}>Clear response</Button>
              </div>
            ) : <div className={explorer.empty}>
              <ArrowReplyRegular />
              <Text weight="semibold">Your response will appear here</Text>
              <Text>Run an action to inspect its response here. Nothing runs automatically.</Text>
              <Text size={200} className={styles.muted}>Search results without leaving the playground.</Text>
            </div>}
          </div>
        </section>
      </div>
      <Dialog open={pending !== null} onOpenChange={(_, data) => { if (!data.open) setPending(null); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Confirm tenant action</DialogTitle>
            <DialogContent>
              <div className={styles.column}>
                <Text>This sends a real request and may make irreversible changes. Check every ID and the request body.</Text>
                <pre className={styles.code}>{JSON.stringify(pending, null, 2)}</pre>
                <Field label={`Type ${pending?.actionId ?? ""} to confirm`}>
                  <Input value={confirmation} autoComplete="off" onChange={(_, data) => setConfirmation(data.value)} />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)}>Cancel</Button>
              <Button appearance="primary" disabled={!pending || confirmation !== pending.actionId}
                onClick={() => {
                  if (!pending || confirmation !== pending.actionId) return;
                  const request = pending;
                  setPending(null);
                  void run(request, true);
                }}>
                Confirm and run
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
