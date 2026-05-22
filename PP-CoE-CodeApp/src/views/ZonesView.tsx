/**
 * Zones — the drag-and-drop canvas (top-level board).
 *
 * Microsoft does not support a parent layer over environment groups
 * ("Although you can't configure the group hierarchy yet, you can use a
 * combination of naming conventions…" — Environment Strategy docs). This
 * view is that parent layer, persisted to localStorage. Drag group
 * chips between user-defined Zones (and optional Sections inside each
 * zone) to organize a tenant the way it actually makes sense for *you*.
 *
 * Chips on this board can be either:
 *  - 🛡️ Microsoft env groups — fetched live from the connector, hold
 *    Managed envs, policy-bearing, read-only from this app.
 *  - 📦 Standard custom groups — user-managed in localStorage, hold
 *    Standard envs, label-only. The construct Microsoft refuses to
 *    ship for Standard tenants.
 *
 * Click a zone's title to open the Zone Detail view, where you can
 * focus on a single zone's contents and add / remove groups in/out.
 */

import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  SearchBox,
  Text,
  tokens,
  type SearchBoxChangeEvent,
  type InputOnChangeData,
} from "@fluentui/react-components";
import { AddRegular, InfoRegular } from "@fluentui/react-icons";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  listEnvironmentGroups,
  type EnvironmentGroupRow,
} from "../data/inventory";
import {
  addSection,
  createZone,
  customRef,
  deleteSection,
  deleteZone,
  msRef,
  refToKey,
  renameSection,
  setAssignment,
  updateZone,
  type GroupRef,
  type Zone,
} from "../data/zones";
import {
  createStandardGroup,
  deleteStandardGroup,
  updateStandardGroup,
  type StandardCustomGroup,
} from "../data/standardGroups";
import { useZones } from "../hooks/useZones";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
import { ZoneColumn, type ZoneColumnGroups } from "./zones/ZoneColumn";
import { ZoneEditorDialog } from "./zones/ZoneEditorDialog";
import { StandardGroupEditorDialog } from "./zones/StandardGroupEditorDialog";
import type { GroupItem } from "./zones/GroupChip";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    height: "100%",
    minHeight: 0,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    maxWidth: "780px",
    lineHeight: tokens.lineHeightBase300,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  searchBox: {
    minWidth: "280px",
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  board: {
    display: "flex",
    gap: tokens.spacingHorizontalL,
    overflowX: "auto",
    paddingBlock: tokens.spacingVerticalS,
    paddingInline: tokens.spacingHorizontalXS,
    flex: 1,
    minHeight: 0,
    alignItems: "flex-start",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalXXL,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  receiptCard: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "flex-start",
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    maxWidth: "780px",
  },
  receiptIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
    marginTop: "2px",
  },
  receiptBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  receiptQuote: {
    fontStyle: "italic",
    color: tokens.colorNeutralForeground2,
  },
});

interface EnvGroupState {
  kind: "loading" | "ready" | "error";
  rows: EnvironmentGroupRow[];
  error?: string;
}

/**
 * Convert a raw MS env group row to the UI-shaped `GroupItem` the
 * board operates on. Inlined here because it's used in exactly one
 * place; ZoneDetailView has its own equivalent for the same reason.
 */
function msToItem(g: EnvironmentGroupRow): GroupItem {
  return {
    ref: msRef(g.id),
    displayName: g.displayName,
    description: g.description,
    meta: g.location || undefined,
  };
}

/**
 * Custom groups carry per-chip kebab actions (Open / Edit / Delete)
 * that MS groups don't get. The caller passes in the navigate + edit +
 * delete callbacks; this function bakes them into the resulting item
 * so Lane/ZoneColumn don't need to plumb extra props.
 */
function customToItem(
  g: StandardCustomGroup,
  actions: {
    onOpen: () => void;
    onEdit: () => void;
    onDelete: () => void;
  },
): GroupItem {
  return {
    ref: customRef(g.id),
    displayName: g.displayName,
    description: g.description,
    color: g.color,
    icon: g.icon,
    envCount: g.envIds.length,
    actions,
  };
}

