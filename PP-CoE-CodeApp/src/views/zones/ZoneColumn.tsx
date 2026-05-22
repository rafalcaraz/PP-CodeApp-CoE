/**
 * A single column in the Zones canvas.
 *
 * Two modes:
 *  - User zone   — full chrome (color stripe, header actions, sections)
 *  - Unassigned  — read-only container with a special look, no edit
 *                  controls, always pinned to the left
 *
 * Each "lane" (a zone's default lane or any section inside it) is its
 * own droppable target; the parent view consumes the resulting drop
 * event and persists the new assignment.
 */

import { useState } from "react";
import {
  Button,
  Caption1,
  Input,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Text,
  tokens,
  type InputOnChangeData,
} from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  EditRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import { useDroppable } from "@dnd-kit/core";
import type { EnvironmentGroupRow } from "../../data/inventory";
import type { Zone } from "../../data/zones";
import { EnvGroupChip } from "./EnvGroupChip";

const SECTION_DEFAULT = "__default__";

export interface ZoneColumnGroups {
  /** Groups that belong to this zone but no specific section. */
  default: EnvironmentGroupRow[];
  /** Groups indexed by sectionId. */
  bySection: Record<string, EnvironmentGroupRow[]>;
}

interface UserZoneProps {
  kind: "zone";
  zone: Zone;
  groups: ZoneColumnGroups;
  onEdit: (zone: Zone) => void;
  onDelete: (zone: Zone) => void;
  onAddSection: (zoneId: string, name: string) => void;
  onRenameSection: (zoneId: string, sectionId: string, name: string) => void;
  onDeleteSection: (zoneId: string, sectionId: string) => void;
}

interface UnassignedProps {
  kind: "unassigned";
  groups: EnvironmentGroupRow[];
}

type Props = UserZoneProps | UnassignedProps;

const useStyles = makeStyles({
  column: {
    display: "flex",
    flexDirection: "column",
    minWidth: "300px",
    maxWidth: "340px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: "hidden",
    flexShrink: 0,
  },
  unassignedColumn: {
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
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
  },
  description: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalM,
    overflowY: "auto",
    flex: 1,
    minHeight: "120px",
  },
  lane: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px dashed transparent`,
    transition: "background-color 120ms ease, border-color 120ms ease",
    minHeight: "60px",
  },
  laneOver: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px dashed ${tokens.colorBrandStroke1}`,
  },
  laneHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
  },
  laneTitle: {
    flex: 1,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: tokens.colorNeutralForeground3,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chipList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  emptyLane: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    paddingBlock: tokens.spacingVerticalS,
    textAlign: "center",
  },
  footer: {
    padding: tokens.spacingHorizontalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  addSectionRow: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
  },
});

interface LaneProps {
  zoneId: string | "unassigned";
  sectionId?: string;
  title?: string;
  groups: EnvironmentGroupRow[];
  onRenameSection?: (newName: string) => void;
  onDeleteSection?: () => void;
}

