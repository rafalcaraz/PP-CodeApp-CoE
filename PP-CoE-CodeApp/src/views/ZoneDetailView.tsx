/**
 * Zone Detail — drill-down view for a single zone.
 *
 * Where the Zone Board (`ZonesView`) shows the *whole tenant* as a
 * Kanban of zones-containing-groups, this view zooms into ONE zone and
 * makes it the workspace: the zone's groups are arranged into lanes
 * (default + sections), and a side panel exposes every other group in
 * the tenant ready to be dragged in.
 *
 * Drag interactions handled here:
 *  - Drag a chip between sections within this zone — moves it
 *  - Drag a chip from the side panel into a section — places it in this zone
 *  - Drag a chip from this zone onto the side panel's "remove" target —
 *    returns it to Unassigned
 *
 * Drag-between-MS-groups (the eventual mutation surface that would
 * issue a real PPAC command) is NOT supported here in v1. That requires
 * a separate permission + audit + rollback story; see `plan.md` →
 * "Question 2d — The two-tier UX" → "The philosophical shift."
 */

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
  Input,
  makeStyles,
  Text,
  tokens,
  type InputOnChangeData,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowLeftRegular,
  DeleteRegular,
  EditRegular,
} from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
  customRef,
  deleteSection,
  deleteZone,
  msRef,
  refToKey,
  renameSection,
  setAssignment,
  updateZone,
  type GroupRef,
} from "../data/zones";
import {
  deleteStandardGroup,
  updateStandardGroup,
  type StandardCustomGroup,
} from "../data/standardGroups";
import { useZones } from "../hooks/useZones";
import { ErrorPane, LoadingPane } from "../components/Status";
import { Lane } from "./zones/Lane";
import { AvailableGroupsPanel } from "./zones/AvailableGroupsPanel";
import { ZoneEditorDialog } from "./zones/ZoneEditorDialog";
import { StandardGroupEditorDialog } from "./zones/StandardGroupEditorDialog";
import type { GroupItem } from "./zones/GroupChip";

function msToItem(g: EnvironmentGroupRow): GroupItem {
  return {
    ref: msRef(g.id),
    displayName: g.displayName,
    description: g.description,
    meta: g.location || undefined,
  };
}