export function ZonesView() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { zones, assignments, standardGroups, refresh } = useZones();
  const [envGroups, setEnvGroups] = useState<EnvGroupState>({
    kind: "loading",
    rows: [],
  });
  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [zoneToDelete, setZoneToDelete] = useState<Zone | null>(null);
  const [customGroupEditorOpen, setCustomGroupEditorOpen] = useState(false);
  const [editingCustomGroup, setEditingCustomGroup] =
    useState<StandardCustomGroup | null>(null);
  const [customGroupToDelete, setCustomGroupToDelete] =
    useState<StandardCustomGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listEnvironmentGroups();
      if (cancelled) return;
      if (res.ok) {
        setEnvGroups({ kind: "ready", rows: res.data });
      } else {
        setEnvGroups({ kind: "error", rows: [], error: res.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Bucket all placeable items (MS env groups + Standard custom groups)
  // into zone columns by current assignment. Search filtering hides
  // non-matching items entirely so a "find and drag" interaction has
  // an unambiguous target.
  const buckets = useMemo(() => {
    const allItems: GroupItem[] = [
      ...envGroups.rows.map(msToItem),
      ...standardGroups.map((g) =>
        customToItem(g, {
          onOpen: () => navigate(`/zones/custom-groups/${g.id}`),
          onEdit: () => {
            setEditingCustomGroup(g);
            setCustomGroupEditorOpen(true);
          },
          onDelete: () => setCustomGroupToDelete(g),
        }),
      ),
    ];

    const trimmedQuery = searchQuery.trim().toLowerCase();
    const matches = (item: GroupItem): boolean => {
      if (!trimmedQuery) return true;
      const haystack = [item.displayName, item.description, item.meta ?? ""]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmedQuery);
    };

    const byZone = new Map<string, ZoneColumnGroups>();
    for (const zone of zones) {
      byZone.set(zone.id, { default: [], bySection: {} });
    }
    const unassigned: GroupItem[] = [];
    let matchCount = 0;

    for (const item of allItems) {
      if (!matches(item)) continue;
      matchCount++;
      const location = assignments[refToKey(item.ref)];
      if (!location || !byZone.has(location.zoneId)) {
        unassigned.push(item);
        continue;
      }
      const zoneBucket = byZone.get(location.zoneId)!;
      if (
        location.sectionId &&
        zones
          .find((z) => z.id === location.zoneId)
          ?.sections.some((s) => s.id === location.sectionId)
      ) {
        const list =
          zoneBucket.bySection[location.sectionId] ??
          (zoneBucket.bySection[location.sectionId] = []);
        list.push(item);
      } else {
        // Section was deleted out from under us — drop to default lane.
        zoneBucket.default.push(item);
      }
    }
    return { byZone, unassigned, matchCount, totalCount: allItems.length };
  }, [zones, assignments, envGroups.rows, standardGroups, searchQuery, navigate]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as
      | {
          kind: "groupChip";
          ref: GroupRef;
          fromZoneId: string | null;
          fromSectionId?: string;
        }
      | undefined;
    const overData = over.data.current as
      | { kind: "lane"; zoneId: string | null; sectionId?: string }
      | undefined;
    if (
      !activeData ||
      activeData.kind !== "groupChip" ||
      !overData ||
      overData.kind !== "lane"
    ) {
      return;
    }
    if (
      activeData.fromZoneId === overData.zoneId &&
      activeData.fromSectionId === overData.sectionId
    ) {
      return;
    }
    if (overData.zoneId === null) {
      setAssignment(activeData.ref, null);
    } else {
      setAssignment(activeData.ref, {
        zoneId: overData.zoneId,
        sectionId: overData.sectionId,
      });
    }
    refresh();
  };

  const openNewZone = () => {
    setEditingZone(null);
    setZoneEditorOpen(true);
  };
  const openEditZone = (zone: Zone) => {
    setEditingZone(zone);
    setZoneEditorOpen(true);
  };
  const handleZoneSubmit = (
    input: { name: string; description: string; color: string; icon: string },
    zone: Zone | null,
  ) => {
    if (zone) {
      updateZone(zone.id, input);
    } else {
      createZone(input);
    }
    setZoneEditorOpen(false);
    setEditingZone(null);
  };

  const openNewCustomGroup = () => {
    setEditingCustomGroup(null);
    setCustomGroupEditorOpen(true);
  };
  const handleCustomGroupSubmit = (
    input: {
      displayName: string;
      description: string;
      color: string;
      icon: string;
    },
    group: StandardCustomGroup | null,
  ) => {
    if (group) {
      updateStandardGroup(group.id, input);
    } else {
      createStandardGroup(input);
    }
    setCustomGroupEditorOpen(false);
    setEditingCustomGroup(null);
  };

  if (envGroups.kind === "loading") {
    return <LoadingPane label="Loading environment groups…" />;
  }
  if (envGroups.kind === "error") {
    return (
      <ErrorPane
        title="Couldn't load environment groups"
        message={envGroups.error ?? "Unknown error"}
      />
    );
  }

  const totalAssigned = Object.keys(assignments).length;
  const noZones = zones.length === 0;
  const noGroups = buckets.totalCount === 0;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Zones
        </Text>
        <Text className={styles.subtitle}>
          Drag groups (Microsoft env groups + Standard custom groups) into
          Zones to organize your tenant the way it actually fits — by business
          unit, region, lifecycle stage, capability, or anything else. Zones
          are personal to this browser and never modify Microsoft data.
        </Text>
      </div>

      <div className={styles.receiptCard}>
        <InfoRegular className={styles.receiptIcon} />
        <div className={styles.receiptBody}>
          <Caption1>Why this exists</Caption1>
          <Text className={styles.receiptQuote} size={200}>
            "Although you can't configure the group hierarchy yet, you can use a
            combination of naming conventions and rule configuration to
            implement your conceptual design."
          </Text>
          <Caption1>— Microsoft Learn, Environment Strategy guidance</Caption1>
        </div>
      </div>

      <div className={styles.toolbar}>
        <Text className={styles.meta}>
          {searchQuery.trim() ? (
            <>
              {buckets.matchCount} of {buckets.totalCount} group
              {buckets.totalCount === 1 ? "" : "s"} match "{searchQuery.trim()}" ·{" "}
              {zones.length} zone{zones.length === 1 ? "" : "s"} ·{" "}
              {totalAssigned} placed
            </>
          ) : (
            <>
              {envGroups.rows.length} MS env group
              {envGroups.rows.length === 1 ? "" : "s"} · {standardGroups.length}{" "}
              custom · {zones.length} zone{zones.length === 1 ? "" : "s"} ·{" "}
              {totalAssigned} placed
            </>
          )}
        </Text>
        <div className={styles.toolbarRight}>
          <SearchBox
            className={styles.searchBox}
            placeholder="Search groups…"
            value={searchQuery}
            onChange={(_: SearchBoxChangeEvent, data: InputOnChangeData) =>
              setSearchQuery(data.value)
            }
          />
          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <MenuButton appearance="primary" icon={<AddRegular />}>
                New
              </MenuButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={openNewZone}>New zone…</MenuItem>
                <MenuItem onClick={openNewCustomGroup}>
                  New Standard custom group…
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>

      {noGroups ? (
        <EmptyPane message="No env groups in this tenant and no custom groups yet. Create a Standard custom group above to start organizing." />
      ) : noZones ? (
        <div className={styles.emptyState}>
          <Text size={400} weight="semibold">
            Start by creating your first zone
          </Text>
          <Text className={styles.subtitle} style={{ textAlign: "center" }}>
            A zone is your own grouping — a business unit, a region, an ALM
            stage, anything. Then drag groups in.
          </Text>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={openNewZone}
          >
            Create your first zone
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className={styles.board}>
            <ZoneColumn kind="unassigned" items={buckets.unassigned} />
            {zones.map((zone) => (
              <ZoneColumn
                key={zone.id}
                kind="zone"
                zone={zone}
                items={
                  buckets.byZone.get(zone.id) ?? {
                    default: [],
                    bySection: {},
                  }
                }
                onEdit={openEditZone}
                onDelete={setZoneToDelete}
                onAddSection={addSection}
                onRenameSection={renameSection}
                onDeleteSection={deleteSection}
              />
            ))}
          </div>
        </DndContext>
      )}

      <ZoneEditorDialog
        open={zoneEditorOpen}
        zone={editingZone}
        onDismiss={() => {
          setZoneEditorOpen(false);
          setEditingZone(null);
        }}
        onSubmit={handleZoneSubmit}
      />

      <StandardGroupEditorDialog
        open={customGroupEditorOpen}
        group={editingCustomGroup}
        onDismiss={() => {
          setCustomGroupEditorOpen(false);
          setEditingCustomGroup(null);
        }}
        onSubmit={handleCustomGroupSubmit}
      />

      <Dialog
        open={zoneToDelete !== null}
        onOpenChange={(_, data) => {
          if (!data.open) setZoneToDelete(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete zone?</DialogTitle>
            <DialogContent>
              <Text>
                Deleting <strong>{zoneToDelete?.name}</strong> returns its
                groups to Unassigned. The Microsoft environment groups
                themselves are not affected. Standard custom groups remain in
                Unassigned.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setZoneToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => {
                  if (zoneToDelete) deleteZone(zoneToDelete.id);
                  setZoneToDelete(null);
                }}
              >
                Delete zone
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={customGroupToDelete !== null}
        onOpenChange={(_, data) => {
          if (!data.open) setCustomGroupToDelete(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete Standard custom group?</DialogTitle>
            <DialogContent>
              <Text>
                Deleting <strong>{customGroupToDelete?.displayName}</strong>{" "}
                removes the group entirely. Any environments that were members
                return to "loose Standard" status; the environments themselves
                are not affected.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setCustomGroupToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => {
                  if (customGroupToDelete)
                    deleteStandardGroup(customGroupToDelete.id);
                  setCustomGroupToDelete(null);
                }}
              >
                Delete group
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
