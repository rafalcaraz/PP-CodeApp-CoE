/**
 * Lane — a single droppable target inside a zone column (the default
 * "unsectioned" lane OR a named section). Extracted from `ZoneColumn`
 * so the Zone Detail view can reuse it.
 *
 * Renders the lane's header (optional section title + rename/delete
 * controls) and the list of chips inside.
 */

import { useState } from "react";
import {
  Button,
  Input,
  makeStyles,
  Text,
  tokens,
  type InputOnChangeData,
} from "@fluentui/react-components";
import { DeleteRegular, EditRegular } from "@fluentui/react-icons";
import { useDroppable } from "@dnd-kit/core";
import { GroupChip, type GroupItem } from "./GroupChip";

const SECTION_DEFAULT = "__default__";

interface LaneProps {
  /** `"unassigned"` sentinel for the implicit Unassigned column on the
   *  Zone Board; otherwise the zone's id. */
  zoneId: string | "unassigned";
  sectionId?: string;
  title?: string;
  items: GroupItem[];
  emptyHint?: string;
  onRenameSection?: (newName: string) => void;
  onDeleteSection?: () => void;
}

const useStyles = makeStyles({
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
});

export function Lane({
  zoneId,
  sectionId,
  title,
  items,
  emptyHint,
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
      {items.length === 0 ? (
        <div className={styles.emptyLane}>
          {emptyHint ?? "Drop groups here"}
        </div>
      ) : (
        <div className={styles.chipList}>
          {items.map((item) => (
            <GroupChip
              key={`${item.ref.kind}:${item.ref.id}`}
              item={item}
              fromZoneId={zoneId === "unassigned" ? null : zoneId}
              fromSectionId={sectionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
