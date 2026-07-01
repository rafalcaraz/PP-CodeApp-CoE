/**
 * Agents feature — live skill-file content fetch + decode.
 *
 * Bundled-skill files (`componenttype 14`) store their bytes in a Dataverse
 * file column. This module pulls a single file's content on demand via the
 * `DownloadFile-Dataverse` passthrough (`shared/dataverse.downloadDataverseFile`)
 * and decodes the flow's raw `result` string into something the viewer can use.
 *
 * ── Decode contract (verified against a real download) ────────────────────
 * The flow's `result` is the file's **raw** content as a string (a real PDF
 * came back starting with `%PDF-1.4 … ReportLab … endobj`, i.e. NOT base64).
 * We decode per file type:
 *   - **Text files** (markdown / code): the raw string *is* the content. (If a
 *     file ever arrives base64-encoded, `maybeBase64ToUtf8` transparently
 *     decodes it; real source/markdown has spaces / `#` / `{` so it won't be
 *     mistaken for base64.)
 *   - **Binary files** (pdf / images / office docs): the raw byte-string is
 *     base64-encoded on the client (`toBase64ForDataUrl`) and wrapped into a
 *     `data:` URL for the Download button. If the binary bytes were corrupted
 *     in transit (a UTF-8 decode in the flow replacing bytes with U+FFFD), the
 *     file can't be reconstructed client-side and the fetch reports an error
 *     suggesting the flow return that file base64-encoded.
 * Some files are expected to fail the download entirely (the flow returns
 * `"ERROR"`); those surface as `{ ok:false }` and the viewer shows the error.
 */

import { downloadDataverseFile } from "../../shared/dataverse";
import type { DataverseResult } from "../../shared/dataverse";
import type { SkillFileRender } from "./skillTree";

/** Decoded, viewer-ready file content. */
export interface FetchedFileContent {
  /** Text content, for markdown / code files. */
  content?: string;
  /** A `data:` URL, for binary files (download target). */
  downloadUrl?: string;
}

/** Result cache (success or failure) keyed by env + record, to avoid refetch. */
const cache = new Map<string, DataverseResult<FetchedFileContent>>();

/** Clear the file-content cache (tests / an eventual Refresh affordance). */
export function clearSkillFileCache(): void {
  cache.clear();
}

export interface FetchSkillFileArgs {
  environmentId: string;
  /** `botcomponentid` of the file subcomponent. */
  recordId: string;
  render: SkillFileRender;
  ext: string;
}

/**
 * Fetch and decode a single bundled-skill file's content via the download flow.
 * Memoized per (environmentId, recordId).
 */
export async function fetchSkillFileContent(
  args: FetchSkillFileArgs,
): Promise<DataverseResult<FetchedFileContent>> {
  const key = `${args.environmentId}::${args.recordId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const res = await downloadDataverseFile({
    environmentId: args.environmentId,
    recordId: args.recordId,
  });

  let decoded: DataverseResult<FetchedFileContent>;
  if (!res.ok) {
    decoded = res;
  } else {
    const data = decodeFileResult(res.data, args.render, args.ext);
    if (args.render === "download" && !data.downloadUrl) {
      // The flow returned content but its binary bytes couldn't be
      // reconstructed on the client (see toBase64ForDataUrl).
      decoded = {
        ok: false,
        error:
          "This file's binary content couldn't be decoded — the download flow may need to return it base64-encoded.",
      };
    } else {
      decoded = { ok: true, data };
    }
  }

  cache.set(key, decoded);
  return decoded;
}

/** Decode a raw flow `result` string per the file's render bucket. */
export function decodeFileResult(
  result: string,
  render: SkillFileRender,
  ext: string,
): FetchedFileContent {
  if (render === "download") {
    // Binary file → build a data: URL. The flow returns the file's *raw*
    // content (verified against a real PDF: it starts with `%PDF-1.4`, not
    // base64), so we base64-encode it ourselves. `toBase64ForDataUrl` returns
    // null when the bytes can't be recovered (see below).
    const b64 = toBase64ForDataUrl(result);
    if (!b64) return {};
    return { downloadUrl: `data:${mimeForExt(ext)};base64,${b64}` };
  }
  // Text → use decoded base64 when the whole payload is base64, else raw.
  return { content: maybeBase64ToUtf8(result) ?? result };
}

/**
 * Produce base64 (for a `data:` URL) from a flow `result` string.
 *
 *  - If the string is *already* base64 (the flow encoded it), use it as-is.
 *  - Otherwise treat each char code as one byte and base64-encode. If any char
 *    code is > 255 the original bytes were lost in transit — most likely a
 *    UTF-8 decode somewhere in the flow replaced binary bytes with U+FFFD — and
 *    the file can't be reconstructed on the client. In that case return null so
 *    the caller can surface a clear "needs base64 from the flow" message rather
 *    than offer a corrupt download.
 */
export function toBase64ForDataUrl(result: string): string | null {
  const compact = result.replace(/\s+/g, "");
  if (
    compact.length >= 8 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    return compact;
  }
  try {
    let bin = "";
    for (let i = 0; i < result.length; i++) {
      const code = result.charCodeAt(i);
      if (code > 255) return null;
      bin += String.fromCharCode(code);
    }
    return btoa(bin);
  } catch {
    return null;
  }
}

/**
 * Decode a string as base64→UTF-8 *only* when it is entirely base64 (after
 * whitespace removal) and decodes to valid UTF-8. Returns `null` otherwise, so
 * callers fall back to treating the input as raw text.
 */
export function maybeBase64ToUtf8(s: string): string | null {
  const compact = s.replace(/\s+/g, "");
  if (compact.length < 8 || compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  try {
    const bin = atob(compact);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Best-effort MIME type from a file extension, for data URLs. */
export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}
