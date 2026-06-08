import { useEffect, useMemo, useRef, useState } from "react";
import {
 Badge,
 Breadcrumb,
 BreadcrumbButton,
 BreadcrumbDivider,
 BreadcrumbItem,
 Button,
 Card,
 CardHeader,
 Checkbox,
 Divider,
 Dropdown,
 Option,
 Spinner,
 Tab,
 TabList,
 Text,
 makeStyles,
 tokens,
} from "@fluentui/react-components";
import { ArrowLeftRegular, ChartMultipleRegular, FilterRegular } from "@fluentui/react-icons";
import {
 Bar,
 BarChart,
 CartesianGrid,
 Legend,
 ResponsiveContainer,
 Tooltip,
 XAxis,
 YAxis,
} from "recharts";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
 listEnvironmentGroups,
 listEnvironments,
 type DataResult,
 type EnvironmentGroupRow,
 type EnvironmentRow,
} from "../../data/inventory";
import { customRef, msRef, refToKey, type Zone, type ZoneAssignments } from "../../data/zones";
import type { StandardCustomGroup } from "../../data/standardGroups";
import { useZones } from "../../hooks/useZones";
import { EmptyPane, ErrorPane, LoadingPane } from "../../components/Status";
import {
 aggregateUsageSeries,
 getUsageTimeseries,
 type ProductCategory,
 type UsageSeries,
} from "../../shared/licensing";
import {
 listZoneAgents,
 listZoneApps,
 listZoneFlows,
 type ZoneUsageResource,
} from "./usageData";

type TabKey = "CopilotStudio" | "PowerAutomate" | "PowerApps";

type ZoneGroupScope = {
 kind: "ms" | "custom";
 id: string;
 displayName: string;
 envs: EnvironmentRow[];
 envIdSet: Set<string>;
};

type LoadedResource = ZoneUsageResource & {
 environmentName: string;
};

type LoadedSeries = {
 resource: LoadedResource;
 series: UsageSeries;
};

type GroupUsageSummary = {
 kind: "ms" | "custom";
 id: string;
 displayName: string;
 envCount: number;
 resourceCount: number;
 usage: UsageSeries;
};

type UsageSummary = {
 totalResources: number;
 loadedResources: number;
 skippedResources: number;
 failedResources: number;
 usage: UsageSeries;
 groups: GroupUsageSummary[];
};

type LoadingProgress = {
 completed: number;
 total: number;
 skipped: number;
 failed: number;
};

type TabFilters = {
 groupKeys: string[];
 envIds: string[];
 resourceKeys: string[];
};

type UsageScopeSeed = {
 groupKeys: string[];
 envIds: string[];
};

type ReadyTabState = {
 kind: "ready";
 summary: UsageSummary;
 resources: LoadedResource[];
 loaded: LoadedSeries[];
 warning?: string;
};

type TabState =
 | { kind: "idle" }
 | { kind: "loading"; progress: LoadingProgress }
 | { kind: "error"; message: string }
 | ReadyTabState;

const PRODUCT_TABS: Record<
 TabKey,
 {
  label: string;
  category: ProductCategory;
  loader: (envIds: string[]) => Promise<DataResult<ZoneUsageResource[]>>;
  note?: string;
 }
> = {
 CopilotStudio: {
  label: "Copilot Studio",
  category: "CopilotStudio",
  loader: listZoneAgents,
 },
 PowerAutomate: {
  label: "Power Automate",
  category: "PowerAutomate",
  loader: listZoneFlows,
 },
 PowerApps: {
  label: "Power Apps",
  category: "PowerApps",
  loader: listZoneApps,
  note: "Experimental - Power Apps usage telemetry may not exist for every tenant.",
 },
};

const EMPTY_FILTERS: Record<TabKey, TabFilters> = {
 CopilotStudio: { groupKeys: [], envIds: [], resourceKeys: [] },
 PowerAutomate: { groupKeys: [], envIds: [], resourceKeys: [] },
 PowerApps: { groupKeys: [], envIds: [], resourceKeys: [] },
};

const USAGE_FANOUT_BATCH_SIZE = 8;

