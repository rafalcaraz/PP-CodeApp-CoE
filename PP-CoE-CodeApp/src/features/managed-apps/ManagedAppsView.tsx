import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Badge, Button, Caption1, Checkbox, Dialog, DialogActions, DialogBody, DialogContent,
  DialogSurface, DialogTitle, Field, InfoLabel, Menu, MenuItem, MenuList,
  MenuPopover, MenuTrigger, MessageBar, MessageBarBody, Input, SearchBox, Select,
  Text, makeStyles, mergeClasses, shorthands, tokens,
} from "@fluentui/react-components";
import { ArrowClockwiseRegular, FilterRegular, MoreHorizontalRegular, ShieldCheckmarkRegular, ReOrderDotsVerticalRegular } from "@fluentui/react-icons";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { useNavigate } from "react-router-dom";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";
import { UserChip } from "../../components/UserChip";
import { useUserDisplay } from "../../hooks/useUserDisplay";
import { useUserLookup } from "../../hooks/useUserLookup";
import { GroupPanel, MovePreparationDialog } from "./GovernancePanels";
import { groupFacts, loadGroupEvidenceBatch, matchesGroup, type GroupEvidence, type MoveSelection } from "./governance";
import type { CloneOutcome } from "./groupClone";
import { CloneCompletionNotice } from "./CloneCompletionNotice";
import { moveCanResume, moveNeedsCheck, moveOutcomeLabel, type MembershipRead, type MoveOutcome, type MoveRecord } from "./pdeMoves";
import { pdeMoveStore } from "./pdeMoveData";
import { liveMoveTask } from "./liveMoveTask";
import { pendingMoveNotice, pendingMoveState } from "./pendingMoveNotice";
import { RECENT_MEMBERSHIP_MS, withRecentPdeMemberships } from "./pdeMembership";
import { SearchPicker } from "./SearchPicker";
import { useConnectorCatalog } from "../../shared/connector-catalog";
import { friendlyConnectorName, normalizeConnectorId, shortResourceType } from "../../data/inventory";
import {
  buildBoard, createBoardInventoryLoader, getCacheVersion, groupPdeApps,
  loadManagedApps, loadPdeApps, matchesContext, membershipId, originLabel, personSearchText, pdeMoveBlocker,
  resolveAppPeople, subscribeCacheVersion,
  type AppRow, type BoardColumn, type DataResult, type EnvironmentGroupRow, type EnvironmentRow, type ManagedApp,
  type ManagedAppsInventory,
} from "./data";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, minWidth: 0 },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: tokens.spacingHorizontalM, flexWrap: "wrap" },
  intro: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, maxWidth: "75ch" },
  heading: { margin: 0, overflowWrap: "anywhere" },
  muted: { color: tokens.colorNeutralForeground3 },
  toolbar: { display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: tokens.spacingHorizontalM },
  primaryToolbar: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: tokens.spacingHorizontalS, minWidth: 0 },
  filterPanel: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, paddingBlock: tokens.spacingVerticalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, minWidth: 0 },
  filterGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: tokens.spacingHorizontalM, minWidth: 0 },
  results: { display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: tokens.spacingHorizontalM, minWidth: 0 },
  help: { maxWidth: "100%", color: tokens.colorNeutralForeground2 },
  helpContent: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, maxWidth: "75ch", paddingBlock: tokens.spacingVerticalS },
  search: { flex: "1 1 260px", minWidth: 0 },
  filter: { minWidth: "min(160px, 100%)", maxWidth: "100%" },
  select: { width: "100%", maxWidth: "100%", minWidth: 0 },
  board: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", alignItems: "start", gap: tokens.spacingHorizontalL, minWidth: 0 },
  column: { display: "flex", flexDirection: "column", minWidth: 0, backgroundColor: tokens.colorNeutralBackground2, borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, overflow: "hidden" },
  columnHeader: { padding: tokens.spacingHorizontalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  row: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, justifyContent: "space-between" },
  title: { margin: 0, minWidth: 0, flex: 1, overflowWrap: "anywhere", fontWeight: tokens.fontWeightSemibold },
  body: { padding: tokens.spacingHorizontalM, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, flex: 1 },
  card: { padding: tokens.spacingHorizontalM, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground1, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, contentVisibility: "auto", containIntrinsicSize: "auto 200px", ":hover": { ...shorthands.borderColor(tokens.colorNeutralStroke1) } },
  appRows: { listStyleType: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", minWidth: 0 },
  appRow: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, paddingBlock: tokens.spacingVerticalS, borderTop: `1px solid ${tokens.colorNeutralStroke2}`, minWidth: 0 },
  appName: { justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere", minWidth: 0 },
  people: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, minWidth: 0 },
  person: { display: "flex", gap: tokens.spacingHorizontalXS, alignItems: "center", minWidth: 0, flexWrap: "wrap", overflowWrap: "anywhere" },
  badges: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
  badge: { maxWidth: "100%", height: "auto", minHeight: "20px", whiteSpace: "normal", overflowWrap: "anywhere" },
  copilot: { backgroundColor: tokens.colorPalettePurpleBackground2, color: tokens.colorPalettePurpleForeground2, ...shorthands.borderColor(tokens.colorPalettePurpleBorderActive) },
  observed: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground2 },
  unknown: { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2 },
  selected: { ...shorthands.borderColor(tokens.colorBrandStroke1), backgroundColor: tokens.colorNeutralBackground1Selected },
  dragging: { opacity: 0.55 },
  drop: { ...shorthands.borderColor(tokens.colorBrandStroke1), backgroundColor: tokens.colorBrandBackground2 },
  dialogContent: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  detailSection: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0 },
  technical: { overflowWrap: "anywhere", "& summary": { cursor: "pointer" } },
  rawJson: { maxHeight: "360px", maxWidth: "100%", overflow: "auto", whiteSpace: "pre", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, padding: tokens.spacingHorizontalM, backgroundColor: tokens.colorNeutralBackground2, borderRadius: tokens.borderRadiusMedium },
  policy: { paddingBlock: tokens.spacingVerticalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  permissions: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
});

type Slot<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; error: string };
type Inspection = { kind: "pde"; environmentId: string; environment?: EnvironmentRow; app?: ManagedApp };

const appKey = (app: ManagedApp) => `${membershipId(app.environmentId)}::${app.id}`;

function slot<T>(result: DataResult<T>): Slot<T> {
  return result.ok ? { kind: "ready", data: result.data } : { kind: "error", error: result.error };
}

