/**
 * A lane in the Tier 2 Kanban representing ONE group (MS env group or
 * Standard custom group) and the envs inside it.
 *
 * MS groups:
 *  - Header shows 🛡️ Microsoft badge + "View in PPAC ↗"
 *  - Env rows are read-only (no checkboxes, no remove buttons)
 *  - Reflects what Microsoft says is in the group on every fetch
 *
 * Custom groups:
 *  - Header has a kebab menu (Open / Edit / Delete)
 *  - Env rows are selectable + each has a × Remove button
 *  - Mutations write to localStorage
 */

import {
  Badge,
  Button,
  Caption1,
  Link,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRightRegular,
  DeleteRegular,
  DismissCircleRegular,
  EditRegular,
  MoreVerticalRegular,
  OpenRegular,
} from "@fluentui/react-icons";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import type { EnvironmentRow } from "../../../data/inventory";
import type { GroupKind } from "../../../data/zones";
import { EnvRow, type EnvDragSource } from "./EnvRow";

const PPAC_ENV_GROUP_BASE =
  "https://admin.powerplatform.microsoft.com/manage/environment-groups";

interface CustomGroupActions {
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

interface Props {
  groupKind: GroupKind;
  groupId: string;
  displayName: string;
  description?: string;
  color?: string;
  icon?: string;
  envs: EnvironmentRow[];
  /** When provided AND a custom group, env rows are selectable. */
  selection?: {
    isSelected: (envId: string) => boolean;
    toggle: (envId: string) => void;
  };
  /** When provided AND a custom group, each env row gets a × button. */
  onRemoveEnv?: (envId: string) => void;
  /** Custom-group only. Kebab menu actions in the header. */
  customActions?: CustomGroupActions;
}

const useStyles = makeStyles({
  lane: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
    minWidth: "300px",
    maxWidth: "380px",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalM,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  colorStripe: {
    width: "4px",
    alignSelf: "stretch",
    borderRadius: tokens.borderRadiusSmall,
    flexShrink: 0,
  },
  headerBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
  },
  icon: {
    fontSize: tokens.fontSizeBase400,
    flexShrink: 0,
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  },
  description: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  ppacLink: {
    fontSize: tokens.fontSizeBase200,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalM,
    maxHeight: "420px",
    overflowY: "auto",
    minHeight: "60px",
    transition: "background-color 120ms ease, outline-color 120ms ease",
  },
  // Valid drop target while hovering: brand highlight (drop here!).
  bodyDropValid: {
    backgroundColor: tokens.colorBrandBackground2,
    outline: `2px dashed ${tokens.colorBrandStroke1}`,
    outlineOffset: "-4px",
  },
  // Invalid drop target while hovering: red highlight (can't drop here).
  // The reason is shown inline via `invalidHint` so the user sees both
  // the color cue AND the explanation in the same place.
  bodyDropInvalid: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    outline: `2px dashed ${tokens.colorPaletteRedBorder2}`,
    outlineOffset: "-4px",
  },
  // During any drag, invalid lanes get a subtle red dashed border so
  // the user knows BEFORE hovering that the drop wouldn't be valid.
  // Less prominent than the full hover styling above.
  bodyDragInvalidNotHovering: {
    outline: `1px dashed ${tokens.colorPaletteRedBorder1}`,
    outlineOffset: "-4px",
    opacity: 0.7,
  },
  invalidHint: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingHorizontalXS,
    padding: tokens.spacingHorizontalS,
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  empty: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    textAlign: "center",
    paddingBlock: tokens.spacingVerticalM,
  },
});