const useStyles = makeStyles({
 root: {
  display: "flex",
  flexDirection: "column",
  gap: tokens.spacingVerticalL,
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
 panel: {
  display: "flex",
  flexDirection: "column",
  gap: tokens.spacingVerticalM,
 },
 tabNote: {
  color: tokens.colorNeutralForeground3,
 },
 actionRow: {
  display: "flex",
  alignItems: "center",
  gap: tokens.spacingHorizontalS,
  flexWrap: "wrap",
 },
 muted: {
  color: tokens.colorNeutralForeground3,
 },
 loadingBody: {
  display: "flex",
  flexDirection: "column",
  gap: tokens.spacingVerticalM,
  padding: tokens.spacingVerticalL,
 },
 progressNote: {
  color: tokens.colorNeutralForeground3,
 },
 statsRow: {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: tokens.spacingHorizontalL,
  rowGap: tokens.spacingVerticalM,
  "@media (max-width: 700px)": {
   gridTemplateColumns: "1fr",
  },
 },
 statCard: {
  display: "flex",
  flexDirection: "column",
  gap: tokens.spacingVerticalXXS,
 },
 statValue: {
  fontSize: tokens.fontSizeHero700,
  fontWeight: tokens.fontWeightSemibold,
 },
 statLabel: {
  color: tokens.colorNeutralForeground3,
  fontSize: tokens.fontSizeBase200,
 },
 chartHost: {
  width: "100%",
  height: "280px",
 },
 groupChartHost: {
  width: "100%",
  height: "260px",
 },
 emptyChart: {
  color: tokens.colorNeutralForeground3,
  fontStyle: "italic",
  padding: tokens.spacingVerticalXL,
  textAlign: "center",
 },
 filterCardBody: {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: tokens.spacingHorizontalM,
  "@media (max-width: 1000px)": {
   gridTemplateColumns: "1fr",
  },
 },
 filterColumn: {
  display: "flex",
  flexDirection: "column",
  gap: tokens.spacingVerticalXS,
  minWidth: 0,
 },
 filterHead: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: tokens.spacingHorizontalS,
 },
 filterActions: {
  display: "flex",
  gap: tokens.spacingHorizontalXS,
 },
 filterList: {
  maxHeight: "180px",
  overflowY: "auto",
  border: `1px solid ${tokens.colorNeutralStroke2}`,
  borderRadius: tokens.borderRadiusMedium,
  padding: tokens.spacingVerticalXS,
  display: "flex",
  flexDirection: "column",
  gap: tokens.spacingVerticalXXS,
 },
 filterSummary: {
  color: tokens.colorNeutralForeground3,
 },
 groupList: {
  display: "flex",
  flexDirection: "column",
  gap: tokens.spacingVerticalXS,
 },
 groupHeader: {
  display: "grid",
  gridTemplateColumns: "1.8fr repeat(3, minmax(0, 1fr))",
  gap: tokens.spacingHorizontalM,
  alignItems: "center",
  padding: tokens.spacingHorizontalS,
 },
 groupRow: {
  display: "grid",
  gridTemplateColumns: "1.8fr repeat(3, minmax(0, 1fr))",
  gap: tokens.spacingHorizontalM,
  alignItems: "center",
  borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  padding: tokens.spacingHorizontalS,
 },
 groupNameCell: {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
 },
 groupName: {
  fontWeight: tokens.fontWeightSemibold,
 },
 groupMeta: {
  color: tokens.colorNeutralForeground3,
  fontSize: tokens.fontSizeBase200,
 },
 groupMetric: {
  textAlign: "right",
 },
 zonePickerRow: {
  display: "flex",
  alignItems: "center",
  gap: tokens.spacingHorizontalM,
  flexWrap: "wrap",
 },
 zonePicker: {
  minWidth: "300px",
  maxWidth: "480px",
 },
});

export function ZoneUsageView() {
 const styles = useStyles();
 const location = useLocation();
 const navigate = useNavigate();
 const { zoneId: routeZoneId } = useParams<{ zoneId?: string }>();
 const { zones, assignments, standardGroups } = useZones();
 const usageScopeSeed = useMemo(() => parseUsageScopeFromSearch(location.search), [location.search]);
 const seededZoneId = useMemo(() => {
  const seededGroupKey = usageScopeSeed.groupKeys[0];
  if (!seededGroupKey) return "";
  const [kind, id] = seededGroupKey.split(":");
  if (!kind || !id) return "";
  const refKey = refToKey(kind === "ms" ? msRef(id) : customRef(id));
  return assignments[refKey]?.zoneId ?? "";
 }, [assignments, usageScopeSeed.groupKeys]);
 const [selectedZoneId, setSelectedZoneId] = useState("");

 const isStandalone = !routeZoneId;
 const activeZoneId = routeZoneId ?? (selectedZoneId || seededZoneId || zones[0]?.id || "");
 const activeZone = zones.find((zone) => zone.id === activeZoneId) ?? null;

 if (zones.length === 0) {
  return (
   <EmptyPane message="No zones yet. Create a zone in Zones board, then come back here to analyze usage." />
  );
 }

 if (!activeZone) {
  return (
   <ErrorPane
    title="Zone not found"
    message="The selected zone no longer exists. Pick another zone."
   />
  );
 }

 return (
  <div className={styles.root}>
   {isStandalone ? (
    <Breadcrumb>
     <BreadcrumbItem>
      <BreadcrumbButton onClick={() => navigate("/zones")}>Zones board</BreadcrumbButton>
     </BreadcrumbItem>
     <BreadcrumbDivider />
     <BreadcrumbItem>
      <BreadcrumbButton current>Zone usage</BreadcrumbButton>
     </BreadcrumbItem>
    </Breadcrumb>
   ) : (
    <Breadcrumb>
     <BreadcrumbItem>
      <BreadcrumbButton onClick={() => navigate("/zones")}>Zones board</BreadcrumbButton>
     </BreadcrumbItem>
     <BreadcrumbDivider />
     <BreadcrumbItem>
      <BreadcrumbButton onClick={() => navigate(`/zones/${activeZone.id}`)}>
       {activeZone.name}
      </BreadcrumbButton>
     </BreadcrumbItem>
     <BreadcrumbDivider />
     <BreadcrumbItem>
      <BreadcrumbButton current>Usage</BreadcrumbButton>
     </BreadcrumbItem>
    </Breadcrumb>
   )}

   {isStandalone && (
    <Card>
     <CardHeader
      header={<Text weight="semibold">Pick a zone</Text>}
      description={<Text size={200}>Use one page to compare usage across zones and drill into subsets.</Text>}
     />
     <Divider />
     <div style={{ padding: tokens.spacingVerticalM }}>
      <div className={styles.zonePickerRow}>
       <Dropdown
        className={styles.zonePicker}
        value={`${activeZone.icon} ${activeZone.name}`}
        selectedOptions={[activeZone.id]}
        onOptionSelect={(_e, data) => {
         if (data.optionValue) setSelectedZoneId(data.optionValue);
        }}
       >
        {zones.map((zone) => (
         <Option key={zone.id} value={zone.id} text={zone.name}>
          {zone.icon} {zone.name}
         </Option>
        ))}
       </Dropdown>
       <Text size={200} className={styles.muted}>
        {zones.length} zone{zones.length === 1 ? "" : "s"} available
       </Text>
      </div>
     </div>
    </Card>
   )}

   <ZoneUsageWorkspace
    key={activeZone.id}
    zone={activeZone}
    assignments={assignments}
    standardGroups={standardGroups}
    standalone={isStandalone}
    initialScope={isStandalone ? usageScopeSeed : undefined}
   />
  </div>
 );
}

