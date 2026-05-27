/**
 * Connectors view — tenant connector catalog.
 *
 * Reads the shared connector catalog (a single `ListConnectors` call
 * against the first reachable env, cached for 24h in localStorage) and
 * shows every Microsoft / certified third-party connector along with
 * its tier and publisher. This is the same catalog the Apps and Flows
 * lists use to flag premium resources.
 *
 * No env picker — the catalog auto-bootstraps from the user's first
 * available environment. Refresh button forces a re-fetch and updates
 * the cached snapshot.
 */
import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Caption1,
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Input,
  Text,
  Title2,
  createTableColumn,
  makeStyles,
  tokens,
  type InputOnChangeData,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import { ArrowClockwiseRegular } from "@fluentui/react-icons";
import { LoadingPane, ErrorPane, EmptyPane } from "../../components/Status";
import {
  loadCatalog,
  useConnectorCatalog,
  type ConnectorEntry,
} from "./data";

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
    alignItems: "flex-end",
    gap: tokens.spacingHorizontalM,
    justifyContent: "space-between",
  },
  controlGroup: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    minWidth: "260px",
  },
  controlLabel: {
    color: tokens.colorNeutralForeground3,
  },
  filterInput: {
    minWidth: "260px",
  },
  summary: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    color: tokens.colorNeutralForeground3,
  },
  refreshGroup: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
});

function tierBadgeColor(
  tier: string,
):
  | "brand"
  | "danger"
  | "important"
  | "informative"
  | "severe"
  | "subtle"
  | "success"
  | "warning" {
  const t = tier.toLowerCase();
  if (t === "premium") return "warning";
  if (t === "standard") return "informative";
  return "subtle";
}

const COLUMNS: TableColumnDefinition<ConnectorEntry>[] = [
  createTableColumn<ConnectorEntry>({
    columnId: "displayName",
    compare: (a, b) => a.displayName.localeCompare(b.displayName),
    renderHeaderCell: () => "Display name",
    renderCell: (row) => <Text weight="semibold">{row.displayName}</Text>,
  }),
  createTableColumn<ConnectorEntry>({
    columnId: "tier",
    compare: (a, b) => a.tier.localeCompare(b.tier),
    renderHeaderCell: () => "Tier",
    renderCell: (row) =>
      row.tier ? (
        <Badge appearance="filled" color={tierBadgeColor(row.tier)}>
          {row.tier}
        </Badge>
      ) : (
        <Caption1>—</Caption1>
      ),
  }),
  createTableColumn<ConnectorEntry>({
    columnId: "publisher",
    compare: (a, b) => a.publisher.localeCompare(b.publisher),
    renderHeaderCell: () => "Publisher",
    renderCell: (row) => row.publisher || <Caption1>—</Caption1>,
  }),
  createTableColumn<ConnectorEntry>({
    columnId: "connectorId",
    compare: (a, b) => a.connectorId.localeCompare(b.connectorId),
    renderHeaderCell: () => "Connector id",
    renderCell: (row) => <Caption1>{row.connectorId}</Caption1>,
  }),
];

function formatAge(fetchedAt: number): string {
  const minutes = Math.floor((Date.now() - fetchedAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} day(s) ago`;
}

export function ConnectorsList() {
  const styles = useStyles();
  const { catalog, status, error } = useConnectorCatalog();
  const [filterText, setFilterText] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadCatalog({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const allEntries = useMemo<ConnectorEntry[]>(
    () =>
      catalog
        ? Array.from(catalog.entries.values()).sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          )
        : [],
    [catalog],
  );

  const filteredEntries = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.connectorId.toLowerCase().includes(q) ||
        r.publisher.toLowerCase().includes(q),
    );
  }, [allEntries, filterText]);

  const premiumCount = useMemo(
    () => allEntries.filter((r) => r.tier.toLowerCase() === "premium").length,
    [allEntries],
  );

  const showLoading = status === "loading" && !catalog;
  const showError = status === "error" && !catalog;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Title2>Connectors</Title2>
        <Text className={styles.subtitle}>
          Tenant-wide catalog of Microsoft and certified third-party
          connectors, with their tier (Standard / Premium) and publisher.
          Sourced from a single <code>ListConnectors</code> call against the
          first reachable environment and cached for 24 hours — used by the
          Apps and Flows lists to flag premium resources.
        </Text>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.controlGroup}>
          <Caption1 className={styles.controlLabel}>
            Filter (name / id / publisher)
          </Caption1>
          <Input
            className={styles.filterInput}
            value={filterText}
            placeholder="Type to filter…"
            disabled={!catalog}
            onChange={(_e, data: InputOnChangeData) => setFilterText(data.value)}
          />
        </div>
        <div className={styles.refreshGroup}>
          {catalog && (
            <Caption1 className={styles.controlLabel}>
              Refreshed {formatAge(catalog.fetchedAt)}
            </Caption1>
          )}
          <Button
            appearance="secondary"
            icon={<ArrowClockwiseRegular />}
            onClick={onRefresh}
            disabled={refreshing || status === "loading"}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {showLoading && <LoadingPane label="Loading connector catalog…" />}

      {showError && (
        <ErrorPane title="Could not load connector catalog" message={error} />
      )}

      {catalog && (
        <>
          <div className={styles.summary}>
            <Text>
              <strong>{allEntries.length}</strong> connectors in catalog
            </Text>
            <Text>•</Text>
            <Text>
              <strong>{premiumCount}</strong> premium
            </Text>
            {filterText.trim() && (
              <>
                <Text>•</Text>
                <Text>
                  showing <strong>{filteredEntries.length}</strong> after filter
                </Text>
              </>
            )}
          </div>

          {filteredEntries.length === 0 ? (
            <EmptyPane message="No connectors match the current filter." />
          ) : (
            <DataGrid
              items={filteredEntries}
              columns={COLUMNS}
              sortable
              getRowId={(row) => row.connectorId}
              focusMode="composite"
            >
              <DataGridHeader>
                <DataGridRow>
                  {({ renderHeaderCell }) => (
                    <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                  )}
                </DataGridRow>
              </DataGridHeader>
              <DataGridBody<ConnectorEntry>>
                {({ item, rowId }) => (
                  <DataGridRow<ConnectorEntry> key={rowId}>
                    {({ renderCell }) => (
                      <DataGridCell>{renderCell(item)}</DataGridCell>
                    )}
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
