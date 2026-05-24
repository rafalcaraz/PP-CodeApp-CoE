/**
 * Zone Detail — Tier 2 Kanban view.
 *
 * The focused workspace for ONE zone. Replaces the v3 Groups-in-lanes
 * layout with a richer "groups as lanes of envs" Kanban so the user
 * can see and manipulate the actual environments inside each group
 * without bouncing into a separate detail page.
 *
 * Visual structure:
 *
 *   [Back to Zones board]
 *   [Zone header + edit/delete]
 *   [SelectionActionBar (sticky, only when something is selected)]
 *
 *   ┌────────────────────────────────────────┐  ┌──────────────────┐
 *   │ Main area (group lanes by section)     │  │ Eligible envs    │
 *   │  ├ Section: Dev                        │  │   Loose Standard │
 *   │  │  ├ [MS group lane: env, env, env]   │  │     ▢ env-1      │
 *   │  │  ├ [Custom lane: env, env]          │  │     ▢ env-2      │
 *   │  │  └ [+ Add custom group]             │  │   Loose Managed  │
 *   │  ├ Section: Prod                       │  │     (PPAC link)  │
 *   │  └ Unsectioned                         │  │                  │
 *   └────────────────────────────────────────┘  └──────────────────┘
 *
 * Interaction model in v1:
 *  - Multi-select Standard envs in side panel → Add to a custom group
 *    in this zone via the SelectionActionBar
 *  - Multi-select envs inside a custom group lane → Remove (back to
 *    Loose Standard)
 *  - MS group lanes are read-only (their membership lives in Microsoft;
 *    changing it requires PPAC writes which we defer to a future
 *    "mutation surface" milestone)
 *  - Silent drift: pruneIneligibleEnvs runs after envs load and quietly
 *    drops any envIds from custom groups that are now Managed or gone
 */

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
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
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Text,
  tokens,
  type InputOnChangeData,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowLeftRegular,
  DeleteRegular,
  DismissRegular,
  EditRegular,
} from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router-dom";
import {
  listEnvironmentGroups,
  listEnvironments,
  type EnvironmentGroupRow,
  type EnvironmentRow,
} from "../../data/inventory";
import {
  addSection,
  deleteSection,
  deleteZone,
  refToKey,
  renameSection,
  updateZone,
} from "../../data/zones";
import {
  addEnvToStandardGroup,
  deleteStandardGroup,
  pruneIneligibleEnvs,
  removeEnvFromStandardGroup,
  updateStandardGroup,
  type StandardCustomGroup,
} from "../../data/standardGroups";
import { useZones } from "../../hooks/useZones";
import { useSelection } from "../../hooks/useSelection";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { ZoneEditorDialog } from "./_components/ZoneEditorDialog";
import { StandardGroupEditorDialog } from "./_components/StandardGroupEditorDialog";
import { GroupEnvLane } from "./_components/GroupEnvLane";
import { EligibleEnvsPanel } from "./_components/EligibleEnvsPanel";
import { SelectionActionBar } from "./_components/SelectionActionBar";
import { AddEnvsToGroupDialog } from "./_components/AddEnvsToGroupDialog";
import {
  EnvMoveDemoDialog,
  type EnvMoveDemoTarget,
} from "./_components/EnvMoveDemoDialog";
import { StandardGroupAddDialog } from "./_components/StandardGroupAddDialog";
import { EnvRowGhost } from "./_components/EnvRowGhost";
import type { EnvDragSource } from "./_components/EnvRow";

interface GroupPlacement {
  kind: "ms" | "custom";
  id: string;
  displayName: string;
  description?: string;
  color?: string;
  icon?: string;
  envs: EnvironmentRow[];
  /** Section the group lives in within this zone (undefined = default). */
  sectionId?: string;
  /** The raw custom group entity, when kind === "custom". Needed for
   *  edit/delete + the bulk Add-to picker. */
  customRef?: StandardCustomGroup;
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
    gap: tokens.spacingVerticalL,
    overflowY: "auto",
    paddingInline: tokens.spacingHorizontalXS,
  },
  sectionBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingInline: tokens.spacingHorizontalS,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  laneRow: {
    display: "flex",
    flexDirection: "row",
    gap: tokens.spacingHorizontalL,
    flexWrap: "wrap",
  },
  emptyZone: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
  },
  addSectionRow: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    alignItems: "center",
  },
  addSectionInput: {
    flex: 1,
  },
});