function ZoneUsageWorkspace({
 zone,
 assignments,
 standardGroups,
 standalone,
 initialScope,
}: {
 zone: Zone;
 assignments: ZoneAssignments;
 standardGroups: StandardCustomGroup[];
 standalone: boolean;
 initialScope?: UsageScopeSeed;
}) {
 const styles = useStyles();
 const navigate = useNavigate();
 const [selectedTab, setSelectedTab] = useState<TabKey>("CopilotStudio");
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
 const [tabStates, setTabStates] = useState<Record<TabKey, TabState>>({
  CopilotStudio: { kind: "idle" },
  PowerAutomate: { kind: "idle" },
  PowerApps: { kind: "idle" },
 });
 const [tabFilters, setTabFilters] = useState<Record<TabKey, TabFilters>>(EMPTY_FILTERS);
 const requestEpochRef = useRef<Record<TabKey, number>>({
  CopilotStudio: 0,
  PowerAutomate: 0,
  PowerApps: 0,
 });
 const [seededTabs, setSeededTabs] = useState<Record<TabKey, boolean>>({
  CopilotStudio: false,
  PowerAutomate: false,
  PowerApps: false,
 });

 useEffect(() => {
  let cancelled = false;
  void (async () => {
   const [envsRes, groupsRes] = await Promise.all([listEnvironments(), listEnvironmentGroups()]);
   if (cancelled) return;
   setEnvsState(envsRes.ok ? { kind: "ready", rows: envsRes.data } : { kind: "error", message: envsRes.error });
   setEnvGroupsState(
    groupsRes.ok ? { kind: "ready", rows: groupsRes.data } : { kind: "error", message: groupsRes.error },
   );
  })();
  return () => {
   cancelled = true;
  };
 }, []);

 const envNameMap = useMemo(() => {
  const map = new Map<string, string>();
  if (envsState.kind !== "ready") return map;
  for (const env of envsState.rows) {
   if (env.id) map.set(env.id, env.displayName || env.id);
  }
  return map;
 }, [envsState]);

 const groupsInZone = useMemo<ZoneGroupScope[]>(() => {
  if (envsState.kind !== "ready" || envGroupsState.kind !== "ready") return [];
  const result: ZoneGroupScope[] = [];

  for (const msGroup of envGroupsState.rows) {
   const placement = assignments[refToKey(msRef(msGroup.id))];
   if (placement?.zoneId !== zone.id) continue;
   const envs = envsState.rows.filter((row) => row.environmentGroupId === msGroup.id);
   result.push({
    kind: "ms",
    id: msGroup.id,
    displayName: msGroup.displayName,
    envs,
    envIdSet: new Set(envs.map((env) => env.id)),
   });
  }

  for (const customGroup of standardGroups) {
   const placement = assignments[refToKey(customRef(customGroup.id))];
   if (placement?.zoneId !== zone.id) continue;
   const envs = envsState.rows.filter((row) => customGroup.envIds.includes(row.id));
   result.push({
    kind: "custom",
    id: customGroup.id,
    displayName: customGroup.displayName,
    envs,
    envIdSet: new Set(customGroup.envIds),
   });
  }

  return result;
 }, [zone.id, envsState, envGroupsState, assignments, standardGroups]);

 const envIdsInZone = useMemo(
  () => Array.from(new Set(groupsInZone.flatMap((group) => group.envs.map((env) => env.id)))).sort((a, b) => a.localeCompare(b)),
  [groupsInZone],
 );

 const resourcesState = tabStates[selectedTab];
 const selectedTabDefinition = PRODUCT_TABS[selectedTab];

 const loadUsage = async () => {
  const zoneIdAtStart = zone.id;
  const epoch = (requestEpochRef.current[selectedTab] += 1);
  setTabStates((current) => ({
   ...current,
   [selectedTab]: {
    kind: "loading",
    progress: {
     completed: 0,
     total: 0,
     skipped: 0,
     failed: 0,
    },
   },
  }));

  const resourceRes = await selectedTabDefinition.loader(envIdsInZone);
  if (zone.id !== zoneIdAtStart || requestEpochRef.current[selectedTab] !== epoch) return;

  if (!resourceRes.ok) {
   setTabStates((current) => ({
    ...current,
    [selectedTab]: { kind: "error", message: resourceRes.error },
   }));
   return;
  }

  const resources = resourceRes.data.map<LoadedResource>((resource) => ({
   ...resource,
   environmentName: envNameMap.get(resource.environmentId) || resource.environmentName || resource.environmentId,
  }));
  const validResources = resources.filter((resource) => resource.id && resource.tenantId);
  const skippedResources = resources.length - validResources.length;

  if (validResources.length === 0) {
   const emptySummary = buildUsageSummary(groupsInZone, validResources, [], skippedResources, 0);
   setTabStates((current) => ({
    ...current,
    [selectedTab]: {
     kind: "ready",
     summary: emptySummary,
     resources: validResources,
     loaded: [],
     warning: skippedResources
      ? `${skippedResources} resource${skippedResources === 1 ? "" : "s"} were skipped because they are missing tenant or resource IDs.`
      : undefined,
    },
   }));
   if (!seededTabs[selectedTab]) {
    setTabFilters((current) => ({
     ...current,
     [selectedTab]: buildSeededFilters(groupsInZone, validResources, initialScope),
    }));
    setSeededTabs((current) => ({ ...current, [selectedTab]: true }));
   }
   return;
  }

  const loaded: LoadedSeries[] = [];
  let failedResources = 0;
  let completed = 0;
  const batches = chunk(validResources, USAGE_FANOUT_BATCH_SIZE);

  for (const batch of batches) {
   const batchResults = await Promise.all(
    batch.map(async (resource) => {
     const result = await getUsageTimeseries({
      productCategory: selectedTabDefinition.category,
      tenantId: resource.tenantId,
      resourceId: resource.id,
     });
     return { resource, result };
    }),
   );

   if (zone.id !== zoneIdAtStart || requestEpochRef.current[selectedTab] !== epoch) return;

   for (const item of batchResults) {
    if (item.result.ok) {
     loaded.push({ resource: item.resource, series: item.result.data });
    } else {
     failedResources += 1;
    }
   }
   completed += batch.length;

   setTabStates((current) => {
    const currentState = current[selectedTab];
    if (currentState.kind !== "loading") return current;
    return {
     ...current,
     [selectedTab]: {
      kind: "loading",
      progress: {
       completed,
       total: validResources.length,
       skipped: skippedResources,
       failed: failedResources,
      },
     },
    };
   });
  }

  if (zone.id !== zoneIdAtStart || requestEpochRef.current[selectedTab] !== epoch) return;

  if (loaded.length === 0 && failedResources > 0) {
   setTabStates((current) => ({
    ...current,
    [selectedTab]: {
     kind: "error",
     message: `Couldn't load usage for any ${selectedTabDefinition.label} resources in this zone.`,
    },
   }));
   return;
  }

  const summary = buildUsageSummary(groupsInZone, validResources, loaded, skippedResources, failedResources);
  const warningParts: string[] = [];
  if (skippedResources > 0) {
   warningParts.push(
    `${skippedResources} resource${skippedResources === 1 ? "" : "s"} were skipped because they are missing tenant or resource IDs.`,
   );
  }
  if (failedResources > 0) {
   warningParts.push(`${failedResources} usage request${failedResources === 1 ? "" : "s"} failed.`);
  }

  setTabStates((current) => ({
   ...current,
   [selectedTab]: {
    kind: "ready",
    summary,
    resources: validResources,
    loaded,
    warning: warningParts.length > 0 ? warningParts.join(" ") : undefined,
   },
  }));
  if (!seededTabs[selectedTab]) {
   setTabFilters((current) => ({
    ...current,
    [selectedTab]: buildSeededFilters(groupsInZone, validResources, initialScope),
   }));
   setSeededTabs((current) => ({ ...current, [selectedTab]: true }));
  }
 };
 const filterScope = useMemo(() => {
  if (resourcesState.kind !== "ready") return null;

  const groupOptions = groupsInZone.map((group) => ({
   key: groupKey(group),
   label: `${group.kind === "ms" ? "MS" : "Custom"} - ${group.displayName}`,
  }));
  const validGroupKeys = new Set(groupOptions.map((item) => item.key));
  const selectedGroupKeys = tabFilters[selectedTab].groupKeys.filter((key) => validGroupKeys.has(key));

  const selectedGroups = groupsInZone.filter((group) => selectedGroupKeys.includes(groupKey(group)));
  const groupEnvIdSet = new Set(selectedGroups.flatMap((group) => Array.from(group.envIdSet)));

  const envOptions = Array.from(groupEnvIdSet)
   .map((id) => ({ id, label: envNameMap.get(id) || id }))
   .sort((a, b) => a.label.localeCompare(b.label));
  const validEnvIds = new Set(envOptions.map((item) => item.id));
  const selectedEnvIds = tabFilters[selectedTab].envIds.filter((id) => validEnvIds.has(id));

  const selectedEnvSet = new Set(selectedEnvIds);
  const resourceOptions = resourcesState.resources
   .filter((resource) => selectedEnvSet.has(resource.environmentId))
   .slice()
   .sort((a, b) => a.displayName.localeCompare(b.displayName))
   .map((resource) => ({
    key: resourceKey(resource),
    label: `${resource.displayName} - ${resource.environmentName}`,
   }));
  const validResourceKeys = new Set(resourceOptions.map((item) => item.key));
  const selectedResourceKeys = tabFilters[selectedTab].resourceKeys.filter((key) => validResourceKeys.has(key));

  const summary = buildFilteredUsageSummary(groupsInZone, resourcesState, {
   groupKeys: selectedGroupKeys,
   envIds: selectedEnvIds,
   resourceKeys: selectedResourceKeys,
  });

  return {
   groupOptions,
   envOptions,
   resourceOptions,
   selectedGroupKeys,
   selectedEnvIds,
   selectedResourceKeys,
   summary,
  };
 }, [envNameMap, groupsInZone, resourcesState, selectedTab, tabFilters]);


 const updateTabFilters = (patch: Partial<TabFilters>) => {
  setTabFilters((current) => ({
   ...current,
   [selectedTab]: {
    ...current[selectedTab],
    ...patch,
   },
  }));
 };

 if (envsState.kind === "loading" || envGroupsState.kind === "loading") {
  return <LoadingPane label="Loading zone usage" />;
 }
 if (envsState.kind === "error") {
  return <ErrorPane title="Couldn't load environments" message={envsState.message} />;
 }
 if (envGroupsState.kind === "error") {
  return <ErrorPane title="Couldn't load environment groups" message={envGroupsState.message} />;
 }


 return (
  <div className={styles.root}>
   {!standalone && (
    <div className={styles.backRow}>
     <Button
      size="small"
      appearance="subtle"
      icon={<ArrowLeftRegular />}
      onClick={() => navigate(`/zones/${zone.id}`)}
     >
      Back to zone
     </Button>
    </div>
   )}

   <div className={styles.header}>
    <div className={styles.colorStripe} style={{ backgroundColor: zone.color }} aria-hidden />
    <div className={styles.headerBody}>
     <div className={styles.titleRow}>
      <span className={styles.zoneIcon} aria-hidden>
       {zone.icon}
      </span>
      <Text size={600} className={styles.zoneTitle}>
       {zone.name}
      </Text>
      <Badge appearance="outline" color="brand">
       Usage
      </Badge>
     </div>
     {zone.description && <Text className={styles.description}>{zone.description}</Text>}
     <Text className={styles.meta}>
      {groupsInZone.length} group{groupsInZone.length === 1 ? "" : "s"} | {envIdsInZone.length} env
      {envIdsInZone.length === 1 ? "" : "s"}
      {resourcesState.kind === "ready" ? (
       <>
        {" | "}
        {resourcesState.summary.totalResources} resource
        {resourcesState.summary.totalResources === 1 ? "" : "s"}
       </>
      ) : null}
     </Text>
    </div>
   </div>

   <Card>
    <CardHeader
     header={<Text weight="semibold">Usage overview</Text>}
     description={<Text size={200}>Load usage per product tab, then scope by groups, environments, or resources.</Text>}
    />
    <Divider />
    <div style={{ padding: tokens.spacingVerticalM, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL }}>
     <TabList selectedValue={selectedTab} onTabSelect={(_e, data) => setSelectedTab(String(data.value) as TabKey)}>
      {Object.entries(PRODUCT_TABS).map(([key, value]) => (
       <Tab key={key} value={key}>
        {value.label}
       </Tab>
      ))}
     </TabList>

     <div className={styles.panel}>
      <Text size={200} className={styles.tabNote}>
       {selectedTabDefinition.note ?? "Load this tab to inspect zone-wide usage and then filter by scope."}
      </Text>
      <div className={styles.actionRow}>
       <Button
        appearance="primary"
        icon={resourcesState.kind === "loading" ? <Spinner size="tiny" /> : <ChartMultipleRegular />}
        onClick={loadUsage}
        disabled={envIdsInZone.length === 0 || resourcesState.kind === "loading"}
       >
        {resourcesState.kind === "ready" ? "Refresh usage" : "Load usage"}
       </Button>
       {resourcesState.kind === "ready" && (
        <Button
         appearance="subtle"
         icon={<FilterRegular />}
         onClick={() => updateTabFilters(buildDefaultFilters(groupsInZone, resourcesState.resources))}
        >
         Reset to whole zone
        </Button>
       )}
       {envIdsInZone.length === 0 && (
        <Text size={200} className={styles.muted}>
         This zone has no environments yet.
        </Text>
       )}
      </div>

      {resourcesState.kind === "idle" && (
       <Text size={200} className={styles.muted}>
        Nothing is loaded yet. Click the button to fan out usage queries for this tab.
       </Text>
      )}

      {resourcesState.kind === "loading" && (
       <div className={styles.loadingBody}>
        <LoadingPane
         label={`Loading ${selectedTabDefinition.label} usage ${resourcesState.progress.completed}/${resourcesState.progress.total || "?"} resources`}
        />
        <Text size={200} className={styles.progressNote}>
         {resourcesState.progress.skipped > 0 ? `${resourcesState.progress.skipped} skipped | ` : ""}
         {resourcesState.progress.failed > 0 ? `${resourcesState.progress.failed} failed | ` : ""}
         {resourcesState.progress.completed} processed
        </Text>
       </div>
      )}

      {resourcesState.kind === "error" && <ErrorPane title="Couldn't load usage" message={resourcesState.message} />}

      {resourcesState.kind === "ready" && filterScope && (
       <>
        <Card>
         <CardHeader
          header={<Text weight="semibold">Filter scope</Text>}
          description={<Text size={200}>Scope metrics and charts to selected groups, environments, and resources.</Text>}
         />
         <Divider />
         <div style={{ padding: tokens.spacingVerticalM }}>
          <div className={styles.filterCardBody}>
           <div className={styles.filterColumn}>
            <div className={styles.filterHead}>
             <Text weight="semibold">Environment groups</Text>
             <div className={styles.filterActions}>
              <Button size="small" appearance="subtle" onClick={() => updateTabFilters({ groupKeys: filterScope.groupOptions.map((item) => item.key) })}>All</Button>
              <Button size="small" appearance="subtle" onClick={() => updateTabFilters({ groupKeys: [] })}>None</Button>
             </div>
            </div>
            <div className={styles.filterList}>
             {filterScope.groupOptions.map((item) => (
              <Checkbox
               key={item.key}
               checked={filterScope.selectedGroupKeys.includes(item.key)}
               label={item.label}
               onChange={(_e, data) => {
                updateTabFilters({
                 groupKeys: toggleString(filterScope.selectedGroupKeys, item.key, !!data.checked),
                });
               }}
              />
             ))}
            </div>
           </div>

           <div className={styles.filterColumn}>
            <div className={styles.filterHead}>
             <Text weight="semibold">Environments</Text>
             <div className={styles.filterActions}>
              <Button size="small" appearance="subtle" onClick={() => updateTabFilters({ envIds: filterScope.envOptions.map((item) => item.id) })}>All</Button>
              <Button size="small" appearance="subtle" onClick={() => updateTabFilters({ envIds: [] })}>None</Button>
             </div>
            </div>
            <div className={styles.filterList}>
             {filterScope.envOptions.map((item) => (
              <Checkbox
               key={item.id}
               checked={filterScope.selectedEnvIds.includes(item.id)}
               label={item.label}
               onChange={(_e, data) => {
                updateTabFilters({
                 envIds: toggleString(filterScope.selectedEnvIds, item.id, !!data.checked),
                });
               }}
              />
             ))}
            </div>
           </div>

           <div className={styles.filterColumn}>
            <div className={styles.filterHead}>
             <Text weight="semibold">Resources</Text>
             <div className={styles.filterActions}>
              <Button size="small" appearance="subtle" onClick={() => updateTabFilters({ resourceKeys: filterScope.resourceOptions.map((item) => item.key) })}>All</Button>
              <Button size="small" appearance="subtle" onClick={() => updateTabFilters({ resourceKeys: [] })}>None</Button>
             </div>
            </div>
            <div className={styles.filterList}>
             {filterScope.resourceOptions.map((item) => (
              <Checkbox
               key={item.key}
               checked={filterScope.selectedResourceKeys.includes(item.key)}
               label={item.label}
               onChange={(_e, data) => {
                updateTabFilters({
                 resourceKeys: toggleString(filterScope.selectedResourceKeys, item.key, !!data.checked),
                });
               }}
              />
             ))}
            </div>
           </div>
          </div>
          <Text size={200} className={styles.filterSummary}>
           Scope: {filterScope.summary.groups.length} group{filterScope.summary.groups.length === 1 ? "" : "s"} | {filterScope.summary.totalResources} resource
           {filterScope.summary.totalResources === 1 ? "" : "s"} selected
          </Text>
         </div>
        </Card>

        <div className={styles.statsRow}>
         <div className={styles.statCard}>
          <Text className={styles.statValue} data-testid="zone-usage-total-users">
           {filterScope.summary.usage.totals.activeUsers.toLocaleString()}
          </Text>
          <Text className={styles.statLabel}>Active users</Text>
         </div>
         <div className={styles.statCard}>
          <Text className={styles.statValue} data-testid="zone-usage-total-sessions">
           {filterScope.summary.usage.totals.activeSessions.toLocaleString()}
          </Text>
          <Text className={styles.statLabel}>Active sessions</Text>
         </div>
         <div className={styles.statCard}>
          <Text className={styles.statValue} data-testid="zone-usage-total-runs">
           {filterScope.summary.usage.totals.activeRuns.toLocaleString()}
          </Text>
          <Text className={styles.statLabel}>Active runs</Text>
         </div>
        </div>

        <Text size={200} className={styles.muted}>
         {filterScope.summary.loadedResources} loaded in scope | {resourcesState.summary.loadedResources} loaded overall | {resourcesState.summary.totalResources} discovered overall
         {resourcesState.summary.skippedResources > 0 ? ` | ${resourcesState.summary.skippedResources} skipped` : ""}
         {resourcesState.summary.failedResources > 0 ? ` | ${resourcesState.summary.failedResources} failed` : ""}
        </Text>

        {resourcesState.warning && (
         <Text size={200} className={styles.muted}>
          {resourcesState.warning}
         </Text>
        )}

        {filterScope.summary.usage.points.length === 0 ? (
         <div className={styles.emptyChart}>No usage data for the current scope in this tab.</div>
        ) : (
         <div className={styles.chartHost}>
          <ResponsiveContainer width="100%" height="100%">
           <BarChart
            data={filterScope.summary.usage.points.map((point) => ({
             label: formatBucketLabel(point.date),
             activeUsers: point.metrics.activeUsers,
             activeSessions: point.metrics.activeSessions,
             activeRuns: point.metrics.activeRuns,
            }))}
            margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
           >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="activeUsers" name="Active users" fill="#0078D4" />
            <Bar dataKey="activeSessions" name="Active sessions" fill="#107C10" />
            <Bar dataKey="activeRuns" name="Active runs" fill="#5C2D91" />
           </BarChart>
          </ResponsiveContainer>
         </div>
        )}

        <Card>
         <CardHeader
          header={<Text weight="semibold">Breakdown by environment group</Text>}
          description={<Text size={200}>Includes a chart + totals for the currently selected scope.</Text>}
         />
         <Divider />
         {filterScope.summary.groups.length === 0 ? (
          <div className={styles.emptyChart}>No groups selected in the current scope.</div>
         ) : (
          <>
           <div className={styles.groupChartHost}>
            <ResponsiveContainer width="100%" height="100%">
             <BarChart
              data={filterScope.summary.groups.map((group) => ({
               label: group.displayName,
               activeUsers: group.usage.totals.activeUsers,
               activeSessions: group.usage.totals.activeSessions,
               activeRuns: group.usage.totals.activeRuns,
              }))}
              margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
             >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" interval={0} angle={-18} textAnchor="end" height={70} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="activeUsers" name="Active users" fill="#0078D4" />
              <Bar dataKey="activeSessions" name="Active sessions" fill="#107C10" />
              <Bar dataKey="activeRuns" name="Active runs" fill="#5C2D91" />
             </BarChart>
            </ResponsiveContainer>
           </div>

           <div className={styles.groupList}>
            <div className={styles.groupHeader}>
             <Text size={200} weight="semibold">Group</Text>
             <Text size={200} weight="semibold" className={styles.groupMetric}>Users</Text>
             <Text size={200} weight="semibold" className={styles.groupMetric}>Sessions</Text>
             <Text size={200} weight="semibold" className={styles.groupMetric}>Runs</Text>
            </div>
            {filterScope.summary.groups.map((group) => (
             <div key={`${group.kind}-${group.id}`} className={styles.groupRow} data-testid={`zone-usage-group-${group.id}`}>
              <div className={styles.groupNameCell}>
               <Text className={styles.groupName}>
                {group.kind === "ms" ? "MS - " : "Custom - "}
                {group.displayName}
               </Text>
               <Text className={styles.groupMeta}>
                {group.resourceCount} resource{group.resourceCount === 1 ? "" : "s"} | {group.envCount} env{group.envCount === 1 ? "" : "s"}
               </Text>
              </div>
              <Text className={styles.groupMetric} data-testid={`zone-usage-group-${group.id}-users`}>
               {group.usage.totals.activeUsers.toLocaleString()}
              </Text>
              <Text className={styles.groupMetric} data-testid={`zone-usage-group-${group.id}-sessions`}>
               {group.usage.totals.activeSessions.toLocaleString()}
              </Text>
              <Text className={styles.groupMetric} data-testid={`zone-usage-group-${group.id}-runs`}>
               {group.usage.totals.activeRuns.toLocaleString()}
              </Text>
             </div>
            ))}
           </div>
          </>
         )}
        </Card>
       </>
      )}
     </div>
    </div>
   </Card>
  </div>
 );
}

