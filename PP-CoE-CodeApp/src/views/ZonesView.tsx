/**
 * Zones — the drag-and-drop canvas.
 *
 * Microsoft does not support a parent layer over environment groups
 * ("Although you can't configure the group hierarchy yet, you can use a
 * combination of naming conventions…" — Environment Strategy docs). This
 * view is that parent layer, persisted to localStorage. Drag env-group
 * chips between user-defined Zones (and optional Sections inside each
 * zone) to organize a tenant the way it actually makes sense for *you*.
 *
 * Architecture:
 *  - Env groups fetched once via `listEnvironmentGroups` (lazy view, so
 *    that's a per-route concern, not a global cache).
 *  - Zones + assignments come from `useZones`, which subscribes to the
 *    localStorage keys (cross-tab + same-tab).
 *  - DndContext owns the drag interaction; on drop, we look at the
 *    droppable's `data` payload to decide where the chip landed and
 *    persist via `setAssignment`.
 *  - The implicit "Unassigned" column is computed: all env groups that
 *    don't appear in the assignments map.
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
  makeStyles,
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
  deleteSection,
  deleteZone,
  renameSection,
  setAssignment,
  updateZone,
  type Zone,
} from "../data/zones";
import { useZones } from "../hooks/useZones";
import { EmptyPane, ErrorPane, LoadingPane } from "../components/Status";
import { ZoneColumn, type ZoneColumnGroups } from "./zones/ZoneColumn";
import { ZoneEditorDialog } from "./zones/ZoneEditorDialog";

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

export function ZonesView() {
  const styles = useStyles();
  const { zones, assignments, refresh } = useZones();
  const [envGroups, setEnvGroups] = useState<EnvGroupState>({
    kind: "loading",
    rows: [],
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [zoneToDelete, setZoneToDelete] = useState<Zone | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Hold-to-drag with a small distance threshold so click events on
  // chips (e.g. the tooltip) still work without accidentally dragging.
  // Keyboard sensor pulled in for accessibility — drag with Space + arrows.
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

  // Bucket env groups by their current assignment so each column only
  // iterates its own list. Recomputed when env groups or assignments
  // change — both stable references coming out of state hooks.
  //
  // When a search query is active, env groups that don't match are
  // dropped from the buckets entirely (rather than greyed out). For a
  // "find and drag" interaction, hiding non-matches keeps the visible
  // chips actionable and makes the target unambiguous.
  const buckets = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const matches = (group: EnvironmentGroupRow): boolean => {
      if (!trimmedQuery) return true;
      const haystack = [
        group.displayName,
        group.description,
        group.location,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmedQuery);
    };

    const byZone = new Map<string, ZoneColumnGroups>();
    for (const zone of zones) {
      byZone.set(zone.id, { default: [], bySection: {} });
    }
    const unassigned: EnvironmentGroupRow[] = [];
    let matchCount = 0;
    for (const group of envGroups.rows) {
      if (!matches(group)) continue;
      matchCount++;
      const location = assignments[group.id];
      if (!location || !byZone.has(location.zoneId)) {
        // No assignment, OR assigned to a zone that no longer exists
        // (defensive — `deleteZone` already clears assignments, but
        // a hand-edited localStorage blob shouldn't crash the view).
        unassigned.push(group);
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
        list.push(group);
      } else {
        // Section was deleted out from under us — drop to default lane.
        zoneBucket.default.push(group);
      }
    }
    return { byZone, unassigned, matchCount };
  }, [zones, assignments, envGroups.rows, searchQuery]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as
      | {
          kind: "envGroup";
          envGroupId: string;
          fromZoneId: string | null;
          fromSectionId?: string;
        }
      | undefined;
    const overData = over.data.current as
      | { kind: "lane"; zoneId: string | null; sectionId?: string }
      | undefined;
    if (
      !activeData ||
      activeData.kind !== "envGroup" ||
      !overData ||
      overData.kind !== "lane"
    ) {
      return;
    }
    // No-op if dropped back into the exact same lane.
    if (
      activeData.fromZoneId === overData.zoneId &&
      activeData.fromSectionId === overData.sectionId
    ) {
      return;
    }
    if (overData.zoneId === null) {
      setAssignment(activeData.envGroupId, null);
    } else {
      setAssignment(activeData.envGroupId, {
        zoneId: overData.zoneId,
        sectionId: overData.sectionId,
      });
    }
    // No explicit refresh() needed — the storage write fires our local
    // change event and the hook re-reads. But trigger one anyway for
    // belt-and-suspenders if the event ever races.
    refresh();
  };

  const openNewZone = () => {
    setEditingZone(null);
    setEditorOpen(true);
  };

  const openEditZone = (zone: Zone) => {
    setEditingZone(zone);
    setEditorOpen(true);
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
    setEditorOpen(false);
    setEditingZone(null);
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
  const noGroups = envGroups.rows.length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Zones
        </Text>
        <Text className={styles.subtitle}>
          Drag environment groups into Zones to organize your tenant the way it
          actually fits — by business unit, region, lifecycle stage, capability,
          or anything else. Zones are personal to this browser and never modify
          Microsoft data.
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
              {buckets.matchCount} of {envGroups.rows.length} env group
              {envGroups.rows.length === 1 ? "" : "s"} match "{searchQuery.trim()}" ·{" "}
              {zones.length} zone{zones.length === 1 ? "" : "s"} · {totalAssigned} placed
            </>
          ) : (
            <>
              {envGroups.rows.length} environment group
              {envGroups.rows.length === 1 ? "" : "s"} · {zones.length} zone
              {zones.length === 1 ? "" : "s"} · {totalAssigned} placed
            </>
          )}
        </Text>
        <div className={styles.toolbarRight}>
          <SearchBox
            className={styles.searchBox}
            placeholder="Search env groups…"
            value={searchQuery}
            onChange={(_: SearchBoxChangeEvent, data: InputOnChangeData) =>
              setSearchQuery(data.value)
            }
          />
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={openNewZone}
          >
            New zone
          </Button>
        </div>
      </div>

      {noGroups ? (
        <EmptyPane message="No environment groups in this tenant yet — create one in Power Platform admin center, then come back to organize." />
      ) : noZones ? (
        <div className={styles.emptyState}>
          <Text size={400} weight="semibold">
            Start by creating your first zone
          </Text>
          <Text className={styles.subtitle} style={{ textAlign: "center" }}>
            A zone is your own grouping — a business unit, a region, an ALM
            stage, anything. Then drag environment groups in.
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
            <ZoneColumn kind="unassigned" groups={buckets.unassigned} />
            {zones.map((zone) => (
              <ZoneColumn
                key={zone.id}
                kind="zone"
                zone={zone}
                groups={
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
        open={editorOpen}
        zone={editingZone}
        onDismiss={() => {
          setEditorOpen(false);
          setEditingZone(null);
        }}
        onSubmit={handleZoneSubmit}
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
                environment groups to Unassigned. The Microsoft environment
                groups themselves are not affected.
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
    </div>
  );
}
