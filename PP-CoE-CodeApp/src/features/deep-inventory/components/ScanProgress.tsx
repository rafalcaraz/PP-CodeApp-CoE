/**
 * Scan progress indicator. Renders the streaming progress bar +
 * counts + the prominent Cancel button while the runner is active,
 * and a quiet "completed" line afterwards.
 *
 * Visual goals:
 *  - The user always knows whether the scan is still going.
 *  - The Cancel button is the primary CTA during a scan — operators
 *    quickly notice when they kicked off a too-broad scope.
 *  - Numbers update in real time (progress events arrive on every
 *    scope unit completion).
 */

import {
  Button,
  ProgressBar,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DismissCircleRegular } from "@fluentui/react-icons";
import type { ScanSummary } from "../data";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  counts: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  done: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface ScanProgressProps {
  scopeUnitsTotal: number;
  scopeUnitsDone: number;
  recordsScanned: number;
  matches: number;
  /** When provided, the runner is still active and the cancel button
   *  is shown. */
  onCancel?: () => void;
  /** When set, the scan has finished and this is the summary. */
  summary?: ScanSummary;
}

export function ScanProgress({
  scopeUnitsTotal,
  scopeUnitsDone,
  recordsScanned,
  matches,
  onCancel,
  summary,
}: ScanProgressProps) {
  const styles = useStyles();
  const total = Math.max(scopeUnitsTotal, 1);
  const ratio = Math.min(1, scopeUnitsDone / total);

  if (summary) {
    return (
      <div className={styles.root}>
        <Text className={styles.done}>
          {summary.cancelled ? "Cancelled — " : "Done — "}
          scanned {summary.recordsScanned.toLocaleString()} records across{" "}
          {summary.scopeUnitsDone}/{summary.scopeUnitsTotal} environments,{" "}
          {summary.matches.toLocaleString()} matches
          {summary.scopeUnitsErrored > 0
            ? `, ${summary.scopeUnitsErrored} env errors`
            : ""}
          .
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <ProgressBar value={ratio} thickness="medium" style={{ flex: 1, minWidth: 200 }} />
        {onCancel && (
          <Button
            appearance="subtle"
            icon={<DismissCircleRegular />}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
      <Text className={styles.counts}>
        Scanning environments — {scopeUnitsDone}/{scopeUnitsTotal} envs,{" "}
        {recordsScanned.toLocaleString()} records, {matches.toLocaleString()} matches
      </Text>
    </div>
  );
}