function buildUsageSummary(
 groupsInZone: ZoneGroupScope[],
 resources: LoadedResource[],
 loaded: LoadedSeries[],
 skippedResources: number,
 failedResources: number,
): UsageSummary {
 return {
  totalResources: resources.length,
  loadedResources: loaded.length,
  skippedResources,
  failedResources,
  usage: aggregateUsageSeries(loaded.map((entry) => entry.series)),
  groups: buildGroupSummaries(groupsInZone, resources, loaded).sort((a, b) => {
   const delta = b.usage.totals.activeSessions - a.usage.totals.activeSessions;
   if (delta !== 0) return delta;
   return b.usage.totals.activeRuns - a.usage.totals.activeRuns;
  }),
 };
}

function buildFilteredUsageSummary(
 groupsInZone: ZoneGroupScope[],
 readyState: ReadyTabState,
 filters: TabFilters,
): UsageSummary {
 const selectedGroups = groupsInZone.filter((group) => filters.groupKeys.includes(groupKey(group)));
 const selectedEnvIds = new Set(filters.envIds);
 const selectedResourceKeys = new Set(filters.resourceKeys);

 const groupEnvIds = new Set<string>();
 for (const group of selectedGroups) {
  for (const envId of group.envIdSet) groupEnvIds.add(envId);
 }

 const allowedEnvIds = new Set<string>();
 for (const envId of selectedEnvIds) {
  if (groupEnvIds.has(envId)) allowedEnvIds.add(envId);
 }

 const scopedResources = readyState.resources.filter(
  (resource) => allowedEnvIds.has(resource.environmentId) && selectedResourceKeys.has(resourceKey(resource)),
 );
 const scopedResourceKeySet = new Set(scopedResources.map((resource) => resourceKey(resource)));
 const scopedLoaded = readyState.loaded.filter((entry) => scopedResourceKeySet.has(resourceKey(entry.resource)));

 return buildUsageSummary(
  selectedGroups,
  scopedResources,
  scopedLoaded,
  readyState.summary.skippedResources,
  readyState.summary.failedResources,
 );
}

