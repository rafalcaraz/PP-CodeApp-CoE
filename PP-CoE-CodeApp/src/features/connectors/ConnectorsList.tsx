/**
 * Connectors view — tenant connector catalog.
 *
 * Reads the shared connector catalog from the first-class inventory resource,
 * with the legacy environment-scoped API retained as a compatibility fallback.
 * A complete inventory snapshot classifies connector usage across Apps and
 * Flows; the fallback enriches known connectors without absence-based guesses.
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
  Link,
  Text,
  Title2,
  createTableColumn,
  makeStyles,
  tokens,
  type InputOnChangeData,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { LoadingPane, ErrorPane, EmptyPane } from "../../components/Status";
import { downloadCsv, rowsToCsv } from "../../utils/csv";
import {
  loadCatalog,
  useConnectorCatalog,
  type ConnectorEntry,
} from "./data";

/** Maps a connector entry to a CSV row with friendly, stable column
 *  headers matching the on-screen grid order. */
function connectorToCsvRow(
  entry: ConnectorEntry,
): Record<string, string | number | boolean> {
  return {
    "Display name": entry.displayName,
    Description: entry.description,
    Tier: entry.tier,
    "Release stage": entry.releaseTag,
    Deprecated: entry.isDeprecated,
    Publisher: entry.publisher,
    Operations: entry.operations.length,
    "Connector id": entry.connectorId,
  };
}

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
  connectorCell: {
    minWidth: 0,
    maxWidth: "320px",
  },
  connectorName: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  connectorDescription: {
    display: "block",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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

function ConnectorNameCell({ row }: { row: ConnectorEntry }) {
  const styles = useStyles();
  const navigate = useNavigate();
  return (
    <div className={styles.connectorCell}>
      <Link
        className={styles.connectorName}
        onClick={() =>
          navigate(`/connectors/${encodeURIComponent(row.connectorId)}`)
        }
      >
        {row.displayName}
      </Link>
      {row.description && (
        <Caption1
          className={styles.connectorDescription}
          title={row.description}
        >
          {row.description}
        </Caption1>
      )}
    </div>
  );
}

const COLUMNS: TableColumnDefinition<ConnectorEntry>[] = [
  createTableColumn<ConnectorEntry>({
    columnId: "displayName",
    compare: (a, b) => a.displayName.localeCompare(b.displayName),
    renderHeaderCell: () => "Display name",
    renderCell: (row) => <ConnectorNameCell row={row} />,
  }),
  createTableColumn<ConnectorEntry>({
    columnId: "releaseTag",
    compare: (a, b) => a.releaseTag.localeCompare(b.releaseTag),
    renderHeaderCell: () => "Release",
    renderCell: (row) =>
      row.releaseTag ? (
        <Badge appearance="outline">{row.releaseTag}</Badge>
      ) : (
        <Caption1>—</Caption1>
      ),
  }),
  createTableColumn<ConnectorEntry>({
    columnId: "isDeprecated",
    compare: (a, b) => Number(a.isDeprecated) - Number(b.isDeprecated),
    renderHeaderCell: () => "Status",
    renderCell: (row) =>
      row.isDeprecated ? (
        <Badge appearance="filled" color="danger">
          Deprecated
        </Badge>
      ) : (
        <Caption1>Active</Caption1>
      ),
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
    columnId: "operations",
    compare: (a, b) => a.operations.length - b.operations.length,
    renderHeaderCell: () => "Operations",
    renderCell: (row) => row.operations.length.toLocaleString(),
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
        r.publisher.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.releaseTag.toLowerCase().includes(q),
    );
  }, [allEntries, filterText]);

  const premiumCount = useMemo(
    () => allEntries.filter((r) => r.tier.toLowerCase() === "premium").length,
    [allEntries],
  );
  const deprecatedCount = useMemo(
    () => allEntries.filter((r) => r.isDeprecated).length,
    [allEntries],
  );
  const previewCount = useMemo(
    () =>
      allEntries.filter((r) =>
        r.releaseTag.toLowerCase().includes("preview"),
      ).length,
    [allEntries],
  );

  const hasFilter = filterText.trim().length > 0;

  const exportAll = useCallback(() => {
    if (allEntries.length === 0) return;
    downloadCsv("connectors", rowsToCsv(allEntries.map(connectorToCsvRow)));
  }, [allEntries]);

  const exportFiltered = useCallback(() => {
    if (filteredEntries.length === 0) return;
    downloadCsv(
      "connectors-filtered",
      rowsToCsv(filteredEntries.map(connectorToCsvRow)),
    );
  }, [filteredEntries]);

  const showLoading = status === "loading" && !catalog;
  const showError = status === "error" && !catalog;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Title2>Connectors</Title2>
        <Text className={styles.subtitle}>
          Tenant-wide connector catalog with licensing tier, release stage,
          deprecation status, publisher, and operations. Inventory catalog
          records are metadata, so they are intentionally excluded from
          operational resource totals and environment rollups.
        </Text>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.controlGroup}>
          <Caption1 className={styles.controlLabel}>
            Filter (name / id / publisher / release)
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
              {catalog.source === "inventory"
                ? "Inventory preview"
                : "ListConnectors fallback (partial)"}
              {" · "}refreshed {formatAge(catalog.fetchedAt)}
            </Caption1>
          )}
          <Button
            appearance="secondary"
            icon={<ArrowDownloadRegular />}
            onClick={exportAll}
            disabled={!catalog || allEntries.length === 0}
          >
            Export all
          </Button>
          <Button
            appearance="secondary"
            icon={<ArrowDownloadRegular />}
            onClick={exportFiltered}
            disabled={!catalog || !hasFilter || filteredEntries.length === 0}
          >
            Export filtered
          </Button>
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
            <Text>•</Text>
            <Text>
              <strong>{previewCount}</strong> preview
            </Text>
            <Text>•</Text>
            <Text>
              <strong>{deprecatedCount}</strong> deprecated
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
