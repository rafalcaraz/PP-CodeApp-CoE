import { useEffect, useMemo, useRef, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
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
import { ResourceTable, fromFluentColumns, type ViewColumn } from "../../shared/resource-table";

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
  const generation = useRef(0);
  const paging = useRef(false);

  useEffect(() => {
    const request = ++generation.current;
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
      generation.current = request + 1;
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
    if (!skipToken || paging.current) return;
    const request = generation.current;
    paging.current = true;
    setLoadingMore(true);
    setErrorMsg("");
    try {
      const res = await listEnvironmentsPage(skipToken, 500, rows.length);
      if (request !== generation.current) return;
      if (!res.ok) {
        setErrorMsg(res.error);
        return;
      }
      setRows((prev) => prev.concat(res.data.rows));
      setSkipToken(res.data.skipToken);
      if (res.data.totalRecords) setTotalRecords(res.data.totalRecords);
      if (!res.data.rows.length && res.data.skipToken) {
        setErrorMsg("Loading stopped because the connector returned an empty page with more results pending.");
      }
    } catch (cause) {
      if (request === generation.current) setErrorMsg(`Loading failed: ${String(cause)}`);
    } finally {
      if (request === generation.current) {
        paging.current = false;
        setLoadingMore(false);
      }
    }
  };

  const loadRemaining = async (exportAfter: boolean) => {
    if (!skipToken || paging.current) return;
    const request = generation.current;
    paging.current = true;
    setLoadingMore(true);
    setErrorMsg("");
    let token: string | undefined = skipToken;
    let safety = exportAfter ? 200 : 50;
    const all = rows.slice();
    let failure = "";
    const seen = new Set<string>();
    try {
      while (token && safety-- > 0) {
        if (seen.has(token)) {
          failure = "The connector repeated a continuation token.";
          break;
        }
        seen.add(token);
        const res = await listEnvironmentsPage(token, 500, all.length);
        if (request !== generation.current) return;
        if (!res.ok) {
          failure = res.error;
          break;
        }
        all.push(...res.data.rows);
        token = res.data.skipToken;
        if (res.data.totalRecords) setTotalRecords(res.data.totalRecords);
        if (!res.data.rows.length && token) {
          failure = "The connector returned an empty page with more results pending.";
          break;
        }
      }
      if (token && !failure) failure = "The safety page limit was reached with more results pending.";
    } catch (cause) {
      failure = String(cause);
    } finally {
      if (request === generation.current) {
        setRows(all);
        setSkipToken(token);
        paging.current = false;
        setLoadingMore(false);
        if (failure) setErrorMsg(`Loading incomplete: ${failure}${exportAfter ? " Export all was not downloaded." : ""}`);
      }
    }
    if (request === generation.current && exportAfter && !failure) {
      downloadCsv("environments-all", rowsToCsv(all));
    }
  };

  const exportLoaded = () => {
    if (rows.length === 0) return;
    downloadCsv("environments", rowsToCsv(filteredRows));
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

  const viewColumns: ViewColumn<EnvironmentRow>[] = [
    ...fromFluentColumns(columns, {
      name: { value: (row) => row.displayName || row.id },
      environmentType: { kind: "category" },
      region: { kind: "category" },
      isManaged: { kind: "boolean" },
      environmentGroup: { value: (row) => row.environmentGroup || row.environmentGroupId, exportValue: (row) => row.environmentGroupId },
      createdAt: { kind: "date" },
    }),
    { id: "id", label: "Environment ID", value: (row) => row.id, defaultVisible: false },
    { id: "createdBy", label: "Creator ID", value: (row) => row.createdBy, defaultVisible: false },
    { id: "lastModifiedAt", label: "Modified", kind: "date", value: (row) => row.lastModifiedAt, render: (row) => formatDate(row.lastModifiedAt), defaultVisible: false },
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
                onClick={() => void loadRemaining(true)}
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
          ) : null}
          <ResourceTable columns={viewColumns} rows={filteredRows} getRowId={(row) => row.id}
            label="Environments" persistence={{ key: "ppcoe.table.environments.v1" }}
            exportDisabled={loadingMore}
            scope="Sort and column filters apply to loaded environments matching the search. Load remaining results to include more environments." />
          {errorMsg && <ErrorPane title="Couldn't load all environments" message={errorMsg} />}

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
                  <Button appearance="subtle" onClick={() => void loadRemaining(false)}>
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
