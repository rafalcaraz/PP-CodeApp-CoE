/**
 * Draggable group chip — the atomic unit on the Zones board and inside
 * Zone Detail. Represents either:
 *  - a Microsoft environment group (Managed envs, policy-bearing, locked)
 *  - a Standard custom group (Standard envs, label-only, fully editable)
 *
 * The visual badge differs by kind so type purity is teachable at a
 * glance. Drag data carries a `GroupRef` so drop handlers can resolve
 * the source without a reverse lookup.
 */

import {
  makeStyles,
  tokens,
  Text,
  Tooltip,
  Caption1,
  Badge,
} from "@fluentui/react-components";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { GroupRef } from "../../data/zones";

/**
 * UI-layer shape for a placeable group. Both MS env groups (from
 * `data/inventory.ts`) and Standard custom groups (from
 * `data/standardGroups.ts`) map to this. Letting the chip / lane work
 * in this common shape means downstream components don't branch on
 * `kind` for rendering.
 */
export interface GroupItem {
  ref: GroupRef;
  displayName: string;
  description: string;
  /** Custom groups carry their own color; MS groups don't have one. */
  color?: string;
  /** Custom groups carry their own icon; MS groups use a kind default. */
  icon?: string;
  /** Optional secondary line (e.g., MS group location). */
  meta?: string;
}

interface Props {
  item: GroupItem;
  /** Where this chip currently lives — used so the drop handler can
   *  compute the "from" location without a reverse lookup. */
  fromZoneId: string | null;
  fromSectionId?: string;
}

const useStyles = makeStyles({
  chip: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
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
  iconCell: {
    width: "24px",
    height: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: tokens.fontSizeBase400,
    flexShrink: 0,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
    minWidth: 0,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

const KIND_DEFAULTS = {
  ms: { icon: "🛡️", badge: "Microsoft", badgeColor: "informative" as const },
  custom: { icon: "📦", badge: "Standard", badgeColor: "subtle" as const },
};

export function GroupChip({ item, fromZoneId, fromSectionId }: Props) {
  const styles = useStyles();
  const kindMeta = KIND_DEFAULTS[item.ref.kind];
  const displayIcon = item.icon || kindMeta.icon;

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `chip:${item.ref.kind}:${item.ref.id}`,
      data: {
        kind: "groupChip",
        ref: item.ref,
        fromZoneId,
        fromSectionId,
      },
    });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    ...(item.color ? { borderLeft: `4px solid ${item.color}` } : {}),
  };

  return (
    <Tooltip
      content={item.description || item.displayName}
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
        <span className={styles.iconCell} aria-hidden="true">
          {displayIcon}
        </span>
        <div className={styles.body}>
          <div className={styles.nameRow}>
            <Text className={styles.name} size={200}>
              {item.displayName || "(unnamed group)"}
            </Text>
            <Badge
              size="extra-small"
              appearance="outline"
              color={kindMeta.badgeColor}
            >
              {kindMeta.badge}
            </Badge>
          </div>
          {item.meta && (
            <Caption1 className={styles.meta}>{item.meta}</Caption1>
          )}
        </div>
      </div>
    </Tooltip>
  );
}
