import { Gunzip } from "fflate";
import { REPORT_NAMES, REPORT_SCHEMAS, type CreditReport, type CreditReportRow, type ReportName, type ReportRange } from "./types";

export const MAX_REPORT_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 200_000;

export function utcDay(value: string): string {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid UTC date "${value}". Expected YYYY-MM-DD.`);
  }
  return date;
}

export function defaultReportRange(now = new Date()): ReportRange {
  const midnight = Date.parse(now.toISOString().slice(0, 10));
  return {
    startDate: new Date(midnight - 30 * 86_400_000).toISOString().slice(0, 10),
    endDate: new Date(midnight - 86_400_000).toISOString().slice(0, 10),
  };
}

export function validateReportRange(range: ReportRange, now = new Date()) {
  const start = utcDay(range.startDate);
  const end = utcDay(range.endDate);
  const available = defaultReportRange(now);
  if (start > end || start < available.startDate || end > available.endDate) {
    throw new Error(`Choose complete UTC days from ${available.startDate} through ${available.endDate}, with start on or before end.`);
  }
}

// Keep newlines inside quoted fields and reject malformed files rather than
// shifting consumption into a neighboring column.
function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const finishField = () => { record.push(field); field = ""; closed = false; };
  const finishRecord = () => {
    finishField();
    if (record.some((value) => value !== "")) records.push(record);
    if (records.length > MAX_ROWS + 1) throw new Error(`Report exceeds ${MAX_ROWS.toLocaleString("en-US")} rows. Use a smaller date range.`);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += character;
    } else if (character === ",") finishField();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[i + 1] === "\n") i++;
      finishRecord();
    } else if (character === '"' && !field && !closed) quoted = true;
    else {
      if (closed || character === '"') throw new Error("Malformed CSV: unexpected content outside a quoted field.");
      field += character;
    }
  }
  if (quoted) throw new Error("Malformed CSV: a quoted field was not closed.");
  if (field || record.length || closed) finishRecord();
  return records;
}

function creditNumber(value: string, column: string, row: number): number {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed) || !Number.isFinite(Number(trimmed))) {
    throw new Error(`Row ${row}: ${column} must contain a finite number, not "${value}".`);
  }
  return Number(trimmed);
}

export function parseReportCsv(text: string, expected?: ReportName) {
  const records = csvRecords(text.replace(/^\uFEFF/, ""));
  const columns = records.shift();
  if (!columns?.length) throw new Error("The file is empty. A Daily report must include its CSV header.");
  if (new Set(columns).size !== columns.length || columns.some((column) => !column.trim())) {
    throw new Error("The CSV contains duplicate or empty column names.");
  }
  const matches = REPORT_NAMES.filter((name) => {
    const schema = REPORT_SCHEMAS[name];
    return [schema.date, schema.first, schema.second].every((column) => columns.includes(column));
  });
  if (matches.length !== 1) throw new Error("Unrecognized report schema. Upload a Daily Resources & features or Environment billing CSV with its date and consumption columns. Summary reports are not supported.");
  const name = matches[0];
  if (expected && name !== expected) throw new Error(`Expected ${expected}, but the downloaded file contains ${name}.`);
  const schema = REPORT_SCHEMAS[name];
  const rows: CreditReportRow[] = records.map((values, index) => {
    if (values.length !== columns.length) throw new Error(`Row ${index + 2}: expected ${columns.length} columns, received ${values.length}.`);
    const cells: Record<string, string> = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
    return {
      date: utcDay(cells[schema.date]),
      environmentId: cells.EnvironmentID?.trim().toLowerCase() || null,
      environmentName: cells.EnvironmentName?.trim() || null,
      first: creditNumber(cells[schema.first], schema.first, index + 2),
      second: creditNumber(cells[schema.second], schema.second, index + 2),
      cells,
    };
  });
  let observedRange: ReportRange | null = null;
  for (const row of rows) {
    if (!observedRange) observedRange = { startDate: row.date, endDate: row.date };
    else {
      if (row.date < observedRange.startDate) observedRange.startDate = row.date;
      if (row.date > observedRange.endDate) observedRange.endDate = row.date;
    }
  }
  return { name, columns, rows, observedRange };
}

export async function readCreditReport(original: Blob, fileName: string, options: {
  source: CreditReport["source"]; expected?: ReportName; requestedRange?: ReportRange;
}): Promise<CreditReport> {
  if (original.size > MAX_REPORT_BYTES) throw new Error("The report file exceeds 25 MiB. Use a smaller date range.");
  const bytes = new Uint8Array(await original.arrayBuffer());
  let content = bytes;
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (compressed) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const unzip = new Gunzip((chunk) => {
      size += chunk.length;
      if (size > MAX_REPORT_BYTES) throw new Error("The expanded report exceeds 25 MiB. Use a smaller date range.");
      chunks.push(chunk);
    });
    for (let offset = 0; offset < bytes.length; offset += 16_384) {
      unzip.push(bytes.subarray(offset, offset + 16_384), offset + 16_384 >= bytes.length);
    }
    content = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
  }
  if (content.byteLength > MAX_REPORT_BYTES) throw new Error("The expanded report exceeds 25 MiB.");
  const parsed = parseReportCsv(new TextDecoder("utf-8", { fatal: true }).decode(content), options.expected);
  const requestedRange = options.requestedRange;
  if (requestedRange && parsed.rows.some((row) =>
    row.date < requestedRange.startDate || row.date > requestedRange.endDate)) {
    throw new Error("The downloaded report contains dates outside the requested period.");
  }
  const safeName = fileName.split(/[\\/]/).pop() || `${parsed.name}.csv`;
  return {
    ...parsed, id: crypto.randomUUID(), schemaVersion: 1, granularity: "Daily",
    source: options.source, loadedAt: new Date().toISOString(), requestedRange: options.requestedRange,
    original, fileName: options.source !== "upload" && !compressed ? safeName.replace(/\.gz$/i, "") : safeName,
  };
}

export function connectorReportBlob(body: unknown): Blob {
  if (body instanceof Blob) return body;
  if (typeof body === "object" && body !== null && "$content" in body && typeof body.$content === "string") {
    return decodeBase64(body.$content);
  }
  if (typeof body === "string") {
    // The SDK may expose an already-decoded CSV or a base64 binary payload.
    if (body.includes(",") && /ConsumptionDate|BilledDate/.test(body)) return new Blob([body], { type: "text/csv;charset=utf-8" });
    return decodeBase64(body);
  }
  throw new Error("The report response did not expose a supported file body (CSV, base64, or a $content binary wrapper). No alternate transport was used.");
}

function decodeBase64(value: string): Blob {
  if (value.length > Math.ceil(MAX_REPORT_BYTES / 3) * 4 + 1024) throw new Error("The encoded report exceeds the 25 MiB file limit.");
  const binary = atob(value.replace(/\s/g, ""));
  return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: "application/octet-stream" });
}
