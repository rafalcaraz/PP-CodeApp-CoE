import { useEffect, useMemo, useState } from "react";
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
  createTableColumn,
  Link,
  Badge,
  SearchBox,
  type SearchBoxChangeEvent,
  type InputOnChangeData,
  Spinner,
  Button,
} from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import { listEnvironmentsPage, type EnvironmentRow } from "./data";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { downloadCsv, rowsToCsv } from "../../utils/csv";

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
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    justifyContent: "space-between",
  },
  searchBox: {
    minWidth: "320px",
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  loadingMore: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
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

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function EnvironmentsList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [rows, setRows] = useState<EnvironmentRow[]>([]);
  const [skipToken, setSkipToken] = useState<string | undefined>(undefined);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setRows([]);
      setSkipToken(undefined);
      setTotalRecords(0);
      setErrorMsg("");
      const res = await listEnvironmentsPage();
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
  }, []);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.environmentType.toLowerCase().includes(q) ||
        r.environmentGroup.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const onSearchChange = (_e: SearchBoxChangeEvent, data: InputOnChangeData) => setQuery(data.value);

  const loadMore = async () => {
    if (!skipToken || loadingMore) return;
    setLoadingMore(true);
    const res = await listEnvironmentsPage(skipToken, 500, rows.length);
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
    let loaded = rows.length;
    let safety = 50;
    const collected: EnvironmentRow[] = [];
    while (token && safety-- > 0) {
      const res = await listEnvironmentsPage(token, 500, loaded + collected.length);
      if (!res.ok) {
        setErrorMsg(res.error);
        break;
      }
      collected.push(...res.data.rows);
      token = res.data.skipToken;
      if (res.data.totalRecords) setTotalRecords(res.data.totalRecords);
      if (res.data.rows.length === 0) break;
    }
    if (collected.length > 0) setRows((prev) => prev.concat(collected));
    setSkipToken(token);
    setLoadingMore(false);
    loaded += collected.length;
    void loaded;
  };

  const exportLoaded = () => {
    if (rows.length === 0) return;
    downloadCsv("environments", rowsToCsv(filteredRows));
  };

  const exportAll = async () => {
    if (rows.length === 0 || !skipToken || loadingMore) return;
    setLoadingMore(true);
    const all: EnvironmentRow[] = rows.slice();
    let token: string | undefined = skipToken;
    let safety = 200;
    while (token && safety-- > 0) {
      const res = await listEnvironmentsPage(token, 500, all.length);
      if (!res.ok) {
        setErrorMsg(res.error);
        break;
      }
      for (const r of res.data.rows) all.push(r);
      token = res.data.skipToken;
      if (res.data.rows.length === 0) break;
    }
    setRows(all);
    setSkipToken(token);
    setLoadingMore(false);
    downloadCsv("environments-all", rowsToCsv(all));
  };

  const columns: TableColumnDefinition<EnvironmentRow>[] = [
    createTableColumn<EnvironmentRow>({
      columnId: "name",
      renderHeaderCell: () => "Name",
      renderCell: (row) => (
        <Link onClick={() => navigate(`/environments/${encodeURIComponent(row.id)}`)}>
          {row.displayName || row.id}
        </Link>
      ),
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "environmentType",
      renderHeaderCell: () => "Type",
      renderCell: (row) => row.environmentType || "—",
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "region",
      renderHeaderCell: () => "Region",
      renderCell: (row) => row.region || "—",
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "isManaged",
      renderHeaderCell: () => "Managed",
      renderCell: (row) =>
        row.isManaged ? (
          <Badge appearance="filled" color="brand">
            Managed
          </Badge>
        ) : (
          <Badge appearance="outline">Standard</Badge>
        ),
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "environmentGroup",
      renderHeaderCell: () => "Group",
      renderCell: (row) =>
        row.environmentGroupId ? (
          <Link
            onClick={() =>
              navigate(`/environment-groups/${encodeURIComponent(row.environmentGroupId)}`)
            }
          >
            {row.environmentGroup || row.environmentGroupId}
          </Link>
        ) : (
          "—"
        ),
    }),
    createTableColumn<EnvironmentRow>({
      columnId: "createdAt",
      renderHeaderCell: () => "Created on",
      renderCell: (row) => formatDate(row.createdAt),
    }),
  ];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Environments
        </Text>
        <Text className={styles.subtitle}>
          All Power Platform environments visible to your admin account.
        </Text>
      </div>

      {phase === "loading" && rows.length === 0 && <LoadingPane label="Loading environments…" />}

      {phase === "error" && (
        <ErrorPane title="Couldn't load environments" message={errorMsg} />
      )}

      {phase === "ready" && (
        <>
          <div className={styles.toolbar}>
            <SearchBox
              className={styles.searchBox}
              placeholder="Search by name, ID, region, type, or group"
              value={query}
              onChange={onSearchChange}
              dismiss={null}
            />
            <Text className={styles.count}>
              {(() => {
                // The connector's totalRecords for QueryResources is approximate
                // and can be stale (we've seen 500 of 731 → 1000 of 731). Trust
                // rows.length as a floor and treat skipToken as the authoritative
                // "more exists" signal.
                const total = Math.max(totalRecords, rows.length);
                const totalLabel = skipToken ? `${total.toLocaleString()}+` : total.toLocaleString();
                return query
                  ? `${filteredRows.length.toLocaleString()} matching, showing ${rows.length.toLocaleString()} of ${totalLabel}`
                  : `Showing ${rows.length.toLocaleString()} of ${totalLabel}`;
              })()}
            </Text>
            <Button
              size="small"
              appearance="subtle"
              icon={<ArrowDownloadRegular />}
              onClick={exportLoaded}
              disabled={loadingMore || rows.length === 0}
            >
              Export ({filteredRows.length.toLocaleString()})
            </Button>
            {skipToken && (
              <Button
                size="small"
                appearance="subtle"
                icon={<ArrowDownloadRegular />}
                onClick={exportAll}
                disabled={loadingMore}
              >
                {loadingMore ? "Fetching all…" : "Export all"}
              </Button>
            )}
          </div>

          {rows.length === 0 ? (
            <EmptyPane message="No environments found." />
          ) : filteredRows.length === 0 ? (
            <EmptyPane
              message={
                skipToken
                  ? `No matches in the ${rows.length} environments loaded so far. Try "Load all remaining" below to search the rest.`
                  : `No environments match "${query}".`
              }
            />
          ) : (
            <DataGrid
              items={filteredRows}
              columns={columns}
              getRowId={(row) => row.id}
              sortable={false}
              focusMode="composite"
            >
              <DataGridHeader>
                <DataGridRow>
                  {({ renderHeaderCell }) => <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<EnvironmentRow>>
                {({ item, rowId }) => (
                  <DataGridRow<EnvironmentRow> key={rowId}>
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
        </>
      )}
    </div>
  );
}