/**
 * Custom-group items in Zone Detail carry the same kebab-menu
 * actions as on the board so navigation / edit / delete are reachable
 * without bouncing back to /zones first.
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

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    height: "100%",
    minHeight: 0,
  },
  backRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
  },
  colorStripe: {
    width: "6px",
    minHeight: "60px",
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
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  zoneIcon: {
    fontSize: tokens.fontSizeBase600,
  },
  zoneTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  description: {
    color: tokens.colorNeutralForeground3,
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexShrink: 0,
  },
  body: {
    display: "flex",
    gap: tokens.spacingHorizontalL,
    flex: 1,
    minHeight: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalXS,
  },
  sectionBlock: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  addSectionRow: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    alignItems: "center",
  },
});

export function ZoneDetailView() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { zoneId } = useParams<{ zoneId: string }>();
  const { zones, assignments, standardGroups, refresh } = useZones();
  const [envGroupsState, setEnvGroupsState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; rows: EnvironmentGroupRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [panelSearch, setPanelSearch] = useState("");
  const [customGroupEditorOpen, setCustomGroupEditorOpen] = useState(false);
  const [editingCustomGroup, setEditingCustomGroup] =
    useState<StandardCustomGroup | null>(null);
  const [customGroupToDelete, setCustomGroupToDelete] =
    useState<StandardCustomGroup | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listEnvironmentGroups();
      if (cancelled) return;
      if (res.ok) {
        setEnvGroupsState({ kind: "ready", rows: res.data });
      } else {
        setEnvGroupsState({ kind: "error", message: res.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const zone = useMemo(
    () => zones.find((z) => z.id === zoneId) ?? null,
    [zones, zoneId],
  );

  const allItems = useMemo<GroupItem[]>(() => {
    if (envGroupsState.kind !== "ready") return [];
    return [
      ...envGroupsState.rows.map(msToItem),
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
  }, [envGroupsState, standardGroups, navigate]);

  const zoneNamesById = useMemo(
    () => new Map(zones.map((z) => [z.id, z.name])),
    [zones],
  );

  // Bucket items belonging to THIS zone into the zone's lanes (default
  // + sections). Items belonging elsewhere are handled by the side
  // panel via `allItems` directly.
  const inZoneBuckets = useMemo(() => {
    const defaultLane: GroupItem[] = [];
    const bySection: Record<string, GroupItem[]> = {};
    if (!zone) return { defaultLane, bySection };
    for (const item of allItems) {
      const location = assignments[refToKey(item.ref)];
      if (location?.zoneId !== zone.id) continue;
      if (
        location.sectionId &&
        zone.sections.some((s) => s.id === location.sectionId)
      ) {
        const list =
          bySection[location.sectionId] ??
          (bySection[location.sectionId] = []);
        list.push(item);
      } else {
        defaultLane.push(item);
      }
    }
    return { defaultLane, bySection };
  }, [zone, allItems, assignments]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !zone) return;
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

  if (envGroupsState.kind === "loading") {
    return <LoadingPane label="Loading environment groups…" />;
  }
  if (envGroupsState.kind === "error") {
    return (
      <ErrorPane
        title="Couldn't load environment groups"
        message={envGroupsState.message}
      />
    );
  }
  if (!zone) {
    return (
      <ErrorPane
        title="Zone not found"
        message="That zone may have been deleted. Go back to the Zones board."
      />
    );
  }

  const totalInZone =
    inZoneBuckets.defaultLane.length +
    Object.values(inZoneBuckets.bySection).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );

  const handleEditSubmit = (
    input: { name: string; description: string; color: string; icon: string },
  ) => {
    updateZone(zone.id, input);
    setEditorOpen(false);
  };

  const handleDeleteConfirm = () => {
    deleteZone(zone.id);
    setDeleteOpen(false);
    navigate("/zones");
  };

  return (
    <div className={styles.root}>
      <div className={styles.backRow}>
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={() => navigate("/zones")}
        >
          Zones board
        </Button>
      </div>

      <div className={styles.header}>
        <div
          className={styles.colorStripe}
          style={{ backgroundColor: zone.color }}
          aria-hidden="true"
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.zoneIcon} aria-hidden="true">
              {zone.icon}
            </span>
            <Text size={600} className={styles.zoneTitle}>
              {zone.name}
            </Text>
          </div>
          {zone.description && (
            <Text className={styles.description}>{zone.description}</Text>
          )}
          <Text className={styles.meta}>
            {totalInZone} group{totalInZone === 1 ? "" : "s"} ·{" "}
            {zone.sections.length} section
            {zone.sections.length === 1 ? "" : "s"}
          </Text>
        </div>
        <div className={styles.headerActions}>
          <Button
            appearance="subtle"
            icon={<EditRegular />}
            onClick={() => setEditorOpen(true)}
          >
            Edit zone
          </Button>
          <Button
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className={styles.body}>
          <div className={styles.main}>
            <div className={styles.sectionBlock}>
              <Lane
                zoneId={zone.id}
                items={inZoneBuckets.defaultLane}
                title={
                  zone.sections.length > 0 ? "Unsectioned" : "Groups in this zone"
                }
                emptyHint="Drag groups from the side panel into this zone"
              />
            </div>
            {zone.sections.map((section) => (
              <div key={section.id} className={styles.sectionBlock}>
                <Lane
                  zoneId={zone.id}
                  sectionId={section.id}
                  title={section.name}
                  items={inZoneBuckets.bySection[section.id] ?? []}
                  onRenameSection={(name) =>
                    renameSection(zone.id, section.id, name)
                  }
                  onDeleteSection={() => deleteSection(zone.id, section.id)}
                />
              </div>
            ))}
            {addingSection ? (
              <div className={styles.addSectionRow}>
                <Input
                  size="small"
                  value={newSectionName}
                  placeholder="Section name (e.g. Dev, UAT, Prod)"
                  autoFocus
                  onChange={(_, d: InputOnChangeData) =>
                    setNewSectionName(d.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSectionName.trim()) {
                      addSection(zone.id, newSectionName.trim());
                      setNewSectionName("");
                      setAddingSection(false);
                    } else if (e.key === "Escape") {
                      setNewSectionName("");
                      setAddingSection(false);
                    }
                  }}
                  onBlur={() => {
                    if (newSectionName.trim()) {
                      addSection(zone.id, newSectionName.trim());
                    }
                    setNewSectionName("");
                    setAddingSection(false);
                  }}
                  style={{ flex: 1 }}
                />
              </div>
            ) : (
              <div>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<AddRegular />}
                  onClick={() => setAddingSection(true)}
                >
                  Add section
                </Button>
              </div>
            )}
            <Caption1 className={styles.meta}>
              Tip: drag chips between sections to move them. Coming later: drag
              envs between MS env groups will issue a real Power Platform admin
              command (with confirmation + audit).
            </Caption1>
          </div>
          <AvailableGroupsPanel
            zone={zone}
            allItems={allItems}
            assignments={assignments}
            zoneNamesById={zoneNamesById}
            searchQuery={panelSearch}
            onSearchChange={setPanelSearch}
          />
        </div>
      </DndContext>

      <ZoneEditorDialog
        open={editorOpen}
        zone={zone}
        onDismiss={() => setEditorOpen(false)}
        onSubmit={(input) => handleEditSubmit(input)}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(_, data) => {
          if (!data.open) setDeleteOpen(false);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete zone?</DialogTitle>
            <DialogContent>
              <Text>
                Deleting <strong>{zone.name}</strong> returns its groups to
                Unassigned. The Microsoft environment groups themselves are
                not affected. Standard custom groups remain in Unassigned.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleDeleteConfirm}>
                Delete zone
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <StandardGroupEditorDialog
        open={customGroupEditorOpen}
        group={editingCustomGroup}
        onDismiss={() => {
          setCustomGroupEditorOpen(false);
          setEditingCustomGroup(null);
        }}
        onSubmit={(input, group) => {
          if (group) updateStandardGroup(group.id, input);
          setCustomGroupEditorOpen(false);
          setEditingCustomGroup(null);
        }}
      />

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
                Deleting{" "}
                <strong>{customGroupToDelete?.displayName}</strong> removes
                the group entirely. Any environments that were members return
                to "loose Standard" status; the environments themselves are
                not affected.
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
