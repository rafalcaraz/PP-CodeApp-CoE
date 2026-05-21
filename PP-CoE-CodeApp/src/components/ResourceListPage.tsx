import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  makeStyles,
  tokens,
  Text,
  DataGrid,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridBody,
  DataGridRow,
  DataGridCell,
  type TableColumnDefinition,
  Spinner,
  Button,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import type { DataResult } from "../data/inventory";
import { EmptyPane, ErrorPane, LoadingPane } from "./Status";
import { downloadCsv, rowsToCsv } from "../utils/csv";

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
  /** Returns one page. Called by the shell. `skipToken` undefined for page 1. */
  fetchPage: (skipToken?: string) => Promise<DataResult<ResourcePage<T>>>;
  filterControls: ReactNode;
  columns: TableColumnDefinition<T>[];
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

  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setRows([]);
      setSkipToken(undefined);
      setTotalRecords(0);
      setErrorMsg("");
      const res = await fetchRef.current(undefined);
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
    };
  }, [filterKey]);

  const loadMore = async () => {
    if (!skipToken || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchRef.current(skipToken);
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
    setLoadingMore(true);
    let token: string | undefined = skipToken;
    let safety = 100;
    while (token && safety-- > 0) {
      const res = await fetchRef.current(token);
      if (!res.ok) {
        setErrorMsg(res.error);
        break;
      }
      setRows((prev) => prev.concat(res.data.rows));
      token = res.data.skipToken;
      if (res.data.totalRecords) setTotalRecords(res.data.totalRecords);
    }
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

  const [exporting, setExporting] = useState(false);
  const stem = exportFilenameStem ?? title.toLowerCase().replace(/\s+/g, "-");

  const exportLoaded = () => {
    if (rows.length === 0) return;
    downloadCsv(stem, rowsToCsv(rows));
  };

  const exportAll = async () => {
    if (rows.length === 0) return;
    setExporting(true);
    const all: T[] = rows.slice();
    let token: string | undefined = skipToken;
    let safety = 200;
    while (token && safety-- > 0) {
      const res = await fetchRef.current(token);
      if (!res.ok) {
        setErrorMsg(res.error);
        break;
      }
      for (const r of res.data.rows) all.push(r);
      token = res.data.skipToken;
    }
    setExporting(false);
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
            <DataGrid
              items={rows}
              columns={columns}
              getRowId={getRowId}
              sortable={false}
              focusMode="composite"
            >
              <DataGridHeader>
                <DataGridRow>
                  {({ renderHeaderCell }) => (
                    <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                  )}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<T>>
                {({ item, rowId }) => (
                  <DataGridRow<T> key={rowId}>
                    {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                  </DataGridRow>
                )}
              </DataGridBody>
            </DataGrid>
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
