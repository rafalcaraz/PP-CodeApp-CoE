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

import { useMemo, useState } from "react";
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
  type DeepScanScopeError,
  type DeepSourceId,
  type ScanEvent,
  type ScanSummary,
  type DriftWarning,
  detectDrift,
  groupCatalog,
  loadObservedSchema,
  mergePropertyCatalog,
  resolveScope,
  runDeepScan,
  SOURCES,
  getSource,
} from "./data";
import { ScopePicker } from "./components/ScopePicker";
import { FilterBuilder } from "./components/FilterBuilder";
import { ColumnPicker } from "./components/ColumnPicker";
import { ScanProgress } from "./components/ScanProgress";
import { ResultsTable } from "./components/ResultsTable";
import { rowsForCsv } from "./components/csvShaper";
import { DriftBanner } from "./components/DriftBanner";
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
      controller: AbortController;
      progress: {
        scopeUnitsTotal: number;
        scopeUnitsDone: number;
        recordsScanned: number;
        matches: number;
      };
    }
  | { kind: "ready"; summary: ScanSummary };

export function DeepScanView() {
  const styles = useStyles();

  // ── Source (only one in v1; the dropdown is forward-looking) ─────
  const [sourceId, setSourceId] = useState<DeepSourceId>("admin-apps");
  const source = getSource(sourceId);

  // ── Catalog (curated + observed). Reloaded whenever the source
  //    changes or after a scan completes (introspection bumps it). ──
  const [observedTick, setObservedTick] = useState(0);
  const catalog = useMemo(() => {
    const observed = loadObservedSchema(sourceId);
    return mergePropertyCatalog(CURATED_ADMIN_APPS, observed);
    // observedTick → bump invalidates the memo after each scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, observedTick]);
  const catalogGroups = useMemo(() => groupCatalog(catalog), [catalog]);

  // ── Scan spec (scope / filters / columns) ────────────────────────
  const [scope, setScope] = useState<DeepScanScope>({ kind: "tenant" });
  const [filters, setFilters] = useState<DeepFilterClause[]>(() =>
    seedFiltersForSharepointForm()
  );
  const [columns, setColumns] = useState<string[]>([]);

  // ── Run state ────────────────────────────────────────────────────
  const [phase, setPhase] = useState<ScanPhase>({ kind: "idle" });
  const [rows, setRows] = useState<DeepScanRow[]>([]);
  const [scopeErrors, setScopeErrors] = useState<DeepScanScopeError[]>([]);
  const [drift, setDrift] = useState<DriftWarning[]>([]);
  const [topError, setTopError] = useState<string | null>(null);

  // Reset transient state when scope-defining inputs change so the
  // previous scan's results don't linger and confuse the user. We do
  // this in the setter handlers (`changeSource`, `changeScope`)
  // rather than a useEffect — React 19's rules-of-hooks lint flags
  // setState calls inside effects as a cascading-render anti-pattern,
  // and this is precisely the "derive state from props" case the new
  // rule warns against. Wrapping setters captures the same intent
  // without the effect.
  const resetTransientState = (): void => {
    setRows([]);
    setScopeErrors([]);
    setDrift([]);
    setTopError(null);
    setPhase({ kind: "idle" });
  };

  const changeSource = (id: DeepSourceId): void => {
    if (id === sourceId) return;
    setSourceId(id);
    resetTransientState();
  };

  const changeScope = (next: DeepScanScope): void => {
    if (next.kind !== scope.kind) {
      resetTransientState();
    }
    setScope(next);
  };

  const canRun = isScopeValid(scope) && phase.kind !== "scanning";

  const start = async (): Promise<void> => {
    const controller = new AbortController();
    setPhase({
      kind: "scanning",
      controller,
      progress: { scopeUnitsTotal: 0, scopeUnitsDone: 0, recordsScanned: 0, matches: 0 },
    });
    setRows([]);
    setScopeErrors([]);
    setDrift([]);
    setTopError(null);

    const spec: DeepQuerySpec = {
      source: sourceId,
      scope,
      filters,
      columns,
    };

    try {
      for await (const event of runDeepScan(spec, resolveScope, {
        signal: controller.signal,
      })) {
        handleEvent(event);
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err));
      setPhase({
        kind: "ready",
        summary: emptySummary(),
      });
    }
  };

  const handleEvent = (event: ScanEvent): void => {
    if (event.kind === "progress") {
      setPhase((prev) => {
        if (prev.kind !== "scanning") return prev;
        return {
          ...prev,
          progress: {
            scopeUnitsTotal: event.scopeUnitsTotal,
            scopeUnitsDone: event.scopeUnitsDone,
            recordsScanned: event.recordsScanned,
            matches: event.matches,
          },
        };
      });
      return;
    }
    if (event.kind === "match") {
      setRows((prev) => [...prev, event.row]);
      return;
    }
    if (event.kind === "scopeUnitError") {
      setScopeErrors((prev) => [...prev, event.error]);
      return;
    }
    if (event.kind === "done") {
      setPhase({ kind: "ready", summary: event.summary });
      // Bump observed-schema tick so the catalog merger picks up
      // any new discovered fields the introspector wrote.
      setObservedTick((t) => t + 1);
      // Run drift detection against the post-scan observed schema.
      setDrift(detectDrift(CURATED_ADMIN_APPS, event.summary.observedAfter));
    }
  };

  const cancel = (): void => {
    if (phase.kind === "scanning") phase.controller.abort();
  };

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

      {topError && (
        <ErrorPane title="Couldn't run scan" message={topError} />
      )}

      {phase.kind === "scanning" && (
        <ScanProgress
          scopeUnitsTotal={phase.progress.scopeUnitsTotal}
          scopeUnitsDone={phase.progress.scopeUnitsDone}
          recordsScanned={phase.progress.recordsScanned}
          matches={phase.progress.matches}
          onCancel={cancel}
        />
      )}

      {phase.kind === "ready" && (
        <ScanProgress
          scopeUnitsTotal={phase.summary.scopeUnitsTotal}
          scopeUnitsDone={phase.summary.scopeUnitsDone}
          recordsScanned={phase.summary.recordsScanned}
          matches={phase.summary.matches}
          summary={phase.summary}
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

function emptySummary(): ScanSummary {
  return {
    scopeUnitsTotal: 0,
    scopeUnitsDone: 0,
    scopeUnitsErrored: 0,
    recordsScanned: 0,
    matches: 0,
    errors: [],
    cancelled: false,
    observedAfter: loadObservedSchema("admin-apps"),
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
