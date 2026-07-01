/**
 * Dataverse file-download client.
 *
 * Wraps the swappable file-download runner (`./flowContract`) and turns its raw
 * envelope into a typed `DataverseResult<string>`. Mirrors `./client` for the
 * record-retrieve flow:
 *
 *  1. The flow's single output (`result`) is a string carrying the file's
 *     content. It is handed back verbatim — the *feature* layer decides how to
 *     decode it (raw text vs. base64) based on the file type.
 *  2. Every failure mode (rejected promise, `success:false`, empty body, or the
 *     literal `"ERROR"` sentinel the flow emits) collapses into `{ ok:false }`.
 *  3. In-flight dedupe — two simultaneous downloads of the same record collapse
 *     into one flow invocation.
 *
 * Note: we intentionally do NOT parse `result` as JSON here (unlike the record
 * client) — a file's content is arbitrary, so the raw string is the contract.
 */

import { runDataverseFileDownload } from "./flowContract";
import type { DataverseResult } from "./types";

/** Ergonomic request for a single file download. */
export interface DataverseFileDownloadRequest {
  environmentId: string;
  /** `botcomponentid` of the file subcomponent (`componenttype 14`). */
  recordId: string;
}

const inflight = new Map<string, Promise<DataverseResult<string>>>();

/** Reset hook for tests and for an eventual "Refresh" UI affordance. */
export function clearDataverseFileInflight(): void {
  inflight.clear();
}

/**
 * Download a Dataverse file column's content as a raw string.
 *
 * @returns `{ ok: true, data: rawString }` on success, otherwise
 *          `{ ok: false, error }` with a human-readable message.
 */
export async function downloadDataverseFile(
  req: DataverseFileDownloadRequest,
): Promise<DataverseResult<string>> {
  const key = `${req.environmentId}::${req.recordId}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = invokeOnce(req).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

async function invokeOnce(
  req: DataverseFileDownloadRequest,
): Promise<DataverseResult<string>> {
  let raw: { success: boolean; data?: { result?: string }; error?: unknown };
  try {
    raw = await runDataverseFileDownload({
      environmentId: req.environmentId,
      recordId: req.recordId,
    });
  } catch (e) {
    return { ok: false, error: formatError(e) };
  }

  if (!raw.success) {
    return {
      ok: false,
      error:
        formatError(raw.error) || "Dataverse file download returned success=false",
    };
  }

  const result = raw.data?.result;
  if (typeof result !== "string" || result.length === 0) {
    return { ok: false, error: "Empty file content from download flow" };
  }

  // The flow emits the literal string "ERROR" when the underlying download
  // fails (e.g. the record has no file, or the column is empty). Some files are
  // expected to fail this way — callers handle it per file.
  if (result.trim().toUpperCase() === "ERROR") {
    return { ok: false, error: "File download failed (flow returned ERROR)" };
  }

  return { ok: true, data: result };
}

function formatError(e: unknown): string {
  if (!e) return "";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const obj = e as { message?: unknown };
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
