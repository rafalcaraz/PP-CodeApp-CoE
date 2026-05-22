/**
 * Side panel for the Zone Detail view: lists every group NOT currently
 * in the zone being viewed, grouped by "where it currently lives"
 * (Unassigned vs. some other zone). Acts as a *source* of chips you
 * drag IN to the zone, and exposes a dedicated drop target for moving
 * chips OUT (back to Unassigned).
 */

import {
  Caption1,
  makeStyles,
  SearchBox,
  Text,
  tokens,
  type SearchBoxChangeEvent,
  type InputOnChangeData,
} from "@fluentui/react-components";
import { DismissCircleRegular } from "@fluentui/react-icons";
import { useDroppable } from "@dnd-kit/core";
import type { Zone, ZoneAssignments } from "../../data/zones";
import { refToKey } from "../../data/zones";
import { GroupChip, type GroupItem } from "./GroupChip";

interface Props {
  /** The zone currently being viewed in Zone Detail. */
  zone: Zone;
  /** Every group in the tenant (MS + custom), already converted to GroupItems. */
  allItems: GroupItem[];
  assignments: ZoneAssignments;
  zoneNamesById: Map<string, string>;
  searchQuery: string;
  onSearchChange: (next: string) => void;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    width: "320px",
    minWidth: "320px",
    maxWidth: "360px",
    height: "100%",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: tokens.spacingHorizontalM,
    overflow: "hidden",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  removeTarget: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    transition: "background-color 120ms ease, border-color 120ms ease",
  },
  removeTargetOver: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    border: `1px dashed ${tokens.colorPaletteRedBorder2}`,
    color: tokens.colorPaletteRedForeground1,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  groupHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  empty: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    paddingBlock: tokens.spacingVerticalM,
    textAlign: "center",
  },
  chipList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
});

/**
 * Dedicated drop target. Lives separate from the chip list so dropping
 * onto the panel "by accident" (e.g., letting go on whitespace) doesn't
 * unintentionally remove a group from the zone.
 */
function RemoveFromZoneDrop({ zoneId }: { zoneId: string }) {
  const styles = useStyles();
  const { isOver, setNodeRef } = useDroppable({
    id: `lane:remove:${zoneId}`,
    // zoneId: null tells the drop handler to call setAssignment(ref, null).
    data: { kind: "lane", zoneId: null, sectionId: undefined },
  });
  return (
    <div
      ref={setNodeRef}
      className={`${styles.removeTarget}${isOver ? ` ${styles.removeTargetOver}` : ""}`}
    >
      <DismissCircleRegular />
      <span>Drop here to remove from this zone</span>
    </div>
  );
}

export function AvailableGroupsPanel({
  zone,
  allItems,
  assignments,
  zoneNamesById,
  searchQuery,
  onSearchChange,
}: Props) {
  const styles = useStyles();

  const trimmed = searchQuery.trim().toLowerCase();
  const matches = (item: GroupItem): boolean => {
    if (!trimmed) return true;
    const haystack = [item.displayName, item.description, item.meta ?? ""]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmed);
  };

  // Anything NOT placed in this zone is eligible to appear here.
  const unassigned: GroupItem[] = [];
  const inOtherZones = new Map<string, GroupItem[]>(); // zoneId → items
  for (const item of allItems) {
    if (!matches(item)) continue;
    const location = assignments[refToKey(item.ref)];
    if (location?.zoneId === zone.id) continue; // already in this zone
    if (!location) {
      unassigned.push(item);
    } else {
      const list = inOtherZones.get(location.zoneId) ?? [];
      list.push(item);
      inOtherZones.set(location.zoneId, list);
    }
  }

  return (
    <aside className={styles.root} aria-label="Available groups">
      <div className={styles.header}>
        <Text weight="semibold">Add groups to this zone</Text>
        <Caption1>Drag a chip into any lane on the left.</Caption1>
      </div>
      <SearchBox
        size="small"
        placeholder="Search groups…"
        value={searchQuery}
        onChange={(_: SearchBoxChangeEvent, data: InputOnChangeData) =>
          onSearchChange(data.value)
        }
      />
      <RemoveFromZoneDrop zoneId={zone.id} />
      <div className={styles.list}>
        <section className={styles.group}>
          <div className={styles.groupHeader}>
            <span>Unassigned</span>
            <Caption1>{unassigned.length}</Caption1>
          </div>
          {unassigned.length === 0 ? (
            <div className={styles.empty}>None</div>
          ) : (
            <div className={styles.chipList}>
              {unassigned.map((item) => (
                <GroupChip
                  key={`${item.ref.kind}:${item.ref.id}`}
                  item={item}
                  fromZoneId={null}
                />
              ))}
            </div>
          )}
        </section>
        {Array.from(inOtherZones.entries())
          .sort(([a], [b]) =>
            (zoneNamesById.get(a) ?? "").localeCompare(
              zoneNamesById.get(b) ?? "",
            ),
          )
          .map(([otherZoneId, items]) => (
            <section key={otherZoneId} className={styles.group}>
              <div className={styles.groupHeader}>
                <span>
                  In zone: {zoneNamesById.get(otherZoneId) ?? "(unknown)"}
                </span>
                <Caption1>{items.length}</Caption1>
              </div>
              <div className={styles.chipList}>
                {items.map((item) => (
                  <GroupChip
                    key={`${item.ref.kind}:${item.ref.id}`}
                    item={item}
                    fromZoneId={otherZoneId}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>
    </aside>
  );
}