function buildGroupSummaries(
 groupsInZone: ZoneGroupScope[],
 resources: LoadedResource[],
 loaded: LoadedSeries[],
): GroupUsageSummary[] {
 return groupsInZone.map((group) => {
  const groupResourceKeys = new Set(
   resources
    .filter((resource) => group.envIdSet.has(resource.environmentId))
    .map((resource) => resourceKey(resource)),
  );
  const groupUsage = aggregateUsageSeries(
   loaded.filter((entry) => groupResourceKeys.has(resourceKey(entry.resource))).map((entry) => entry.series),
  );
  return {
   kind: group.kind,
   id: group.id,
   displayName: group.displayName,
   envCount: group.envs.length,
   resourceCount: groupResourceKeys.size,
   usage: groupUsage,
  };
 });
}

function buildDefaultFilters(groupsInZone: ZoneGroupScope[], resources: LoadedResource[]): TabFilters {
 return {
  groupKeys: groupsInZone.map((group) => groupKey(group)),
  envIds: Array.from(new Set(groupsInZone.flatMap((group) => Array.from(group.envIdSet)))),
  resourceKeys: resources.map((resource) => resourceKey(resource)),
 };
}

function buildSeededFilters(
 groupsInZone: ZoneGroupScope[],
 resources: LoadedResource[],
 seed?: UsageScopeSeed,
): TabFilters {
 const defaults = buildDefaultFilters(groupsInZone, resources);
 if (!seed || (seed.groupKeys.length === 0 && seed.envIds.length === 0)) return defaults;

 const validGroupKeys = new Set(defaults.groupKeys);
 const seededGroupKeys = seed.groupKeys.filter((key) => validGroupKeys.has(key));
 const groupKeys = seededGroupKeys.length > 0 ? seededGroupKeys : defaults.groupKeys;

 const allowedEnvIdsFromGroups = new Set<string>();
 for (const group of groupsInZone) {
  if (!groupKeys.includes(groupKey(group))) continue;
  for (const envId of group.envIdSet) allowedEnvIdsFromGroups.add(envId);
 }

 const seededEnvIds = seed.envIds.filter((envId) => allowedEnvIdsFromGroups.has(envId));
 const envIds =
  seededEnvIds.length > 0 ? seededEnvIds : Array.from(allowedEnvIdsFromGroups);
 const selectedEnvIds = new Set(envIds);
 const resourceKeys = resources
  .filter((resource) => selectedEnvIds.has(resource.environmentId))
  .map((resource) => resourceKey(resource));

 return { groupKeys, envIds, resourceKeys };
}

