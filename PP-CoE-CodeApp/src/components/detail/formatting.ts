/**
 * Date formatting helpers shared by the resource detail pages.
 *
 * Kept dependency-free (no React, no Fluent) so they're cheap to import from
 * non-component callers (tests, the Raw JSON exporter, etc.).
 */

/** Locale-aware absolute timestamp ("5/21/2026, 9:48:13 AM"). Returns "—"
 *  for empty input and the original string when the value can't be parsed. */
export function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/** Human-friendly relative time ("3 days ago", "in 2 hours", "just now").
 *  Returns "" for empty / unparseable input so callers can no-op render. */
export function formatRelative(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return "";
  const diffMs = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  let label: string;
  if (abs < minute) label = "just now";
  else if (abs < hour) {
    const n = Math.round(abs / minute);
    label = `${n} minute${n === 1 ? "" : "s"}`;
  } else if (abs < day) {
    const n = Math.round(abs / hour);
    label = `${n} hour${n === 1 ? "" : "s"}`;
  } else if (abs < 30 * day) {
    const n = Math.round(abs / day);
    label = n === 1 ? "yesterday" : `${n} days`;
  } else if (abs < 365 * day) {
    const n = Math.round(abs / (30 * day));
    label = `${n} month${n === 1 ? "" : "s"}`;
  } else {
    const n = Math.round(abs / (365 * day));
    label = `${n} year${n === 1 ? "" : "s"}`;
  }
  if (label === "just now" || label === "yesterday") return label;
  return future ? `in ${label}` : `${label} ago`;
}
