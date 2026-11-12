import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  makeStyles,
  tokens,
  Text,
  type TableColumnDefinition,
  Spinner,
  Button,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import type { DataResult } from "../data/inventory";
import { EmptyPane, ErrorPane, LoadingPane } from "./Status";
import { downloadCsv, rowsToCsv } from "../utils/csv";
import { ResourceTable, fromFluentColumns, type ViewColumn } from "../shared/resource-table";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    justifyContent: "space-between",
  },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    justifyContent: "center",
    paddingBlock: tokens.spacingVerticalM,
  },
  footerNote: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export interface ResourcePage<T> {
  rows: T[];
  skipToken?: string;
  totalRecords: number;
}

export interface ResourceListPageProps<T> {
  title: string;
  subtitle?: string;
  /** Stable serialization of current filter state. The shell refetches
   *  page 1 whenever this value changes. */
  filterKey: string;
  /** Returns one page. Called by the shell. `skipToken` undefined for page 1.
   *  `skip` is the number of rows already loaded — pass it through to the
   *  connector as the `Skip` offset so paging keeps advancing on connectors
   *  that don't honor `SkipToken` reliably. */
  fetchPage: (skipToken?: string, skip?: number) => Promise<DataResult<ResourcePage<T>>>;
  filterControls: ReactNode;
  columns: TableColumnDefinition<T>[];
  viewColumns?: ViewColumn<T>[];
  getRowId: (row: T) => string;
  emptyMessage?: string;
  /** Override the default "Showing X of Y" footer text. */
  countLabel?: (loaded: number, total: number) => string;
  /** Filename stem for CSV export (default: lowercase title). */
  exportFilenameStem?: string;
}

/** Generic, server-paginated list page used by Apps, Flows, Agents.
 *
 *  Behavior:
 *  - On mount and on `filterKey` change → reset and fetch page 1.
 *  - "Load more" → fetch next page, append.
 *  - "Load all remaining" → drain pages until no skipToken.
 *  - Error in initial fetch → ErrorPane; error mid-pagination → inline note. */
