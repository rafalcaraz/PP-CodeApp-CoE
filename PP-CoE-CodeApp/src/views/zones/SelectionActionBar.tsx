/**
 * Floating selection action bar — appears at the top of the Tier 2
 * Kanban when one or more envs are selected. Surfaces bulk actions:
 *  - Add to ▾ (picker dialog)
 *  - Remove from current group (only relevant in-lane)
 *  - Clear selection
 *
 * Renders nothing when `count === 0`. The action bar is "sticky" via
 * its CSS position; the parent decides where it lives.
 */

import {
  Button,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  DismissRegular,
} from "@fluentui/react-icons";

interface Props {
  count: number;
  onAddTo: () => void;
  onRemove?: () => void;
  onClear: () => void;
}

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    position: "sticky",
    top: 0,
    zIndex: 10,
    boxShadow: tokens.shadow4,
  },
  count: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  spacer: {
    flex: 1,
  },
});

export function SelectionActionBar({
  count,
  onAddTo,
  onRemove,
  onClear,
}: Props) {
  const styles = useStyles();
  if (count === 0) return null;
  return (
    <div className={styles.bar} role="toolbar" aria-label="Selection actions">
      <Text className={styles.count}>
        {count} env{count === 1 ? "" : "s"} selected
      </Text>
      <div className={styles.spacer} />
      <Button appearance="primary" icon={<AddRegular />} onClick={onAddTo}>
        Add to…
      </Button>
      {onRemove && (
        <Button
          appearance="secondary"
          icon={<DeleteRegular />}
          onClick={onRemove}
        >
          Remove
        </Button>
      )}
      <Button
        appearance="subtle"
        icon={<DismissRegular />}
        onClick={onClear}
        aria-label="Clear selection"
      >
        Clear
      </Button>
    </div>
  );
}
