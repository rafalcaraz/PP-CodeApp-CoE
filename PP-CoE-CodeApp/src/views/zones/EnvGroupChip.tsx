/**
 * Draggable env-group chip — the atomic unit in the Zones canvas.
 *
 * Each chip represents a Microsoft environment group. Dragging it moves
 * the group between Zones / Sections (and the implicit Unassigned
 * bucket). Identity matches the env group's id so a drop handler can
 * resolve back to the source row trivially.
 */

import {
  makeStyles,
  tokens,
  Text,
  Tooltip,
  Caption1,
} from "@fluentui/react-components";
import { GroupListRegular } from "@fluentui/react-icons";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { EnvironmentGroupRow } from "../../data/inventory";

interface Props {
  group: EnvironmentGroupRow;
  /** Where this chip currently lives — used to scope the draggable id
   *  so the drag listener can compute the "from" location without a
   *  reverse lookup. */
  fromZoneId: string | null;
  fromSectionId?: string;
}

const useStyles = makeStyles({
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "grab",
    userSelect: "none",
    boxShadow: tokens.shadow2,
    transition: "transform 120ms ease, box-shadow 120ms ease",
    ":hover": {
      border: `1px solid ${tokens.colorNeutralStroke1}`,
      boxShadow: tokens.shadow4,
    },
    ":active": {
      cursor: "grabbing",
    },
  },
  dragging: {
    opacity: 0.4,
  },
  icon: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "220px",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "220px",
  },
});

export function EnvGroupChip({ group, fromZoneId, fromSectionId }: Props) {
  const styles = useStyles();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `chip:${group.id}`,
      data: {
        kind: "envGroup",
        envGroupId: group.id,
        fromZoneId,
        fromSectionId,
      },
    });
  const style = {
    transform: CSS.Translate.toString(transform),
  };
  return (
    <Tooltip
      content={group.description || group.displayName}
      relationship="description"
      withArrow
    >
      <div
        ref={setNodeRef}
        style={style}
        className={`${styles.chip}${isDragging ? ` ${styles.dragging}` : ""}`}
        {...listeners}
        {...attributes}
      >
        <GroupListRegular className={styles.icon} />
        <div className={styles.body}>
          <Text className={styles.name} size={200}>
            {group.displayName || "(unnamed group)"}
          </Text>
          {group.location && (
            <Caption1 className={styles.meta}>{group.location}</Caption1>
          )}
        </div>
      </div>
    </Tooltip>
  );
}
