import {
  ALL_APP_TYPES,
  MANAGED_APP_SUBTYPE,
  isManagedApp,
  CONNECTOR_USAGE_RESOURCE_TYPES,
  ResourceType,
  buildClausesFromSpec,
  invalidateInventoryCache,
  runRawQuery,
  toAppRow,
  toEnvironmentGroupRow,
  toEnvironmentRow,
  type AppRow,
  type DataResult,
  type EnvironmentGroupRow,
  type EnvironmentRow,
} from "../../data/inventory";
import { PowerPlatformforAdminsV2Service } from "../../generated";
import { formatApiError } from "../../shared/api-explorer/schema";
import { peekUser, resolveUsers } from "../../data/userEnrichment";
import type { Clause, Policy, ResourceItem } from "../../generated/models/PowerPlatformforAdminsV2Model";

export { getCacheVersion, subscribeCacheVersion, peekUser } from "../../data/userEnrichment";
export type { AppRow, DataResult, EnvironmentGroupRow, EnvironmentRow };

export function readCancelled(signal?: AbortSignal): DataResult<never> | undefined {
  return signal?.aborted ? { ok: false, error: "Read cancelled because the view or preview changed." } : undefined;
}

export interface ManagedApp extends AppRow {
  raw?: ResourceItem;
  origin: string;
  makerId: string;
  makerName: string;
  connectorIds: string[] | null;
}

export interface ManagedAppsInventory {
  apps: ManagedApp[];
  environments: EnvironmentRow[];
  groups: EnvironmentGroupRow[];
  excludedApps: number;
  environmentIssues?: Record<string, string>;
}

export interface BoardColumn {
  key: string;
  groupId?: string;
  name: string;
  description: string;
  apps: ManagedApp[];
}

export function groupPdeApps(apps: ManagedApp[]): Array<{ environmentId: string; apps: ManagedApp[] }> {
  const grouped = new Map<string, ManagedApp[]>();
  for (const app of apps) {
    const id = membershipId(app.environmentId);
    const siblings = grouped.get(id) ?? [];
    siblings.push(app);
    grouped.set(id, siblings);
  }
  return [...grouped].map(([environmentId, siblings]) => ({ environmentId, apps: siblings }));
}

export function membershipId(value: string): string {
  const id = value.trim().toLowerCase();
  return id === "00000000-0000-0000-0000-000000000000" ? "" : id;
}

export function pdeMoveBlocker(environment?: EnvironmentRow, issue?: string): string {
  if (!environment) return issue || "Environment details were not returned by inventory. Refresh inventory to check move eligibility.";
  if (environment.environmentType !== "Developer") return `Moves here require a Developer environment; inventory reports ${environment.environmentType || "an unavailable type"}.`;
  if (!environment.isManaged) return "Moves here require a managed Developer environment; inventory reports this environment is not managed.";
  return "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readEnvironmentGroupMembership(value: unknown): DataResult<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Environment membership fields were not returned as an object." };
  }
  const fields = object(value);
  const id = fields.environmentGroupId;
  if (id !== undefined && id !== null && typeof id !== "string") {
    return { ok: false, error: "environmentGroupId has an invalid type; expected an optional string." };
  }
  const groupId = typeof id === "string" ? membershipId(id) : "";
  if (!groupId && fields.environmentGroup !== undefined && fields.environmentGroup !== null && fields.environmentGroup !== "") {
    return { ok: false, error: "Environment group name/details conflict with an absent group ID." };
  }
  return { ok: true, data: groupId };
}

function readMembershipEnvironment(item: ResourceItem): DataResult<EnvironmentRow> {
  if (!item.name?.trim() || item.type?.toLowerCase() !== ResourceType.Environment.toLowerCase()
    || !item.properties || typeof item.properties !== "object" || Array.isArray(item.properties)) {
    return { ok: false, error: "A complete environment resource identity and properties object are required for membership." };
  }
  const props = object(item.properties);
  if (typeof props.environmentType !== "string" || typeof props.isManaged !== "boolean") {
    return { ok: false, error: "Environment resource omitted type or managed eligibility; membership is not verified." };
  }
  const membership = readEnvironmentGroupMembership(props);
  return membership.ok
    ? { ok: true, data: { ...toEnvironmentRow(item), environmentGroupId: membership.data } }
    : membership;
}

