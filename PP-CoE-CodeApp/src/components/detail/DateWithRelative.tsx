/**
 * `DateWithRelative` — renders a localized absolute timestamp with a muted
 * relative-time suffix ("5/21/2026, 9:48 AM (3 days ago)").
 *
 * Falls back to "—" for empty input so the call site doesn't need to check.
 */
import { formatDate, formatRelative } from "./formatting";
import { useDetailStyles } from "./useDetailStyles";

export function DateWithRelative({ value }: { value: string }) {
  const styles = useDetailStyles();
  if (!value) return <>—</>;
  const rel = formatRelative(value);
  return (
    <>
      {formatDate(value)}
      {rel && <span className={styles.relative}>({rel})</span>}
    </>
  );
}