export function ManagedAppsView() {
  const styles = useStyles();
  const { catalog } = useConnectorCatalog();
  const [inventory, setInventory] = useState<Slot<ManagedAppsInventory>>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [origin, setOrigin] = useState("*");
  const [group, setGroup] = useState("*");
  const [advanced, setAdvanced] = useState({ app: "", environment: "", group: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState("");
  const [browseAllGroups, setBrowseAllGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [connectorSearch, setConnectorSearch] = useState("");
  const [connectorMode, setConnectorMode] = useState<"all" | "any">("all");
  const [ruleField, setRuleField] = useState("");
  const [ruleValue, setRuleValue] = useState("");
  const [evidence, setEvidence] = useState<Record<string, GroupEvidence>>({});
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [groupPanel, setGroupPanel] = useState<EnvironmentGroupRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [move, setMove] = useState<{ selection: MoveSelection[]; destinationId?: string } | null>(null);
  const [checkingMoves, setTransferBusy] = useState(false);
  const moveTask = useSyncExternalStore(liveMoveTask.subscribe, liveMoveTask.getSnapshot);
  const transferBusy = checkingMoves || !!moveTask?.running;
  const handledTask = useRef(0);
  const transferActive = useRef(false);
  const [moveCompletion, setMoveCompletion] = useState<MoveOutcome | null>(null);
  const [moveError, setMoveError] = useState("");
  const [pendingMoves, setPendingMoves] = useState<{ records: MoveRecord[]; error: string }>(() => {
    try { return { records: pdeMoveStore.list(), error: "" }; }
    catch (error) { return { records: [], error: String(error) }; }
  });
  const readPendingMoves = useCallback(() => {
    try { setPendingMoves({ records: pdeMoveStore.list(), error: "" }); }
    catch (error) { setPendingMoves({ records: [], error: String(error) }); }
  }, []);
  const pendingState = pendingMoveState(pendingMoves.records);
  const dismissedPendingState = useSyncExternalStore(pendingMoveNotice.subscribe, pendingMoveNotice.getSnapshot);
  const hasPendingMove = !!pendingState;
  const dismissMoveResult = () => {
    pendingMoveNotice.dismiss(pendingState);
    setMoveCompletion(null); setMoveError(""); liveMoveTask.dismiss();
  };
  useEffect(() => {
    const changed = () => readPendingMoves();
    window.addEventListener("storage", changed);
    window.addEventListener("focus", changed);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", changed); };
  }, [readPendingMoves]);
  const [recentMemberships, setRecentMemberships] = useState<MembershipRead[]>([]);
  useEffect(() => {
    const expires = recentMemberships.map((read) => (read.evidence?.readAt ?? 0) + RECENT_MEMBERSHIP_MS).filter((time) => time > Date.now());
    if (!expires.length) return;
    const timer = setTimeout(() => setRecentMemberships((reads) => reads.filter((read) => read.evidence && Date.now() - read.evidence.readAt < RECENT_MEMBERSHIP_MS)), Math.min(...expires) - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [recentMemberships]);
  const evidenceRevision = useRef(0);
  const evidenceRequest = useRef<AbortController | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [externalChanges, setExternalChanges] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [resolving, setResolving] = useState(false);
  const [peopleError, setPeopleError] = useState("");
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [cloneCompletion, setCloneCompletion] = useState<CloneOutcome | null>(null);
  const cacheVersion = useSyncExternalStore(subscribeCacheVersion, getCacheVersion, getCacheVersion);
  const [loadInventory] = useState(() => createBoardInventoryLoader(loadManagedApps));

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void loadInventory(revision > 0, controller.signal).then((result) => {
      if (!cancelled) {
        setInventory(slot(result));
        if (revision > 0 && result.ok) void fetchEvidence(result.data.groups.map((entry) => entry.id));
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [revision, loadInventory]);

  useEffect(() => {
    const written = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object" || !("targetIds" in detail) || !Array.isArray(detail.targetIds)
        || detail.targetIds.some((id: unknown) => typeof id !== "string")) return;
      const ids = new Set(detail.targetIds.map(membershipId));
      ++evidenceRevision.current; evidenceRequest.current?.abort(); setEvidenceLoading(false);
      setEvidence((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.has(id))));
    };
    const invalidate = () => {
      if (transferActive.current || liveMoveTask.getSnapshot()?.running) return;
      ++evidenceRevision.current;
      evidenceRequest.current?.abort();
      setEvidenceLoading(false);
      setEvidence({});
      setMove(null);
      setDuplicateOpen(false);
      setDuplicateSource("");
      setGroupPanel(null);
      setCloneCompletion(null);
      setExternalChanges(true);
      setRecentMemberships([]);
    };
    window.addEventListener("focus", invalidate);
    window.addEventListener("ppcoe:managed-apps:rule-sync:written", written);
    return () => {
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("ppcoe:managed-apps:rule-sync:written", written);
      evidenceRequest.current?.abort();
    };
  }, []);

  const displayInventory = useMemo(() => inventory.kind === "ready" ? withRecentPdeMemberships(inventory.data, recentMemberships) : null, [inventory, recentMemberships]);
  const environments = useMemo(() => new Map(displayInventory
    ? displayInventory.environments.map((environment) => [membershipId(environment.id), environment])
    : []), [displayInventory]);
  const columns = useMemo(() => displayInventory ? buildBoard(displayInventory, true).map((column) => ({
    ...column, totalApps: column.apps.length,
    pdeCount: new Set(column.apps.filter((app) => !pdeMoveBlocker(environments.get(membershipId(app.environmentId)))).map((app) => membershipId(app.environmentId))).size,
    otherEnvironments: new Set(column.apps.filter((app) => pdeMoveBlocker(environments.get(membershipId(app.environmentId)))).map((app) => membershipId(app.environmentId))).size,
  })) : [], [displayInventory, environments]);
  const searchText = useMemo(() => {
    void cacheVersion;
    return new Map(inventory.kind === "ready" ? inventory.data.apps.map((app) => [appKey(app), `${app.displayName} ${app.id} ${personSearchText(app)} ${originLabel(app.origin)}`.toLowerCase()]) : []);
  }, [inventory, cacheVersion]);
  const visible = useMemo(() => {
    // A lookup anywhere in the app must update name-search results as well as chips.
    void cacheVersion;
    return columns.filter((column) => (group === "*" || column.key === group) && matchesGroup(
      { ...column, name: `${column.name} ${column.groupId ?? ""}` }, evidence[membershipId(column.groupId ?? "")],
      { search: groupSearch, connectors: connectorSearch.split(",").map((value) => value.trim()).filter(Boolean), connectorMode, field: ruleValue ? ruleField : "", value: ruleValue.slice(1) },
    ))
      .map((column) => ({
        ...column,
        apps: column.apps.filter((app) => (origin === "*" || !origin || app.origin === origin)
          && matchesContext(app, environments.get(membershipId(app.environmentId)), column, deferredSearch, advanced, searchText.get(appKey(app)))),
      })).filter((column) => column.apps.length > 0 || (browseAllGroups && column.totalApps === 0
        && !advanced.app.trim() && !advanced.environment.trim()
        && `${column.name} ${column.groupId ?? ""}`.toLowerCase().includes(advanced.group.trim().toLowerCase())
        && deferredSearch.trim().toLowerCase().split(/\s+/).every((word) => `${column.name} ${column.groupId ?? ""}`.toLowerCase().includes(word)))
        || (browseAllGroups && column.totalApps > 0 && !deferredSearch.trim() && !advanced.app.trim() && !advanced.environment.trim() && !advanced.group.trim()));
  }, [columns, deferredSearch, origin, group, browseAllGroups, cacheVersion, groupSearch, connectorSearch, connectorMode, ruleField, ruleValue, evidence, searchText, environments, advanced]);
  const origins = useMemo(() => inventory.kind === "ready" ? [...new Set(inventory.data.apps.map((app) => app.origin))].sort() : [], [inventory]);
  const visibleCount = visible.reduce((count, column) => count + column.apps.length, 0);
  const visibleGroupCount = visible.filter((column) => column.groupId).length;
  const appPdeCount = useMemo(() => new Set(columns.flatMap((column) => column.apps.filter((app) => !pdeMoveBlocker(environments.get(membershipId(app.environmentId)))).map((app) => membershipId(app.environmentId)))).size, [columns, environments]);
  const visiblePdeCount = useMemo(() => new Set(visible.flatMap((column) => column.apps.filter((app) => !pdeMoveBlocker(environments.get(membershipId(app.environmentId)))).map((app) => membershipId(app.environmentId)))).size, [visible, environments]);
  const otherEnvironmentCount = new Set(visible.flatMap((column) => column.apps.filter((app) => pdeMoveBlocker(environments.get(membershipId(app.environmentId)))).map((app) => membershipId(app.environmentId)))).size;
  const governanceFilters = !!(groupSearch.trim() || connectorSearch.trim() || ruleValue);
  const activeFilterCount = [
    search.trim(), origin !== "*" && origin, group !== "*" && group,
    advanced.app.trim(), advanced.environment.trim(), advanced.group.trim(),
    groupSearch.trim(), connectorSearch.split(",").some((id) => id.trim()), ruleField && ruleValue,
  ].filter(Boolean).length;
  const hasFilterValues = search !== "" || origin !== "*" || group !== "*"
    || Object.values(advanced).some((value) => value !== "") || groupSearch !== ""
    || connectorSearch !== "" || connectorMode !== "all" || ruleField !== "" || ruleValue !== "";
  const selectedEnvironments = useMemo(() => [...environments.values()].filter((environment) => selected.has(membershipId(environment.id)) && !pdeMoveBlocker(environment)), [environments, selected]);
  const selectedApps = useMemo(() => inventory.kind === "ready" ? inventory.data.apps.filter((app) => selected.has(membershipId(app.environmentId))) : [], [inventory, selected]);
  const allPdeApps = useMemo(() => new Map(inventory.kind === "ready" ? groupPdeApps(inventory.data.apps).map((pde) => [pde.environmentId, pde.apps]) : []), [inventory]);
  const facts = useMemo(() => Object.values(evidence).flatMap(groupFacts), [evidence]);
  const fields = useMemo(() => [...new Set(facts.map((fact) => fact.field))].sort(), [facts]);
  const values = useMemo(() => [...new Set(facts.filter((fact) => fact.field === ruleField).map((fact) => fact.value))].sort(), [facts, ruleField]);

  async function fetchEvidence(ids: string[]) {
    const request = ++evidenceRevision.current;
    evidenceRequest.current?.abort();
    const controller = new AbortController();
    evidenceRequest.current = controller;
    const requested = new Set(ids.map(membershipId));
    setEvidence((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !requested.has(id))));
    setEvidenceLoading(true);
    const loaded = await loadGroupEvidenceBatch(ids, controller.signal);
    if (controller.signal.aborted || request !== evidenceRevision.current) return;
    setEvidence((previous) => ({ ...previous, ...Object.fromEntries(loaded.map((entry) => [membershipId(entry.groupId), entry])) }));
    setEvidenceLoading(false);
  }

  function prepare(environmentIds: string[], destinationId?: string) {
    if (liveMoveTask.getSnapshot()?.running) { liveMoveTask.showDetails(); return; }
    const ids = [...new Set(environmentIds.map(membershipId))].filter((id) => !pdeMoveBlocker(environments.get(id)));
    if (!ids.length) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMove({ selection: ids.map((environmentId) => ({ environmentId })), destinationId });
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      const target = returnFocus.current;
      (target?.isConnected && target !== document.body ? target : searchInput.current ?? heading.current)?.focus();
    });
  }

  const selectPde = useCallback((environment: EnvironmentRow) => {
    if (pdeMoveBlocker(environment)) return;
    const id = membershipId(environment.id);
    setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const inspectPde = useCallback((environment: EnvironmentRow | undefined, app?: ManagedApp) => {
    const environmentId = environment?.id || app?.environmentId;
    if (!environmentId) { setMoveError("Environment identity is unavailable. Refresh inventory before opening its details."); return; }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInspection({ kind: "pde", environmentId, environment, app });
  }, []);
  const refreshInventory = useCallback(() => {
    if (transferActive.current || liveMoveTask.getSnapshot()?.running) return;
    setMoveCompletion(null); setMoveError(""); setRecentMemberships([]);
    setCloneCompletion(null);
    ++evidenceRevision.current;
    evidenceRequest.current?.abort();
    setEvidenceLoading(false);
    setExternalChanges(false);
    setEvidence({});
    setSelected(new Set());
    setMove(null);
    setDuplicateOpen(false);
    setDuplicateSource("");
    setGroupPanel(null);
    setInventory({ kind: "loading" });
    setInspection(null);
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    const completed = () => {
      const task = liveMoveTask.getSnapshot();
      if (!task || task.running || handledTask.current === task.id) return;
      handledTask.current = task.id;
      readPendingMoves();
      if (task.outcome) {
        const outcome = task.outcome;
        const completedIds = new Set(outcome.record.pdes.filter((entry) => entry.phase === "verified" || entry.phase === "already-member")
          .map((entry) => membershipId(entry.environmentId)));
        const taskIds = new Set(outcome.record.pdes.map((entry) => membershipId(entry.environmentId)));
        setMoveCompletion(completedIds.size === outcome.record.pdes.length ? null : outcome);
        setRecentMemberships((reads) => [...reads, ...(outcome.verifiedMemberships ?? []).filter((read) =>
          completedIds.has(membershipId(read.environmentId)) && membershipId(read.groupId) === membershipId(outcome.record.destinationId))]);
        setSelected((previous) => new Set([...previous].filter((id) => !completedIds.has(membershipId(id)))));
        setMove((previous) => previous?.selection.some((entry) => taskIds.has(membershipId(entry.environmentId))) ? null : previous);
      } else if (task.error) setMoveError(task.error);
    };
    const unsubscribe = liveMoveTask.subscribe(completed);
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) completed(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [readPendingMoves]);
  const preparePde = useCallback((environment: EnvironmentRow) => {
    if (liveMoveTask.getSnapshot()?.running) { liveMoveTask.showDetails(); return; }
    if (pdeMoveBlocker(environment)) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const chosen = selected.has(membershipId(environment.id)) ? selectedEnvironments : [environment];
    setMove({ selection: chosen.map((entry) => ({ environmentId: membershipId(entry.id) })) });
  }, [selected, selectedEnvironments]);
  function inspectGoverningGroup(environment: EnvironmentRow) {
    const entry = inventory.kind === "ready" ? inventory.data.groups.find((group) => membershipId(group.id) === membershipId(environment.environmentGroupId)) : undefined;
    if (!entry) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setGroupPanel(entry); void fetchEvidence([entry.id]);
  }

  async function resolvePeople() {
    if (inventory.kind !== "ready") return;
    setResolving(true);
    setPeopleError("");
    const result = await resolveAppPeople(inventory.data.apps);
    setResolving(false);
    if (!result.ok) setPeopleError(result.error);
    else setPeopleLoaded(true);
  }
  function clearFilters() {
    setSearch(""); setOrigin("*"); setGroup("*");
    setAdvanced({ app: "", environment: "", group: "" });
    setGroupSearch(""); setConnectorSearch(""); setConnectorMode("all");
    setRuleField(""); setRuleValue("");
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.intro}>
          <Text as="h1" ref={heading} tabIndex={-1} className={styles.heading} size={700} weight="semibold">Managed apps governance</Text>
          <Text className={styles.muted}>Browse managed apps by environment and group. Moves are available for managed personal developer environments (PDEs).</Text>
        </div>
        {inventory.kind !== "ready" && <Button icon={<ArrowClockwiseRegular />} disabled={inventory.kind === "loading" || transferBusy} onClick={refreshInventory}>Refresh inventory</Button>}
      </div>
      {externalChanges && <MessageBar intent="warning"><MessageBarBody>Returned to this app: earlier policy evidence and previews were invalidated. Inventory is still the previous snapshot. Refresh inventory after external membership or policy changes.</MessageBarBody></MessageBar>}
      <CloneCompletionNotice outcome={cloneCompletion} />
      {moveCompletion && <MessageBar intent={moveCompletion.record.pdes.every((pde) => pde.phase === "verified" || pde.phase === "already-member") ? "success" : "warning"}><MessageBarBody>
        {moveCompletion.record.pdes.map((pde, index) => <p key={pde.environmentId}>
          {inventory.kind === "ready" ? inventory.data.environments.find((environment) => membershipId(environment.id) === membershipId(pde.environmentId))?.displayName || `PDE ${index + 1}` : `PDE ${index + 1}`}: {moveOutcomeLabel(moveCompletion, pde)}.
        </p>)}
        {inventory.kind === "ready" && <Text>{moveCompletion.record.pdes.every((entry) => entry.phase === "verified" || entry.phase === "already-member") ? "Destination" : "Requested destination"}: {inventory.data.groups.find((group) => membershipId(group.id) === membershipId(moveCompletion.record.destinationId))?.displayName || "See recorded group ID in technical details"}.</Text>}
        {moveCompletion.record.pdes.some(moveNeedsCheck) && <Button disabled={transferBusy || inventory.kind !== "ready"} onClick={() => {
          const recoverable = moveCompletion.record.pdes.filter(moveCanResume);
          setMove(recoverable.length
            ? { selection: recoverable.map((entry) => ({ environmentId: entry.environmentId })), destinationId: moveCompletion.record.destinationId }
            : { selection: [] });
        }}>{moveCompletion.record.pdes.some(moveCanResume) ? "Review add-only recovery" : "Check move status"}</Button>}
        <Button appearance="subtle" aria-label="Dismiss move result" onClick={dismissMoveResult}>Dismiss</Button>
        {moveCompletion.record.pdes.some((entry) => entry.phase !== "verified" && entry.phase !== "already-member") && <details><summary>Move error details</summary>
          {moveCompletion.messages.map((message, index) => <p key={index}>{message}</p>)}
        </details>}
      </MessageBarBody></MessageBar>}
      {moveError && <MessageBar intent="warning"><MessageBarBody>
        The move stopped. No automatic retry or rollback was performed.
        <details><summary>Transfer technical details</summary>{moveError}</details>
        <Button appearance="subtle" aria-label="Dismiss move result" onClick={dismissMoveResult}>Dismiss</Button>
      </MessageBarBody></MessageBar>}
      {pendingMoves.error && <MessageBar intent="error"><MessageBarBody>Pending move records could not be read. Moves remain blocked until storage is accessible.<details><summary>Move error details</summary>{pendingMoves.error}</details></MessageBarBody></MessageBar>}
      {hasPendingMove && pendingState !== dismissedPendingState && !move && !moveTask?.running && !moveCompletion && <MessageBar intent="warning"><MessageBarBody>A move needs attention.
        <Button disabled={transferBusy || inventory.kind !== "ready"} onClick={() => setMove({ selection: [] })}>Resolve pending move</Button>
        <Button appearance="subtle" aria-label="Dismiss pending move reminder" onClick={() => pendingMoveNotice.dismiss(pendingState)}>Dismiss</Button>
      </MessageBarBody></MessageBar>}
      {evidenceLoading && <Text role="status">Reading group properties, tenant rules and ACP evidence...</Text>}
      {!!Object.values(evidence).filter((entry) => !entry.details.ok || !entry.policies.ok || !entry.rulesets.ok).length && <MessageBar intent="warning"><MessageBarBody>Some group evidence is unavailable. Inspect each group for the specific error; unknown sections do not match configuration filters.</MessageBarBody></MessageBar>}
      {!!selectedEnvironments.length && <div className={styles.toolbar} role="region" aria-label="Move selection">
        <Text weight="semibold">{selectedEnvironments.length} selected PDE{selectedEnvironments.length === 1 ? "" : "s"} · {selectedApps.length} inventory apps affected</Text>
        <Caption1>Includes hidden siblings. Review checks all apps and other resources before moving.</Caption1>
        <Button onClick={() => prepare(selectedEnvironments.map((environment) => environment.id))}>Prepare selected PDE moves</Button>
        <Button onClick={() => setSelected(new Set())}>Clear selection</Button>
      </div>}
      {inventory.kind === "loading" && <LoadingPane label="Loading managed apps and environment groups..." />}
      {inventory.kind === "error" && <ErrorPane title="Couldn't load managed apps governance" message={inventory.error} />}
      {inventory.kind === "ready" && (
        <>
          <div className={styles.primaryToolbar} role="group" aria-label="Managed apps controls">
            <SearchBox className={styles.search} input={{ ref: searchInput }} aria-label="Search apps, people, PDEs and groups"
              value={search} placeholder="Search apps, people, PDEs or groups" onChange={(_, data) => setSearch(data.value)} />
            <Button icon={<FilterRegular />} aria-expanded={filtersOpen} aria-controls={filterPanelId} onClick={() => setFiltersOpen((open) => !open)}>
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </Button>
            <Checkbox checked={browseAllGroups} onChange={(_, data) => setBrowseAllGroups(data.checked === true)} label="Show empty groups" />
            <Button icon={<ArrowClockwiseRegular />} disabled={transferBusy} onClick={refreshInventory}>Refresh inventory</Button>
            <Menu><MenuTrigger disableButtonEnhancement><Button icon={<MoreHorizontalRegular />} disabled={transferBusy}>Actions</Button></MenuTrigger>
              <MenuPopover><MenuList>
                <MenuItem onClick={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDuplicateOpen(true); }}>Duplicate environment group</MenuItem>
                <MenuItem disabled={resolving || !inventory.data.apps.length} onClick={() => void resolvePeople()}>{resolving ? "Resolving people..." : "Resolve owner / maker names"}</MenuItem>
                {hasPendingMove && <MenuItem onClick={() => setMove({ selection: [] })}>Resolve pending move</MenuItem>}
              </MenuList></MenuPopover>
            </Menu>
          </div>
          {filtersOpen && <section id={filterPanelId} className={styles.filterPanel} aria-label="App and governance filters">
            <div className={styles.primaryToolbar}><Text weight="semibold">App and environment filters</Text>
              <Button disabled={!hasFilterValues} onClick={clearFilters}>Clear filters</Button>
            </div>
            <div className={styles.filterGrid}>
            <Field label="Origin" className={styles.filter}>
              <SearchPicker label="Origin" value={origin} onChange={(id) => setOrigin(id || "*")}
                options={[{ id: "*", name: "All origins" }, ...origins.map((value) => ({ id: value, name: originLabel(value) }))]} />
            </Field>
            <Field label="Environment group" className={styles.filter}>
              <SearchPicker label="Environment group" value={group} onChange={(id) => setGroup(id || "*")} showIds
                options={[{ id: "*", name: "All groups" }, ...columns.map((column) => ({ id: column.key, name: `${column.name}${column.groupId ? ` · ${column.groupId}` : ""}` }))]} />
            </Field>
            {(["app", "environment", "group"] as const).map((key) => <Field key={key} label={key === "group" ? "Environment group name or ID" : `${key === "app" ? "App" : "Environment"} name or ID`} className={styles.search}>
              <Input value={advanced[key]} onChange={(_, data) => setAdvanced((previous) => ({ ...previous, [key]: data.value }))} />
            </Field>)}
            </div>
            <Caption1 className={styles.muted}>Nonempty filters combine with AND. Show empty groups to include governance matches without scoped apps.</Caption1>
            <div className={styles.primaryToolbar}><Text weight="semibold">Configured group governance</Text>
              <Button disabled={evidenceLoading} onClick={() => void fetchEvidence(inventory.data.groups.map((entry) => entry.id))}>{evidenceLoading ? "Reading governance..." : "Load group rules / ACP"}</Button>
            </div>
            <div className={styles.filterGrid}>
              <Field label="Find environment groups" className={styles.search}><Input value={groupSearch} placeholder="Group name or description" onChange={(_, data) => setGroupSearch(data.value)} /></Field>
              <Field label="Configured allowed connectors (comma-separated)" className={styles.search}><Input value={connectorSearch} placeholder="sharepointonline, teams" onChange={(_, data) => setConnectorSearch(data.value)} /></Field>
              <Field label="Add configured connector" className={styles.search}><SearchPicker label="Add configured connector" value="" showIds
                options={[...(catalog?.entries.values() ?? [])].map((entry) => ({ id: entry.connectorId, name: entry.displayName || entry.connectorId }))}
                onChange={(id) => { if (id) setConnectorSearch((previous) => [...new Set([...previous.split(",").map((value) => value.trim()).filter(Boolean), id])].join(", ")); }} /></Field>
              <Field label="Connector match" className={styles.filter}><Select className={styles.select} value={connectorMode} onChange={(_, data) => setConnectorMode(data.value === "any" ? "any" : "all")}><option value="all">All requested connectors</option><option value="any">Any requested connector</option></Select></Field>
              <Field label="Rule / property" className={styles.filter}><SearchPicker label="Rule / property" value={ruleField} onChange={(id) => { setRuleField(id); setRuleValue(""); }} options={fields.map((id) => ({ id, name: id }))} /></Field>
              <Field label="Exact returned value" className={styles.filter}><SearchPicker label="Exact returned value" value={ruleValue} disabled={!ruleField} onChange={setRuleValue} options={values.map((value) => ({ id: `=${value}`, name: value || "(empty string)" }))} /></Field>
            </div>
            <Caption1 className={styles.muted}>Governance evidence loaded for {Object.keys(evidence).length} of {inventory.data.groups.length} groups. Connector filters match readable configured allowance (including listed-action restrictions), never unknown data or verified runtime access.</Caption1>
          </section>}
          {!browseAllGroups && governanceFilters && <Caption1 role="status">Group search currently shows only matching apps. Enable Show empty groups to include governance matches with no scoped apps.</Caption1>}
          {peopleError && <ErrorPane title="Some people could not be resolved" message={peopleError} />}
          {peopleLoaded && <Caption1 role="status">Name lookup finished. Identities not found remain unknown; no ownership is inferred.</Caption1>}
          <div className={styles.results}>
            <Text role="status" aria-live="polite">{externalChanges ? "Historical snapshot: " : ""}{visibleCount} {visibleCount === 1 ? "app" : "apps"} · {visiblePdeCount} {visiblePdeCount === 1 ? "PDE" : "PDEs"}{otherEnvironmentCount > 0 ? ` · ${otherEnvironmentCount} other environment${otherEnvironmentCount === 1 ? "" : "s"}` : ""} · {visibleGroupCount} {visibleGroupCount === 1 ? "group" : "groups"}</Text>
            <details className={styles.help}><summary>About this view and totals</summary><div className={styles.helpContent}>
              <Text>{visibleCount} of {inventory.data.apps.length} apps shown · {visiblePdeCount} of {appPdeCount} PDEs with apps · {visible.length} of {columns.length} group columns shown</Text>
              <Text>{inventory.data.environments.filter((environment) => !pdeMoveBlocker(environment)).length} managed Developer environments in inventory. Empty environments are not rendered on the board.</Text>
              <Text>Scope: Managed app subtype, matching the Apps list. Missing or ineligible parent environments remain visible without move controls. Origin labels reflect inventory values, not inferred creation paths.</Text>
              <Text>Show empty groups includes groups without scoped or matching apps. All groups remain available as move destinations and duplicate sources, regardless of board filters.</Text>
              <Text>Each active search or filter field counts once. Connector all/any mode applies within its field; other fields combine with AND. Show empty groups is browse scope, not a filter; Clear filters keeps that scope and your selection.</Text>
              <Text>Refresh reloads inventory and group evidence, clearing selections and previews. Clear filters only changes the view; it does not refresh evidence or alter transfer records.</Text>
              <Text>Names from inventory and the identity cache are searchable. Actions → Resolve owner / maker names looks up other identities; missing names do not prove an account was deleted.</Text>
              <Text>Select or drag a PDE to review a move. All its apps and resources are included.</Text>
            </div></details>
          </div>
          {!inventory.data.apps.length && <EmptyPane message="No managed apps were returned. App Builder, canvas, model-driven and code apps are outside this view." />}
          {!!inventory.data.apps.length && !visibleCount && <EmptyPane message={browseAllGroups && visible.length
            ? "Matching groups are shown below, but no apps match the current filters."
            : "No apps match these filters. Clear app filters or browse all environment groups to search governance and empty destinations."} />}
          {browseAllGroups && !visible.length && <EmptyPane message="No environment groups match the readable group evidence. Unknown governance is not treated as a match." />}
          <DndContext sensors={sensors} onDragEnd={({ active, over }) => {
            if (!over || !inventory.data.groups.some((entry) => membershipId(entry.id) === over.id)) return;
            const environment = environments.get(membershipId(String(active.id)));
            if (environment && !pdeMoveBlocker(environment)) prepare(selected.has(membershipId(environment.id)) ? selectedEnvironments.map((entry) => entry.id) : [environment.id], String(over.id));
          }}>
          <div className={styles.board} role="region" aria-label="Managed apps by environment group" tabIndex={0}>
            {visible.map((column) => (
              <GroupColumn key={column.key} column={column}>
                <div className={styles.columnHeader}>
                  <Text as="h2" size={400} className={styles.title}>{column.name}</Text>
                  <Caption1 className={styles.muted}>{column.apps.length} shown / {column.totalApps} apps · {column.pdeCount} PDE{column.pdeCount === 1 ? "" : "s"}{column.otherEnvironments ? ` · ${column.otherEnvironments} other environment${column.otherEnvironments === 1 ? "" : "s"}` : ""}</Caption1>
                  {column.description && <Caption1 className={styles.muted}>{column.description}</Caption1>}
                  {column.groupId
                    ? <Button size="small" icon={<ShieldCheckmarkRegular />} disabled={evidenceLoading} onClick={() => {
                      const entry = inventory.data.groups.find((item) => membershipId(item.id) === membershipId(column.groupId!));
                      if (entry) { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setGroupPanel(entry); void fetchEvidence([entry.id]); }
                    }}>Inspect ACP permissions</Button>
                    : <Caption1 className={styles.muted}>ACP permissions unavailable in this column.</Caption1>}
                </div>
                <div className={styles.body}>
                  {!column.apps.length && <Caption1 className={styles.muted}>No apps in the current view.</Caption1>}
                  {groupPdeApps(column.apps).map((pde) => {
                    const environment = environments.get(pde.environmentId);
                    return <PdeCard key={pde.environmentId} apps={pde.apps} totalApps={allPdeApps.get(pde.environmentId)?.length ?? pde.apps.length} environment={environment} environmentId={pde.environmentId}
                        moveBlocker={pdeMoveBlocker(environment, inventory.data.environmentIssues?.[pde.environmentId])}
                        selected={selected.has(pde.environmentId)} governingGroupAvailable={!!column.groupId}
                        onSelect={selectPde} onPrepare={preparePde} onInspect={inspectPde} onGoverningGroup={inspectGoverningGroup} />;
                  })}
                </div>
              </GroupColumn>
            ))}
          </div>
          </DndContext>
        </>
      )}
      {inspection && <InspectionDialog key={inspection.environmentId} inspection={inspection}
        groupName={inventory.kind === "ready" && inspection.environment ? inventory.data.groups.find((group) => membershipId(group.id) === membershipId(inspection.environment?.environmentGroupId ?? ""))?.displayName : undefined}
        onClose={() => { setInspection(null); restoreFocus(); }} />}
      {duplicateOpen && inventory.kind === "ready" && <Dialog open onOpenChange={(_, data) => { if (!data.open) { setDuplicateOpen(false); restoreFocus(); } }}>
        <DialogSurface><DialogBody><DialogTitle>Duplicate environment group</DialogTitle><DialogContent className={styles.dialogContent}>
          <Text>Choose the group whose settings you want to copy. Its environments stay where they are.</Text>
          <SearchPicker label="Source environment group" showIds value={duplicateSource} onChange={setDuplicateSource}
            options={inventory.data.groups.map((entry) => ({ id: entry.id, name: entry.displayName || entry.id }))} />
        </DialogContent><DialogActions><Button onClick={() => { setDuplicateOpen(false); restoreFocus(); }}>Cancel</Button>
          <Button appearance="primary" disabled={!inventory.data.groups.some((entry) => entry.id === duplicateSource)} onClick={() => {
            const entry = inventory.data.groups.find((item) => item.id === duplicateSource);
            if (entry) { setDuplicateOpen(false); setGroupPanel(entry); void fetchEvidence([entry.id]); }
          }}>Review selected source</Button></DialogActions></DialogBody></DialogSurface>
      </Dialog>}
      {groupPanel && <GroupPanel key={groupPanel.id} group={groupPanel} evidence={evidence[membershipId(groupPanel.id)]} loading={evidenceLoading} onCompleted={(outcome) => { refreshInventory(); setCloneCompletion(outcome); restoreFocus(); }} onClose={() => { setGroupPanel(null); restoreFocus(); }} />}
      {move && inventory.kind === "ready" && <MovePreparationDialog selection={move.selection} groups={inventory.data.groups} destinationId={move.destinationId}
        environmentNames={Object.fromEntries(inventory.data.environments.map((environment) => [membershipId(environment.id), environment.displayName || environment.id]))}
        onBusyChange={(busy) => { transferActive.current = busy; setTransferBusy(busy); }}
        onStatusChecked={(outcomes) => {
          readPendingMoves();
          setRecentMemberships((reads) => [...reads, ...outcomes.flatMap((outcome) => outcome.verifiedMemberships ?? [])]);
          setMoveCompletion((previous) => {
            const checked = outcomes.find((outcome) => outcome.record.id === previous?.record.id);
            return previous && checked ? { ...checked, messages: [...previous.messages, ...checked.messages] } : previous;
          });
        }}
        onReviewRecovery={(ids, destinationId) => setMove({ selection: ids.map((environmentId) => ({ environmentId })), destinationId })}
        onClose={() => { setMove(null); transferActive.current = false; setTransferBusy(false); restoreFocus(); }} />}
    </div>
  );
}

function GroupColumn({ column, children }: { column: BoardColumn; children: ReactNode }) {
  const styles = useStyles();
  const { setNodeRef, isOver } = useDroppable({ id: membershipId(column.groupId ?? column.key), disabled: !column.groupId });
  return <section ref={setNodeRef} className={mergeClasses(styles.column, isOver && styles.drop)} aria-label={column.name}>{children}</section>;
}

const PdeCard = memo(function PdeCard({ apps, totalApps, environment, environmentId, moveBlocker, onInspect, selected, onSelect, onPrepare, governingGroupAvailable, onGoverningGroup }: {
  apps: ManagedApp[]; totalApps: number; environment?: EnvironmentRow; environmentId: string; moveBlocker: string; onInspect: (env: EnvironmentRow | undefined, app?: ManagedApp) => void;
  selected: boolean; onSelect: (environment: EnvironmentRow) => void; onPrepare: (environment: EnvironmentRow) => void;
  governingGroupAvailable: boolean; onGoverningGroup: (environment: EnvironmentRow) => void;
}) {
  const styles = useStyles();
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: environmentId, disabled: !!moveBlocker });
  const name = environment?.displayName || (apps[0]?.environmentName !== apps[0]?.environmentId ? apps[0]?.environmentName : "") || "Environment details unavailable";
  return (
    <article ref={setNodeRef} className={mergeClasses(styles.card, selected && styles.selected, isDragging && styles.dragging)} aria-label={`${moveBlocker ? "Environment" : "PDE"} ${name}`}>
      <div className={styles.row}>
        {!moveBlocker && environment && <Checkbox checked={selected} onChange={() => onSelect(environment)} aria-label={`Select PDE ${name}`} />}
        <Text as="h3" className={styles.title}>{name}</Text>
        {!moveBlocker && <Button size="small" appearance="subtle" icon={<ReOrderDotsVerticalRegular />} {...listeners} {...attributes} aria-label={`Drag PDE ${name} to prepare a move`} />}
        <Menu>
          <MenuTrigger disableButtonEnhancement><Button size="small" appearance="subtle" icon={<MoreHorizontalRegular />} aria-label={`Actions for PDE ${name}`} /></MenuTrigger>
          <MenuPopover><MenuList>
            <MenuItem disabled={!!moveBlocker} onClick={() => { if (environment) onPrepare(environment); }}>Move environment</MenuItem>
            <MenuItem disabled={!governingGroupAvailable || !environment} onClick={() => { if (environment) onGoverningGroup(environment); }}>View governing rules / ACP</MenuItem>
            <MenuItem disabled={!environment} onClick={() => onInspect(environment)}>View all apps in environment</MenuItem>
            <MenuItem onClick={() => navigate(`/environments/${encodeURIComponent(environmentId)}`)}>Open environment details</MenuItem>
          </MenuList></MenuPopover>
        </Menu>
      </div>
      <Caption1 className={styles.muted}>{apps.length === totalApps ? `${totalApps} app${totalApps === 1 ? "" : "s"}` : `${apps.length} of ${totalApps} apps matching`}</Caption1>
      {moveBlocker && <Caption1 className={styles.muted}>{moveBlocker}</Caption1>}
      {!governingGroupAvailable && <Caption1 className={styles.muted}>Governing group rules / ACP unavailable. This does not imply unrestricted access.</Caption1>}
      <ul className={styles.appRows} aria-label={`Apps in ${name}`}>
        {apps.map((app) => <li key={appKey(app)} className={styles.appRow}>
          <Button appearance="transparent" className={styles.appName} onClick={() => onInspect(environment, app)} aria-label={`Inspect ${app.displayName || app.id} and connectors`}>{app.displayName || app.id}</Button>
          <div className={styles.badges}><Badge appearance="tint" className={mergeClasses(styles.badge, app.origin === "CopilotStudio" ? styles.copilot : app.origin ? styles.observed : styles.unknown)}>{originLabel(app.origin)}</Badge>
            <Caption1 className={styles.muted}>{app.connectorIds == null ? "Connectors used: unreported" : `${app.connectorIds.length} connector${app.connectorIds.length === 1 ? "" : "s"} used`}</Caption1>
          </div>
        </li>)}
      </ul>
    </article>
  );
});

