/**
 * Single env row inside a group lane or in the eligible-envs panel.
 *
 * Renders an env with type-aware provenance (🛡️ Managed / 📦 Standard /
 * ⚡ Loose Managed). Has three optional interaction modes:
 *
 *   1. Selection (custom group lanes + Loose Standard panel section) —
 *      a checkbox surfaces and the row participates in multi-select.
 *   2. Removal (custom group lanes only) — a × button kicks the env
 *      out of the group.
 *   3. Drag (Managed envs in MS group lanes + Loose Managed in side
 *      panel) — used by the Tier 2 Kanban's "demo the future" UX:
 *      drag a Managed env onto an MS group lane and a popup explains
 *      what the eventual mutation would do.
 *
 * Row click does NOT navigate anywhere. Earlier this used to open the
 * env's detail page, which fought with multi-select and drag interactions
 * — both are far more useful in the Kanban than another way to drill in.
 */

import {
  Caption1,
  Checkbox,
  Link,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { CheckboxOnChangeData } from "@fluentui/react-components";
import {
  DismissRegular,
  OpenRegular,
  ShieldRegular,
} from "@fluentui/react-icons";
import { Button } from "@fluentui/react-components";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { EnvironmentRow } from "../../data/inventory";

/**
 * Where a draggable env row came from. Embedded in the drag data so
 * the drop handler in `ZoneDetailView` can craft a precise "move from
 * X to Y" message without a reverse lookup.
 */
export type EnvDragSource =
  | { kind: "ms-group"; groupId: string; groupDisplayName: string }
  | { kind: "loose-managed" }
  | { kind: "loose-standard" }
  | {
      kind: "custom-group";
      groupId: string;
      groupDisplayName: string;
    };

interface Props {
  env: EnvironmentRow;
  /** Show the checkbox + selection styling. Omit to render a non-selectable row. */
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  /** When present, renders a small × button (used in custom group lanes). */
  onRemove?: () => void;
  /**
   * When true, append a deep link to PPAC for managing this env.
   * Used for Loose Managed envs ("promote to a group in PPAC").
   */
  showPpacLink?: boolean;
  /**
   * When provided, the row becomes a drag source. Only set this for
   * Managed envs that are draggable in the Tier 2 Kanban — selection
   * (Standard envs) and drag (Managed envs) are kept type-disjoint to
   * avoid mode collision.
   */
  dragSource?: EnvDragSource;
}

const PPAC_BASE = "https://admin.powerplatform.microsoft.com/manage/environments";

const useStyles = makeStyles({
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    transition: "background-color 80ms ease, border-color 80ms ease",
    ":hover": {
      border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
  },
  rowSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    ":hover": {
      backgroundColor: tokens.colorBrandBackground2,
      border: `1px solid ${tokens.colorBrandStroke1}`,
    },
  },
  rowDraggable: {
    cursor: "grab",
    ":active": {
      cursor: "grabbing",
    },
  },
  rowDragging: {
    opacity: 0.4,
  },
  body: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  managedIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  ppacLink: {
    fontSize: tokens.fontSizeBase200,
  },
});

export function EnvRow({
  env,
  selectable = false,
  selected = false,
  onToggle,
  onRemove,
  showPpacLink = false,
  dragSource,
}: Props) {
  const styles = useStyles();

  // Draggable plumbing is conditional: only Managed envs in MS group
  // lanes or in the Loose Managed side-panel bucket pass `dragSource`.
  // For all other rows the hook still runs (rules-of-hooks) but its
  // listeners attach to nothing useful.
  const draggable = useDraggable({
    id: `env:${env.id}`,
    disabled: dragSource === undefined,
    data: dragSource
      ? { kind: "envDrag", env, source: dragSource }
      : undefined,
  });

  const classes = [styles.row];
  if (selected) classes.push(styles.rowSelected);
  if (dragSource) classes.push(styles.rowDraggable);
  if (draggable.isDragging) classes.push(styles.rowDragging);

  const style: React.CSSProperties = dragSource
    ? { transform: CSS.Translate.toString(draggable.transform) }
    : {};

  // Drag-related props only attach when the row is actually draggable.
  // Spreading `undefined` would still be valid JSX but reads as noise.
  const dragRefProp = dragSource ? { ref: draggable.setNodeRef } : {};
  const dragListenerProps = dragSource
    ? { ...draggable.listeners, ...draggable.attributes }
    : {};

  return (
    <div
      {...dragRefProp}
      style={style}
      className={classes.join(" ")}
      {...dragListenerProps}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(_, data: CheckboxOnChangeData) => {
            if (onToggle) onToggle();
            void data;
          }}
          aria-label={`Select ${env.displayName}`}
        />
      )}
      {env.isManaged && !selectable && (
        <ShieldRegular className={styles.managedIcon} aria-hidden />
      )}
      <div className={styles.body}>
        <Text className={styles.name} size={200}>
          {env.displayName || "(unnamed)"}
        </Text>
        <Caption1 className={styles.meta}>
          {env.isManaged ? "🛡️ Managed · " : "📦 Standard · "}
          {env.environmentType}
          {env.region ? ` · ${env.region}` : ""}
          {showPpacLink && (
            <>
              {" · "}
              <Link
                href={`${PPAC_BASE}/${env.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ppacLink}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                Manage in PPAC <OpenRegular fontSize={10} />
              </Link>
            </>
          )}
        </Caption1>
      </div>
      {onRemove && (
        <Button
          size="small"
          appearance="subtle"
          icon={<DismissRegular />}
          aria-label={`Remove ${env.displayName}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      )}
    </div>
  );
}
