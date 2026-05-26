/**
 * CSV-shaping helper for deep-scan rows.
 *
 * Lives in its own module so `ResultsTable.tsx` can stay
 * components-only (React Refresh requires it). Imports the same
 * label-resolution helpers `ResultsTable` uses, but those are tiny
 * and locally re-stated to keep the module standalone.
 */

import type { CatalogGroup, DeepScanRow, PropertyCatalogEntry } from "../data";

/** Flatten the streamed rows into plain records the shared
 *  `rowsToCsv` helper can serialize. Includes the identity
 *  columns plus every projected cell. */
export function rowsForCsv(
  catalogGroups: CatalogGroup[],
  columns: string[],
  defaultColumns: string[],
  rows: DeepScanRow[]
): Record<string, unknown>[] {
  const effectiveColumns = columns.length > 0 ? columns : defaultColumns;
  return rows.map((row) => {
    const record: Record<string, unknown> = {
      name: row.identity.displayName,
      id: row.identity.id,
      environmentId: row.identity.environmentId,
    };
    for (const path of effectiveColumns) {
      const label = labelForPath(catalogGroups, path);
      record[label] = row.cells[path] ?? lookupRaw(row, path) ?? "";
    }
    return record;
  });
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

function lookupRaw(row: DeepScanRow, path: string): unknown {
  let cur: unknown = row.raw;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