function InspectionDialog({ inspection, groupName, onClose }: { inspection: Inspection; groupName?: string; onClose: () => void }) {
  const styles = useStyles();
  const [apps, setApps] = useState<Slot<AppRow[]>>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void loadPdeApps(inspection.environmentId, true, controller.signal).then((result) => { if (!cancelled) setApps(slot(result)); });
    return () => { cancelled = true; controller.abort(); };
  }, [inspection]);
  const app = inspection.app;
  const siblings = apps.kind === "ready" ? apps.data.filter((entry) => !app || membershipId(entry.id) !== membershipId(app.id) || entry.type.toLowerCase() !== app.type.toLowerCase()) : [];
  const group = !inspection.environment ? "Membership unavailable" : membershipId(inspection.environment.environmentGroupId) ? groupName || "Group name unavailable" : "No environment group";
  const siblingList = <div className={styles.detailSection}>
    <Caption1 className={styles.muted}>Complete app inventory read, including apps hidden by board filters.</Caption1>
    {!siblings.length ? <Text>{app ? "No other apps returned." : "No apps returned."}</Text> : <ul className={styles.permissions}>{siblings.map((entry) => {
      const label = shortResourceType(entry.type, entry.subType);
      return <li key={`${entry.type}::${entry.id}`}>{entry.displayName || "Unnamed app"} <Caption1 className={styles.muted}>({label === entry.type ? "App type unavailable" : label})</Caption1></li>;
    })}</ul>}
  </div>;
  return (
    <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{app ? app.displayName || "App details" : inspection.environment?.displayName || "Environment details"}</DialogTitle>
          <DialogContent className={styles.dialogContent}>
                <div className={styles.detailSection}>
                  <Text>Environment: {inspection.environment?.displayName || "Details unavailable"}</Text>
                  <Text>Group: {group}</Text>
                </div>
                {app && <><div className={styles.badges}><Badge appearance="tint">{originLabel(app.origin)}</Badge></div>
                  <div className={styles.people}>
                    <div className={styles.person}><Text weight="semibold">Owner</Text><AppPerson id={app.ownerId} name={app.ownerDisplayName} /></div>
                    <div className={styles.person}><Text weight="semibold">Maker</Text><AppPerson id={app.makerId} name={app.makerName} /></div>
                  </div><AppConnectors app={app} /></>}
                {apps.kind === "loading" && <LoadingPane label="Reading environment apps..." />}
                {apps.kind === "error" && <ErrorPane title="Couldn't load PDE apps" message={apps.error} />}
                {apps.kind === "ready" && (app
                  ? <details className={styles.technical}><summary>Other apps in this environment ({siblings.length})</summary>{siblingList}</details>
                  : <section className={styles.detailSection}><Text as="h3" className={styles.title}>{apps.data.length} apps in this PDE</Text>{siblingList}</section>)}
                <details className={styles.technical}><summary>Technical details</summary><div className={styles.detailSection}>
                  {app && <><Text>App ID: {app.id}</Text><Text>Resource type: {app.type}</Text><Text>Subtype: {app.subType || "Unreported"}</Text>
                    <Text>Owner ID: {app.ownerId || "Unreported"}</Text><Text>Maker ID: {app.makerId || "Unreported"}</Text>
                    {!!app.connectorIds?.length && <div><Text as="h3" className={styles.title}>Connector IDs</Text><ul>{app.connectorIds.map((id) => <li key={id}>{id}</li>)}</ul></div>}</>}
                  <Text>Environment ID: {inspection.environmentId}</Text>
                  <Text>Group ID: {!inspection.environment ? "Unavailable" : membershipId(inspection.environment.environmentGroupId) || "None"}</Text>
                  {apps.kind === "ready" && !!siblings.length && <ul>{siblings.map((entry) => <li key={`${entry.type}::${entry.id}`}>{entry.displayName || "Unnamed app"}: {entry.id} · {entry.type}{entry.subType ? ` · ${entry.subType}` : ""}</li>)}</ul>}
                </div></details>
                {app && <RawInventoryRecord app={app} />}
          </DialogContent>
          <DialogActions><Button appearance="primary" onClick={onClose}>Close</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function RawInventoryRecord({ app }: { app: ManagedApp }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const json = useMemo((): DataResult<string> => {
    if (!open) return { ok: true, data: "" };
    if (!app.raw) return { ok: false, error: "The original inventory record is unavailable. Refresh inventory to read it again." };
    try {
      return { ok: true, data: JSON.stringify(app.raw, null, 2) };
    } catch (error) {
      return { ok: false, error: `Could not display the inventory record: ${error instanceof Error ? error.message : String(error)}` };
    }
  }, [open, app.raw]);
  return <details className={styles.technical} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Raw inventory record</summary>
    {open && (json.ok ? <pre className={styles.rawJson} tabIndex={0} aria-label="Raw inventory JSON"><code>{json.data}</code></pre>
      : <ErrorPane title="Raw record unavailable" message={json.error} />)}
  </details>;
}

function AppPerson({ id, name }: { id: string; name?: string }) {
  const entry = useUserDisplay(id);
  const lookup = useUserLookup();
  if (entry.status === "resolved") return <UserChip id={id} />;
  if (name && name !== id) return <Text>{name}</Text>;
  if (!id) return <Text>Unreported</Text>;
  return <><Text>{entry.status === "missing" ? "Unknown identity" : "Name not resolved"}</Text><Button size="small" appearance="transparent" onClick={() => lookup(id)}>Look up identity</Button></>;
}

function AppConnectors({ app }: { app: ManagedApp }) {
  const styles = useStyles();
  const { catalog } = useConnectorCatalog();
  return <section className={styles.detailSection}><Text as="h3" className={styles.title}>Connectors used</Text>
    <InfoLabel className={styles.muted} info="Usage does not confirm policy permission or runtime access.">Reported by inventory</InfoLabel>
    {app.connectorIds == null ? <Text>Connector usage was not reported or is unreadable.</Text>
      : !app.connectorIds.length ? <Text>No connectors reported (explicit empty inventory list).</Text>
      : <ul>{app.connectorIds.map((id) => <li key={id}>
        {catalog?.entries.get(normalizeConnectorId(id).toLowerCase())?.displayName || friendlyConnectorName(normalizeConnectorId(id))}
      </li>)}</ul>}
  </section>;
}
