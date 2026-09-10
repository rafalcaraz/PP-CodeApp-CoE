/**
 * `DeepScanView` — the tenant-scan page.
 *
 * Wires the catalog (curated + observed), the scope picker, the
 * filter builder, the column picker, the runner, and the streaming
 * result table into one page.
 *
 * State machine (component-local):
 *
 *  ```
 *  idle ─[Run scan]──▶ scanning ─[done]──▶ ready
 *    ▲                    │
 *    │                    └─[Cancel]──▶ ready (summary.cancelled)
 *    │
 *    └─[Reset]──── ready
 *  ```
 *
 * The result table is preserved across scans so the user can compare
 * — clicking "Run" again replaces it atomically once the new scan
 * starts emitting matches.
 *
 * Visual Copilot Studio agent queries saved from the Queries view can
 * be loaded into the Inventory API candidate-filter stage.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  Button,
  Card,
  CardHeader,
  Dropdown,
  Option,
  Text,
  Divider,
  Link,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  PlayRegular,
  ArrowDownloadRegular,
  EyeRegular,
} from "@fluentui/react-icons";
import {
  CURATED_ADMIN_APPS,
  CURATED_COPILOT_AGENTS,
  type DeepFilterClause,
  type DeepQuerySpec,
  type DeepScanRow,
  type DeepScanScope,
  type DeepSourceId,
  type DriftWarning,
  type ScanSnapshot,
  cancelScan,
  detectDrift,
  getScanSnapshot,
  groupCatalog,
  loadObservedSchema,
  mergePropertyCatalog,
  resolveScope,
  resolveAgentCandidates,
  previewAgentCandidates,
  type AgentCandidatePreview,
  getAgentCandidateCatalog,
  listSavedAgentCandidateQueries,
  startScan,
  subscribeToScan,
  SOURCES,
  getSource,
  ADMIN_APPS_EXCLUDE_PREFIXES,
  COPILOT_AGENT_OBSERVED_HIDE_PREFIXES,
} from "./data";
import { ScopePicker } from "./components/ScopePicker";
import { FilterBuilder } from "./components/FilterBuilder";
import { ColumnPicker } from "./components/ColumnPicker";
import { ScanProgress } from "./components/ScanProgress";
import { ResultsTable } from "./components/ResultsTable";
import { rowsForCsv } from "./components/csvShaper";
import { DriftBanner } from "./components/DriftBanner";
import { ObservedSchemaPanel } from "./components/ObservedSchemaPanel";
import { ErrorPane } from "../../components/Status";
import { downloadCsv, rowsToCsv } from "../../utils/csv";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  pageHeader: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  card: {
    display: "flex",
    flexDirection: "column",
  },
  cardBody: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    justifyContent: "space-between",
  },
  errorList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  inlineError: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  actionGroup: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  previewPanel: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  previewList: {
    marginBlock: 0,
    paddingInlineStart: tokens.spacingHorizontalXL,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
});

type ScanPhase =
  | { kind: "idle" }
  | {
      kind: "scanning";
      progress: {
        scopeUnitsTotal: number;
        scopeUnitsDone: number;
        recordsScanned: number;
        matches: number;
        candidatesConsidered?: number;
        sourceRecordsProcessed?: number;
        scopeUnitsSkipped?: number;
      };
    }
  | {
      kind: "ready";
      summary: {
        scopeUnitsTotal: number;
        scopeUnitsDone: number;
        scopeUnitsErrored: number;
        recordsScanned: number;
        matches: number;
        candidatesConsidered: number;
        sourceRecordsProcessed: number;
        scopeUnitsSkipped: number;
        cancelled: boolean;
      };
    };

type CandidatePreviewPhase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ready"; result: AgentCandidatePreview }
  | { kind: "error"; message: string };

/** Subscribe to the shared scan store via `useSyncExternalStore`.
 *  The hook re-renders the view whenever the store emits — including
 *  when a scan that started on a previous mount is still running. */
function useScanSnapshot(): ScanSnapshot {
  return useSyncExternalStore(
    subscribeToScan,
    getScanSnapshot,
    getScanSnapshot
  );
}