export function ZoneDetailView() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { zoneId } = useParams<{ zoneId: string }>();
  const { zones, assignments, standardGroups, refresh } = useZones();

  const [envsState, setEnvsState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; rows: EnvironmentRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [envGroupsState, setEnvGroupsState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; rows: EnvironmentGroupRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  const [zoneEditorOpen, setZoneEditorOpen] = useState(false);
  const [zoneDeleteOpen, setZoneDeleteOpen] = useState(false);
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [editingCustom, setEditingCustom] =
    useState<StandardCustomGroup | null>(null);
  const [customToDelete, setCustomToDelete] =
    useState<StandardCustomGroup | null>(null);

  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [panelSearch, setPanelSearch] = useState("");

  const selection = useSelection<string>();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{
    intent: "success" | "warning";
    text: string;
  } | null>(null);

  // "Demo the future" state: when a Managed env is dragged onto a
  // different MS env group lane, instead of mutating Microsoft we
  // surface a dialog explaining what the eventual mutation would do
  // and provide a PPAC deep link for the manual workflow today.
  const [demoState, setDemoState] = useState<{
    env: EnvironmentRow;
    source: EnvDragSource;
    target: EnvMoveDemoTarget;
  } | null>(null);

  // Post-add state: when a Standard env is dragged into a Standard
  // custom group lane, the add HAS already happened. The dialog is a
  // forward-looking "here's what's coming" educational popup pointing
  // at the future DLP-to-custom-group linkage feature.
  const [standardAddState, setStandardAddState] = useState<{
    env: EnvironmentRow;
    targetGroupName: string;
    fromGroupName: string | null;
  } | null>(null);

  // The currently-dragging env, surfaced via `<DragOverlay>` as a
  // "lifted ghost" that follows the cursor. Without the overlay the
  // dragged row only transforms inside its own scroll container, which
  // clips and feels janky. With it, drag-and-drop has the classic
  // affordance users expect.
  const [activeDrag, setActiveDrag] = useState<{
    env: EnvironmentRow;
    source: EnvDragSource;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small drag-distance threshold so a quick click on a Loose Managed
      // env's PPAC link doesn't accidentally start a drag gesture.
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as
      | { kind: "envDrag"; env: EnvironmentRow; source: EnvDragSource }
      | undefined;
    if (data?.kind === "envDrag") {
      setActiveDrag({ env: data.env, source: data.source });
    }
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
  };

  const handleEnvDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as
      | { kind: "envDrag"; env: EnvironmentRow; source: EnvDragSource }
      | undefined;
    const overData = over.data.current as
      | {
          kind: "msGroupLane" | "customGroupLane";
          groupId: string;
          displayName: string;
        }
      | undefined;
    if (
      !activeData ||
      activeData.kind !== "envDrag" ||
      !overData ||
      (overData.kind !== "msGroupLane" && overData.kind !== "customGroupLane")
    ) {
      return;
    }

    const { env, source } = activeData;
    const target = overData;

    // ---- MS group lane drops --------------------------------------------
    if (target.kind === "msGroupLane") {
      // Type purity: only Managed envs can land in MS group lanes.
      // Standard envs (loose-standard or custom-group source) are
      // silently rejected — the absence of a "drop here" cue during
      // hover is the signal that the drop wouldn't be valid.
      if (source.kind === "loose-standard" || source.kind === "custom-group") {
        return;
      }
      // Self-drop on the same MS group is a no-op.
      if (source.kind === "ms-group" && source.groupId === target.groupId) {
        return;
      }
      // Open the preview-only demo dialog (mutation is deferred until
      // we have permission + audit + rollback infra for PPAC writes).
      setDemoState({
        env,
        source,
        target: {
          groupId: target.groupId,
          groupDisplayName: target.displayName,
        },
      });
      return;
    }

    // ---- Custom group lane drops ----------------------------------------
    // Managed envs can't go in custom groups (type purity, enforced at
    // the data layer too via addEnvToStandardGroup's isManaged check).
    if (source.kind === "ms-group" || source.kind === "loose-managed") {
      return;
    }
    // Self-drop on the same custom group is a no-op.
    if (source.kind === "custom-group" && source.groupId === target.groupId) {
      return;
    }
    // Real action: actually add the Standard env to the custom group.
    // The data layer handles exclusive membership (auto-removes from
    // any prior custom group).
    const result = addEnvToStandardGroup(target.groupId, env);
    if (!result.ok) {
      // Should be unreachable given the type-purity guard above, but
      // surface defensively so silent-failure regressions are loud.
      setBulkMessage({
        intent: "warning",
        text: `Couldn't add ${env.displayName}: ${result.reason}`,
      });
      return;
    }
    setStandardAddState({
      env,
      targetGroupName: target.displayName,
      fromGroupName:
        source.kind === "custom-group" ? source.groupDisplayName : null,
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [envsRes, groupsRes] = await Promise.all([
        listEnvironments(),
        listEnvironmentGroups(),
      ]);
      if (cancelled) return;
      if (envsRes.ok) {
        setEnvsState({ kind: "ready", rows: envsRes.data });
        // Silent drift: drop envIds from custom groups whose envs are
        // now Managed or have been deleted in PPAC. Runs invisibly.
        const envIndex = new Map(
          envsRes.data.map((e) => [
            e.id,
            { id: e.id, isManaged: e.isManaged },
          ]),
        );
        pruneIneligibleEnvs(envIndex);
        refresh();
      } else {
        setEnvsState({ kind: "error", message: envsRes.error });
      }
      if (groupsRes.ok) {
        setEnvGroupsState({ kind: "ready", rows: groupsRes.data });
      } else {
        setEnvGroupsState({ kind: "error", message: groupsRes.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const zone = useMemo(
    () => zones.find((z) => z.id === zoneId) ?? null,
    [zones, zoneId],
  );

  // Build the list of groups placed in this zone, with each group's
  // env contents already resolved. MS groups derive envs from the
  // current `parentGroupId` mapping; custom groups from their `envIds`.
  const groupsInZone = useMemo<GroupPlacement[]>(() => {
    if (!zone || envsState.kind !== "ready" || envGroupsState.kind !== "ready") {
      return [];
    }
    const result: GroupPlacement[] = [];
    // MS env groups placed in this zone
    for (const msGroup of envGroupsState.rows) {
      const placement = assignments[refToKey({ kind: "ms", id: msGroup.id })];
      if (placement?.zoneId !== zone.id) continue;
      const envs = envsState.rows.filter(
        (e) => e.environmentGroupId === msGroup.id,
      );
      result.push({
        kind: "ms",
        id: msGroup.id,
        displayName: msGroup.displayName,
        description: msGroup.description,
        sectionId: placement.sectionId,
        envs,
      });
    }
    // Standard custom groups placed in this zone
    for (const customGroup of standardGroups) {
      const placement =
        assignments[refToKey({ kind: "custom", id: customGroup.id })];
      if (placement?.zoneId !== zone.id) continue;
      const memberIds = new Set(customGroup.envIds);
      const envs = envsState.rows.filter((e) => memberIds.has(e.id));
      result.push({
        kind: "custom",
        id: customGroup.id,
        displayName: customGroup.displayName,
        description: customGroup.description,
        color: customGroup.color,
        icon: customGroup.icon,
        sectionId: placement.sectionId,
        envs,
        customRef: customGroup,
      });
    }
    return result;
  }, [zone, envsState, envGroupsState, assignments, standardGroups]);

  // Set of env IDs that are inside SOME group placed in this zone —
  // used to exclude them from the eligible-envs side panel.
  const envIdsInZone = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groupsInZone) {
      for (const e of g.envs) ids.add(e.id);
    }
    return ids;
  }, [groupsInZone]);

  // Group placements bucketed by sectionId (including "default" lane).
  const placementsBySection = useMemo(() => {
    const def: GroupPlacement[] = [];
    const bySection = new Map<string, GroupPlacement[]>();
    for (const p of groupsInZone) {
      if (
        p.sectionId &&
        zone?.sections.some((s) => s.id === p.sectionId)
      ) {
        const list = bySection.get(p.sectionId) ?? [];
        list.push(p);
        bySection.set(p.sectionId, list);
      } else {
        def.push(p);
      }
    }
    return { def, bySection };
  }, [groupsInZone, zone]);

  const customGroupsInZone = useMemo(
    () =>
      groupsInZone
        .filter((g) => g.kind === "custom" && g.customRef)
        .map((g) => g.customRef!),
    [groupsInZone],
  );

  if (envsState.kind === "loading" || envGroupsState.kind === "loading") {
    return <LoadingPane label="Loading zone…" />;
  }
  if (envsState.kind === "error") {
    return (
      <ErrorPane
        title="Couldn't load environments"
        message={envsState.message}
      />
    );
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

  const totalEnvs = envIdsInZone.size;

  const handleAddToConfirm = (target: StandardCustomGroup) => {
    const selectedIds = Array.from(selection.selected);
    let added = 0;
    let skipped = 0;
    let skippedReason: string | null = null;
    for (const envId of selectedIds) {
      const env = envsState.rows.find((e) => e.id === envId);
      if (!env) {
        skipped++;
        continue;
      }
      const result = addEnvToStandardGroup(target.id, env);
      if (result.ok) {
        added++;
      } else {
        skipped++;
        skippedReason = skippedReason ?? result.reason;
      }
    }
    setAddDialogOpen(false);
    selection.clear();
    if (skipped === 0) {
      setBulkMessage({
        intent: "success",
        text: `Added ${added} env${added === 1 ? "" : "s"} to "${target.displayName}".`,
      });
    } else {
      setBulkMessage({
        intent: "warning",
        text: `Added ${added}, skipped ${skipped}${skippedReason ? ` — ${skippedReason}` : ""}`,
      });
    }
  };

  const handleBulkRemove = () => {
    const selectedIds = Array.from(selection.selected);
    let removed = 0;
    for (const envId of selectedIds) {
      // Only removes from custom groups (where the env is a member);
      // a no-op if the env isn't in any custom group.
      removeEnvFromStandardGroup(envId);
      removed++;
    }
    selection.clear();
    setBulkMessage({
      intent: "success",
      text: `Removed ${removed} env${removed === 1 ? "" : "s"} from their custom groups.`,
    });
  };

  const handleZoneEditSubmit = (input: {
    name: string;
    description: string;
    color: string;
    icon: string;
  }) => {
    updateZone(zone.id, input);
    setZoneEditorOpen(false);
  };
  const handleZoneDeleteConfirm = () => {
    deleteZone(zone.id);
    setZoneDeleteOpen(false);
    navigate("/zones");
  };
  const handleCustomEditSubmit = (
    input: {
      displayName: string;
      description: string;
      color: string;
      icon: string;
    },
    group: StandardCustomGroup | null,
  ) => {
    if (group) updateStandardGroup(group.id, input);
    setCustomEditorOpen(false);
    setEditingCustom(null);
  };

  const renderLane = (p: GroupPlacement) => (
    <GroupEnvLane
      key={`${p.kind}:${p.id}`}
      groupKind={p.kind}
      groupId={p.id}
      displayName={p.displayName}
      description={p.description}
      color={p.color}
      icon={p.icon}
      envs={p.envs}
      selection={
        p.kind === "custom"
          ? {
              isSelected: selection.isSelected,
              toggle: selection.toggle,
            }
          : undefined
      }
      onRemoveEnv={
        p.kind === "custom"
          ? (envId) => removeEnvFromStandardGroup(envId)
          : undefined
      }
      customActions={
        p.kind === "custom" && p.customRef
          ? {
              onOpen: () => navigate(`/zones/custom-groups/${p.id}`),
              onEdit: () => {
                setEditingCustom(p.customRef ?? null);
                setCustomEditorOpen(true);
              },
              onDelete: () => setCustomToDelete(p.customRef ?? null),
            }
          : undefined
      }
    />
  );

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
          aria-hidden
        />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <span className={styles.zoneIcon} aria-hidden>
              {zone.icon}
            </span>
            <Text size={600} className={styles.zoneTitle}>
              {zone.name}
            </Text>
            <Badge appearance="outline" color="brand">
              Zone
            </Badge>
          </div>
          {zone.description && (
            <Text className={styles.description}>{zone.description}</Text>
          )}
          <Text className={styles.meta}>
            {groupsInZone.length} group{groupsInZone.length === 1 ? "" : "s"} ·{" "}
            {totalEnvs} env{totalEnvs === 1 ? "" : "s"}
          </Text>
        </div>
        <div className={styles.headerActions}>
          <Button
            appearance="subtle"
            icon={<EditRegular />}
            onClick={() => setZoneEditorOpen(true)}
          >
            Edit zone
          </Button>
          <Button
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={() => setZoneDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      <SelectionActionBar
        count={selection.count}
        onAddTo={() => setAddDialogOpen(true)}
        onRemove={handleBulkRemove}
        onClear={selection.clear}
      />

      {bulkMessage && (
        <MessageBar intent={bulkMessage.intent}>
          <MessageBarBody>
            <MessageBarTitle>
              {bulkMessage.intent === "success" ? "Done" : "Partial"}
            </MessageBarTitle>
            {bulkMessage.text}
          </MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                appearance="transparent"
                icon={<DismissRegular />}
                aria-label="Dismiss"
                onClick={() => setBulkMessage(null)}
              />
            }
          />
        </MessageBar>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleEnvDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className={styles.body}>
          <div className={styles.main}>
          {groupsInZone.length === 0 ? (
            <div className={styles.emptyZone}>
              No groups in this zone yet. Drag MS env groups or Standard
              custom groups into this zone from the Zones board.
            </div>
          ) : (
            <>
              {placementsBySection.def.length > 0 && (
                <div className={styles.sectionBlock}>
                  {zone.sections.length > 0 && (
                    <div className={styles.sectionHeader}>
                      <Text className={styles.sectionTitle}>Unsectioned</Text>
                    </div>
                  )}
                  <div className={styles.laneRow}>
                    {placementsBySection.def.map(renderLane)}
                  </div>
                </div>
              )}
              {zone.sections.map((section) => (
                <div key={section.id} className={styles.sectionBlock}>
                  <div className={styles.sectionHeader}>
                    <Text className={styles.sectionTitle}>{section.name}</Text>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<EditRegular />}
                      aria-label={`Rename section ${section.name}`}
                      onClick={() => {
                        const next = prompt("Rename section", section.name);
                        if (next && next.trim()) {
                          renameSection(zone.id, section.id, next.trim());
                        }
                      }}
                    />
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      aria-label={`Delete section ${section.name}`}
                      onClick={() => deleteSection(zone.id, section.id)}
                    />
                  </div>
                  <div className={styles.laneRow}>
                    {(placementsBySection.bySection.get(section.id) ?? []).map(
                      renderLane,
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
          {addingSection ? (
            <div className={styles.addSectionRow}>
              <Input
                size="small"
                className={styles.addSectionInput}
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
        </div>
        <EligibleEnvsPanel
          allEnvs={envsState.rows}
          envIdsInZone={envIdsInZone}
          searchQuery={panelSearch}
          onSearchChange={setPanelSearch}
          selection={{
            isSelected: selection.isSelected,
            toggle: selection.toggle,
          }}
        />
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDrag ? <EnvRowGhost env={activeDrag.env} /> : null}
        </DragOverlay>
      </DndContext>

      <ZoneEditorDialog
        open={zoneEditorOpen}
        zone={zone}
        onDismiss={() => setZoneEditorOpen(false)}
        onSubmit={(input) => handleZoneEditSubmit(input)}
      />

      <Dialog
        open={zoneDeleteOpen}
        onOpenChange={(_, data) => {
          if (!data.open) setZoneDeleteOpen(false);
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
                onClick={() => setZoneDeleteOpen(false)}
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleZoneDeleteConfirm}>
                Delete zone
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <StandardGroupEditorDialog
        open={customEditorOpen}
        group={editingCustom}
        onDismiss={() => {
          setCustomEditorOpen(false);
          setEditingCustom(null);
        }}
        onSubmit={handleCustomEditSubmit}
      />

      <Dialog
        open={customToDelete !== null}
        onOpenChange={(_, data) => {
          if (!data.open) setCustomToDelete(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete Standard custom group?</DialogTitle>
            <DialogContent>
              <Text>
                Deleting <strong>{customToDelete?.displayName}</strong>{" "}
                removes the group entirely. Its environments return to "loose
                Standard" status; the environments themselves are not
                affected.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setCustomToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => {
                  if (customToDelete) deleteStandardGroup(customToDelete.id);
                  setCustomToDelete(null);
                }}
              >
                Delete group
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <AddEnvsToGroupDialog
        open={addDialogOpen}
        selectedCount={selection.count}
        candidateGroups={customGroupsInZone}
        onDismiss={() => setAddDialogOpen(false)}
        onConfirm={handleAddToConfirm}
      />

      <EnvMoveDemoDialog
        open={demoState !== null}
        env={demoState?.env ?? null}
        source={demoState?.source ?? null}
        target={demoState?.target ?? null}
        onDismiss={() => setDemoState(null)}
      />

      <StandardGroupAddDialog
        open={standardAddState !== null}
        env={standardAddState?.env ?? null}
        targetGroupName={standardAddState?.targetGroupName ?? null}
        fromGroupName={standardAddState?.fromGroupName ?? null}
        onDismiss={() => setStandardAddState(null)}
      />

      <Caption1 className={styles.meta}>
        Tip: select Standard envs from the side panel, then use the action bar
        to bulk-add them to a custom group. MS env group contents are
        read-only here — managing them requires PPAC.
      </Caption1>
    </div>
  );
}