function groupKey(group: Pick<ZoneGroupScope, "kind" | "id">): string {
 return `${group.kind}:${group.id}`;
}

function resourceKey(resource: Pick<LoadedResource, "environmentId" | "id">): string {
 return `${resource.environmentId}::${resource.id}`;
}

function toggleString(values: string[], next: string, checked: boolean): string[] {
 if (checked) {
  return values.includes(next) ? values : [...values, next];
 }
 return values.filter((value) => value !== next);
}

function chunk<T>(items: T[], size: number): T[][] {
 const out: T[][] = [];
 for (let i = 0; i < items.length; i += size) {
  out.push(items.slice(i, i + size));
 }
 return out;
}

function formatBucketLabel(value: string): string {
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return value;
 return new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
 }).format(date);
}

function parseUsageScopeFromSearch(search: string): UsageScopeSeed {
 const params = new URLSearchParams(search);
 const groupKindParam = (params.get("groupKind") || "").trim().toLowerCase();
 const groupIdParam = (params.get("groupId") || "").trim();
 const envIdParam = (params.get("envId") || "").trim();

 const groupKeys: string[] = [];
 if (groupIdParam && (groupKindParam === "ms" || groupKindParam === "custom")) {
  groupKeys.push(`${groupKindParam}:${groupIdParam}`);
 }

 return {
  groupKeys,
  envIds: envIdParam ? [envIdParam] : [],
 };
}