export function readManagedApp(item: Parameters<typeof toAppRow>[0]): ManagedApp {
  const row = toAppRow(item);
  const props = object(item.properties);
  const maker = object(props.createdBy);
  const owner = object(props.owner);
  return {
    ...row,
    raw: item,
    ownerDisplayName: text(props.ownerDisplayName) || text(owner.displayName) || text(owner.email),
    origin: text(props.origin).trim(),
    makerId: text(props.createdBy) || text(maker.id),
    makerName: text(maker.displayName) || text(maker.email),
    connectorIds: readAppConnectors(props.powerPlatformConnectors),
  };
}

export function readAppConnectors(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => !text(object(entry).connectorId).trim())) return null;
  return [...new Map(value.map((entry) => {
    const id = text(object(entry).connectorId).trim();
    return [id.toLowerCase(), id];
  })).values()];
}

export function matchesContext(app: ManagedApp, environment: EnvironmentRow | undefined, group: BoardColumn,
  search: string, fields: { app: string; environment: string; group: string }, people = personSearchText(app)): boolean {
  const appText = `${app.displayName} ${app.id} ${people} ${originLabel(app.origin)}`;
  const environmentText = `${app.environmentId} ${environment?.displayName ?? ""}`;
  const groupText = `${group.name} ${group.groupId ?? ""}`;
  const match = (haystack: string, needle: string) => needle.trim().toLowerCase().split(/\s+/).every((word) => haystack.toLowerCase().includes(word));
  return match(`${appText} ${environmentText} ${groupText}`, search)
    && match(`${app.displayName} ${app.id}`, fields.app)
    && match(environmentText, fields.environment) && match(groupText, fields.group);
}
export function originLabel(origin: string): string {
  return origin === "CopilotStudio" ? "Copilot Studio" : origin || "Origin unavailable";
}

export function personSearchText(app: ManagedApp): string {
  return [app.ownerId, app.ownerDisplayName, app.makerId, app.makerName]
    .flatMap((value) => {
      const entry = peekUser(value);
      return entry.status === "resolved"
        ? [value, entry.user.displayName, entry.user.upn]
        : [value];
    })
    .join(" ");
}