export function ResourceListPage<T>({
  title,
  subtitle,
  filterKey,
  fetchPage,
  filterControls,
  columns,
  viewColumns,
  getRowId,
  emptyMessage = "No matching items.",
  countLabel,
  exportFilenameStem,
}: ResourceListPageProps<T>) {
  const styles = useStyles();
  const [rows, setRows] = useState<T[]>([]);
  const [skipToken, setSkipToken] = useState<string | undefined>(undefined);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const generation = useRef(0);

  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(() => {
    const request = ++generation.current;
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setRows([]);
      setSkipToken(undefined);
      setTotalRecords(0);
      setErrorMsg("");
      setLoadingMore(false);
      setExporting(false);
      const res = await fetchRef.current(undefined, 0);
      if (cancelled) return;
      if (!res.ok) {
        setErrorMsg(res.error);
        setPhase("error");
        return;
      }
      setRows(res.data.rows);
      setSkipToken(res.data.skipToken);
      setTotalRecords(res.data.totalRecords);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
      generation.current = request + 1;
    };
  }, [filterKey]);

  const loadMore = async () => {
    if (!skipToken || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    setErrorMsg("");
    const res = await fetchRef.current(skipToken, rows.length);
    if (request !== generation.current) return;
    setLoadingMore(false);
    if (!res.ok) {
      setErrorMsg(res.error);
      return;
    }
    setRows((prev) => prev.concat(res.data.rows));
    setSkipToken(res.data.skipToken);
    if (res.data.totalRecords) setTotalRecords(res.data.totalRecords);
  };

  const loadAll = async () => {
    if (!skipToken || loadingMore) return;
    const request = generation.current;
    const fetch = fetchRef.current;
    setLoadingMore(true);
    setErrorMsg("");
    let token: string | undefined = skipToken;
    let safety = 100;
    const collected: T[] = [];
    const seen = new Set<string>();
    while (token && safety-- > 0) {
      if (seen.has(token)) {
        setErrorMsg("Loading stopped because pagination repeated. Loaded rows are incomplete; change filters or reload to retry.");
        break;
      }
      seen.add(token);
      const res = await fetch(token, rows.length + collected.length);
      if (request !== generation.current) return;
      if (!res.ok) {
        setErrorMsg(res.error);
        break;
      }
      collected.push(...res.data.rows);
      token = res.data.skipToken;
      if (res.data.totalRecords) setTotalRecords(res.data.totalRecords);
      if (res.data.rows.length === 0 && token) {
        setErrorMsg("Loading stopped because the connector returned no additional rows. Results are incomplete.");
        break;
      }
    }
    if (token && safety < 0) setErrorMsg("Load-all safety limit reached. Results are incomplete; more rows remain.");
    if (collected.length > 0) setRows((prev) => prev.concat(collected));
    setSkipToken(token);
    setLoadingMore(false);
  };

  const renderCount = () => {
    // The connector's totalRecords for QueryResources is approximate and
    // can be stale (we've seen 500 of 731 → 1000 of 731). Trust rows.length
    // as a floor and treat skipToken as the authoritative "more exists"
    // signal so we never undercount what the user can see.
    const total = Math.max(totalRecords, rows.length);
    const totalLabel = skipToken ? `${total.toLocaleString()}+` : total.toLocaleString();
    if (countLabel) return countLabel(rows.length, total);
    return `Showing ${rows.length.toLocaleString()} of ${totalLabel}`;
  };

  const stem = exportFilenameStem ?? title.toLowerCase().replace(/\s+/g, "-");

  const exportLoaded = () => {
    if (rows.length === 0) return;
    downloadCsv(stem, rowsToCsv(rows));
  };

  const exportAll = async () => {
    if (rows.length === 0) return;
    const request = generation.current;
    const fetch = fetchRef.current;
    setExporting(true);
    setErrorMsg("");
    const all: T[] = rows.slice();
    let token: string | undefined = skipToken;
    let safety = 200;
    let incomplete = false;
    const seen = new Set<string>();
    while (token && safety-- > 0) {
      if (seen.has(token)) {
        setErrorMsg("Export stopped because pagination repeated. No complete CSV was downloaded.");
        incomplete = true;
        break;
      }
      seen.add(token);
      const res = await fetch(token, all.length);
      if (request !== generation.current) return;
      if (!res.ok) {
        setErrorMsg(res.error);
        incomplete = true;
        break;
      }
      for (const r of res.data.rows) all.push(r);
      token = res.data.skipToken;
      if (res.data.rows.length === 0 && token) {
        setErrorMsg("Export stopped because pagination made no progress. No complete CSV was downloaded.");
        incomplete = true;
        break;
      }
    }
    if (token && !incomplete) {
      setErrorMsg("Export safety limit reached. No complete CSV was downloaded.");
      incomplete = true;
    }
    setExporting(false);
    if (incomplete) return;
    downloadCsv(`${stem}-all`, rowsToCsv(all));
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          {title}
        </Text>
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filters}>{filterControls}</div>
        {phase === "ready" && (
          <div style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM }}>
            <Text className={styles.count}>{renderCount()}</Text>
            {rows.length > 0 && (
              <>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<ArrowDownloadRegular />}
                  onClick={exportLoaded}
                  disabled={exporting}
                >
                  Export ({rows.length.toLocaleString()})
                </Button>
                {skipToken && (
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<ArrowDownloadRegular />}
                    onClick={exportAll}
                    disabled={exporting}
                  >
                    {exporting ? "Fetching all…" : "Export all"}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {phase === "loading" && <LoadingPane label={`Loading ${title.toLowerCase()}…`} />}

      {phase === "error" && (
        <ErrorPane title={`Couldn't load ${title.toLowerCase()}`} message={errorMsg} />
      )}

      {phase === "ready" && (
        <>
          {rows.length === 0 ? (
            <EmptyPane message={emptyMessage} />
          ) : (
            <ResourceTable
              label={title}
              rows={rows}
              columns={viewColumns ?? fromFluentColumns(columns)}
              getRowId={getRowId}
              persistence={{ key: `ppcoe.table.${stem}.v1` }}
              scope={skipToken ? "Sort and column filters apply to loaded rows only. Load all remaining to include the rest." : "Sort and column filters apply to all loaded results."}
            />
          )}

          {skipToken && (
            <div className={styles.footer}>
              {loadingMore ? (
                <>
                  <Spinner size="tiny" />
                  <Text className={styles.footerNote}>Loading more…</Text>
                </>
              ) : (
                <>
                  <Button appearance="primary" onClick={loadMore}>
                    Load more
                  </Button>
                  <Button appearance="subtle" onClick={loadAll}>
                    Load all remaining
                  </Button>
                </>
              )}
            </div>
          )}

          {errorMsg && phase === "ready" && (
            <Text className={styles.footerNote} style={{ color: tokens.colorPaletteRedForeground1 }}>
              {errorMsg}
            </Text>
          )}
        </>
      )}
    </div>
  );
}
