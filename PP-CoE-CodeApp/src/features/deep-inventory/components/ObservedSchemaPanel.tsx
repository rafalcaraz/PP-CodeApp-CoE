/**
 * Observed-schema diagnostics panel.
 *
 * Surfaces the current state of the per-source observed schema so
 * users (and reviewers) can verify the introspection layer is doing
 * its job. Shows window size, number of paths discovered, last update
 * timestamp, and a "Clear observed schema" affordance.
 *
 * Lives below the results table on the deep-scan page. Collapsed by
 * default so it doesn't compete with the primary action.
 */

import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useMemo, useState } from "react";
import type { DeepSourceId, ObservedSchema } from "../data";
import { clearObservedSchema, loadObservedSchema } from "../data";

const useStyles = makeStyles({
  root: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  body: {
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  buttons: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
});

interface ObservedSchemaPanelProps {
  sourceId: DeepSourceId;
  /** Bump count from the parent that invalidates the schema snapshot.
   *  The panel re-reads from localStorage when this changes so the
   *  numbers update after each scan completes. */
  refreshKey: number;
  /** Called after the user clears the observed schema, so the parent
   *  can rebuild its catalog. */
  onCleared: () => void;
}

export function ObservedSchemaPanel({
  sourceId,
  refreshKey,
  onCleared,
}: ObservedSchemaPanelProps) {
  const styles = useStyles();
  // localClearTick lets the Clear button force a re-read after
  // wiping the schema, without waiting for the parent to bump
  // refreshKey (no scan happened, just a clear).
  const [localClearTick, setLocalClearTick] = useState(0);

  // Snapshot the schema for display. Re-read from localStorage on
  // every refresh-key bump (post-scan) or local clear. Cheap — just
  // a JSON.parse of a few KB.
  const snapshot: ObservedSchema = useMemo(
    () => loadObservedSchema(sourceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceId, refreshKey, localClearTick]
  );

  const onClear = (): void => {
    clearObservedSchema(sourceId);
    onCleared();
    setLocalClearTick((t) => t + 1);
  };

  const updated =
    snapshot.updatedAt === new Date(0).toISOString()
      ? "never"
      : new Date(snapshot.updatedAt).toLocaleString();

  return (
    <div className={styles.root}>
      <Accordion collapsible>
        <AccordionItem value="observed">
          <AccordionHeader>
            <Text weight="semibold">
              Observed schema ({snapshot.paths.size.toLocaleString()} paths)
            </Text>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.body}>
              <Text size={200} className={styles.hint}>
                The introspector populates this catalog as scans return
                records. Curated properties always show in the picker;
                discovered paths appear under "Discovered fields" once
                at least one scan has run. Stored in this browser only
                (localStorage); clearing wipes it for this source.
              </Text>
              <div className={styles.statsRow}>
                <Stat label="Records in window" value={snapshot.windowRecords.toLocaleString()} />
                <Stat label="Window size" value={snapshot.windowSize.toLocaleString()} />
                <Stat label="Distinct paths" value={snapshot.paths.size.toLocaleString()} />
                <Stat label="Last updated" value={updated} />
              </div>
              <div className={styles.buttons}>
                <Button onClick={onClear} disabled={snapshot.windowRecords === 0}>
                  Clear observed schema
                </Button>
              </div>
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.stat}>
      <Text className={styles.statLabel}>{label}</Text>
      <Text>{value}</Text>
    </div>
  );
}