export function matchesApp(app: ManagedApp, search: string, origin: string, searchText?: string): boolean {
  if (origin !== "*" && app.origin !== origin) return false;
  const haystack = searchText ?? `${app.displayName} ${app.id} ${personSearchText(app)} ${originLabel(app.origin)}`.toLowerCase();
  return search.trim().toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

export function buildBoard(inventory: ManagedAppsInventory, includeEmptyGroups = false): BoardColumn[] {
  const environments = new Map(inventory.environments.map((env) => [membershipId(env.id), env]));
  const columns: BoardColumn[] = inventory.groups.map((group) => ({
    key: `group:${membershipId(group.id)}`,
    groupId: group.id,
    name: group.displayName || group.id,
    description: group.description,
    apps: [],
  }));
  const byGroup = new Map(columns.map((column) => [membershipId(column.groupId ?? ""), column]));
  for (const app of inventory.apps) {
    const env = environments.get(membershipId(app.environmentId));
    if (!env) {
      let unknown = byGroup.get("unresolved-pde");
      if (!unknown) {
        unknown = { key: "unresolved-pde", name: "Environment details unavailable", description: "Parent environment details are unavailable. Group membership is unknown, not empty or ungrouped. These apps remain counted; moves are disabled.", apps: [] };
        byGroup.set("unresolved-pde", unknown);
        columns.push(unknown);
      }
      unknown.apps.push(app);
      continue;
    }
    const groupId = membershipId(env?.environmentGroupId ?? "");
    let column = byGroup.get(groupId);
    if (!column) {
      column = {
        key: groupId ? `missing:${groupId}` : "ungrouped",
        name: groupId ? env?.environmentGroup || "Group details unavailable" : "No environment group",
        description: groupId
          ? `Membership references group ${groupId}, which was not returned by inventory. Policy data is unavailable.`
          : "No group is reported in this inventory snapshot. This does not mean connectors are unrestricted.",
        apps: [],
      };
      byGroup.set(groupId, column);
      columns.push(column);
    }
    column.apps.push(app);
  }
  return includeEmptyGroups ? columns : columns.filter((column) => column.apps.length > 0);
}

export async function loadManagedApps(refresh = false, signal?: AbortSignal): Promise<DataResult<ManagedAppsInventory>> {
  const cancelled = readCancelled(signal);
  if (cancelled) return cancelled;
  if (refresh) invalidateInventoryCache();
  const [envs, groups, result] = await Promise.all([
    drainInventory(buildClausesFromSpec({
      resourceTypes: [ResourceType.Environment],
      filters: [],
      orderField: "name", orderDirection: "asc", limit: 500,
    }), refresh, signal),
    drainInventory(buildClausesFromSpec({
      resourceTypes: [ResourceType.EnvironmentGroup], filters: [],
      orderField: "name", orderDirection: "asc", limit: 500,
    }), refresh, signal),
    drainInventory(buildClausesFromSpec({
      resourceTypes: [ResourceType.AppBuilderApp], filters: [{ field: "properties.subType", op: "==", value: MANAGED_APP_SUBTYPE }],
      orderField: "name", orderDirection: "asc", limit: 500,
    }), refresh, signal),
  ]);
  if (!envs.ok) return { ok: false, error: `PDE inventory: ${envs.error}` };
  if (!groups.ok) return { ok: false, error: `Environment groups: ${groups.error}` };
  if (!result.ok) return { ok: false, error: `Managed app inventory: ${result.error}` };
  const environmentReads = envs.data.map(readMembershipEnvironment);
  const environmentIssues = Object.fromEntries(environmentReads.flatMap((entry, index) => entry.ok ? [] : [[membershipId(envs.data[index].name ?? ""), entry.error]]));
  const environments = environmentReads.flatMap((entry) => entry.ok ? [entry.data] : []);
  const allApps = result.data.map(readManagedApp);
  const apps = allApps.filter(isManagedApp);
  if (apps.some((app) => !membershipId(app.environmentId))) {
    return { ok: false, error: "App inventory omitted an environment identifier. Refresh to retry; scope cannot be verified." };
  }
  return { ok: true, data: { apps, environments, environmentIssues, groups: groups.data.map(toEnvironmentGroupRow), excludedApps: allApps.length - apps.length } };
}

// Own one loader per mounted board, never a global account/tenant snapshot cache.
export function createBoardInventoryLoader(read = loadManagedApps): typeof loadManagedApps {
  type Flight = { controller: AbortController; result: ReturnType<typeof loadManagedApps>; subscribers: Set<symbol>; settled: boolean };
  let pending: Flight | undefined;
  return (refresh = false, signal?: AbortSignal) => {
    const cancelled = readCancelled(signal);
    if (cancelled) return Promise.resolve(cancelled);
    if (refresh || !pending || pending.controller.signal.aborted) {
      const controller = new AbortController();
      const flight: Flight = {
        controller, result: read(refresh, controller.signal), subscribers: new Set(), settled: false,
      };
      pending = flight;
      const release = () => { flight.settled = true; if (pending === flight) pending = undefined; };
      void flight.result.then(release, release);
    }
    const flight = pending;
    return new Promise((resolve, reject) => {
      const subscriber = Symbol();
      flight.subscribers.add(subscriber);
      const detach = () => {
        signal?.removeEventListener("abort", abort);
        flight.subscribers.delete(subscriber);
        // StrictMode may immediately reattach an active consumer after cleanup.
        queueMicrotask(() => {
          if (!flight.settled && !flight.subscribers.size) {
            flight.controller.abort();
            if (pending === flight) pending = undefined;
          }
        });
      };
      const abort = () => { detach(); resolve(readCancelled(signal)!); };
      signal?.addEventListener("abort", abort, { once: true });
      void flight.result.then(
        (result) => { detach(); resolve(readCancelled(signal) ?? result); },
        (error: unknown) => { detach(); if (signal?.aborted) resolve(readCancelled(signal)!); else reject(error); },
      );
    });
  };
}

async function drainInventory(clauses: Clause[], forceFresh = false, signal?: AbortSignal): Promise<DataResult<ResourceItem[]>> {
  const items: ResourceItem[] = [];
  const seen = new Map<string, string>();
  const tokens = new Set<string>();
  const ordered = clauses.map((clause) => clause.$type === "orderby"
    ? { $type: "orderby" as const, FieldNamesAscDesc: { name: "asc", "tostring(properties.environmentId)": "asc", type: "asc" } }
    : clause);
  let token = "";
  let skip = 0;
  for (;;) {
    const cancelled = readCancelled(signal);
    if (cancelled) return cancelled;
    const result = await runRawQuery(ordered, { Top: 500, Skip: skip, SkipToken: token }, { forceFresh });
    const cancelledAfterRead = readCancelled(signal);
    if (cancelledAfterRead) return cancelledAfterRead;
    if (!result.ok) return result;
    const page = result.data.rawItems ?? result.data.items;
    if (!Array.isArray(page)) return { ok: false, error: "Inventory response omitted its resource collection. Completeness cannot be verified." };
    let added = 0;
    for (const item of page) {
      if (!item.name?.trim() || !item.type?.trim()) return { ok: false, error: "Inventory omitted a resource identifier or type; scope cannot be verified." };
      const key = `${item.type}::${membershipId(text(object(item.properties).environmentId))}::${item.name}`;
      const snapshot = JSON.stringify(item);
      if (seen.has(key)) {
        if (seen.get(key) !== snapshot) return { ok: false, error: "Inventory changed across overlapping pages. Refresh to retry; a mixed snapshot is not displayed." };
        continue;
      }
      seen.set(key, snapshot);
      items.push(item);
      added++;
    }
    if (!result.data.skipToken) {
      if (result.data.resultTruncated === "0" || result.data.resultTruncated === "unknown") {
        return { ok: false, error: "Inventory reports truncated or unknown completion without a continuation token. Incomplete impact is not displayed." };
      }
      return { ok: true, data: items };
    }
    if (!added || tokens.has(result.data.skipToken)) return { ok: false, error: "Inventory pagination did not advance. Refresh to retry; incomplete counts are not displayed." };
    tokens.add(result.data.skipToken);
    skip += page.length;
    token = result.data.skipToken;
  }
}

export async function loadPdeApps(environmentId: string, forceFresh = false, signal?: AbortSignal): Promise<DataResult<AppRow[]>> {
  if (!membershipId(environmentId)) return { ok: false, error: "A PDE identity is required to read affected apps." };
  const result = await drainInventory(buildClausesFromSpec({
    resourceTypes: ALL_APP_TYPES,
    filters: [{ field: "properties.environmentId", op: "==", value: environmentId }],
    orderField: "properties.displayName", orderDirection: "asc", limit: 500,
  }), forceFresh, signal);
  return scopedResources(result, environmentId);
}

function scopedResources(result: DataResult<ResourceItem[]>, environmentId: string): DataResult<AppRow[]> {
  if (!result.ok) return result;
  if (result.data.some((item) => membershipId(text(object(item.properties).environmentId)) !== membershipId(environmentId))) {
    return { ok: false, error: "Inventory returned a resource outside the selected PDE. Impact scope could not be verified." };
  }
  return { ok: true, data: result.data.map(toAppRow) };
}

export async function loadPdeResources(environmentId: string, signal?: AbortSignal): Promise<DataResult<AppRow[]>> {
  if (!membershipId(environmentId)) return { ok: false, error: "A PDE identity is required to read affected resources." };
  const result = await drainInventory(buildClausesFromSpec({
    resourceTypes: CONNECTOR_USAGE_RESOURCE_TYPES,
    filters: [{ field: "properties.environmentId", op: "==", value: environmentId }],
    orderField: "properties.displayName", orderDirection: "asc", limit: 500,
  }), true, signal);
  return scopedResources(result, environmentId);
}

export async function loadPdeMemberships(ids: string[], signal?: AbortSignal): Promise<DataResult<EnvironmentRow[]>> {
  if (!ids.length || ids.some((id) => !membershipId(id))) return { ok: false, error: "PDE identities are required for a membership check." };
  const result = await drainInventory(buildClausesFromSpec({
    resourceTypes: [ResourceType.Environment],
    filters: [{ field: "name", op: "in~", value: ids.join(",") }],
    orderField: "name", orderDirection: "asc", limit: 500,
  }), true, signal);
  if (!result.ok) return result;
  const rows: EnvironmentRow[] = [];
  for (const item of result.data) {
    const parsed = readMembershipEnvironment(item);
    if (!parsed.ok) return parsed;
    rows.push(parsed.data);
  }
  return { ok: true, data: rows };
}

export async function loadEmptyGroupMembership(groupId: string): Promise<DataResult<boolean>> {
  if (!membershipId(groupId)) return { ok: false, error: "A returned group identity is required to verify empty membership." };
  const result = await drainInventory(buildClausesFromSpec({
    resourceTypes: [ResourceType.Environment],
    filters: [{ field: "properties.environmentGroupId", op: "==", value: groupId }],
    orderField: "name", orderDirection: "asc", limit: 500,
  }), true);
  if (!result.ok) return result;
  if (result.data.some((item) => membershipId(toEnvironmentRow(item).environmentGroupId) !== membershipId(groupId))) {
    return { ok: false, error: "Membership inventory returned environments outside the destination group." };
  }
  return { ok: true, data: result.data.length === 0 };
}

export async function loadRuleSyncGroups(signal?: AbortSignal): Promise<DataResult<EnvironmentGroupRow[]>> {
  const result = await drainInventory(buildClausesFromSpec({
    resourceTypes: [ResourceType.EnvironmentGroup], filters: [],
    orderField: "name", orderDirection: "asc", limit: 500,
  }), true, signal);
  if (!result.ok) return result;
  const rows = result.data.map(toEnvironmentGroupRow);
  if (rows.some((row) => !membershipId(row.id)) || new Set(rows.map((row) => membershipId(row.id))).size !== rows.length) {
    return { ok: false, error: "Group inventory has missing or duplicate identities. Sync targets are unavailable." };
  }
  return { ok: true, data: rows };
}

export async function loadRuleSyncEnvironments(groupId: string): Promise<DataResult<EnvironmentRow[]>> {
  if (!membershipId(groupId)) return { ok: false, error: "A group identity is required for sync impact." };
  const result = await drainInventory(buildClausesFromSpec({
    resourceTypes: [ResourceType.Environment],
    filters: [{ field: "properties.environmentGroupId", op: "==", value: groupId }],
    orderField: "name", orderDirection: "asc", limit: 500,
  }), true);
  if (!result.ok) return result;
  const rows: EnvironmentRow[] = [];
  for (const item of result.data) {
    const parsed = readMembershipEnvironment(item);
    if (!parsed.ok) return parsed;
    if (membershipId(parsed.data.environmentGroupId) !== membershipId(groupId)) {
      return { ok: false, error: "Sync impact returned an environment outside the selected group." };
    }
    rows.push(parsed.data);
  }
  if (new Set(rows.map((row) => membershipId(row.id))).size !== rows.length) {
    return { ok: false, error: "Sync impact has duplicate environment identities." };
  }
  return { ok: true, data: rows };
}

export async function loadPolicy(policyId: string): Promise<DataResult<Policy>> {
  try {
    const result = await PowerPlatformforAdminsV2Service.GetRuleBasedPolicyByID(policyId, "2024-10-01");
    if (!result.success) return { ok: false, error: formatApiError(result.error) };
    if (membershipId(result.data?.id ?? "") !== membershipId(policyId) || !Array.isArray(result.data?.ruleSets)
      || (result.data.ruleSetCount !== undefined && result.data.ruleSetCount !== result.data.ruleSets.length)
      || result.data.ruleSets.some((rule) => !rule.id?.trim() || !rule.version?.trim() || !rule.inputs || typeof rule.inputs !== "object" || Array.isArray(rule.inputs))) {
      return { ok: false, error: `Policy ${policyId} omitted or changed its identity, rule count, versions or inputs. Connector evidence is incomplete.` };
    }
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  }
}

export async function loadGroupPolicies(
  groupId: string, signal?: AbortSignal,
  readPolicy: (id: string) => Promise<DataResult<Policy>> = loadPolicy,
): Promise<DataResult<Policy[]>> {
  const cancelled = readCancelled(signal);
  if (cancelled) return cancelled;
  if (!membershipId(groupId)) return { ok: false, error: "Group identity is required to read policy assignments." };
  try {
    const result = await PowerPlatformforAdminsV2Service.ListRuleAssignmentsByEnvironmentGroupId(groupId, true, "2024-10-01");
    if (!result.success) return { ok: false, error: formatApiError(result.error) };
    const raw = object(result.data);
    if (raw["@odata.nextLink"] || raw.nextLink) {
      return { ok: false, error: "Policy assignments are paginated. This connector integration cannot read the remaining assignments; connector permissions are unavailable." };
    }
    if (!Array.isArray(result.data?.value)) return { ok: false, error: "Policy assignments omitted their collection. Connector evidence is unavailable." };
    const assignments = result.data.value;
    if (assignments.some((assignment) => !assignment.policyId?.trim()
      || membershipId(assignment.resourceId ?? "") !== membershipId(groupId) || assignment.resourceType !== "EnvironmentGroup")) {
      return { ok: false, error: "Policy assignment identity or group scope is incomplete. Connector evidence is unavailable." };
    }
    const policies: Policy[] = [];
    for (const id of new Set(assignments.map((assignment) => assignment.policyId!))) {
      const cancelledRead = readCancelled(signal);
      if (cancelledRead) return cancelledRead;
      const policy = await readPolicy(id);
      if (!policy.ok) return policy;
      if (assignments.some((assignment) => assignment.policyId === id && assignment.ruleSetCount !== undefined
        && assignment.ruleSetCount !== policy.data.ruleSets?.length)) {
        return { ok: false, error: `Policy ${id} changed between assignment and policy reads. Refresh to retry.` };
      }
      policies.push(policy.data);
    }
    return readCancelled(signal) ?? { ok: true, data: policies };
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  }
}

export async function resolveAppPeople(apps: ManagedApp[]): Promise<DataResult<void>> {
  try {
    await resolveUsers([...new Set(apps.flatMap((app) => [app.ownerId, app.makerId]).filter(Boolean))]);
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
