/**
 * Bundle a skill's files into a single `.zip` for download.
 *
 * A bundled skill's files each live in a Dataverse `filedata` column and are
 * fetched on demand via the download flow (`./skillFiles`). This module walks a
 * skill's file tree, resolves every file's bytes (reusing the same cached fetch
 * the viewer uses), and rolls them into one zip with folder paths preserved —
 * all client-side, no server round-trip beyond the per-file downloads.
 *
 * Byte resolution per file:
 *   - text (markdown / code) → UTF-8 encode the decoded string.
 *   - binary (pdf / xlsx / images) → decode the `data:` URL the fetch produced.
 *   - inline single-skill content (no `recordId`) → UTF-8 encode directly.
 *
 * Resilience: files that can't be downloaded are collected as `errors` and the
 * successful ones are still zipped, with a `_download-errors.txt` manifest added
 * so the user knows what was skipped. If *every* file fails, `ok` is false and
 * no zip is produced.
 */

import { zip } from "fflate";
import type { SkillFileNode, SkillNode, SkillSummary } from "./skillTree";
import { fetchSkillFileContent } from "./skillFiles";

/** A single file's resolved bytes, or a reason it couldn't be resolved. */
export type FileBytesResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

/** Injectable byte resolver — the default hits the live download flow. */
export type FileBytesResolver = (
  file: SkillFileNode,
  environmentId?: string,
) => Promise<FileBytesResult>;

/** Flatten a skill tree into its file leaves (depth-first). */
export function collectFiles(nodes: SkillNode[]): SkillFileNode[] {
  const out: SkillFileNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file") out.push(node);
    else out.push(...collectFiles(node.children));
  }
  return out;
}

/** Decode a `data:` URL into raw bytes. Returns null when it can't be parsed. */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    try {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

/**
 * Resolve a single file's bytes, using the live download flow for bundle files
 * (those with a `recordId`) and the node's own content for inline files.
 */
export const resolveFileBytes: FileBytesResolver = async (file, environmentId) => {
  // Inline file (single-skill markdown / mock overlay): bytes are already here.
  if (!file.recordId || !environmentId) {
    if (file.content !== undefined) {
      return { ok: true, bytes: new TextEncoder().encode(file.content) };
    }
    if (file.downloadUrl) {
      const bytes = dataUrlToBytes(file.downloadUrl);
      if (bytes) return { ok: true, bytes };
    }
    return { ok: false, error: "No downloadable content for this file." };
  }

  const res = await fetchSkillFileContent({
    environmentId,
    recordId: file.recordId,
    render: file.render,
    ext: file.ext,
  });
  if (!res.ok) return { ok: false, error: res.error };

  if (res.data.content !== undefined) {
    return { ok: true, bytes: new TextEncoder().encode(res.data.content) };
  }
  if (res.data.downloadUrl) {
    const bytes = dataUrlToBytes(res.data.downloadUrl);
    if (bytes) return { ok: true, bytes };
  }
  return { ok: false, error: "File content could not be decoded." };
};

/** Promisified `fflate.zip`. */
function zipEntries(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (err, data) =>
      err ? reject(err) : resolve(data),
    );
  });
}

/** Sanitize a skill name into a safe zip filename stem. */
export function safeZipName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_");
  return (cleaned || "skill").replace(/^-+|-+$/g, "") || "skill";
}

/** Outcome of a {@link buildSkillZip} run. */
export interface BuildSkillZipResult {
  /** True when at least one file was zipped. */
  ok: boolean;
  /** The zip payload, present when `ok`. */
  blob?: Blob;
  /** The raw zip bytes (same content as `blob`), present when `ok`. */
  bytes?: Uint8Array;
  /** Suggested download filename, e.g. `my_skill.zip`. */
  filename?: string;
  /** Per-file failures (empty on a fully clean run). */
  errors: { path: string; error: string }[];
}

/**
 * Download every file in a skill and roll them into a single zip Blob.
 *
 * @param skill          The skill whose files to bundle.
 * @param environmentId  Environment GUID, required to fetch bundle-file bytes.
 * @param resolver       Byte resolver (injectable for tests).
 */
export async function buildSkillZip(
  skill: SkillSummary,
  environmentId?: string,
  resolver: FileBytesResolver = resolveFileBytes,
): Promise<BuildSkillZipResult> {
  const files = collectFiles(skill.tree);
  const entries: Record<string, Uint8Array> = {};
  const errors: { path: string; error: string }[] = [];

  await Promise.all(
    files.map(async (file) => {
      try {
        const res = await resolver(file, environmentId);
        if (res.ok) entries[file.path] = res.bytes;
        else errors.push({ path: file.path, error: res.error });
      } catch (e) {
        errors.push({
          path: file.path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );

  if (Object.keys(entries).length === 0) {
    return { ok: false, errors };
  }

  if (errors.length > 0) {
    const manifest = [
      "Some files could not be downloaded and were skipped:",
      "",
      ...errors.map((e) => `- ${e.path}: ${e.error}`),
    ].join("\n");
    entries["_download-errors.txt"] = new TextEncoder().encode(manifest);
  }

  const zipped = await zipEntries(entries);
  // Copy into a fresh ArrayBuffer so the Blob part is a plain ArrayBuffer.
  const bytes = zipped.slice();
  const blob = new Blob([bytes], { type: "application/zip" });
  return {
    ok: true,
    blob,
    bytes,
    filename: `${safeZipName(skill.name)}.zip`,
    errors,
  };
}
