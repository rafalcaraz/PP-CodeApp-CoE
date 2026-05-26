/**
 * Streaming result table for deep-scan matches.
 *
 * Renders one row per match as they arrive. Cells follow either the
 * user-picked column list or the source's default columns when none
 * is set. The display-name cell links back to the existing detail
 * page (Apps detail today; future sources route to their own pages).
 *
 * Coerces cell values for display:
 *  - `null` / `undefined` → "—"
 *  - `boolean` → "Yes" / "No"
 *  - arrays / objects → compact JSON
 *  - other primitives → `String(value)`
 *
 * Exports a single `ResultsTable` component plus a small CSV helper
 * the parent uses for the export button.
 */

import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Link,
  Text,
  createTableColumn,
  makeStyles,
  tokens,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import type {
  CatalogGroup,
  DeepScanRow,
  PropertyCatalogEntry,
} from "../data";

const useStyles = makeStyles({
  root: {
    overflow: "auto",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "60vh",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    padding: tokens.spacingHorizontalL,
    textAlign: "center",
  },
  envCell: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface ResultsTableProps {
  catalogGroups: CatalogGroup[];
  /** Column paths the table should render in addition to the
   *  fixed "Name" column. Empty → use `defaultColumns`. */
  columns: string[];
  defaultColumns: string[];
  rows: DeepScanRow[];
}

export function ResultsTable({
  catalogGroups,
  columns,
  defaultColumns,
  rows,
}: ResultsTableProps) {
  const styles = useStyles();
  const navigate = useNavigate();
  const effectiveColumns = columns.length > 0 ? columns : defaultColumns;

  if (rows.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          No matches yet. Adjust the filter or run the scan again.
        </div>
      </div>
    );
  }

  const dynamicCols: TableColumnDefinition<DeepScanRow>[] = effectiveColumns.map(
    (path) =>
      createTableColumn<DeepScanRow>({
        columnId: path,
        renderHeaderCell: () => labelForPath(catalogGroups, path),
        renderCell: (row) => formatCell(row.cells[path] ?? lookupRaw(row, path)),
      })
  );

  const cols: TableColumnDefinition<DeepScanRow>[] = [
    createTableColumn<DeepScanRow>({
      columnId: "__name",
      renderHeaderCell: () => "Name",
      renderCell: (row) => (
        <Link
          onClick={() => navigate(detailPathFor(row))}
          appearance="default"
        >
          {row.identity.displayName || row.identity.id}
        </Link>
      ),
    }),
    createTableColumn<DeepScanRow>({
      columnId: "__env",
      renderHeaderCell: () => "Environment",
      renderCell: (row) => (
        <Link
          appearance="subtle"
          onClick={() =>
            navigate(`/environments/${encodeURIComponent(row.identity.environmentId)}`)
          }
        >
          <Text className={styles.envCell}>{row.identity.environmentId}</Text>
        </Link>
      ),
    }),
    ...dynamicCols,
  ];

  return (
    <div className={styles.root}>
      <DataGrid
        items={rows}
        columns={cols}
        getRowId={(row) => `${row.identity.environmentId}::${row.identity.id}`}
        size="small"
      >
        <DataGridHeader>
          <DataGridRow>
            {({ renderHeaderCell }) => (
              <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
            )}
          </DataGridRow>
        </DataGridHeader>
        <DataGridBody<DeepScanRow>>
          {({ item, rowId }) => (
            <DataGridRow<DeepScanRow> key={rowId}>
              {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
    </div>
  );
}

// ─── cell formatting ────────────────────────────────────────────────

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((v) => (typeof v === "object" ? safeJson(v) : String(v))).join("; ");
  }
  if (typeof value === "object") return safeJson(value);
  return String(value);
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch {
    return String(value);
  }
}

function lookupRaw(row: DeepScanRow, path: string): unknown {
  // Used as a fallback when a column path wasn't in `cells` (e.g. the
  // user added a column after the scan finished). Walk the raw payload.
  let cur: unknown = row.raw;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function labelForPath(groups: CatalogGroup[], path: string): string {
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.path === path) return labelFor(e);
    }
  }
  return path;
}

function labelFor(entry: PropertyCatalogEntry): string {
  if (entry.origin === "curated") return entry.label;
  return entry.path;
}

function detailPathFor(row: DeepScanRow): string {
  // For v1 only `admin-apps` is wired, all matches link to /apps/:id.
  // Future sources will dispatch on `row.identity.resourceType`.
  return `/apps/${encodeURIComponent(row.identity.id)}`;
}
