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
 * **No saved-queries integration in v1.** The spec is held in
 * component state; users can re-author the filter to reproduce a
 * scan. The saved-queries plumbing is a small follow-up (extend
 * `savedQueries.ts` with a `kind: 'deep'` discriminator) but kept
 * out of v1 to ship the framework first. The plan document calls
 * this out.
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
import { PlayRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import {
  CURATED_ADMIN_APPS,
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
  startScan,
  subscribeToScan,
  SOURCES,
  getSource,
  ADMIN_APPS_EXCLUDE_PREFIXES,
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
        cancelled: boolean;
      };
    };

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
      sourceId === "admin-apps" ? ADMIN_APPS_EXCLUDE_PREFIXES : undefined;
    return mergePropertyCatalog(CURATED_ADMIN_APPS, observed, { hidePrefixes });
    // finishedAt bump invalidates the memo after each scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, finishedAt]);
  const catalogGroups = useMemo(
    () => groupCatalog(catalog, { alwaysIncludeObservedGroup: true }),
    [catalog]
  );

  // ── Drift warnings (derived from the most recent completed scan) ─
  // Pure derivation from the snapshot — no setState-in-effect needed.
  const drift: DriftWarning[] = useMemo(
    () =>
      snapshot.kind === "ready"
        ? detectDrift(CURATED_ADMIN_APPS, snapshot.summary.observedAfter)
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
  const [columns, setColumns] = useState<string[]>([]);

  const canRun = isScopeValid(scope) && phase.kind !== "scanning";

  const start = (): void => {
    const spec: DeepQuerySpec = {
      source: sourceId,
      scope,
      filters,
      columns,
    };
    startScan(spec, resolveScope);
  };

  const cancel = (): void => {
    cancelScan();
  };

  const changeSource = (id: DeepSourceId): void => {
    if (id === sourceId) return;
    setSourceId(id);
  };

  const changeScope = (next: DeepScanScope): void => {
    setScope(next);
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
          fans out admin-scope calls across environments and filters in real
          time. Results are cached for 10 minutes per environment.
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

          <div className={styles.field}>
            <Text className={styles.fieldLabel}>Filters</Text>
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
            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={start}
              disabled={!canRun}
            >
              Run scan
            </Button>
            <Link
              onClick={() => {
                setFilters([]);
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
          onCancel={cancel}
        />
      )}

      {phase.kind === "ready" && snapshot.kind === "ready" && (
        <ScanProgress
          scopeUnitsTotal={snapshot.summary.scopeUnitsTotal}
          scopeUnitsDone={snapshot.summary.scopeUnitsDone}
          recordsScanned={snapshot.summary.recordsScanned}
          matches={snapshot.summary.matches}
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


