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
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Link,
  Text,
  createTableColumn,
  makeStyles,
  tokens,
  type TableColumnDefinition,
} from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RawJsonAccordion } from "../../../components/RawJsonAccordion";
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
  evidenceSurface: {
    width: "min(900px, 90vw)",
    maxWidth: "900px",
  },
  evidenceSearch: {
    width: "100%",
    marginBottom: tokens.spacingVerticalM,
  },
  evidenceMatches: {
    maxHeight: "48vh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  evidenceMatch: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 40%) minmax(0, 1fr)",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  evidencePath: {
    color: tokens.colorBrandForeground1,
    overflowWrap: "anywhere",
  },
  evidenceValue: {
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
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
  const [evidenceRow, setEvidenceRow] = useState<DeepScanRow | null>(null);
  const [evidenceSearch, setEvidenceSearch] = useState("");
  const effectiveColumns = columns.length > 0 ? columns : defaultColumns;
  const evidenceMatches = useMemo(
    () => searchEvidence(evidenceRow?.raw, evidenceSearch),
    [evidenceRow, evidenceSearch],
  );

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
    createTableColumn<DeepScanRow>({
      columnId: "__evidence",
      renderHeaderCell: () => "Evidence",
      renderCell: (row) => (
        <Button
          appearance="subtle"
          size="small"
          onClick={() => {
            setEvidenceSearch("");
            setEvidenceRow(row);
          }}
        >
          View
        </Button>
      ),
    }),
    ...dynamicCols,
  ];

  return (
    <>
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
      <Dialog
        open={evidenceRow !== null}
        onOpenChange={(_event, data) => {
          if (!data.open) {
            setEvidenceSearch("");
            setEvidenceRow(null);
          }
        }}
      >
        <DialogSurface className={styles.evidenceSurface}>
          <DialogBody>
            <DialogTitle>
              Scan evidence —{" "}
              {evidenceRow?.identity.displayName || evidenceRow?.identity.id}
            </DialogTitle>
            <DialogContent>
              <Input
                className={styles.evidenceSearch}
                aria-label="Search evidence"
                placeholder="Search evidence paths or values"
                contentBefore={<SearchRegular />}
                value={evidenceSearch}
                onChange={(_event, data) => setEvidenceSearch(data.value)}
              />
              {evidenceSearch.trim() &&
                (evidenceMatches.length > 0 ? (
                  <div
                    className={styles.evidenceMatches}
                    data-testid="evidence-search-results"
                  >
                    {evidenceMatches.map((match) => (
                      <div
                        className={styles.evidenceMatch}
                        key={`${match.path}:${match.value}`}
                      >
                        <span className={styles.evidencePath}>{match.path}</span>
                        <span className={styles.evidenceValue}>{match.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text className={styles.empty}>
                    No evidence matches that search.
                  </Text>
                ))}
              <RawJsonAccordion
                data={evidenceRow?.raw}
                title="Normalized source evidence"
                defaultOpen
              />
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => {
                  setEvidenceSearch("");
                  setEvidenceRow(null);
                }}
              >
                Close
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
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

interface EvidenceSearchMatch {
  path: string;
  value: string;
}

function searchEvidence(
  value: unknown,
  query: string,
): EvidenceSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const matches: EvidenceSearchMatch[] = [];
  const visit = (current: unknown, path: string): void => {
    if (matches.length >= 100) return;
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        visit(child, path ? `${path}.${key}` : key);
      }
      return;
    }

    const displayValue =
      current === null
        ? "null"
        : current === undefined
          ? "undefined"
          : String(current);
    if (
      path.toLowerCase().includes(normalizedQuery) ||
      displayValue.toLowerCase().includes(normalizedQuery)
    ) {
      matches.push({ path, value: displayValue });
    }
  };

  visit(value, "");
  return matches;
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
  if (row.identity.resourceType === "microsoft.copilotstudio/agents") {
    return `/agents/${encodeURIComponent(row.identity.id)}?envId=${encodeURIComponent(
      row.identity.environmentId
    )}`;
  }
  return `/apps/${encodeURIComponent(row.identity.id)}`;
}
