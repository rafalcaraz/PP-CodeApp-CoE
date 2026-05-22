/**
 * `Meta` — the label-over-value pair used everywhere on detail pages.
 *
 * The label sits in muted small text above the value (any ReactNode), so it
 * stacks cleanly inside the `metaGrid` / `metaGridTwo` grids.
 */
import type { ReactNode } from "react";
import { Text } from "@fluentui/react-components";
import { useDetailStyles } from "./useDetailStyles";

export function Meta({ label, children }: { label: string; children: ReactNode }) {
  const styles = useDetailStyles();
  return (
    <div className={styles.metaItem}>
      <Text className={styles.metaLabel}>{label}</Text>
      <Text>{children}</Text>
    </div>
  );
}