export function DeepScanView() {
  const styles = useStyles();

  // ── Source (only one in v1; the dropdown is forward-looking) ─────
  const [sourceId, setSourceId] = useState<DeepSourceId>("admin-apps");
  const source = getSource(sourceId);

  // ── Subscribe to the shared scan store ───────────────────────────
  const snapshot = useScanSnapshot();
  const phase = snapshotToPhase(snapshot);
  const rows: DeepScanRow[] = snapshot.kind === "idle" ? [] : snapshot.rows;
  const scopeErrors = snapshot.kind === "idle" ? [] : snapshot.scopeErrors;

  // ── Catalog (curated + observed). Reloaded whenever the source
  //    changes or a scan completes (introspection refreshes the
  //    observed schema). The dependency on `finishedAt` invalidates
  //    the memo when a scan completes — we re-read localStorage
  //    fresh so the picker picks up newly discovered fields. ──────
  const finishedAt = snapshot.kind === "ready" ? snapshot.finishedAt : 0;
  const catalog = useMemo(() => {
    const observed = loadObservedSchema(sourceId);
    // Mirror the source's flatten-time exclude prefixes at the merge
    // layer too. That way any paths that were introspected & cached
    // BEFORE a new exclude was added still drop out of the picker
    // without forcing the user to clear their localStorage cache.
    const hidePrefixes =
      sourceId === "admin-apps"
        ? ADMIN_APPS_EXCLUDE_PREFIXES
        : sourceId === "copilot-agents-dataverse"
          ? COPILOT_AGENT_OBSERVED_HIDE_PREFIXES
          : undefined;
    return mergePropertyCatalog(curatedForSource(sourceId), observed, {
      hidePrefixes,
    });
    // finishedAt bump invalidates the memo after each scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, finishedAt]);
  const catalogGroups = useMemo(
    () => groupCatalog(catalog, { alwaysIncludeObservedGroup: true }),
    [catalog]
  );
  const candidateCatalog = useMemo(() => getAgentCandidateCatalog(), []);
  const candidateCatalogGroups = useMemo(
    () => groupCatalog(mergePropertyCatalog(candidateCatalog, undefined)),
    [candidateCatalog]
  );
  const savedAgentQueries = useMemo(() => listSavedAgentCandidateQueries(), []);

  // ── Drift warnings (derived from the most recent completed scan) ─
  // Pure derivation from the snapshot — no setState-in-effect needed.
  const drift: DriftWarning[] = useMemo(
    () =>
      snapshot.kind === "ready"
        ? detectDrift(
            curatedForSource(snapshot.spec.source),
          snapshot.summary.observedAfter,
          {
            includePresenceLow:
              snapshot.spec.source !== "copilot-agents-dataverse",
          },
        )
        : [],
    [snapshot]
  );

  // ── Scan spec (scope / filters / columns) ────────────────────────
  // These are the form inputs the user is editing right now. They
  // may differ from the spec of the currently-running / last-completed
  // scan (snapshot.spec). Bias toward "what the user typed" for the
  // form fields; "what the runner produced" for results / progress.
  const [scope, setScope] = useState<DeepScanScope>({ kind: "tenant" });
  const [filters, setFilters] = useState<DeepFilterClause[]>(() =>
    seedFiltersForSharepointForm()
  );
  const [candidateFilters, setCandidateFilters] = useState<DeepFilterClause[]>(
    []
  );
  const [savedCandidateQueryId, setSavedCandidateQueryId] = useState("");
  const [savedCandidateQueryError, setSavedCandidateQueryError] = useState("");
  const [candidatePreview, setCandidatePreview] =
    useState<CandidatePreviewPhase>({ kind: "idle" });
  const [columns, setColumns] = useState<string[]>([]);

  const canRun = isScopeValid(scope) && phase.kind !== "scanning";
  const normalizedCandidateFilters = useMemo(
    () =>
      candidateFilters.map((filter) => {
        const normalizedInput = filter.path.trim().toLowerCase();
        const entry = candidateCatalog.find(
          (candidate) =>
            candidate.path.toLowerCase() === normalizedInput ||
            candidate.label.toLowerCase() === normalizedInput
        );
        return entry ? { ...filter, path: entry.path } : filter;
      }),
    [candidateCatalog, candidateFilters]
  );

  const start = (): void => {
    const spec: DeepQuerySpec = {
      source: sourceId,
      scope,
      candidateFilters: normalizedCandidateFilters,
      filters,
      columns,
    };

    startScan(spec, resolveScope, {
      resolveCandidates: resolveAgentCandidates,
    });
  };

  const previewCandidates = async (): Promise<void> => {
    setCandidatePreview({ kind: "running" });
    try {
      const result = await previewAgentCandidates(
        {
          source: "copilot-agents-dataverse",
          scope,
          candidateFilters: normalizedCandidateFilters,
          filters: [],
          columns: [],
        },
        new AbortController().signal,
      );
      setCandidatePreview({ kind: "ready", result });
    } catch (error) {
      setCandidatePreview({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const cancel = (): void => {
    cancelScan();
  };

  const changeSource = (id: DeepSourceId): void => {
    if (id === sourceId) return;
    setSourceId(id);
    setCandidateFilters([]);
    setSavedCandidateQueryId("");
    setSavedCandidateQueryError("");
    setCandidatePreview({ kind: "idle" });
    setFilters(seedFiltersForSource(id));
    setColumns([]);
  };

  const changeScope = (next: DeepScanScope): void => {
    setScope(next);
    setCandidatePreview({ kind: "idle" });
  };

  // observedTick is now derived above as `finishedAt`. The
  // ObservedSchemaPanel uses it as a refresh key so its read of
  // localStorage stays in sync with what the runner wrote.

  const onExportCsv = (): void => {
    if (rows.length === 0) return;
    const csvRows = rowsForCsv(catalogGroups, columns, source.defaultColumns ?? [], rows);
    downloadCsv("deep-scan", rowsToCsv(csvRows));
  };

  return (
    <div className={styles.root}>
      <div className={styles.pageHeader}>
        <Text size={700} weight="semibold">
          Tenant scans
        </Text>
        <Text size={300}>
          Find resources by properties the base inventory doesn't carry —{" "}
          fans out bounded admin or Dataverse calls across environments and
          filters in real time. Results are cached for 10 minutes per
          environment.
        </Text>
      </div>

      <Card className={styles.card}>
        <CardHeader
          header={<Text weight="semibold">Scan setup</Text>}
          description={
            <Text size={200}>Pick a source, scope, filters, and columns.</Text>
          }
        />
        <Divider />
        <div className={styles.cardBody}>
          <div className={styles.field}>
            <Text className={styles.fieldLabel}>Source</Text>
            <Dropdown
              value={source.label}
              selectedOptions={[sourceId]}
              onOptionSelect={(_e, data) => {
                const id = data.optionValue as DeepSourceId | undefined;
                if (id && SOURCES[id]) changeSource(id);
              }}
            >
              {(Object.keys(SOURCES) as DeepSourceId[]).map((id) => (
                <Option key={id} value={id} text={SOURCES[id].label}>
                  {SOURCES[id].label}
                </Option>
              ))}
            </Dropdown>
          </div>

          <div className={styles.field}>
            <Text className={styles.fieldLabel}>Scope</Text>
            <ScopePicker value={scope} onChange={changeScope} />
          </div>

          {sourceId === "copilot-agents-dataverse" && (
            <div className={styles.field}>
              <Text className={styles.fieldLabel}>
                Candidate filters — Inventory API
              </Text>
              <Text size={200}>
                Applied before Dataverse calls. Leave empty to inspect every
                Copilot Studio agent in scope.
              </Text>
              <Dropdown
                placeholder="Load a saved Copilot Studio agent query…"
                value={
                  savedAgentQueries.find(
                    (query) => query.id === savedCandidateQueryId
                  )?.name ?? ""
                }
                selectedOptions={
                  savedCandidateQueryId ? [savedCandidateQueryId] : []
                }
                onOptionSelect={(_e, data) => {
                  const query = savedAgentQueries.find(
                    (item) => item.id === data.optionValue
                  );
                  if (!query) return;
                  setSavedCandidateQueryId(query.id);
                  if (query.error) {
                    setSavedCandidateQueryError(query.error);
                    return;
                  }
                  setSavedCandidateQueryError("");
                  setCandidateFilters(query.filters);
                  setCandidatePreview({ kind: "idle" });
                }}
              >
                {savedAgentQueries.map((query) => (
                  <Option key={query.id} value={query.id} text={query.name}>
                    {query.name}
                    {query.error ? " — incompatible filter" : ""}
                  </Option>
                ))}
              </Dropdown>
              {savedAgentQueries.length === 0 && (
                <Text size={200}>
                  No saved visual agent queries yet.{" "}
                  <Link href="#/queries">Create one in Queries</Link>.
                </Text>
              )}
              {savedCandidateQueryError && (
                <Text className={styles.inlineError}>
                  {savedCandidateQueryError}
                </Text>
              )}
              <FilterBuilder
                catalogGroups={candidateCatalogGroups}
                filters={candidateFilters}
                onChange={(next) => {
                  setCandidateFilters(next);
                  setSavedCandidateQueryId("");
                  setSavedCandidateQueryError("");
                  setCandidatePreview({ kind: "idle" });
                }}
              />
              <div className={styles.actionGroup}>
                <Button
                  appearance="secondary"
                  icon={<EyeRegular />}
                  onClick={() => void previewCandidates()}
                  disabled={!isScopeValid(scope) || candidatePreview.kind === "running"}
                >
                  {candidatePreview.kind === "running"
                    ? "Previewing candidates…"
                    : "Preview candidates"}
                </Button>
                <Text size={200}>
                  Inventory API only — this does not run ListRows-Dataverse.
                </Text>
              </div>
              {candidatePreview.kind === "error" && (
                <Text className={styles.inlineError}>
                  Candidate preview failed: {candidatePreview.message}
                </Text>
              )}
              {candidatePreview.kind === "ready" && (
                <div className={styles.previewPanel}>
                  <Text weight="semibold">
                    {candidatePreview.result.count.toLocaleString()} candidate
                    {candidatePreview.result.count === 1 ? "" : "s"} across{" "}
                    {candidatePreview.result.environmentsScanned}/
                    {candidatePreview.result.environmentsTotal} environments.
                  </Text>
                  {candidateFilters.length > 0 && (
                    <Text size={200}>
                      {candidatePreview.result.countBeforeFilters.toLocaleString()}{" "}
                      agents were found before applying the candidate filters.
                    </Text>
                  )}
                  {candidatePreview.result.filterDiagnostics.map(
                    (diagnostic) => (
                      <Text key={diagnostic.path} size={200}>
                        {diagnostic.path}:{" "}
                        {diagnostic.matched.toLocaleString()} matched; observed{" "}
                        {Object.entries(diagnostic.observedValues)
                          .map(
                            ([value, count]) =>
                              `${value} (${count.toLocaleString()})`,
                          )
                          .join(", ") || "no values"}.
                      </Text>
                    ),
                  )}
                  <Text size={200}>
                    ListRows-Dataverse has not run. Running the scan will query
                    Dataverse only for these candidates.
                  </Text>
                  {candidatePreview.result.sample.length > 0 && (
                    <>
                      <Text size={200}>
                        Showing the first{" "}
                        {candidatePreview.result.sample.length.toLocaleString()}:
                      </Text>
                      <ul className={styles.previewList}>
                        {candidatePreview.result.sample.map((candidate) => (
                          <li
                            key={`${candidate.environmentId}::${candidate.id}`}
                          >
                            {candidate.displayName} —{" "}
                            {candidate.environmentName}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {candidatePreview.result.errors.length > 0 && (
                    <Text className={styles.inlineError}>
                      {candidatePreview.result.errors.length} environment
                      {candidatePreview.result.errors.length === 1 ? "" : "s"}{" "}
                      could not be previewed.
                    </Text>
                  )}
                </div>
              )}
            </div>
          )}

          <div className={styles.field}>
            <Text className={styles.fieldLabel}>
              {sourceId === "copilot-agents-dataverse"
                ? "Match filters — Dataverse evidence"
                : "Filters"}
            </Text>
            {sourceId === "copilot-agents-dataverse" && (
              <Text size={200}>
                Capability flags describe detected configuration. The app does
                not classify features as preview or generally available.
              </Text>
            )}
            <FilterBuilder
              catalogGroups={catalogGroups}
              filters={filters}
              onChange={setFilters}
            />
          </div>

          <div className={styles.field}>
            <Text className={styles.fieldLabel}>Columns</Text>
            <ColumnPicker
              catalogGroups={catalogGroups}
              columns={columns}
              onChange={setColumns}
              defaultColumns={source.defaultColumns}
            />
          </div>

          <div className={styles.toolbar}>
            <div className={styles.actionGroup}>
              <Button
                appearance="primary"
                icon={<PlayRegular />}
                onClick={start}
                disabled={!canRun}
              >
                Run scan
              </Button>
            </div>
            <Link
              onClick={() => {
                setFilters(seedFiltersForSource(sourceId));
                setCandidateFilters([]);
                setSavedCandidateQueryId("");
                setSavedCandidateQueryError("");
                setCandidatePreview({ kind: "idle" });
                setColumns([]);
                setScope({ kind: "tenant" });
              }}
            >
              Reset
            </Link>
          </div>
        </div>
      </Card>

      {phase.kind === "scanning" && (
        <ScanProgress
          scopeUnitsTotal={phase.progress.scopeUnitsTotal}
          scopeUnitsDone={phase.progress.scopeUnitsDone}
          recordsScanned={phase.progress.recordsScanned}
          matches={phase.progress.matches}
          candidatesConsidered={phase.progress.candidatesConsidered}
          sourceRecordsProcessed={phase.progress.sourceRecordsProcessed}
          scopeUnitsSkipped={phase.progress.scopeUnitsSkipped}
          onCancel={cancel}
        />
      )}

      {phase.kind === "ready" && snapshot.kind === "ready" && (
        <ScanProgress
          scopeUnitsTotal={snapshot.summary.scopeUnitsTotal}
          scopeUnitsDone={snapshot.summary.scopeUnitsDone}
          recordsScanned={snapshot.summary.recordsScanned}
          matches={snapshot.summary.matches}
          candidatesConsidered={snapshot.summary.candidatesConsidered}
          sourceRecordsProcessed={snapshot.summary.sourceRecordsProcessed}
          scopeUnitsSkipped={snapshot.summary.scopeUnitsSkipped}
          summary={snapshot.summary}
        />
      )}

      <DriftBanner warnings={drift} />

      {scopeErrors.length > 0 && (
        <div className={styles.errorList}>
          {scopeErrors.map((e, idx) => (
            <ErrorPane
              key={`${e.scopeUnitId}-${idx}`}
              title={`Env error — ${e.scopeUnitName ?? e.scopeUnitId}`}
              message={e.message}
            />
          ))}
        </div>
      )}

      {(phase.kind === "ready" || rows.length > 0) && (
        <Card>
          <CardHeader
            header={
              <Text weight="semibold">
                Results ({rows.length.toLocaleString()})
              </Text>
            }
            description={
              <Text size={200}>
                Click a name to open the resource detail page. The
                Environment column links to the env detail.
              </Text>
            }
            action={
              <Button
                appearance="subtle"
                icon={<ArrowDownloadRegular />}
                onClick={onExportCsv}
                disabled={rows.length === 0}
              >
                Export CSV
              </Button>
            }
          />
          <Divider />
          <div className={styles.cardBody}>
            <ResultsTable
              catalogGroups={catalogGroups}
              columns={columns}
              defaultColumns={source.defaultColumns ?? []}
              rows={rows}
            />
          </div>
        </Card>
      )}

      <ObservedSchemaPanel
        sourceId={sourceId}
        refreshKey={finishedAt}
        onCleared={() => {
          /* The store's snapshot doesn't change on a manual schema
             clear, so we use `finishedAt` as the refresh key. The
             ObservedSchemaPanel re-reads localStorage on its own
             internal clearTick when its Clear button fires, which
             is what we want. */
        }}
      />
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function isScopeValid(scope: DeepScanScope): boolean {
  if (scope.kind === "tenant") return true;
  if (scope.kind === "envGroup") return !!scope.groupId;
  if (scope.kind === "env") return !!scope.envId;
  return false;
}

/** Project the shared store snapshot into the simpler `ScanPhase`
 *  the render path uses (idle / scanning / ready). The full snapshot
 *  is still consumed elsewhere (rows, scopeErrors, summary) — this is
 *  just a slim discriminator for the progress bar and the "is the
 *  Run button enabled?" check. */
function snapshotToPhase(snapshot: ScanSnapshot): ScanPhase {
  if (snapshot.kind === "idle") return { kind: "idle" };
  if (snapshot.kind === "running") {
    return { kind: "scanning", progress: snapshot.progress };
  }
  return {
    kind: "ready",
    summary: {
      scopeUnitsTotal: snapshot.summary.scopeUnitsTotal,
      scopeUnitsDone: snapshot.summary.scopeUnitsDone,
      scopeUnitsErrored: snapshot.summary.scopeUnitsErrored,
      recordsScanned: snapshot.summary.recordsScanned,
      matches: snapshot.summary.matches,
      candidatesConsidered: snapshot.summary.candidatesConsidered ?? 0,
      sourceRecordsProcessed: snapshot.summary.sourceRecordsProcessed ?? 0,
      scopeUnitsSkipped: snapshot.summary.scopeUnitsSkipped ?? 0,
      cancelled: snapshot.summary.cancelled,
    },
  };
}

/** Pre-populate the filter list with the SharePoint-form-app scan
 *  that motivated this whole feature. Lets the user see a useful
 *  starting point on first load — they can clear / change as needed. */
function seedFiltersForSharepointForm(): DeepFilterClause[] {
  return [
    {
      path: "properties.embeddedApp.type",
      op: "eq",
      value: "SharepointFormApp",
    },
  ];
}

function seedFiltersForSource(sourceId: DeepSourceId): DeepFilterClause[] {
  return sourceId === "admin-apps" ? seedFiltersForSharepointForm() : [];
}

function curatedForSource(sourceId: DeepSourceId) {
  return sourceId === "admin-apps"
    ? CURATED_ADMIN_APPS
    : CURATED_COPILOT_AGENTS;
}
