/**
 * CSV export utilities.
 *
 * `rowsToCsv` flattens a list of arbitrarily-nested records into a tabular
 * CSV using dot-notation column names. Arrays of primitives become
 * semicolon-joined strings; arrays of objects are JSON-encoded.
 *
 * `downloadCsv` triggers a browser download via a Blob URL.
 */

type Primitive = string | number | boolean | null | undefined;
type Json = Primitive | Json[] | { [k: string]: Json };

interface FlattenOpts {
  /** Max recursion depth into nested objects. Default 5. */
  maxDepth?: number;
  /** Prefix for the root keys (internal). */
  prefix?: string;
}

function flatten(value: Json, opts: FlattenOpts = {}): Record<string, Primitive> {
  const maxDepth = opts.maxDepth ?? 5;
  const out: Record<string, Primitive> = {};

  const walk = (v: Json, key: string, depth: number): void => {
    if (v === null || v === undefined) {
      out[key] = "";
      return;
    }
    if (typeof v !== "object") {
      out[key] = v as Primitive;
      return;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out[key] = "";
        return;
      }
      const allPrimitive = v.every(
        (x) => x === null || x === undefined || typeof x !== "object"
      );
      if (allPrimitive) {
        out[key] = v.map((x) => (x == null ? "" : String(x))).join("; ");
      } else {
        // Arrays of objects: stringify the whole thing into one cell.
        out[key] = JSON.stringify(v);
      }
      return;
    }
    // Object
    if (depth >= maxDepth) {
      out[key] = JSON.stringify(v);
      return;
    }
    const entries = Object.entries(v as Record<string, Json>);
    if (entries.length === 0) {
      out[key] = "";
      return;
    }
    for (const [k, child] of entries) {
      walk(child, key ? `${key}.${k}` : k, depth + 1);
    }
  };

  walk(value, opts.prefix ?? "", 0);
  return out;
}

function escapeCell(value: Primitive): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (s === "") return "";
  // Quote if it contains comma, quote, newline, or leading/trailing whitespace.
  if (/[",\r\n]|^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Flattens each row and emits a CSV string with the union of all keys as columns. */
export function rowsToCsv(rows: unknown[]): string {
  if (rows.length === 0) return "";
  const flatRows: Record<string, Primitive>[] = rows.map((r) =>
    flatten(r as Json)
  );
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const fr of flatRows) {
    for (const k of Object.keys(fr)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
  }
  const header = columns.map(escapeCell).join(",");
  const body = flatRows
    .map((fr) => columns.map((c) => escapeCell(fr[c])).join(","))
    .join("\r\n");
  return body ? `${header}\r\n${body}` : header;
}

function timestampedFilename(stem: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stem}-${ts}.csv`;
}

/** Triggers a CSV file download in the browser. Prepends a UTF-8 BOM so Excel
 *  correctly detects the encoding. */
export function downloadCsv(filenameStem: string, content: string): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = timestampedFilename(filenameStem);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
