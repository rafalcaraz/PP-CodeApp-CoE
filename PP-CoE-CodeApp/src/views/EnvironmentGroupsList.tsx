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
  SearchBox,
  type SearchBoxChangeEvent,
  type InputOnChangeData,
  Button,
} from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { listEnvironmentGroups, type EnvironmentGroupRow } from "../data/inventory";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
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
});

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function EnvironmentGroupsList() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; rows: EnvironmentGroupRow[] }
  >({ kind: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listEnvironmentGroups();
      if (cancelled) return;
      if (res.ok) {
        setState({ kind: "ready", rows: res.data });
      } else {
        setState({ kind: "error", message: res.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.rows;
    return state.rows.filter((r) => {
      return (
        r.displayName.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q)
      );
    });
  }, [state, query]);

  const onSearchChange = (_e: SearchBoxChangeEvent, data: InputOnChangeData) => {
    setQuery(data.value);
  };

  const columns: TableColumnDefinition<EnvironmentGroupRow>[] = [
    createTableColumn<EnvironmentGroupRow>({
      columnId: "name",
      renderHeaderCell: () => "Name",
      renderCell: (row) => (
        <Link onClick={() => navigate(`/environment-groups/${encodeURIComponent(row.id)}`)}>
          {row.displayName || row.id}
        </Link>
      ),
    }),
    createTableColumn<EnvironmentGroupRow>({
      columnId: "description",
      renderHeaderCell: () => "Description",
      renderCell: (row) => row.description || "—",
    }),
    createTableColumn<EnvironmentGroupRow>({
      columnId: "createdAt",
      renderHeaderCell: () => "Created on",
      renderCell: (row) => formatDate(row.createdAt),
    }),
    createTableColumn<EnvironmentGroupRow>({
      columnId: "location",
      renderHeaderCell: () => "Location",
      renderCell: (row) => row.location || "—",
    }),
  ];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Environment groups
        </Text>
        <Text className={styles.subtitle}>
          Logical groupings of environments managed by Managed Environments policies.
        </Text>
      </div>

      {state.kind === "loading" && <LoadingPane label="Loading environment groups…" />}

      {state.kind === "error" && (
        <ErrorPane title="Couldn't load environment groups" message={state.message} />
      )}

      {state.kind === "ready" && (
        <>
          <div className={styles.toolbar}>
            <SearchBox
              className={styles.searchBox}
              placeholder="Search by name, description, ID, or location"
              value={query}
              onChange={onSearchChange}
              dismiss={null}
            />
            <Text className={styles.count}>
              {filteredRows.length} of {state.rows.length}
            </Text>
            {state.rows.length > 0 && (
              <Button
                size="small"
                appearance="subtle"
                icon={<ArrowDownloadRegular />}
                onClick={() =>
                  downloadCsv("environment-groups", rowsToCsv(filteredRows))
                }
              >
                Export ({filteredRows.length.toLocaleString()})
              </Button>
            )}
          </div>

          {state.rows.length === 0 ? (
            <EmptyPane message="No environment groups found in this tenant." />
          ) : filteredRows.length === 0 ? (
            <EmptyPane message={`No environment groups match "${query}".`} />
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
              <DataGridBody<EnvironmentGroupRow>>
                {({ item, rowId }) => (
                  <DataGridRow<EnvironmentGroupRow> key={rowId}>
                    {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                  </DataGridRow>
                )}
              </DataGridBody>
            </DataGrid>
          )}
        </>
      )}
    </div>
  );
}
