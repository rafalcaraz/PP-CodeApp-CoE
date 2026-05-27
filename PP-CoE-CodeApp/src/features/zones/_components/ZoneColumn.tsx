/**
 * A single column on the Zones board.
 *
 * Two modes:
 *  - User zone   — full chrome (color stripe, header actions, sections,
 *                  Open / Edit / Delete menu)
 *  - Unassigned  — read-only container with a special look, no edit
 *                  controls, always pinned to the left
 *
 * Group rendering is delegated to the shared `Lane` primitive so the
 * same drop / chip behavior works in Zone Detail too. This column only
 * owns the column-level chrome (header + section management) and a
 * tiny footer for adding new sections.
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
  ArrowRightRegular,
  DeleteRegular,
  EditRegular,
  MoreHorizontalRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import type { Zone } from "../../../data/zones";
import type { GroupItem } from "./GroupChip";
import { Lane } from "./Lane";

export interface ZoneColumnGroups {
  /** Items that belong to this zone but no specific section. */
  default: GroupItem[];
  /** Items indexed by sectionId. */
  bySection: Record<string, GroupItem[]>;
}

interface UserZoneProps {
  kind: "zone";
  zone: Zone;
  items: ZoneColumnGroups;
  onEdit: (zone: Zone) => void;
  onDelete: (zone: Zone) => void;
  onAddSection: (zoneId: string, name: string) => void;
  onRenameSection: (zoneId: string, sectionId: string, name: string) => void;
  onDeleteSection: (zoneId: string, sectionId: string) => void;
}

interface UnassignedProps {
  kind: "unassigned";
  items: GroupItem[];
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
  titleButton: {
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
    textAlign: "left",
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
    minWidth: 0,
    ":hover": {
      color: tokens.colorBrandForeground1,
      textDecoration: "underline",
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "2px",
    },
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

export function ZoneColumn(props: Props) {
  const styles = useStyles();
  const navigate = useNavigate();
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
              Groups without a zone — drag into any zone to place them
            </Caption1>
            <Text className={styles.count}>{props.items.length} groups</Text>
          </div>
        </div>
        <div className={styles.body}>
          <Lane zoneId="unassigned" items={props.items} />
        </div>
      </div>
    );
  }

  const { zone, items } = props;
  const totalCount =
    items.default.length +
    Object.values(items.bySection).reduce((sum, arr) => sum + arr.length, 0);

  const openDetail = () => navigate(`/zones/${zone.id}`);

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
            <button
              type="button"
              className={styles.titleButton}
              onClick={openDetail}
              aria-label={`Open zone ${zone.name}`}
            >
              {zone.name}
            </button>
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
              <MenuItem icon={<ArrowRightRegular />} onClick={openDetail}>
                Open zone…
              </MenuItem>
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
          items={items.default}
          title={zone.sections.length > 0 ? "Unsectioned" : undefined}
        />
        {zone.sections.map((section) => (
          <Lane
            key={section.id}
            zoneId={zone.id}
            sectionId={section.id}
            title={section.name}
            items={items.bySection[section.id] ?? []}
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
