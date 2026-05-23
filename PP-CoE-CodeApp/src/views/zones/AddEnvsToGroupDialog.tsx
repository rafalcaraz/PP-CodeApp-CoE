/**
 * Picker dialog for bulk "Add N selected envs to a Standard custom
 * group". Only lists custom groups that the caller passes in — the
 * Tier 2 Kanban scopes this to custom groups placed in the current
 * zone so the user can't accidentally scatter envs across zones.
 *
 * Selecting a target and clicking Add fires the per-env add via the
 * caller's callback. Result aggregation (added vs skipped due to type
 * purity) lives in the caller.
 */

import { useState } from "react";
import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  makeStyles,
  Radio,
  RadioGroup,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { StandardCustomGroup } from "../../data/standardGroups";

interface Props {
  open: boolean;
  selectedCount: number;
  candidateGroups: StandardCustomGroup[];
  onDismiss: () => void;
  onConfirm: (group: StandardCustomGroup) => void;
}

const useStyles = makeStyles({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  groupRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  groupIcon: {
    fontSize: tokens.fontSizeBase400,
  },
  groupMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export function AddEnvsToGroupDialog({
  open,
  selectedCount,
  candidateGroups,
  onDismiss,
  onConfirm,
}: Props) {
  const styles = useStyles();
  const [chosenId, setChosenId] = useState<string | null>(
    candidateGroups[0]?.id ?? null,
  );

  // Reset when the dialog opens (handled by the key prop in caller, but
  // also defensive: when candidate list changes, default to first item).
  if (open && chosenId !== null && !candidateGroups.some((g) => g.id === chosenId)) {
    setChosenId(candidateGroups[0]?.id ?? null);
  }

  const handleConfirm = () => {
    const chosen = candidateGroups.find((g) => g.id === chosenId);
    if (chosen) onConfirm(chosen);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onDismiss();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            Add {selectedCount} env{selectedCount === 1 ? "" : "s"} to a custom
            group
          </DialogTitle>
          <DialogContent>
            <div className={styles.body}>
              <Caption1>
                Only Standard custom groups placed in this zone are shown.
                Managed envs in your selection are skipped — they belong in a
                Microsoft env group instead.
              </Caption1>
              {candidateGroups.length === 0 ? (
                <Text className={styles.empty}>
                  No Standard custom groups are placed in this zone yet.
                  Create one from the Zones board and drag it into this zone
                  first.
                </Text>
              ) : (
                <Field label="Target custom group">
                  <RadioGroup
                    value={chosenId ?? ""}
                    onChange={(_, data) => setChosenId(data.value)}
                  >
                    {candidateGroups.map((g) => (
                      <Radio
                        key={g.id}
                        value={g.id}
                        label={
                          <div className={styles.groupRow}>
                            <span className={styles.groupIcon} aria-hidden>
                              {g.icon}
                            </span>
                            <span>{g.displayName}</span>
                            <span className={styles.groupMeta}>
                              · {g.envIds.length} envs
                            </span>
                          </div>
                        }
                      />
                    ))}
                  </RadioGroup>
                </Field>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={handleConfirm}
              disabled={chosenId === null || candidateGroups.length === 0}
            >
              Add
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
