import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge, Button, Card, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, Dropdown, Field, Input, Option, Spinner, Tab, TabList, Text, Textarea,
  makeStyles, tokens,
} from "@fluentui/react-components";
import { ArrowDownloadRegular, CopyRegular, PlayRegular, SaveRegular } from "@fluentui/react-icons";
import {
  ALL_RESOURCE_TYPES, QUERY_TEMPLATES, buildClausesFromSpec, buildQueryExecutionPlan, hasPairedOperationFilters, queryFilters, resourceTypeShort, validateQuerySpec,
  type QuerySpec, type ResourceTypeValue,
} from "../../data/inventory";
import { getFieldSuggestions } from "../../data/inventory.fields";
import {
  createSavedQuery, deleteSavedQuery, getSavedQueriesStorageError, isQuerySpec,
  listSavedQueries, updateSavedQuery, type SavedQuery, type SavedQueryInput,
} from "../../data/savedQueries";
import { downloadCsv, rowsToCsv } from "../../utils/csv";
import { useConnectorCatalog } from "../../shared/connector-catalog";
import { buildDynamicQueryTemplates } from "./dynamicTemplates";
import type { ResourceItem } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { ConditionBuilder } from "./ConditionBuilder";
import { typedFilterErrors } from "./filterModel";
import { ErrorPane } from "../../components/Status";
import { QueryResults } from "./QueryResults";
import { createExecution, drainExecution, nextPage, recallExecution, rememberExecution, type Execution } from "./execution";
import {
  cellText, draftKey, genericResultShape, getPath, parseClausesPayload, readWorkspace, resultColumns,
  writeWorkspace, type BuilderMode, type WorkspaceDraft,
} from "./workspace";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, minWidth: 0 },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, minWidth: 0 },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: tokens.spacingHorizontalM },
  library: { maxHeight: "360px", overflowY: "auto", display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  libraryRow: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS, alignItems: "center", paddingBlock: tokens.spacingVerticalXS, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  libraryLabel: { flex: "1 1 240px", minWidth: 0, overflowWrap: "anywhere" },
  muted: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  error: { color: tokens.colorPaletteRedForeground1, overflowWrap: "anywhere" },
  notice: { padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorNeutralBackground2, borderRadius: tokens.borderRadiusMedium },
  filters: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  field: { minWidth: "180px", flex: "1 1 220px" },
  json: { fontFamily: tokens.fontFamilyMonospace, whiteSpace: "pre-wrap", overflowWrap: "anywhere", overflow: "auto", maxHeight: "320px" },
  textarea: { width: "100%", fontFamily: tokens.fontFamilyMonospace },
  control: { minWidth: 0, maxWidth: "100%" },
});
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function QueriesView() {
  const styles = useStyles();
  const { catalog } = useConnectorCatalog();
  const [restored] = useState(readWorkspace);
  const [draft, setDraft] = useState<WorkspaceDraft>(restored.draft);
  const draftRef = useRef(draft);
  const [saved, setSaved] = useState(listSavedQueries);
  const [error, setError] = useState(() => restored.warning || getSavedQueriesStorageError());
  const [notice, setNotice] = useState("");
  const [execution, setExecution] = useState<Execution | undefined>(recallExecution);
  const executionRef = useRef(execution);
  const [busy, setBusy] = useState<"run" | "more" | "export" | undefined>();
  const [scanCount, setScanCount] = useState(0);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const [partial, setPartial] = useState<Execution>();
  const exportShape = draft.exportShape ?? "columns";
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [renameTarget, setRenameTarget] = useState<SavedQuery>();
  const [deleteTarget, setDeleteTarget] = useState<SavedQuery>();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  useEffect(() => () => { generation.current++; }, []);
  const reportError = useCallback((value: string) => setError(value), [setError]);
  const commitExecution = (value: Execution) => { executionRef.current = value; setExecution(value); rememberExecution(value); };

  const changeDraft = (patch: Partial<WorkspaceDraft>, queryChanged = true) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    if (queryChanged) {
      generation.current++;
      busyRef.current = false;
      setBusy(undefined);
      setPartial(undefined);
    }
    setDraft(next);
    try { writeWorkspace(next); }
    catch (e) { setError(`Workspace could not be stored for navigation: ${message(e)}. Your current draft is still open.`); }
  };
  const updateSpec = (patch: Partial<QuerySpec>) => changeDraft({ spec: { ...draft.spec, ...patch } });
  const fields = useMemo(() => getFieldSuggestions(draft.spec.resourceTypes, "filter"), [draft.spec.resourceTypes]);
  const columnFields = useMemo(() => getFieldSuggestions(draft.spec.resourceTypes, "column").filter((f) => !f.path.startsWith("__")), [draft.spec.resourceTypes]);
  const builderClauses = useMemo(() => buildClausesFromSpec(draft.spec), [draft.spec]);
  const paired = draft.mode === "basic" && hasPairedOperationFilters(draft.spec);
  const parsed = useMemo(() => parseClausesPayload(draft.advancedText), [draft.advancedText]);
  const clauses = draft.mode === "basic" ? builderClauses : parsed.ok ? parsed.clauses : [];
  const validation = [
    ...(draft.mode === "basic" ? [...validateQuerySpec(draft.spec), ...typedFilterErrors(queryFilters(draft.spec), fields)] : parsed.ok ? [] : [parsed.error]),
    ...(!Number.isInteger(draft.spec.limit) || draft.spec.limit < 1 || draft.spec.limit > 500 ? ["Page size must be an integer from 1 to 500."] : []),
  ];
  const key = draftKey(draft.spec, draft.mode, draft.advancedText);
  const stale = execution !== undefined && execution.key !== key;
  const loaded = saved.find((q) => q.id === draft.loadedId);
  const dirty = loaded && (loaded.source !== (draft.mode === "basic" ? "builder" : "raw") ||
    (draft.mode === "basic" ? JSON.stringify(loaded.spec) !== JSON.stringify(draft.spec) :
      JSON.stringify(loaded.clauses) !== JSON.stringify(clauses) || (loaded.pageSize ?? 100) !== draft.spec.limit));
  const defaults = useMemo(() => {
    const preferred = ["properties.displayName", "type", "properties.environmentId", "properties.ownerId", "properties.lastModifiedAt", "properties.lastPublishedAt", "properties.status", "properties.powerPlatformConnectors", "properties.connectors"];
    return preferred.filter((path) => columnFields.some((f) => f.path === path));
  }, [columnFields]);
  const columns = execution ? resultColumns(execution.rows, execution.clauses, draft.columns, execution.defaultColumns ?? defaults) : defaults;
  const templates = [...buildDynamicQueryTemplates(catalog), ...QUERY_TEMPLATES];
  const search = draft.search.toLowerCase();
  const filteredSaved = saved.filter((q) => (!draft.favoritesOnly || q.favorite) && `${q.name} ${q.description}`.toLowerCase().includes(search))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  const refreshSaved = () => setSaved(listSavedQueries());
  const persist = (action: () => void) => {
    try { action(); refreshSaved(); return true; }
    catch (e) { setError(`Saved query was not changed: ${message(e)}`); return false; }
  };
  const input = (): SavedQueryInput => ({
    name: saveName, description: saveDescription, source: draft.mode === "basic" ? "builder" : "raw",
    spec: draft.mode === "basic" ? draft.spec : undefined, clauses, pageSize: draft.spec.limit,
  });
  const applySaved = (q: SavedQuery) => {
    changeDraft({
      spec: q.source === "builder" && q.spec ? q.spec : { ...draft.spec, limit: q.pageSize ?? 100 },
      mode: q.source === "builder" && q.spec ? "basic" : "advanced", loadedId: q.id,
      advancedText: q.source === "raw" ? JSON.stringify(q.clauses, null, 2) : "", advancedSeed: undefined, columns: undefined,
    });
    setNotice(`Loaded ${q.name}. Run to refresh results.`);
  };
  const switchMode = (mode: BuilderMode) => {
    const seed = JSON.stringify(builderClauses, null, 2);
    changeDraft({ mode, ...(mode === "advanced" && !draft.advancedText ? { advancedText: seed, advancedSeed: seed } : {}) });
  };
  const run = async () => {
    if (busyRef.current || validation.length) return;
    const id = ++generation.current;
    busyRef.current = true; setBusy("run"); setScanCount(0); setError(""); setNotice(""); setPartial(undefined);
    try {
      const plan = draft.mode === "basic" ? buildQueryExecutionPlan(draft.spec, new Date()) : undefined;
      const snapshot = createExecution(key, plan?.clauses ?? clauses, draft.spec.limit);
      snapshot.defaultColumns = defaults;
      const result = await nextPage(snapshot);
      if (id !== generation.current) return;
      if (!result.ok) { setError(`Query failed: ${result.error}. Previous results are retained.`); return; }
      if (plan?.requiresClientFiltering) {
        setScanCount(result.execution.offset);
        const drained = await drainExecution(result.execution, (progress) => {
          if (id === generation.current) setScanCount(progress.offset);
        }, () => id !== generation.current);
        if (id !== generation.current || drained.cancelled) return;
        if (drained.error || !drained.execution.complete) {
          setError(`Paired evidence scan is incomplete: ${drained.error ?? "The connector could not prove completion."} No candidate rows are presented as matches. Previous results are retained.`);
          return;
        }
        const matches = drained.execution.rows.filter((item) => plan.matches(item as ResourceItem))
          .map((item) => plan.projectResult ? plan.projectResult(item as ResourceItem) : item);
        commitExecution({ ...drained.execution, rows: matches, total: matches.length });
      } else commitExecution(result.execution);
    } catch (e) { if (id === generation.current) setError(`Query failed: ${message(e)}`); }
    finally { if (id === generation.current) { busyRef.current = false; setBusy(undefined); } }
  };
  const loadMore = async () => {
    if (!execution?.token || stale || busyRef.current) return;
    const id = ++generation.current;
    busyRef.current = true; setBusy("more"); setError("");
    try {
      const result = await nextPage(execution);
      if (id !== generation.current) return;
      if (!result.ok) { setError(`Load more failed: ${result.error}. Loaded rows are retained; retry when ready.`); return; }
      commitExecution(result.execution);
    } catch (e) { if (id === generation.current) setError(`Load more failed: ${message(e)}`); }
    finally { if (id === generation.current) { busyRef.current = false; setBusy(undefined); } }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch (e) { setError(`Clipboard failed: ${message(e)}`); }
  };
  const download = (value: Execution, status: "loaded" | "all" | "partial") => {
    try {
      const paths = resultColumns(value.rows, value.clauses, draft.columns, value.defaultColumns ?? defaults);
      const output = exportShape === "raw" ? value.rows :
        value.rows.map((r) => Object.fromEntries(paths.map((path) => [path, path === "Value" && (r === null || typeof r !== "object") ? cellText(r) : cellText(getPath(r, path))])));
      downloadCsv(`inventory-query-${status}-${exportShape}`, rowsToCsv(output));
      setNotice(`Downloaded ${value.rows.length.toLocaleString()} rows (${status === "all" ? "complete connector result" : status === "partial" ? "explicitly partial export" : "loaded rows only"}; ${exportShape === "raw" ? "raw flattened fields" : "selected field paths with raw IDs/values"}).`);
    } catch (e) { setError(`CSV download failed: ${message(e)}`); }
  };
  const exportAll = async () => {
    if (!execution || stale || busyRef.current) return;
    const id = ++generation.current;
    busyRef.current = true; setBusy("export"); setError(""); setPartial(undefined);
    try {
      const result = await drainExecution(execution, (progress) => {
        if (id === generation.current) commitExecution(progress);
      }, () => id !== generation.current);
      if (id !== generation.current || result.cancelled) return;
      commitExecution(result.execution);
      if (result.error || !result.execution.complete) {
        setError(result.error ?? "Export is incomplete. No file was downloaded.");
        setPartial(result.execution);
      } else download(result.execution, "all");
    } catch (e) { if (id === generation.current) {
      setError(`Export failed: ${message(e)}. No file was downloaded.`);
      setPartial(executionRef.current);
    } }
    finally { if (id === generation.current) { busyRef.current = false; setBusy(undefined); } }
  };
  const importQuery = () => {
    try {
      const raw: unknown = JSON.parse(importText);
      const result = parseClausesPayload(importText);
      if (!result.ok) throw new Error(result.error);
      const envelope = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
      if (envelope?.source === "builder") {
        if (!isQuerySpec(envelope.spec)) throw new Error("Imported builder spec is invalid or unsupported.");
        changeDraft({ spec: envelope.spec, mode: "basic", loadedId: undefined, advancedText: "", advancedSeed: undefined, columns: undefined });
      } else {
        changeDraft({ mode: "advanced", advancedText: JSON.stringify(result.clauses, null, 2), loadedId: undefined, advancedSeed: undefined,
          spec: { ...draft.spec, limit: typeof envelope?.pageSize === "number" && envelope.pageSize >= 1 && envelope.pageSize <= 500 ? envelope.pageSize : draft.spec.limit } });
      }
      setImportOpen(false); setNotice("Imported as an unsaved draft. Review it before running.");
    } catch (e) { setError(`Import failed: ${message(e)}`); }
  };

  return <div className={styles.root}>
    <header className={styles.section}>
      <Text as="h1" size={600} weight="semibold">Queries</Text>
      <Text>Investigate inventory with typed filters or connector clauses. Drafts are restored in this tab; results stay in memory only.</Text>
    </header>
    {error && <div role="alert"><ErrorPane title="Queries needs attention" message={error} /><Button size="small" appearance="subtle" onClick={() => setError("")}>Dismiss</Button></div>}
    {notice && <Text role="status" className={styles.muted}>{notice}</Text>}
    <div className={styles.section}>
      <div className={styles.row}>
        <Button aria-expanded={draft.libraryOpen} aria-controls="queries-library" onClick={() => changeDraft({ libraryOpen: !draft.libraryOpen }, false)}>
          {draft.libraryOpen ? "Hide" : "Show"} saved queries &amp; templates ({saved.length})
        </Button>
        <Button onClick={() => setImportOpen(true)}>Import query JSON</Button>
      </div>
      {draft.libraryOpen && <Card id="queries-library" className={styles.section}>
        <div className={styles.row}>
          <Input aria-label="Search saved queries and templates" value={draft.search} placeholder="Search saved queries and templates"
            onChange={(_e, d) => changeDraft({ search: d.value }, false)} />
          <Button aria-pressed={draft.favoritesOnly} onClick={() => changeDraft({ favoritesOnly: !draft.favoritesOnly }, false)}>Favorites only</Button>
          <Text className={styles.muted}>Saved locally in this browser. Relative dates are evaluated on each run.</Text>
        </div>
        <div className={styles.library}>
          <Text as="h2" weight="semibold">Saved queries</Text>
          {!filteredSaved.length && <Text className={styles.muted}>No saved queries match. Save your draft to reuse it.</Text>}
          {filteredSaved.map((q) => <div key={q.id} className={styles.libraryRow}>
            <div className={styles.libraryLabel}><Button appearance="subtle" onClick={() => applySaved(q)}>{q.name}</Button><Text className={styles.muted}>{q.description}</Text></div>
            <Badge appearance="outline">{q.source === "builder" ? "Basic" : "Advanced"}</Badge>
            <Button size="small" aria-label={`${q.favorite ? "Unfavorite" : "Favorite"} ${q.name}`} aria-pressed={!!q.favorite}
              onClick={() => persist(() => { if (!updateSavedQuery(q.id, { favorite: !q.favorite })) throw new Error("Query no longer exists."); })}>{q.favorite ? "Unfavorite" : "Favorite"}</Button>
            <Button size="small" onClick={() => setRenameTarget({ ...q })}>Edit name</Button>
            <Button size="small" onClick={() => setDeleteTarget(q)}>Delete</Button>
          </div>)}
          {!draft.favoritesOnly && <>
            <Text as="h2" weight="semibold">Templates</Text>
            {templates.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(search)).map((t) => <div key={t.id} className={styles.libraryRow}>
              <div className={styles.libraryLabel}><Button appearance="subtle" onClick={() => changeDraft({ spec: t.spec, mode: "basic", loadedId: undefined, advancedText: "", advancedSeed: undefined, columns: undefined })}>{t.name}</Button><Text className={styles.muted}>{t.description}</Text></div>
            </div>)}
          </>}
        </div>
      </Card>}
    </div>
    <Card className={styles.section}>
      <div className={styles.row}><Text as="h2" weight="semibold">Query draft</Text>
        {loaded && <Badge appearance="outline" color={dirty ? "warning" : "success"}>{loaded.name}{dirty ? " - unsaved changes" : " - saved"}</Badge>}
      </div>
      <TabList selectedValue={draft.mode} onTabSelect={(_e, d) => switchMode(d.value as BuilderMode)}>
        <Tab value="basic">Basic</Tab><Tab value="advanced" disabled={paired}>Advanced</Tab>
      </TabList>
      {draft.mode === "basic" ? <>
        {paired && <Text className={styles.notice}>Connector-specific operation evidence requires a complete candidate scan, then exact local pairing. Raw clauses and Advanced conversion are unavailable for this draft. Reusable JSON preserves the builder spec; raw dashboard conversion is not supported.</Text>}
        {draft.advancedText && <Text className={styles.notice}>Basic and Advanced are separate drafts. Returning to Basic does not translate Advanced edits.</Text>}
        <Field label="Resource types">
          <Dropdown className={styles.control} multiselect value={draft.spec.resourceTypes.length ? draft.spec.resourceTypes.map(resourceTypeShort).join(", ") : "All reportable resources"}
            selectedOptions={draft.spec.resourceTypes} onOptionSelect={(_e, d) => changeDraft({ spec: { ...draft.spec, resourceTypes: d.selectedOptions as ResourceTypeValue[] }, columns: undefined })}>
            {ALL_RESOURCE_TYPES.map((t) => <Option key={t} value={t} text={resourceTypeShort(t)}>{resourceTypeShort(t)}</Option>)}
          </Dropdown>
        </Field>
        <ConditionBuilder spec={draft.spec} fields={fields} onChange={(conditions) => updateSpec({ conditions, filters: [] })} />
        <div className={styles.row}>
          <Field label="Sort field (or type a path)" className={styles.field}>
            <Input list="query-sort-fields" value={draft.spec.orderField} onChange={(_e, d) => updateSpec({ orderField: d.value })} />
            <datalist id="query-sort-fields">{getFieldSuggestions(draft.spec.resourceTypes, "sort").map((f) => <option key={f.path} value={f.path}>{f.label}</option>)}</datalist>
          </Field>
          <Field label="Sort direction"><Dropdown className={styles.control} value={draft.spec.orderDirection === "asc" ? "Ascending" : "Descending"} selectedOptions={[draft.spec.orderDirection]}
            onOptionSelect={(_e, d) => updateSpec({ orderDirection: d.optionValue as "asc" | "desc" })}><Option value="asc">Ascending</Option><Option value="desc">Descending</Option></Dropdown></Field>
        </div>
      </> : <>
        <Text className={styles.notice}>Advanced is an independent clauses draft. Relative dates copied from Basic remain dynamic. Basic edits are not automatically merged.</Text>
        <Button onClick={() => {
          const seed = JSON.stringify(builderClauses, null, 2);
          changeDraft({ advancedText: seed, advancedSeed: seed });
        }}>Replace Advanced with current Basic clauses</Button>
        <Field label="Advanced clauses JSON">
          <Textarea rows={12} resize="vertical" className={styles.textarea} value={draft.advancedText}
            onChange={(_e, d) => changeDraft({ advancedText: d.value })} />
        </Field>
      </>}
      <Field label="Page size (1-500)" className={styles.field}>
        <Input type="number" min={1} max={500} value={String(draft.spec.limit)} onChange={(_e, d) => updateSpec({ limit: Number(d.value) })} />
      </Field>
      {!!validation.length && <div role="alert" className={styles.error}>{validation.map((v, i) => <div key={i}>{v}</div>)}</div>}
      <div className={styles.row}>
        <Button appearance="primary" icon={<PlayRegular />} disabled={!!busy || !!validation.length || !clauses.length} onClick={() => void run()}>{busy === "run" ? "Running..." : "Run query"}</Button>
        {loaded && <Button icon={<SaveRegular />} disabled={!!validation.length || !dirty} onClick={() => {
          if (persist(() => {
            const updated = updateSavedQuery(loaded.id, { ...input(), name: loaded.name, description: loaded.description });
            if (!updated) throw new Error("The loaded query no longer exists. Use Save as new.");
          })) setNotice(`Updated ${loaded.name}.`);
        }}>Update existing</Button>}
        <Button icon={<SaveRegular />} disabled={!!validation.length || !clauses.length} onClick={() => {
          setSaveName(loaded?.name ?? ""); setSaveDescription(loaded?.description ?? ""); setSaveOpen(true);
        }}>{loaded ? "Save as new" : "Save query"}</Button>
        <Button icon={<CopyRegular />} disabled={!!validation.length || !clauses.length} onClick={() => void copy(JSON.stringify({ version: 1, ...input() }, null, 2))}>Copy reusable query JSON</Button>
        <Button disabled={paired || !!validation.length || !clauses.length} onClick={() => void copy(JSON.stringify(clauses, null, 2))}>Copy clauses JSON</Button>
      </div>
      {draft.mode === "basic" && !paired && <details><summary>Generated clauses (read-only)</summary><pre className={styles.json}>{JSON.stringify(builderClauses, null, 2)}</pre></details>}
    </Card>
    {busy && <div role="status" className={styles.row}><Spinner size="tiny" />{busy === "export" ? `Fetching export: ${execution?.rows.length.toLocaleString()} rows loaded...` : busy === "more" ? "Loading next page..." : paired ? `Scanning connector evidence: ${scanCount.toLocaleString()} candidate rows checked...` : "Running query..."}</div>}
    {execution && <Card className={styles.section}>
      <div className={styles.row}><Text as="h2" weight="semibold">Results</Text>
        <Text>{execution.rows.length.toLocaleString()} loaded{execution.complete ? " - complete" : " - incomplete / more available"}; approximately {execution.total.toLocaleString()} reported</Text>
      </div>
      <Text className={styles.muted}>Executed {new Date(execution.startedAt).toLocaleString()}. The continuation token, not the approximate total, determines completion.</Text>
      {stale && <Text role="status" className={styles.notice}>Query changed - run again. These results belong to the previous execution; continuation and export are disabled.</Text>}
      {execution.warning && <Text role="alert" className={styles.error}>{execution.warning}</Text>}
      {!genericResultShape(execution.rows, execution.clauses) && <Field label="Result columns">
        <Dropdown className={styles.control} multiselect value={columns.map((path) => columnFields.find((f) => f.path === path)?.label ?? path).join(", ")} selectedOptions={columns} onOptionSelect={(_e, d) => changeDraft({ columns: d.selectedOptions.length ? d.selectedOptions : undefined }, false)}>
          {columnFields.map((f) => <Option key={f.path} value={f.path} text={f.label}>{f.label} - {f.path}</Option>)}
        </Dropdown>
      </Field>}
      <div className={styles.row}>
        <Field label="CSV fields"><Dropdown className={styles.control} value={exportShape === "columns" ? "Displayed field paths (raw values)" : "All raw fields (flattened)"} selectedOptions={[exportShape]}
          onOptionSelect={(_e, d) => changeDraft({ exportShape: d.optionValue as "raw" | "columns" }, false)}>
          <Option value="columns">Displayed field paths (raw values)</Option><Option value="raw">All raw fields (flattened)</Option>
        </Dropdown></Field>
        <Button icon={<ArrowDownloadRegular />} disabled={stale || !!busy || !execution.rows.length} onClick={() => download(execution, "loaded")}>Export loaded ({execution.rows.length})</Button>
        <Button icon={<ArrowDownloadRegular />} disabled={stale || !!busy || !execution.rows.length || (!execution.complete && !execution.token)}
          onClick={() => void exportAll()}>Export complete result</Button>
        {execution.token && <Button appearance="primary" disabled={stale || !!busy} onClick={() => void loadMore()}>Load more</Button>}
        {busy === "export" && <Button onClick={() => {
          generation.current++; busyRef.current = false; setBusy(undefined); setPartial(execution);
          setError("Export cancelled. No file was downloaded; fetched rows are retained.");
        }}>Cancel export</Button>}
      </div>
      <Text className={styles.muted}>CSV preserves original IDs and field values, not resolved display names. Loaded exports contain only currently fetched rows.</Text>
      {partial && !stale && <div role="alert" className={styles.notice}>
        <Text>No complete file was downloaded. {partial.rows.length.toLocaleString()} rows are available for an explicitly partial export. </Text>
        <Button onClick={() => { download(partial, "partial"); setPartial(undefined); }}>Download partial CSV ({partial.rows.length})</Button>
        <Button onClick={() => setPartial(undefined)}>Keep results without downloading</Button>
      </div>}
      {!execution.rows.length ? <Text>No matching rows.</Text> : <QueryResults execution={execution} columns={columns} onError={reportError} />}
    </Card>}
    <Dialog open={saveOpen} onOpenChange={(_e, d) => setSaveOpen(d.open)}>
      <DialogSurface><DialogBody><DialogTitle>Save as new query</DialogTitle>
        <DialogContent><div className={styles.section}>
          <Field label="Name"><Input value={saveName} onChange={(_e, d) => setSaveName(d.value)} /></Field>
          <Field label="Description (optional)"><Textarea value={saveDescription} onChange={(_e, d) => setSaveDescription(d.value)} /></Field>
          <Text className={styles.muted}>Stored in this browser. Relative builder dates re-evaluate in Queries and dashboard tiles.</Text>
          {error && <Text role="alert" className={styles.error}>{error}</Text>}
        </div></DialogContent>
        <DialogActions><Button onClick={() => setSaveOpen(false)}>Cancel</Button><Button appearance="primary" disabled={!saveName.trim() || !!validation.length} onClick={() => {
          let created: SavedQuery | undefined;
          if (persist(() => { created = createSavedQuery(input()); }) && created) {
            changeDraft({ loadedId: created.id }, false); setSaveOpen(false); setNotice(`Saved ${created.name}.`);
          }
        }}>Save</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
    <Dialog open={!!renameTarget} onOpenChange={(_e, d) => { if (!d.open) setRenameTarget(undefined); }}>
      <DialogSurface><DialogBody><DialogTitle>Edit saved query details</DialogTitle>
        <DialogContent><div className={styles.section}>
          <Field label="Name"><Input value={renameTarget?.name ?? ""} onChange={(_e, d) => setRenameTarget((q) => q ? { ...q, name: d.value } : q)} /></Field>
          <Field label="Description"><Textarea value={renameTarget?.description ?? ""} onChange={(_e, d) => setRenameTarget((q) => q ? { ...q, description: d.value } : q)} /></Field>
          {error && <Text role="alert" className={styles.error}>{error}</Text>}
        </div></DialogContent>
        <DialogActions><Button onClick={() => setRenameTarget(undefined)}>Cancel</Button><Button appearance="primary" disabled={!renameTarget?.name.trim()} onClick={() => {
          if (renameTarget && persist(() => {
            if (!updateSavedQuery(renameTarget.id, { name: renameTarget.name, description: renameTarget.description })) throw new Error("Query no longer exists.");
          })) setRenameTarget(undefined);
        }}>Save details</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={(_e, d) => { if (!d.open) setDeleteTarget(undefined); }}>
      <DialogSurface><DialogBody><DialogTitle>Delete saved query?</DialogTitle>
        <DialogContent>{deleteTarget?.name} will be removed from this browser. Existing dashboard tiles keep their own query snapshot.
          {error && <Text role="alert" className={styles.error}>{error}</Text>}</DialogContent>
        <DialogActions><Button onClick={() => setDeleteTarget(undefined)}>Cancel</Button><Button appearance="primary" onClick={() => {
          if (deleteTarget && persist(() => deleteSavedQuery(deleteTarget.id))) {
            if (draft.loadedId === deleteTarget.id) changeDraft({ loadedId: undefined }, false);
            setDeleteTarget(undefined);
          }
        }}>Delete</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
    <Dialog open={importOpen} onOpenChange={(_e, d) => setImportOpen(d.open)}>
      <DialogSurface><DialogBody><DialogTitle>Import query JSON</DialogTitle>
        <DialogContent><Field label="Reusable query or raw clauses JSON"><Textarea rows={12} className={styles.textarea} value={importText} onChange={(_e, d) => setImportText(d.value)} /></Field>
          {error && <Text role="alert" className={styles.error}>{error}</Text>}</DialogContent>
        <DialogActions><Button onClick={() => setImportOpen(false)}>Cancel</Button><Button appearance="primary" disabled={!importText.trim()} onClick={importQuery}>Import draft</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </div>;
}
