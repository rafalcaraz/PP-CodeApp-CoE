/**
 * Skill file download helpers.
 *
 * A selected skill file can be downloaded via two routes:
 *
 *  1. **Client-side, from content we already have.** For text files we hold the
 *     decoded `content` string; for binary files we hold a `data:` URL (built by
 *     `./skillFiles`). Either way we can hand the bytes to the browser without an
 *     extra network round-trip — build/reuse a URL and click a hidden anchor.
 *  2. **Direct Dataverse Web API link.** `{orgUrl}/api/data/v9.2/botcomponents(
 *     {recordId})/filedata/$value` streams the file column straight from
 *     Dataverse. This relies on the user's existing browser auth to that org, so
 *     it's a best-effort *fallback* — used when the client-side content isn't
 *     usable (e.g. a binary file whose bytes couldn't be reconstructed because
 *     the download flow didn't return them base64-encoded).
 *
 * The pure string builders here are unit-tested; the DOM-triggering helpers are
 * thin wrappers around an anchor click.
 */

/** Strip trailing slash(es) so we can safely append an `/api/...` path. */
export function normalizeOrgUrl(orgUrl: string): string {
  return orgUrl.trim().replace(/\/+$/, "");
}

/**
 * Build the Dataverse Web API `$value` link for a botcomponent's `filedata`
 * column, e.g.
 * `https://contoso.crm.dynamics.com/api/data/v9.2/botcomponents(<id>)/filedata/$value`.
 */
export function dataverseFileValueUrl(orgUrl: string, recordId: string): string {
  const base = normalizeOrgUrl(orgUrl);
  return `${base}/api/data/v9.2/botcomponents(${recordId})/filedata/$value`;
}

/** Trigger a browser download of an already-usable URL (data: or object URL). */
export function triggerUrlDownload(url: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Trigger a browser download of a Blob, revoking the object URL afterwards. */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerUrlDownload(url, filename);
  // Revoke on a delay so the click has a chance to start the download first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a text string as a file (markdown / code / any decoded text). */
export function downloadTextFile(
  content: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
): void {
  triggerBlobDownload(new Blob([content], { type: mime }), filename);
}