function Lane({
  zoneId,
  sectionId,
  title,
  groups,
  onRenameSection,
  onDeleteSection,
}: LaneProps) {
  const styles = useStyles();
  const laneKey =
    zoneId === "unassigned"
      ? "lane:unassigned"
      : `lane:${zoneId}:${sectionId ?? SECTION_DEFAULT}`;
  const { isOver, setNodeRef } = useDroppable({
    id: laneKey,
    data: {
      kind: "lane",
      zoneId: zoneId === "unassigned" ? null : zoneId,
      sectionId,
    },
  });
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(title ?? "");

  return (
    <div
      ref={setNodeRef}
      className={`${styles.lane}${isOver ? ` ${styles.laneOver}` : ""}`}
    >
      {title !== undefined && (
        <div className={styles.laneHeader}>
          {renaming ? (
            <Input
              size="small"
              value={draftName}
              autoFocus
              onChange={(_, d: InputOnChangeData) => setDraftName(d.value)}
              onBlur={() => {
                if (onRenameSection && draftName.trim()) {
                  onRenameSection(draftName.trim());
                }
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (onRenameSection && draftName.trim()) {
                    onRenameSection(draftName.trim());
                  }
                  setRenaming(false);
                } else if (e.key === "Escape") {
                  setDraftName(title ?? "");
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <Text className={styles.laneTitle} title={title}>
              {title}
            </Text>
          )}
          {onRenameSection && !renaming && (
            <Button
              size="small"
              appearance="subtle"
              icon={<EditRegular />}
              aria-label="Rename section"
              onClick={() => {
                setDraftName(title ?? "");
                setRenaming(true);
              }}
            />
          )}
          {onDeleteSection && !renaming && (
            <Button
              size="small"
              appearance="subtle"
              icon={<DeleteRegular />}
              aria-label="Delete section"
              onClick={onDeleteSection}
            />
          )}
        </div>
      )}
      {groups.length === 0 ? (
        <div className={styles.emptyLane}>Drop env groups here</div>
      ) : (
        <div className={styles.chipList}>
          {groups.map((g) => (
            <EnvGroupChip
              key={g.id}
              group={g}
              fromZoneId={zoneId === "unassigned" ? null : zoneId}
              fromSectionId={sectionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ZoneColumn(props: Props) {
  const styles = useStyles();
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");

  if (props.kind === "unassigned") {
    return (
      <div className={`${styles.column} ${styles.unassignedColumn}`}>
        <div className={styles.header}>
          <div
            className={styles.colorStripe}
            style={{ backgroundColor: tokens.colorNeutralStroke1 }}
            aria-hidden="true"
          />
          <div className={styles.headerBody}>
            <div className={styles.titleRow}>
              <span className={styles.icon} aria-hidden="true">
                🪐
              </span>
              <Text className={styles.title}>Unassigned</Text>
            </div>
            <Caption1 className={styles.description}>
              Env groups without a zone — drag into any zone to place them
            </Caption1>
            <Text className={styles.count}>{props.groups.length} groups</Text>
          </div>
        </div>
        <div className={styles.body}>
          <Lane zoneId="unassigned" groups={props.groups} />
        </div>
      </div>
    );
  }

  const { zone, groups } = props;
  const totalCount =
    groups.default.length +
    Object.values(groups.bySection).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className={styles.column}>
      <div className={styles.header}>
        <div
          className={styles.colorStripe}
          style={{ backgroundColor: zone.color }}
          aria-hidden="true"
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.icon} aria-hidden="true">
              {zone.icon}
            </span>
            <Text className={styles.title}>{zone.name}</Text>
          </div>
          {zone.description && (
            <Caption1 className={styles.description}>
              {zone.description}
            </Caption1>
          )}
          <Text className={styles.count}>
            {totalCount} group{totalCount === 1 ? "" : "s"}
            {zone.sections.length > 0
              ? ` · ${zone.sections.length} section${zone.sections.length === 1 ? "" : "s"}`
              : ""}
          </Text>
        </div>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button
              size="small"
              appearance="subtle"
              icon={<MoreHorizontalRegular />}
              aria-label={`Zone "${zone.name}" actions`}
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem
                icon={<EditRegular />}
                onClick={() => props.onEdit(zone)}
              >
                Edit zone…
              </MenuItem>
              <MenuItem
                icon={<DeleteRegular />}
                onClick={() => props.onDelete(zone)}
              >
                Delete zone
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      <div className={styles.body}>
        <Lane
          zoneId={zone.id}
          groups={groups.default}
          title={zone.sections.length > 0 ? "Unsectioned" : undefined}
        />
        {zone.sections.map((section) => (
          <Lane
            key={section.id}
            zoneId={zone.id}
            sectionId={section.id}
            title={section.name}
            groups={groups.bySection[section.id] ?? []}
            onRenameSection={(name) =>
              props.onRenameSection(zone.id, section.id, name)
            }
            onDeleteSection={() => props.onDeleteSection(zone.id, section.id)}
          />
        ))}
      </div>
      <div className={styles.footer}>
        {addingSection ? (
          <div className={styles.addSectionRow}>
            <Input
              size="small"
              value={newSectionName}
              placeholder="Section name"
              autoFocus
              onChange={(_, d: InputOnChangeData) => setNewSectionName(d.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSectionName.trim()) {
                  props.onAddSection(zone.id, newSectionName.trim());
                  setNewSectionName("");
                  setAddingSection(false);
                } else if (e.key === "Escape") {
                  setNewSectionName("");
                  setAddingSection(false);
                }
              }}
              onBlur={() => {
                if (newSectionName.trim()) {
                  props.onAddSection(zone.id, newSectionName.trim());
                }
                setNewSectionName("");
                setAddingSection(false);
              }}
              style={{ flex: 1 }}
            />
          </div>
        ) : (
          <Button
            size="small"
            appearance="subtle"
            icon={<AddRegular />}
            onClick={() => setAddingSection(true)}
          >
            Add section
          </Button>
        )}
      </div>
    </div>
  );
}
