import { PowerPlatformforAdminsV2Service } from "../../generated";
import { readLivePdeMembership } from "./pdeMembership";
import {
  getEnvironmentGroupDetails,
} from "../../data/adminEnrichment";
import {
  ALL_APP_TYPES, friendlyConnectorName, normalizeConnectorId,
} from "../../data/inventory";
import { formatApiError } from "../../shared/api-explorer/schema";
import { getPortalActions } from "../../components/PortalActions";
import type {
  EnvironmentGroup, Policy, PolicyRequest, RuleSetDto,
} from "../../generated/models/PowerPlatformforAdminsV2Model";
import {
  loadGroupPolicies, loadManagedApps, loadPdeResources, loadPolicy, membershipId, pdeMoveBlocker, readCancelled,
  type AppRow, type DataResult, type EnvironmentGroupRow, type EnvironmentRow,
} from "./data";

const API_VERSION = "2024-10-01";

export interface GroupRules {
  matching: RuleSetDto[];
  unresolved: RuleSetDto[];
}

export interface GroupEvidence {
  groupId: string;
  capturedAt: number;
  details: DataResult<EnvironmentGroup>;
  rulesets: DataResult<GroupRules>;
  policies: DataResult<Policy[]>;
}

export interface RuleFact {
  field: string;
  value: string;
  identity: string;
}

export interface ConnectorDeclaration {
  policyId: string;
  ruleVersion: string;
  connectorId: string;
  actionsMode: string;
  actions: string[];
  connectionTypesMode: string;
}

export interface ConnectorEvidence {
  state: "allowed-configured" | "restricted-configured" | "not-listed" | "unknown";
  declarations: ConnectorDeclaration[];
}

export function connectorKey(id: string): string {
  return normalizeConnectorId(id.trim()).toLowerCase().replace(/^shared_/, "");
}

export function groupPortalUrl(groupId: string): string | undefined {
  return getPortalActions({ entityKind: "environmentGroup", entityId: groupId })
    .find((action) => action.kind === "ppac")?.url;
}

async function mapLimited<T, R>(values: T[], work: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await work(values[index]);
    }
  }));
  return results;
}

async function loadTenantRules(signal?: AbortSignal): Promise<DataResult<RuleSetDto[]>> {
  const rules: RuleSetDto[] = [];
  const ids = new Set<string>();
  const snapshots = new Map<string, string>();
  const tokens = new Set<string>();
  let token: string | undefined;
  try {
    for (;;) {
      const cancelled = readCancelled(signal);
      if (cancelled) return cancelled;
      const result = await PowerPlatformforAdminsV2Service.GetRuleSetListForTenant(
        API_VERSION, undefined, undefined, undefined, token, 100,
      );
      if (!result.success) return { ok: false, error: formatApiError(result.error) };
      const cancelledAfterRead = readCancelled(signal);
      if (cancelledAfterRead) return cancelledAfterRead;
      if (!Array.isArray(result.data?.value)) {
        return { ok: false, error: "Ruleset response omitted its collection. Group rules are unavailable." };
      }
      const previousCount = ids.size;
      for (const rule of result.data.value) {
        if (!rule.id) return { ok: false, error: "A ruleset omitted its identity. Group rules are unavailable." };
        const snapshot = JSON.stringify(rule);
        if (snapshots.has(rule.id) && snapshots.get(rule.id) !== snapshot) return { ok: false, error: "A ruleset changed across pages. Refresh to read complete group evidence." };
        snapshots.set(rule.id, snapshot);
        if (!ids.has(rule.id)) { ids.add(rule.id); rules.push(rule); }
      }
      const next = result.data["@odata.nextLink"];
      const raw = result.data as typeof result.data & { nextLink?: unknown; "@odata.count"?: unknown };
      if (raw["@odata.count"] !== undefined && (typeof raw["@odata.count"] !== "number" || !Number.isInteger(raw["@odata.count"]) || raw["@odata.count"] < 0)) {
        return { ok: false, error: "Ruleset response returned an invalid completion count. Group rules are incomplete." };
      }
      if (raw.nextLink && !next) return { ok: false, error: "Ruleset response returned an unsupported continuation. Group rules are incomplete." };
      if (!next) {
        if (typeof raw["@odata.count"] === "number" && raw["@odata.count"] > rules.length) return { ok: false, error: "Ruleset count exceeds the completed collection. Group rules are incomplete." };
        return { ok: true, data: rules };
      }
      if (ids.size === previousCount) {
        return { ok: false, error: "Ruleset pagination did not return new identities. Group rules are incomplete." };
      }
      const params = new URL(next, "https://pagination.invalid").searchParams;
      token = params.get("$skiptoken") ?? params.get("skiptoken") ?? undefined;
      if (!token || tokens.has(token)) {
        return { ok: false, error: "Ruleset pagination has an unsupported or repeated continuation token. Group rules are incomplete." };
      }
      tokens.add(token);
    }
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  }
}