export function GroupEnvLane({
  groupKind,
  groupId,
  displayName,
  description,
  color,
  icon,
  envs,
  selection,
  onRemoveEnv,
  customActions,
}: Props) {
  const styles = useStyles();
  const isMs = groupKind === "ms";
  const stripeColor = color ?? (isMs ? tokens.colorNeutralStroke1 : "#525252");
  const displayIcon = icon ?? (isMs ? "🛡️" : "📦");

  // MS group lanes are droppable targets for the "demo the future"
  // drag interaction (drop a Managed env from another MS group / from
  // the Loose Managed side panel to see what the eventual mutation
  // would do). Custom group lanes are ALSO droppable, but for a
  // different reason: they accept Standard envs and the drop actually
  // performs an `addEnvToStandardGroup` mutation (we own that data),
  // followed by an educational popup. The two drop semantics share the
  // same hook signature; the discriminator is on the data payload so
  // `ZoneDetailView`'s handler routes drops to the right action.
  const { isOver, setNodeRef } = useDroppable({
    id: `${groupKind === "ms" ? "ms" : "custom"}-group-lane:${groupId}`,
    data: {
      kind: isMs ? "msGroupLane" : "customGroupLane",
      groupId,
      displayName,
    },
  });

  // Read the currently-dragging env so we can decide whether THIS lane
  // would be a valid drop target — and surface that to the user via
  // green/red styling instead of letting them drop and discover the
  // rejection only afterward. Type purity becomes teachable visually:
  //
  //   - MS group lane accepts Managed envs only
  //   - Custom group lane accepts Standard envs only
  //   - Self-drop on the source group is neutral (no cue)
  const { active } = useDndContext();
  const activeData = active?.data.current as
    | { kind?: string; source?: EnvDragSource }
    | undefined;
  const activeSource =
    activeData?.kind === "envDrag" ? activeData.source : undefined;

  const validity = useMemo<"valid" | "invalid" | "self" | null>(() => {
    if (!activeSource) return null; // not dragging anything
    if (isMs) {
      // MS group lane: managed envs only
      if (
        activeSource.kind === "loose-standard" ||
        activeSource.kind === "custom-group"
      ) {
        return "invalid";
      }
      if (
        activeSource.kind === "ms-group" &&
        activeSource.groupId === groupId
      ) {
        return "self";
      }
      return "valid";
    }
    // Custom group lane: standard envs only
    if (
      activeSource.kind === "ms-group" ||
      activeSource.kind === "loose-managed"
    ) {
      return "invalid";
    }
    if (
      activeSource.kind === "custom-group" &&
      activeSource.groupId === groupId
    ) {
      return "self";
    }
    return "valid";
  }, [activeSource, isMs, groupId]);

  const bodyClasses = [styles.body];
  if (isOver && validity === "valid") bodyClasses.push(styles.bodyDropValid);
  if (isOver && validity === "invalid")
    bodyClasses.push(styles.bodyDropInvalid);
  // Subtle pre-hover cue: when a drag is active AND this lane is
  // invalid, dim it slightly so the user sees "not for me" before they
  // even mouse over.
  if (!isOver && validity === "invalid")
    bodyClasses.push(styles.bodyDragInvalidNotHovering);

  const invalidReason = isMs
    ? "Standard envs can't go in Microsoft env groups"
    : "Managed envs can't go in Standard custom groups";

  return (
    <div className={styles.lane}>
      <div className={styles.header}>
        <div
          className={styles.colorStripe}
          style={{ backgroundColor: stripeColor }}
          aria-hidden
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.icon} aria-hidden>
              {displayIcon}
            </span>
            <Text className={styles.title}>{displayName}</Text>
            <Badge
              size="extra-small"
              appearance="outline"
              color={isMs ? "informative" : "subtle"}
            >
              {isMs ? "Microsoft" : "Standard"}
            </Badge>
          </div>
          {description && (
            <Caption1 className={styles.description}>{description}</Caption1>
          )}
          <Text className={styles.meta}>
            {envs.length} env{envs.length === 1 ? "" : "s"}
            {isMs && (
              <>
                {" · "}
                <Link
                  href={`${PPAC_ENV_GROUP_BASE}/${groupId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.ppacLink}
                >
                  View in PPAC <OpenRegular fontSize={10} />
                </Link>
              </>
            )}
          </Text>
        </div>
        {!isMs && customActions && (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                size="small"
                appearance="subtle"
                icon={<MoreVerticalRegular />}
                aria-label={`${displayName} actions`}
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  icon={<ArrowRightRegular />}
                  onClick={customActions.onOpen}
                >
                  Open
                </MenuItem>
                <MenuItem
                  icon={<EditRegular />}
                  onClick={customActions.onEdit}
                >
                  Edit…
                </MenuItem>
                <MenuItem
                  icon={<DeleteRegular />}
                  onClick={customActions.onDelete}
                >
                  Delete
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
      </div>
      <div ref={setNodeRef} className={bodyClasses.join(" ")}>
        {isOver && validity === "invalid" && (
          <div className={styles.invalidHint}>
            <DismissCircleRegular />
            <span>{invalidReason}</span>
          </div>
        )}
        {envs.length === 0 ? (
          <div className={styles.empty}>
            {isMs
              ? "No environments in this MS group"
              : "No environments yet. Add Standard envs from the side panel."}
          </div>
        ) : (
          envs.map((env) => (
            <EnvRow
              key={env.id}
              env={env}
              selectable={!isMs && selection !== undefined}
              selected={selection?.isSelected(env.id) ?? false}
              onToggle={
                !isMs && selection
                  ? () => selection.toggle(env.id)
                  : undefined
              }
              onRemove={!isMs && onRemoveEnv ? () => onRemoveEnv(env.id) : undefined}
              dragSource={
                isMs
                  ? {
                      kind: "ms-group",
                      groupId,
                      groupDisplayName: displayName,
                    }
                  : {
                      kind: "custom-group",
                      groupId,
                      groupDisplayName: displayName,
                    }
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
