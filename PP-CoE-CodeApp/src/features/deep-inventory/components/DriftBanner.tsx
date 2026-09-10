/**
 * Drift-warnings banner. Renders zero or more warnings produced by
 * `detectDrift` after a scan completes. Each warning is its own
 * MessageBar so the user can dismiss them individually if we ever
 * wire dismissal.
 *
 * Kept tiny — the heavy lifting is in `catalog/drift.ts`. This
 * component is presentation-only.
 */

import {
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { DriftWarning } from "../data";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
});

interface DriftBannerProps {
  warnings: DriftWarning[];
}

export function DriftBanner({ warnings }: DriftBannerProps) {
  const styles = useStyles();
  if (warnings.length === 0) return null;
  const counts = {
    missing: warnings.filter((warning) => warning.kind === "missing").length,
    sparse: warnings.filter((warning) => warning.kind === "presence-low").length,
    typeShift: warnings.filter((warning) => warning.kind === "type-shift").length,
  };
  const summary = [
    counts.missing > 0
      ? `${counts.missing} watched ${plural(counts.missing, "property", "properties")} missing`
      : "",
    counts.typeShift > 0
      ? `${counts.typeShift} ${plural(counts.typeShift, "type", "types")} changed`
      : "",
    counts.sparse > 0
      ? `${counts.sparse} rarely observed`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const affected = warnings
    .slice(0, 5)
    .map((warning) => warning.property.label)
    .join(", ");

  return (
    <div className={styles.root}>
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>Schema drift — {summary}</MessageBarTitle>
          Watched curated properties affected: {affected}
          {warnings.length > 5 ? ` and ${warnings.length - 5} more` : ""}.
          Discovered values alone do not create drift alerts.
        </MessageBarBody>
      </MessageBar>
    </div>
  );
}

function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}
