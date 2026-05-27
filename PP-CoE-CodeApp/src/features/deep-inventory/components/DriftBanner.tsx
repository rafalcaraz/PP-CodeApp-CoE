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
  return (
    <div className={styles.root}>
      {warnings.map((w, idx) => (
        <MessageBar key={`${w.kind}:${w.property.id}:${idx}`} intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Schema drift — {titleFor(w.kind)}</MessageBarTitle>
            {w.message}
          </MessageBarBody>
        </MessageBar>
      ))}
    </div>
  );
}

function titleFor(kind: DriftWarning["kind"]): string {
  switch (kind) {
    case "missing":
      return "missing curated property";
    case "presence-low":
      return "rarely observed";
    case "type-shift":
      return "type changed";
  }
}