export function rulesForGroup(rules: RuleSetDto[], groupId: string): GroupRules {
  const matching: RuleSetDto[] = [];
  const unresolved: RuleSetDto[] = [];
  for (const rule of rules) {
    const filter = rule.environmentFilter;
    const groupValues = filter?.values?.filter((value) => value.type === "EnvironmentGroup") ?? [];
    const mentionsGroup = groupValues.some((value) => membershipId(value.id ?? "") === membershipId(groupId));
    if (filter?.type === "Include" && Array.isArray(filter.values)) {
      if (mentionsGroup) matching.push(rule);
    } else if (filter?.type === "Exclude" && mentionsGroup) {
      continue;
    } else {
      unresolved.push(rule);
    }
  }
  return { matching, unresolved };
}

export async function loadGroupEvidenceBatch(groupIds: string[], signal?: AbortSignal): Promise<GroupEvidence[]> {
  const ids = [...new Set(groupIds.map(membershipId).filter(Boolean))];
  if (!ids.length) return [];
  const tenantRules = await loadTenantRules(signal);
  const policyReads = new Map<string, Promise<DataResult<Policy>>>();
  const readPolicy = (id: string) => {
    const key = membershipId(id);
    let result = policyReads.get(key);
    if (!result) { result = loadPolicy(id); policyReads.set(key, result); }
    return result;
  };
  return mapLimited(ids, async (groupId) => {
    const cancelled = readCancelled(signal);
    if (cancelled) return { groupId, capturedAt: Date.now(), details: cancelled, policies: cancelled, rulesets: cancelled };
    const [details, policies] = await Promise.all([
      getEnvironmentGroupDetails(groupId), loadGroupPolicies(groupId, signal, readPolicy),
    ]);
    return {
      groupId, capturedAt: Date.now(),
      details: details.ok && membershipId(details.data.data.id ?? "") === groupId
        ? { ok: true, data: details.data.data }
        : { ok: false, error: details.ok ? "Group response omitted or changed its identity." : details.error },
      policies,
      rulesets: tenantRules.ok
        ? { ok: true, data: rulesForGroup(tenantRules.data, groupId) }
        : tenantRules,
    };
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

const declarationCache = new WeakMap<GroupEvidence, DataResult<ConnectorDeclaration[]>>();

export function connectorDeclarations(evidence: GroupEvidence | undefined): DataResult<ConnectorDeclaration[]> {
  if (!evidence) return { ok: false, error: "Complete ACP policy evidence is unavailable." };
  let result = declarationCache.get(evidence);
  if (!result) { result = readConnectorDeclarations(evidence); declarationCache.set(evidence, result); }
  return result;
}

function readConnectorDeclarations(evidence: GroupEvidence): DataResult<ConnectorDeclaration[]> {
  if (!evidence.policies.ok) return { ok: false, error: "Complete ACP policy evidence is unavailable." };
  const declarations: ConnectorDeclaration[] = [];
  for (const policy of evidence.policies.data) {
    if (!policy.id || !Array.isArray(policy.ruleSets)) return { ok: false, error: "Policy identity or rules are unavailable." };
    for (const rule of policy.ruleSets) {
      if (rule.id !== "ConnectorManagement") continue;
      const list = rule.inputs?.AllowedConnectorList;
      if (!Array.isArray(list)) return { ok: false, error: "ConnectorManagement omitted a readable connector list." };
      for (const value of list) {
        const entry = record(value);
        if (!entry || typeof entry.AllowedConnector !== "string" || !entry.AllowedConnector.trim()) {
          return { ok: false, error: "An ACP connector declaration is malformed." };
        }
        const actions = entry.AllowedActions;
        if (actions !== undefined && (!Array.isArray(actions) || actions.some((action) => typeof action !== "string"))) {
          return { ok: false, error: "An ACP action list is malformed." };
        }
        declarations.push({
          policyId: policy.id ?? "", ruleVersion: rule.version ?? "",
          connectorId: connectorKey(entry.AllowedConnector),
          actionsMode: typeof entry.AllowedActionsMode === "string" ? entry.AllowedActionsMode : "",
          actions: Array.isArray(actions) ? actions : [],
          connectionTypesMode: typeof entry.AllowedConnectionTypesMode === "string" ? entry.AllowedConnectionTypesMode : "",
        });
      }
    }
  }
  return { ok: true, data: declarations };
}

export function connectorEvidence(evidence: GroupEvidence | undefined, id: string): ConnectorEvidence {
  const result = connectorDeclarations(evidence);
  if (!result.ok) return { state: "unknown", declarations: [] };
  const declarations = result.data.filter((entry) => entry.connectorId === connectorKey(id));
  if (!declarations.length) return { state: "not-listed", declarations };
  if (declarations.some((entry) => !entry.ruleVersion || entry.connectionTypesMode !== "AllAllowed"
    || !["AllAllowed", "SomeAllowed"].includes(entry.actionsMode)
    || (entry.actionsMode === "SomeAllowed" && !entry.actions.length))) {
    return { state: "unknown", declarations };
  }
  return {
    state: declarations.every((entry) => entry.actionsMode === "AllAllowed")
      ? "allowed-configured" : "restricted-configured",
    declarations,
  };
}

function scalarFacts(value: unknown, path: string, identity: string, facts: RuleFact[], depth = 0): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    facts.push({ field: path, value: String(value), identity });
  } else if (depth < 4 && record(value)) {
    for (const [key, child] of Object.entries(record(value)!)) {
      if (key !== "AllowedConnectorList") scalarFacts(child, `${path}.${key}`, identity, facts, depth + 1);
    }
  }
}

export function groupFacts(evidence: GroupEvidence | undefined): RuleFact[] {
  if (!evidence) return [];
  const facts: RuleFact[] = [];
  if (evidence.details.ok) {
    for (const field of ["displayName", "description", "parentGroupId"] as const) {
      const value = evidence.details.data[field];
      if (value !== undefined) facts.push({ field: `Group.${field}`, value, identity: evidence.groupId });
    }
  }
  if (evidence.policies.ok) {
    for (const policy of evidence.policies.data) {
      for (const rule of policy.ruleSets ?? []) {
        if (!rule.id) continue;
        const identity = `Policy ${policy.id} / ${rule.id} v${rule.version ?? "unknown"}`;
        if (rule.version) facts.push({ field: `ModelB.${rule.id}.version`, value: rule.version, identity });
        scalarFacts(rule.inputs, `ModelB.${rule.id}.inputs`, identity, facts);
      }
    }
  }
  if (evidence.rulesets.ok) {
    for (const ruleset of evidence.rulesets.data.matching) {
      for (const bucket of ruleset.parameters ?? []) {
        for (const rule of bucket.value ?? []) {
          if (rule.id && rule.value !== undefined) {
            facts.push({ field: `ModelA.${bucket.type}.${bucket.resourceType}.${rule.id}`, value: rule.value, identity: `Ruleset ${ruleset.id}` });
          }
        }
      }
    }
  }
  return facts;
}

export interface GroupFilter {
  search: string;
  connectors: string[];
  connectorMode: "all" | "any";
  field: string;
  value: string;
}

export function matchesGroup(group: { name: string; description: string }, evidence: GroupEvidence | undefined, filter: GroupFilter): boolean {
  if (!`${group.name} ${group.description}`.toLowerCase().includes(filter.search.trim().toLowerCase())) return false;
  const connectors = [...new Set(filter.connectors.map(connectorKey).filter(Boolean))];
  if (connectors.length) {
    const match = (connector: string) => {
      const state = connectorEvidence(evidence, connector).state;
      return state === "allowed-configured" || state === "restricted-configured";
    };
    if (!(filter.connectorMode === "all" ? connectors.every(match) : connectors.some(match))) return false;
  }
  if (filter.field && !groupFacts(evidence).some((fact) => fact.field === filter.field && fact.value === filter.value)) return false;
  return true;
}

export interface CopyAssessment {
  group: Pick<EnvironmentGroup, "displayName" | "description">;
  independentPolicies: Array<{ sourcePolicyId: string; isAcp: boolean; request: PolicyRequest }>;
  supported: string[];
  limitations: string[];
}

export function assessGroupCopy(evidence: GroupEvidence, name: string): CopyAssessment {
  const limitations = [
    "Live creation is gated on verified source draft/published selection, destination publication, storage fidelity and ambiguous-write recovery. Reads do not establish write authorization.",
    "Environment membership, existing policy IDs, source permissions and environment-specific settings will not be copied.",
  ];
  const independentPolicies: CopyAssessment["independentPolicies"] = [];
  const supported = ["Create a newly named empty group with the source description using CreateEnvironmentGroup."];
  if (!name.trim()) limitations.push("A new group name is required.");
  if (!evidence.details.ok) limitations.push(`Source properties unavailable: ${evidence.details.error}`);
  if (!evidence.policies.ok) limitations.push(`Source ACP / policies unavailable: ${evidence.policies.error}`);
  else {
    if (evidence.policies.data.length !== 1) limitations.push("Exactly one assigned policy is supported. Multiple policies must not be unioned or copied by position.");
    for (const policy of evidence.policies.data) {
      independentPolicies.push({
        sourcePolicyId: policy.id ?? "",
        isAcp: !!policy.ruleSets?.some((rule) => rule.id === "ConnectorManagement"),
        request: { name: `${name.trim()} - ${policy.name || policy.id}`, ruleSets: structuredClone(policy.ruleSets) },
      });
      if (policy.ruleSets?.some((rule) => !rule.id || !rule.version || !record(rule.inputs))) {
        limitations.push(`Policy ${policy.id} has incomplete rule identity/version/inputs; exact cloning cannot be verified.`);
      }
    }
  }
  if (!independentPolicies.some((policy) => policy.isAcp)) limitations.push("No readable source ACP is available for an independent ACP copy.");
  else supported.push("Create independent Model B policies (including ACP), preserve rule versions/inputs, and attach only newly returned policy IDs to the new group.");
  if (!evidence.rulesets.ok) limitations.push(`Model A settings unavailable: ${evidence.rulesets.error}`);
  else {
    for (const rule of evidence.rulesets.data.matching) {
      const settings = rule.parameters?.flatMap((bucket) => (bucket.value ?? []).map((item) => `${bucket.type}/${bucket.resourceType}/${item.id}`)) ?? [];
      supported.push(`Model A group-only CreateRuleSet is registered; preserve string settings and setting IDs for ${rule.id}: ${settings.join(", ") || "settings unavailable"}. Use a fresh resource ID and destination-only Include scope.`);
      limitations.push(`Model A ${rule.id}: fresh resource identity, cardinality and authoritative stored/published fidelity need verification for ${settings.join(", ") || "settings unavailable"}.`);
    }
    if (evidence.rulesets.data.unresolved.length) limitations.push("Additional rulesets have unresolved applicability; an exact group copy cannot be asserted.");
  }
  return {
    group: { displayName: name.trim(), description: evidence.details.ok ? evidence.details.data.description : undefined },
    independentPolicies, supported, limitations,
  };
}

export interface MoveSelection {
  environmentId: string;
  appId?: string;
}

export interface ConnectorChange {
  id: string;
  name: string;
  operations: string[];
  source: ConnectorEvidence;
  destination: ConnectorEvidence;
}

export interface PdeMovePreview {
  environmentId: string;
  status: "prepared" | "already-member" | "error";
  error?: string;
  environment?: EnvironmentRow;
  apps: AppRow[];
  resources?: AppRow[];
  resourceCount: number;
  connectors: ConnectorChange[];
  sourceEvidence?: GroupEvidence;
  destinationEvidence?: GroupEvidence;
}

export interface MovePreview {
  preparedAt: number;
  destination: EnvironmentGroupRow;
  pdes: PdeMovePreview[];
}

export async function preparePdeMoves(selection: MoveSelection[], destinationId: string, signal?: AbortSignal): Promise<DataResult<MovePreview>> {
  if (!selection.length) return { ok: false, error: "Select at least one app or PDE to prepare a move." };
  if (selection.some((item) => !membershipId(item.environmentId))) return { ok: false, error: "A selected app omitted its PDE identity. No partial selection was prepared." };
  const inventory = await loadManagedApps(true, signal);
  if (!inventory.ok) return inventory;
  const destination = inventory.data.groups.find((group) => membershipId(group.id) === membershipId(destinationId));
  if (!destination) return { ok: false, error: "The destination group was not returned by fresh inventory. No move was prepared." };
  const ids = [...new Set(selection.map((item) => membershipId(item.environmentId)).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "Selected apps omitted their PDE identities. No move was prepared." };
  const environments = new Map(inventory.data.environments.map((environment) => [membershipId(environment.id), environment]));
  const appsByEnvironment = new Map<string, Map<string, AppRow>>();
  for (const app of inventory.data.apps) {
    const id = membershipId(app.environmentId);
    const apps = appsByEnvironment.get(id) ?? new Map<string, AppRow>();
    apps.set(app.id, app);
    appsByEnvironment.set(id, apps);
  }
  const selectionByEnvironment = new Map<string, string[]>();
  for (const item of selection) {
    const id = membershipId(item.environmentId);
    const selected = selectionByEnvironment.get(id) ?? [];
    if (item.appId) selected.push(item.appId);
    selectionByEnvironment.set(id, selected);
  }
  const pdes = await mapLimited(ids, async (environmentId): Promise<PdeMovePreview> => {
    const environment = environments.get(environmentId);
    const base = { environmentId, apps: [], resourceCount: 0, connectors: [] };
    const eligibilityIssue = pdeMoveBlocker(environment, inventory.data.environmentIssues?.[environmentId]);
    if (!environment || eligibilityIssue) return { ...base, status: "error", error: eligibilityIssue };
    const expectedApps = appsByEnvironment.get(environmentId);
    const missingSelection = selectionByEnvironment.get(environmentId)?.some((id) => !expectedApps?.has(id));
    if (missingSelection) return { ...base, environment, status: "error", error: "A selected app changed or disappeared from fresh inventory. Reselect it before preparing a move." };
    const resources = await loadPdeResources(environment.id, signal);
    if (!resources.ok) return { ...base, environment, status: "error", error: resources.error };
    const resourceKeys = new Set(resources.data.map((resource) => `${resource.type}::${resource.id}`));
    if ([...(expectedApps?.values() ?? [])].some((app) => !resourceKeys.has(`${app.type}::${app.id}`))
      || resources.data.some((resource) => membershipId(resource.environmentId) !== environmentId)) {
      return { ...base, environment, status: "error", error: "PDE apps changed between inventory and impact reads. Refresh and prepare again." };
    }
    return {
      ...base, environment,
      status: membershipId(environment.environmentGroupId) === membershipId(destination.id) ? "already-member" : "prepared",
      apps: resources.data.filter((resource) => ALL_APP_TYPES.some((type) => type === resource.type)),
      resources: resources.data,
      resourceCount: resources.data.length,
      connectors: observedConnectors(resources.data),
    };
  });
  const cancelled = readCancelled(signal);
  if (cancelled) return cancelled;
  const valid = pdes.filter((pde) => pde.status !== "error");
  if (valid.length) {
    await mapLimited(valid, async (pde) => {
      const membership = await readLivePdeMembership(pde.environmentId, signal);
      if (!membership.ok || !membership.data.hasDataverse) {
        pde.status = "error";
        pde.error = membership.ok ? "A Dataverse-backed PDE is required." : `Final membership check failed: ${membership.error}`;
        pde.apps = [];
        pde.resourceCount = 0;
        pde.connectors = [];
      } else {
        const groupId = membership.data.groupId;
        pde.environment = { ...pde.environment!, environmentGroupId: groupId,
          environmentGroup: inventory.data.groups.find((group) => membershipId(group.id) === groupId)?.displayName || groupId };
        pde.status = groupId === membershipId(destination.id) ? "already-member" : "prepared";
      }
    });
  }
  const ready = pdes.filter((pde) => pde.status !== "error");
  const evidence = await loadGroupEvidenceBatch(ready.length ? [
    destination.id, ...ready.map((pde) => pde.environment!.environmentGroupId),
  ] : [], signal);
  const evidenceById = new Map(evidence.map((entry) => [membershipId(entry.groupId), entry]));
  for (const pde of ready) {
    const sourceEvidence = evidenceById.get(membershipId(pde.environment!.environmentGroupId));
    const destinationEvidence = evidenceById.get(membershipId(destination.id));
    pde.sourceEvidence = sourceEvidence;
    pde.destinationEvidence = destinationEvidence;
    const changes = new Map(pde.connectors.map((connector) => [connector.id, connector]));
    for (const groupEvidence of [sourceEvidence, destinationEvidence]) {
      const declared = connectorDeclarations(groupEvidence);
      if (declared.ok) {
        for (const entry of declared.data) {
          if (!changes.has(entry.connectorId)) changes.set(entry.connectorId, {
            id: entry.connectorId, name: friendlyConnectorName(entry.connectorId), operations: [],
            source: { state: "unknown", declarations: [] }, destination: { state: "unknown", declarations: [] },
          });
        }
      }
    }
    pde.connectors = [...changes.values()].map((connector) => ({
      ...connector, source: connectorEvidence(sourceEvidence, connector.id), destination: connectorEvidence(destinationEvidence, connector.id),
    }));
  }
  return readCancelled(signal) ?? { ok: true, data: { preparedAt: Date.now(), destination, pdes } };
}

function observedConnectors(resources: AppRow[]): ConnectorChange[] {
    const used = new Map<string, Set<string>>();
    for (const resource of resources) {
      for (const connector of resource.connectors) {
        const id = connectorKey(connector.connectorId);
        const operations = used.get(id) ?? new Set<string>();
        connector.operations.forEach((operation) => operations.add(operation.operationId));
        used.set(id, operations);
      }
    }
    return [...used].map(([id, operations]) => ({
        id, name: friendlyConnectorName(id), operations: [...operations].sort(),
        source: { state: "unknown", declarations: [] }, destination: { state: "unknown", declarations: [] },
      }));
}
