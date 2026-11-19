import type { EnvironmentGroup, Policy, PolicyRequest, RuleAssignment, RuleSetDto } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { membershipId, type DataResult } from "./data";
import { groupPortalUrl } from "./governance";

export type PublicationState = "applied" | "published" | "draft" | "unknown";
export interface CloneSnapshot {
  group: EnvironmentGroup;
  rules: RuleSetDto[];
  assignments: RuleAssignment[];
  policy: Policy;
  publication: PublicationState;
  publicationEvidence: string;
  blockers: string[];
}

export interface ClonePlan {
  sourceId: string;
  sourcePolicyId: string;
  sourceRuleIds: string[];
  sourceFingerprint: string;
  preparedAt: number;
  group: Pick<EnvironmentGroup, "displayName" | "description">;
  rules: Array<{ sourceId: string; added?: true; parameters: RuleSetDto["parameters"] }>;
  policy: PolicyRequest;
  publication: PublicationState;
  copied: Array<{ identity: string; path: string; value: unknown }>;
  unsupported?: Array<{ path: string; value: unknown }>;
  skipped?: CloneOmission[];
  skippedEvidence?: Array<{ path: string; value: unknown }>;
  independentRules?: IndependentRule[];
  connectionTypeModes?: { omitted: number; total: number };
  trialRules?: GroupRuleTrial[];
  managedAppSharing?: {
    present: boolean;
    values: ManagedAppSharingValues;
    configurable: boolean;
    requested?: ManagedAppSharingValues;
  };
  blockers: string[];
}

export interface GroupRuleTrial {
  sourceRuleId: string;
  bucket: "Sharing/MicrosoftApp";
  sourceManagedBy?: "IT";
}

export const GROUP_RULE_TRIAL_NOTICE = "Managed app sharing was returned successfully for the reported configuration. Other values and service variants still require exact destination verification; source management and future managed updates are not copied.";

export const MANAGED_APP_SHARING_FIELDS = [
  { id: "MaximumShareLimit", label: "Maximum share limit" },
  { id: "IsGroupSharingDisabled", label: "Disable group sharing" },
  { id: "IsGuestSharingDisabled", label: "Disable guest sharing" },
  { id: "IsViralSharingDisabled", label: "Disable viral sharing" },
] as const;
export type ManagedAppSharingValues = Partial<Record<typeof MANAGED_APP_SHARING_FIELDS[number]["id"], string>>;

export function managedAppSharingErrors(values: ManagedAppSharingValues, adding: boolean): string[] {
  const errors: string[] = [];
  if (!jsonObject(values) || Object.keys(values).some((key) => !MANAGED_APP_SHARING_FIELDS.some((field) => field.id === key))) {
    return ["Managed app sharing contains unknown properties."];
  }
  for (const { id, label } of MANAGED_APP_SHARING_FIELDS) {
    const value = values[id];
    if (value === undefined) {
      if (adding) errors.push(`${label} is required when adding managed app sharing.`);
    } else if (typeof value !== "string" || (id === "MaximumShareLimit"
      ? !/^(?:-1|0|[1-9]\d*)$/.test(value) : !["true", "false"].includes(value))) {
      errors.push(id === "MaximumShareLimit" ? `${label} must be -1 or a non-negative whole number.` : `${label} must be true or false.`);
    }
  }
  return errors;
}

export interface IndependentRule {
  id: string;
  sourceManagedBy: "Microsoft" | "IT";
}

export const INDEPENDENT_RULE_NOTICE = "Copied as independently managed settings. Source management attribution and future source-managed updates are not carried over.";
const independentRuleContracts = new Map<string, { version: string; managers: IndependentRule["sourceManagedBy"][] }>([
  ["MicrosoftAppsContentSecurityPolicy", { version: "1.0", managers: ["Microsoft", "IT"] }],
  ["MicrosoftAppsAppCreationFromCLI", { version: "1.0", managers: ["Microsoft"] }],
  ["ConnectorManagement", { version: "1.0", managers: ["IT"] }],
  ["ManagedAppsAssetProfile", { version: "1.0", managers: ["Microsoft"] }],
]);

function independentManager(rule: { id?: string; version?: string }): IndependentRule["sourceManagedBy"] | undefined {
  const contract = independentRuleContracts.get(rule.id ?? "");
  const manager = "managedBy" in rule ? rule.managedBy : undefined;
  return contract !== undefined && contract.version === rule.version && (manager === "Microsoft" || manager === "IT")
    && contract.managers.includes(manager) ? manager : undefined;
}

export interface CloneOmission {
  kind: "group-rule" | "policy-module";
  id: string;
  reasons: string[];
}

export function jsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Object key order is immaterial; array ordering and every input value are retained.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (jsonObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sourceIdentity(snapshot: CloneSnapshot): unknown {
  return {
    group: snapshot.group, rules: snapshot.rules, assignments: snapshot.assignments,
    policy: snapshot.policy, publication: snapshot.publication,
    publicationEvidence: snapshot.publicationEvidence, blockers: snapshot.blockers,
  };
}

const groupMetadata = new Set(["id", "displayName", "description", "parentGroupId", "childrenGroupIds", "createdTime", "createdBy", "lastModifiedTime", "lastModifiedBy"]);
const policyFields = new Set(["id", "tenantId", "name", "lastModified", "lastModifiedOffset", "ruleSets", "ruleSetCount"]);

function validResponseTimestamp(value: object): boolean {
  if (!("lastModifiedDate" in value)) return true;
  return typeof value.lastModifiedDate === "string" && Number.isFinite(Date.parse(value.lastModifiedDate));
}

function storedSettings(values: object[] | undefined): unknown {
  return values?.map((value) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "lastModifiedDate")));
}

function sameSettings(actual: object[] | undefined, expected: object[] | undefined): boolean {
  return !!actual?.every(validResponseTimestamp) && canonical(storedSettings(actual)) === canonical(storedSettings(expected));
}

function inputReferences(value: unknown, identities: string[]): boolean {
  if (typeof value === "string") return identities.some((id) => id && value.toLowerCase().includes(id.toLowerCase()));
  if (Array.isArray(value)) return value.some((entry) => inputReferences(entry, identities));
  return jsonObject(value) && Object.entries(value).some(([key, entry]) => inputReferences(key, identities) || inputReferences(entry, identities));
}

function validJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validJson);
  return jsonObject(value) && Object.values(value).every(validJson);
}

export async function planGroupClone(snapshot: CloneSnapshot, name: string, description = snapshot.group.description, now = Date.now(),
  options: { preserveExistingReferences?: boolean; purpose?: "duplication" | "selective-sync"; managedAppSharing?: ManagedAppSharingValues } = {}): Promise<ClonePlan> {
  const blockers = [...snapshot.blockers];
  const sourceId = snapshot.group.id ?? "";
  const sourcePolicyId = snapshot.policy.id ?? "";
  const sourceRuleIds = snapshot.rules.map((rule) => rule.id ?? "");
  const copied: ClonePlan["copied"] = [];
  const unsupported: NonNullable<ClonePlan["unsupported"]> = [];
  const skipped: CloneOmission[] = [];
  const skippedEvidence: NonNullable<ClonePlan["skippedEvidence"]> = [];
  const independentRules: IndependentRule[] = [];
  const trialRules: GroupRuleTrial[] = [];
  let connectionTypeModes: ClonePlan["connectionTypeModes"];
  const checkFields = (value: object, allowed: Set<string>, path: string, omissionReasons?: string[]) => {
    for (const [key, entry] of Object.entries(value)) {
      if (allowed.has(key)) continue;
      unsupported.push({ path: `${path}.${key}`, value: structuredClone(entry) });
      if (inputReferences({ [key]: entry }, [sourceId, sourcePolicyId, ...sourceRuleIds])) {
        blockers.push(`${path}.${key} references source-owned resources without a verified remapping contract.`);
      }
      if (key === "hasStagedChanges") blockers.push(`${path}.hasStagedChanges makes applied source state ambiguous.`);
      const reason = omissionReasons ? `Unsupported field: ${key}. The whole rule is omitted, not just this field.`
        : `${path}.${key} has no supported independent-copy mapping.`;
      (omissionReasons ?? blockers).push(reason);
    }
  };
  const checkTimestamp = (value: object, path: string) => {
    if (!validResponseTimestamp(value)) blockers.push(`${path}.lastModifiedDate is not a valid response timestamp.`);
  };
  const destinationName = name.trim();
  if (!sourceId || !membershipId(sourceId)) blockers.push("Source group identity is missing.");
  if (!destinationName) blockers.push("A user-selected new group name is required.");
  if (!sourcePolicyId || !Array.isArray(snapshot.policy.ruleSets)) blockers.push("Source policy identity or rule collection is missing.");
  checkFields(snapshot.policy, policyFields, "Policy");
  const offset = (snapshot.policy as Record<string, unknown>).lastModifiedOffset;
  if (offset !== undefined && (typeof offset !== "string" || !Number.isFinite(Date.parse(offset)))) {
    blockers.push("Policy.lastModifiedOffset is not a valid response timestamp.");
  }
  if (snapshot.publication === "unknown" || !snapshot.publicationEvidence) {
    blockers.push("Applied source state couldn't be verified; returned settings may be an unpublished draft. Read a fresh supported source before copying.");
  }
  if (snapshot.assignments.length !== 1 || snapshot.assignments.some((assignment) =>
    membershipId(assignment.resourceId ?? "") !== membershipId(sourceId)
    || assignment.resourceType !== "EnvironmentGroup"
    || membershipId(assignment.policyId ?? "") !== membershipId(sourcePolicyId))) {
    blockers.push("Exactly one unambiguous whole-group policy assignment is required; policies cannot be unioned or selected by position.");
  }
  for (const assignment of snapshot.assignments) {
    const raw = assignment as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["policyId", "resourceId", "resourceType", "tenantId", "ruleSetCount"].includes(key))) {
      blockers.push("Assignment has additional settings or overrides with no verified lossless whole-group copy mapping.");
    }
    if (assignment.ruleSetCount !== undefined && assignment.ruleSetCount !== snapshot.policy.ruleSets?.length) {
      blockers.push("Assignment and policy rule counts differ; the source changed or is incomplete.");
    }
  }
  for (const key of Object.keys(snapshot.group)) {
    if (!groupMetadata.has(key)) {
      unsupported.push({ path: `Group.${key}`, value: structuredClone((snapshot.group as Record<string, unknown>)[key]) });
      blockers.push(`Group.${key} has no verified create mapping.`);
    }
  }
  if (snapshot.group.parentGroupId || snapshot.group.childrenGroupIds?.length) {
    blockers.push("Source group has parent/child hierarchy. Hierarchy is not copied and inherited rule fidelity has no verified independent-group mapping.");
  }
  const moduleIds = new Set<string>();
  const rules: ClonePlan["rules"] = snapshot.rules.flatMap((rule) => {
    const omissionReasons: string[] = [];
    const settings: ClonePlan["copied"] = [];
    const ruleTrials: GroupRuleTrial[] = [];
    if (!rule.id || !Array.isArray(rule.parameters)) blockers.push(`Model A ${rule.id || "(missing ID)"} omitted identity or parameters.`);
    const filter = rule.environmentFilter;
    if (filter?.type !== "Include" || !Array.isArray(filter.values)
      || !filter.values.some((value) => value.type === "EnvironmentGroup" && membershipId(value.id ?? "") === membershipId(sourceId))) {
      blockers.push(`Model A ${rule.id} has ambiguous source applicability.`);
    }
    if (filter && (Object.keys(filter).some((key) => !["type", "values"].includes(key))
      || filter.values?.some((value) => !value.id || !["EnvironmentGroup", "Environment"].includes(value.type ?? "")
        || Object.keys(value).some((key) => !["id", "type"].includes(key))))) {
      blockers.push(`Model A ${rule.id} has unsupported source scope/override fields.`);
    }
    checkFields(rule, new Set(["id", "lastModified", "parameters", "environmentFilter"]), `GroupRules.${rule.id}`, omissionReasons);
    const buckets = new Set<string>();
    for (const bucket of rule.parameters ?? []) {
      const bucketKey = `${bucket.type}/${bucket.resourceType}`;
      if (!bucket.type || !bucket.resourceType || !Array.isArray(bucket.value) || buckets.has(bucketKey)) {
        blockers.push(`GroupRules.${rule.id}/${bucketKey} has missing values or a duplicate bucket.`);
      }
      const trial = options.purpose !== "selective-sync" && bucketKey === "Sharing/MicrosoftApp"
        && (!("managedBy" in bucket) || bucket.managedBy === "IT");
      checkFields(bucket, new Set(["type", "resourceType", "value", "lastModifiedDate", ...(trial ? ["managedBy"] : [])]), `GroupRules.${rule.id}/${bucketKey}`, omissionReasons);
      if (bucketKey === "Sharing/MicrosoftApp" && !trial) {
        omissionReasons.push("Sharing/MicrosoftApp is enabled only for confirmed independent duplication with source managedBy IT or no attribution. Other shapes and selective sync remain unsupported; the whole resource is omitted.");
      }
      if (trial) ruleTrials.push({ sourceRuleId: rule.id ?? "", bucket: "Sharing/MicrosoftApp", ...("managedBy" in bucket ? { sourceManagedBy: "IT" as const } : {}) });
      checkTimestamp(bucket, `GroupRules.${rule.id}/${bucketKey}`);
      buckets.add(bucketKey);
      const settingIds = new Set<string>();
      for (const setting of bucket.value ?? []) {
        const path = `ModelA.${bucketKey}/${setting.id}`;
        settings.push({ identity: rule.id ?? "", path, value: setting.value });
        if (!setting.id || typeof setting.value !== "string" || settingIds.has(setting.id)) {
          blockers.push(`${path} cannot be copied losslessly: missing/duplicate identity or non-string value.`);
        }
        checkFields(setting, new Set(["id", "value"]), path, omissionReasons);
        settingIds.add(setting.id ?? "");
        if (!options.preserveExistingReferences && inputReferences(setting.value, [sourceId, sourcePolicyId, ...sourceRuleIds])) {
          blockers.push(`${path} references source-owned resources without a verified remapping contract.`);
        }
      }
    }
    if (omissionReasons.length) {
      skipped.push({ kind: "group-rule", id: rule.id ?? "", reasons: omissionReasons });
      skippedEvidence.push({ path: `GroupRules.${rule.id}`, value: structuredClone(rule) });
      return [];
    }
    copied.push(...settings);
    trialRules.push(...ruleTrials);
    return [{
      sourceId: rule.id ?? "",
      parameters: rule.parameters?.map(({ type, resourceType, value }) => ({ type, resourceType, value: structuredClone(value) })),
    }];
  });
  const sourceSharing = snapshot.rules.flatMap((rule) => rule.parameters ?? [])
    .filter((bucket) => bucket.type === "Sharing" && bucket.resourceType === "MicrosoftApp");
  const sharingValues: ManagedAppSharingValues = {};
  for (const { id } of MANAGED_APP_SHARING_FIELDS) {
    const value = sourceSharing[0]?.value?.find((setting) => setting.id === id)?.value;
    if (value !== undefined) sharingValues[id] = value;
  }
  const managedAppSharing: NonNullable<ClonePlan["managedAppSharing"]> = {
    present: sourceSharing.length > 0, values: sharingValues,
    configurable: snapshot.rules.length <= 1 && sourceSharing.length <= 1 && rules.length === snapshot.rules.length,
  };
  if (options.managedAppSharing !== undefined) {
    managedAppSharing.requested = structuredClone(options.managedAppSharing);
    const errors = managedAppSharingErrors(options.managedAppSharing, !managedAppSharing.present);
    if (options.purpose === "selective-sync") errors.push("Managed app sharing customization is available only during duplication.");
    if (!managedAppSharing.configurable) errors.push("Managed app sharing cannot be customized: source group rules are omitted, duplicated or have ambiguous resource identity.");
    if (!Object.keys(options.managedAppSharing).length) errors.push("Choose at least one managed app sharing setting before reviewing customization.");
    blockers.push(...errors);
    if (!errors.length) {
      let resource: ClonePlan["rules"][number] | undefined = rules[0];
      if (!resource) {
        // A client-only plan key, not a claimed source or returned resource identity.
        resource = { sourceId: "new:managed-app-sharing", added: true, parameters: [] };
        rules.push(resource);
      }
      let bucket = resource.parameters!.find((entry) => entry.type === "Sharing" && entry.resourceType === "MicrosoftApp");
      if (!bucket) {
        bucket = { type: "Sharing", resourceType: "MicrosoftApp", value: [] };
        resource.parameters!.push(bucket);
      }
      for (const { id } of MANAGED_APP_SHARING_FIELDS) {
        const value = options.managedAppSharing[id];
        if (value === undefined) continue;
        const setting = bucket.value!.find((entry) => entry.id === id);
        if (setting) setting.value = value;
        else bucket.value!.push({ id, value });
        const path = `ModelA.Sharing/MicrosoftApp/${id}`;
        const reviewed = copied.find((entry) => entry.identity === resource.sourceId && entry.path === path);
        if (reviewed) reviewed.value = value;
        else copied.push({ identity: resource.sourceId, path, value });
      }
      if (!trialRules.some((entry) => entry.sourceRuleId === resource.sourceId)) {
        trialRules.push({ sourceRuleId: resource.sourceId, bucket: "Sharing/MicrosoftApp" });
      }
    }
  }
  if (new Set(sourceRuleIds.map(membershipId)).size !== sourceRuleIds.length) blockers.push("Duplicate Model A resource identities were returned.");
  const policyRules: NonNullable<PolicyRequest["ruleSets"]> = [];
  for (const rule of snapshot.policy.ruleSets ?? []) {
    const omissionReasons: string[] = [];
    const manager = options.purpose !== "selective-sync" ? independentManager(rule) : undefined;
    if (!rule.id || !rule.version || !jsonObject(rule.inputs) || !validJson(rule.inputs) || moduleIds.has(rule.id)) {
      blockers.push(`Model B ${rule.id || "(missing module)"} has missing/duplicate identity, version or unsupported inputs.`);
    }
    checkFields(rule, new Set(["id", "version", "inputs", "lastModifiedDate", ...(manager ? ["managedBy"] : [])]), `PolicyRules.${rule.id}`,
      rule.id === "ConnectorManagement" ? undefined : omissionReasons);
    checkTimestamp(rule, `PolicyRules.${rule.id}`);
    moduleIds.add(rule.id ?? "");
    if (!options.preserveExistingReferences && inputReferences(rule.inputs, [sourceId, sourcePolicyId, ...sourceRuleIds])) {
      blockers.push(`Model B ${rule.id} references source-owned resources without a verified remapping contract.`);
    }
    if (rule.id === "ConnectorManagement") {
      const connectors = rule.inputs?.AllowedConnectorList;
      const ids = new Set<string>();
      if (!Array.isArray(connectors)) blockers.push("ACP connector collection is missing.");
      else {
        const omitted = connectors.filter((connector) => jsonObject(connector) && !Object.hasOwn(connector, "AllowedConnectionTypesMode")).length;
        if (omitted) connectionTypeModes = { omitted, total: connectors.length };
        for (const connector of connectors) {
          const omittedConnectionMode = options.purpose !== "selective-sync" && jsonObject(connector)
            && !Object.hasOwn(connector, "AllowedConnectionTypesMode") && !Object.hasOwn(connector, "AllowedConnectionTypes");
          if (jsonObject(connector) && !Object.hasOwn(connector, "AllowedConnectionTypesMode") && Object.hasOwn(connector, "AllowedConnectionTypes")) {
            blockers.push("ACP has AllowedConnectionTypes without AllowedConnectionTypesMode; the restriction semantics are ambiguous. No mode or permissions will be inferred.");
          }
          if (!jsonObject(connector) || typeof connector.AllowedConnector !== "string"
            || !connector.AllowedConnector.trim() || ids.has(connector.AllowedConnector.toLowerCase())
            || (connector.AllowedActionsMode !== "AllAllowed" && connector.AllowedActionsMode !== "SomeAllowed")
            || (!omittedConnectionMode && connector.AllowedConnectionTypesMode !== "AllAllowed" && connector.AllowedConnectionTypesMode !== "SomeAllowed")
            || ["AllowedActions", "AllowedConnectionTypes"].some((key) => {
              const mode = connector[key === "AllowedActions" ? "AllowedActionsMode" : "AllowedConnectionTypesMode"];
              const list = connector[key];
              return (mode === "SomeAllowed" && !Array.isArray(list))
                || (list !== undefined && (!Array.isArray(list) || list.some((item) => typeof item !== "string")));
            })) blockers.push("ACP contains malformed/duplicate connectors or ambiguous action/connection-type restrictions.");
          if (jsonObject(connector) && typeof connector.AllowedConnector === "string") ids.add(connector.AllowedConnector.toLowerCase());
        }
      }
    }
    if (omissionReasons.length) {
      skipped.push({ kind: "policy-module", id: rule.id ?? "", reasons: omissionReasons });
      skippedEvidence.push({ path: `PolicyRules.${rule.id}`, value: structuredClone(rule) });
    } else {
      if (manager) independentRules.push({ id: rule.id!, sourceManagedBy: manager });
      copied.push({ identity: sourcePolicyId, path: `ModelB.${rule.id} v${rule.version}`, value: structuredClone(rule.inputs) });
      policyRules.push({ id: rule.id, version: rule.version, inputs: structuredClone(rule.inputs) });
    }
  }
  if (!policyRules.some((rule) => rule.id === "ConnectorManagement")) blockers.push("A supported source ACP module is required; it cannot be skipped or replaced.");
  if (snapshot.policy.ruleSetCount !== undefined && snapshot.policy.ruleSetCount !== snapshot.policy.ruleSets?.length) blockers.push("Source policy rule count is incomplete.");
  copied.unshift({ identity: sourceId, path: "Group.description", value: description });
  return {
    sourceId, sourcePolicyId, sourceRuleIds, sourceFingerprint: await fingerprint(sourceIdentity(snapshot)),
    preparedAt: now, group: { displayName: destinationName, description },
    rules, policy: {
      name: `${destinationName} - ${snapshot.policy.name || sourcePolicyId}`,
      ruleSets: policyRules,
    },
    publication: snapshot.publication, copied, unsupported, ...(skipped.length ? { skipped, skippedEvidence } : {}),
    ...(independentRules.length ? { independentRules } : {}), blockers: [...new Set(blockers)],
    ...(connectionTypeModes ? { connectionTypeModes } : {}),
    ...(trialRules.length ? { trialRules } : {}),
    ...(options.purpose !== "selective-sync" ? { managedAppSharing } : {}),
  };
}

export function ruleCreateBody(rule: ClonePlan["rules"][number], destinationId: string): RuleSetDto {
  return {
    environmentFilter: { type: "Include", values: [{ id: destinationId, type: "EnvironmentGroup" }] },
    parameters: structuredClone(rule.parameters),
  };
}

export type ClonePhase = "planned" | "blocked" | "running" | "failed" | "indeterminate" | "publication-pending" | "verified" | "created-with-omissions";

export function isCompletedClone(phase: ClonePhase): boolean {
  return phase === "verified" || phase === "created-with-omissions";
}
export interface CloneStep {
  key: string;
  outcome: "started" | "returned" | "verified" | "failed" | "indeterminate";
  returnedId?: string;
  operationId?: string;
}
export interface CloneOperation {
  version: 1 | 2;
  id: string;
  sourceId: string;
  sourceFingerprint: string;
  planFingerprint: string;
  destinationFingerprint?: string;
  phase: ClonePhase;
  destinationId?: string;
  policyId?: string;
  rules: Array<{ sourceId: string; destinationId: string }>;
  steps: CloneStep[];
  skipped?: CloneOmission[];
  independentRules?: IndependentRule[];
  trialRules?: GroupRuleTrial[];
  updatedAt: number;
}

export interface CloneStore {
  read(id: string): CloneOperation | undefined;
  save(operation: CloneOperation): void;
  list(): CloneOperation[];
}

export interface CloneBackend {
  readSource(id: string): Promise<DataResult<CloneSnapshot>>;
  executionBlockers(plan: ClonePlan): string[];
  createGroup(body: ClonePlan["group"]): Promise<DataResult<unknown>>;
  createRule(groupId: string, body: RuleSetDto): Promise<DataResult<unknown>>;
  createPolicy(body: PolicyRequest): Promise<DataResult<unknown>>;
  patchPolicy(policyId: string, body: PolicyRequest): Promise<DataResult<unknown>>;
  assign(policyId: string, groupId: string): Promise<DataResult<unknown>>;
  readGroup(id: string): Promise<DataResult<EnvironmentGroup>>;
  readRules(groupId: string): Promise<DataResult<RuleSetDto[]>>;
  readPolicy(id: string): Promise<DataResult<Policy>>;
  readAssignments(groupId: string): Promise<DataResult<RuleAssignment[]>>;
  readPolicyAssignments(policyId: string): Promise<DataResult<RuleAssignment[]>>;
  readEmptyMembership(groupId: string): Promise<DataResult<boolean>>;
  readPublication(groupId: string): Promise<DataResult<PublicationState>>;
}

export const CLONE_REQUEST_TIMEOUT_MS = 60_000;

export async function boundedCloneRequest<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Connector request timed out. A tenant write may still complete; reconcile recorded IDs and do not retry creation.")), CLONE_REQUEST_TIMEOUT_MS);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface CloneOutcome {
  operation: CloneOperation;
  message: string;
  destinationUrl?: string;
}

function identity(value: unknown): string | undefined {
  return jsonObject(value) && typeof value.id === "string" && membershipId(value.id) ? value.id : undefined;
}
function requireResult<T>(result: DataResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
async function readResult<T>(request: Promise<DataResult<T>>): Promise<T> {
  return requireResult(await boundedCloneRequest(request));
}

function sameGroup(group: EnvironmentGroup, plan: ClonePlan, id: string): boolean {
  return membershipId(group.id ?? "") === membershipId(id) && group.displayName === plan.group.displayName
    && (group.description ?? "") === (plan.group.description ?? "") && !group.parentGroupId && !group.childrenGroupIds?.length
    && Object.keys(group).every((key) => groupMetadata.has(key));
}
function samePolicy(policy: Policy, plan: ClonePlan, id: string): boolean {
  requireIndependentManagement(policy, plan);
  return membershipId(policy.id ?? "") === membershipId(id) && policy.name === plan.policy.name
    && sameSettings(policy.ruleSets, plan.policy.ruleSets)
    && Object.keys(policy).every((key) => policyFields.has(key))
    && (policy.ruleSetCount === undefined || policy.ruleSetCount === plan.policy.ruleSets?.length);
}
function requireIndependentManagement(policy: Policy, plan: ClonePlan): void {
  const independentRules = plan.independentRules;
  if (!independentRules?.length) return;
  if ("managedBy" in policy || policy.ruleSets?.some((rule) =>
    independentRules.some((entry) => entry.id === rule.id) && "managedBy" in rule)) {
    throw new Error("Destination returned an unexpected management attribution. Independent rule management could not be verified; no ownership repair or reassignment is attempted.");
  }
}
function sameRules(rules: RuleSetDto[], plan: ClonePlan, operation: CloneOperation): boolean {
  return rules.length === plan.rules.length && operation.rules.length === plan.rules.length
    && new Set(operation.rules.map((rule) => membershipId(rule.destinationId))).size === plan.rules.length
    && plan.rules.every((rule) => {
      const mapped = operation.rules.find((entry) => entry.sourceId === rule.sourceId);
      const stored = rules.find((entry) => membershipId(entry.id ?? "") === membershipId(mapped?.destinationId ?? ""));
      if (plan.trialRules?.some((trial) => trial.sourceRuleId === rule.sourceId)
        && stored?.parameters?.some((bucket) => `${bucket.type}/${bucket.resourceType}` === "Sharing/MicrosoftApp" && "managedBy" in bucket)) {
        throw new Error("Destination group rule returned unexpected management attribution. The trial's independent settings could not be verified; no ownership normalization was attempted.");
      }
      return stored && sameSettings(stored.parameters, rule.parameters)
        && canonical(stored.environmentFilter) === canonical(ruleCreateBody(rule, operation.destinationId!).environmentFilter)
        && Object.keys(stored).every((key) => ["id", "lastModified", "parameters", "environmentFilter"].includes(key));
    });
}
function sameAssignment(assignments: RuleAssignment[], operation: CloneOperation, ruleCount: number): boolean {
  return assignments.length === 1 && assignments.every((entry) =>
    membershipId(entry.resourceId ?? "") === membershipId(operation.destinationId ?? "")
    && entry.resourceType === "EnvironmentGroup" && membershipId(entry.policyId ?? "") === membershipId(operation.policyId ?? "")
    && (entry.ruleSetCount === undefined || entry.ruleSetCount === ruleCount)
    && Object.keys(entry).every((key) => ["policyId", "resourceId", "resourceType", "tenantId", "ruleSetCount"].includes(key)));
}

export async function newCloneOperation(plan: ClonePlan): Promise<CloneOperation> {
  const intent = await cloneIntent(plan);
  return {
    version: 2, id: crypto.randomUUID(), sourceId: plan.sourceId, sourceFingerprint: plan.sourceFingerprint,
    ...intent, phase: "planned", rules: [], steps: [], updatedAt: Date.now(),
    ...(plan.skipped?.length ? { skipped: structuredClone(plan.skipped) } : {}),
    ...(plan.independentRules?.length ? { independentRules: structuredClone(plan.independentRules) } : {}),
    ...(plan.trialRules?.length ? { trialRules: structuredClone(plan.trialRules) } : {}),
  };
}

function planIdentity(plan: ClonePlan): unknown {
  return { ...plan, preparedAt: 0 };
}

export async function cloneIntent(plan: ClonePlan): Promise<{ destinationFingerprint: string; planFingerprint: string }> {
  return {
    destinationFingerprint: await fingerprint({ version: 1, sourceId: membershipId(plan.sourceId),
      destinationName: (plan.group.displayName ?? "").trim().toLowerCase() }),
    planFingerprint: await fingerprint(planIdentity(plan)),
  };
}

export function hasIncompleteCloneWrites(record: CloneOperation): boolean {
  return !isCompletedClone(record.phase) && (!!record.destinationId || !!record.policyId || record.rules.length > 0
    || record.steps.length > 0 || ["running", "indeterminate", "publication-pending"].includes(record.phase));
}

export function cloneHistory(records: CloneOperation[], sourceId: string, intent: Awaited<ReturnType<typeof cloneIntent>>) {
  const incomplete = records.filter((record) => membershipId(record.sourceId) === membershipId(sourceId) && hasIncompleteCloneWrites(record));
  const same = incomplete.filter((record) => record.destinationFingerprint === intent.destinationFingerprint || record.planFingerprint === intent.planFingerprint);
  return { same, separate: incomplete.filter((record) => !same.includes(record)) };
}

export function recordedCloneGroupId(record: CloneOperation): string | undefined {
  const id = record.destinationId ?? record.steps.find((step) => step.key === "create-group")?.returnedId;
  return id && membershipId(id) && membershipId(id) !== membershipId(record.sourceId) ? id : undefined;
}

export interface CloneInspection {
  operationId: string;
  message: string;
  observations: Array<{ resource: string; ok: boolean; detail: string }>;
  destinationUrl?: string;
}

export async function inspectGroupClone(operation: CloneOperation, backend: CloneBackend, store: CloneStore): Promise<CloneInspection> {
  const current = store.read(operation.id) ?? operation;
  const result: CloneInspection = { operationId: current.id, message: "", observations: [] };
  if (activeOperations.has(current.id)) return { ...result, message: "This copy is still active. Wait for it to stop before inspecting its current state." };
  const observe = async <T>(resource: string, request: () => Promise<DataResult<T>>, describe: (value: T) => string) => {
    try {
      const value = requireResult(await boundedCloneRequest(request()));
      result.observations.push({ resource, ok: true, detail: describe(value) });
      return true;
    } catch (error) {
      result.observations.push({ resource, ok: false, detail: String(error) });
      return false;
    }
  };
  const groupId = recordedCloneGroupId(current);
  if (groupId && await observe("Group", () => backend.readGroup(groupId), (group) => {
    if (membershipId(group.id ?? "") !== membershipId(groupId)) throw new Error("Returned group identity differs from the recorded ID.");
    return `Group returned: ${group.displayName ?? groupId} (${groupId}).`;
  })) {
    result.destinationUrl = groupPortalUrl(groupId);
    await Promise.all([
      observe("Group rules", () => backend.readRules(groupId), (rules) => `${rules.length} rule resources returned. IDs: ${rules.map((rule) => rule.id ?? "(missing ID)").join(", ") || "(none)"}.`),
      observe("Assignments", () => backend.readAssignments(groupId), (assignments) => `${assignments.length} assignments returned. Policy IDs: ${assignments.map((entry) => entry.policyId ?? "(missing ID)").join(", ") || "(none)"}. Attachments do not prove operation ownership.`),
      observe("Membership", () => backend.readEmptyMembership(groupId), (empty) => empty ? "Empty membership established." : "Empty membership not established."),
    ]);
  }
  const policyId = current.policyId ?? current.steps.find((step) => step.key === "create-policy")?.returnedId;
  if (policyId) await observe("Recorded policy", () => backend.readPolicy(policyId), (policy) => {
    if (membershipId(policy.id ?? "") !== membershipId(policyId)) throw new Error("Returned policy identity differs from the recorded ID.");
    return `Policy ${policyId}: ${policy.ruleSets ? `${policy.ruleSets.length} modules returned` : "module collection not returned"}.`;
  });
  result.message = !groupId && !policyId
    ? "No resource IDs were recorded. Manual admin review is needed; do not identify ownership or retry creation by name."
    : "Read-only inspection reports current resources, not exact equivalence or completed-copy verification. The journal is unchanged; no writes or retries were performed.";
  return result;
}

async function sourceUnchanged(plan: ClonePlan, backend: CloneBackend): Promise<void> {
  const source = requireResult(await boundedCloneRequest(backend.readSource(plan.sourceId)));
  if (await fingerprint(sourceIdentity(source)) !== plan.sourceFingerprint) throw new Error("Source changed since preview. No further writes are allowed; prepare a fresh preview.");
}

async function verifyDestination(plan: ClonePlan, operation: CloneOperation, backend: CloneBackend): Promise<PublicationState> {
  if (!operation.destinationId || !operation.policyId) throw new Error("Created resource identity is unresolved. Do not retry creation by name.");
  if (membershipId(operation.destinationId) === membershipId(plan.sourceId) || membershipId(operation.policyId) === membershipId(plan.sourcePolicyId)
    || operation.rules.some((rule) => plan.sourceRuleIds.map(membershipId).includes(membershipId(rule.destinationId)))) {
    throw new Error("Recovery identities reuse source-owned resources. This is not an independent clone.");
  }
  const [group, rules, policy, assignments, policyAssignments, empty, publication] = await boundedCloneRequest(Promise.all([
    backend.readGroup(operation.destinationId), backend.readRules(operation.destinationId), backend.readPolicy(operation.policyId),
    backend.readAssignments(operation.destinationId), backend.readPolicyAssignments(operation.policyId),
    backend.readEmptyMembership(operation.destinationId), backend.readPublication(operation.destinationId),
  ]));
  if (!sameGroup(requireResult(group), plan, operation.destinationId) || !requireResult(empty)) throw new Error("Destination properties or empty membership verification failed.");
  if (!sameRules(requireResult(rules), plan, operation)) throw new Error("Destination Model A rule identity, settings or scope differ from the copy plan.");
  if (!samePolicy(requireResult(policy), plan, operation.policyId)) throw new Error("Destination policy modules, versions or complete inputs differ from the copy plan.");
  if (!sameAssignment(requireResult(assignments), operation, plan.policy.ruleSets?.length ?? 0)
    || !sameAssignment(requireResult(policyAssignments), operation, plan.policy.ruleSets?.length ?? 0)) throw new Error("Destination policy is missing, shared, overridden, incomplete or assigned outside the new group.");
  await sourceUnchanged(plan, backend);
  return requireResult(publication);
}

const activeOperations = new Set<string>();

export async function executeGroupClone(plan: ClonePlan, requested: CloneOperation, backend: CloneBackend, store: CloneStore, confirmed: boolean, omissionsConfirmed = false, trialConfirmed = false, separateCopyConfirmed = false): Promise<CloneOutcome> {
  const operation = structuredClone(store.read(requested.id) ?? requested);
  const save = () => { operation.updatedAt = Date.now(); store.save(structuredClone(operation)); };
  if (activeOperations.has(operation.id)) return { operation, message: "This operation is already running. Do not submit another copy." };
  if (activeOperations.size) return { operation, message: "Another group copy is actively running. Wait until it stops before starting a separate copy." };
  if (operation.phase !== "planned" || operation.destinationId || operation.policyId || operation.rules.length || operation.steps.length) {
    return { operation, message: "Creation is never retried. Reconcile this operation by its recorded IDs; review remaining resources manually." };
  }
  activeOperations.add(operation.id);
  let currentStep: CloneStep | undefined;
  let writeInFlight = false;
  try {
    if (!confirmed) throw new Error("Confirm the source, new empty destination, independent ACP, full copied scope and publication changes before tenant writes.");
    const intent = await cloneIntent(plan);
    if (operation.sourceId !== plan.sourceId || operation.sourceFingerprint !== plan.sourceFingerprint
      || operation.planFingerprint !== intent.planFingerprint
      || (operation.version === 2 && operation.destinationFingerprint !== intent.destinationFingerprint)
      || canonical(operation.skipped ?? []) !== canonical(plan.skipped ?? [])
      || canonical(operation.independentRules ?? []) !== canonical(plan.independentRules ?? [])
      || canonical(operation.trialRules ?? []) !== canonical(plan.trialRules ?? [])) throw new Error("The operation does not match the reviewed copy plan.");
    const blockers = [...plan.blockers, ...backend.executionBlockers(plan)];
    if (blockers.length) { operation.phase = "blocked"; save(); return { operation, message: blockers.join(" ") }; }
    if (plan.skipped?.length && !omissionsConfirmed) throw new Error("Explicitly acknowledge the listed skipped rules and incomplete governance before creating a partial copy.");
    if (plan.trialRules?.length && !trialConfirmed) throw new Error("Confirm independent managed app sharing settings and possible service rejection before any tenant writes.");
    const earlier = store.list().filter((record) => record.id !== operation.id);
    const history = cloneHistory(earlier, plan.sourceId, intent);
    if (history.same.length) throw new Error("An incomplete copy already has this destination intent. Inspect its recorded resources; do not retry the same create request.");
    if (history.separate.length && !separateCopyConfirmed) throw new Error("Confirm a separate new copy. Earlier incomplete resources remain recorded and may still need recovery; this must not retry or continue them.");
    const priorIds = new Set(earlier.flatMap((record) => [record.destinationId, record.policyId,
      ...record.rules.map((rule) => rule.destinationId), ...record.steps.map((step) => step.returnedId)])
      .filter((id): id is string => !!id).map(membershipId));
    const requireNewIdentity = (id: string) => {
      if (priorIds.has(membershipId(id))) throw new Error("Creation returned an earlier operation's resource ID. No existing resource will be adopted, patched or assigned.");
    };
    if (Date.now() - plan.preparedAt > 5 * 60_000) throw new Error("Preview expired. Read a fresh source preview before creating resources.");
    await sourceUnchanged(plan, backend);
    operation.phase = "running";
    save();
    const write = async (key: string, action: () => Promise<DataResult<unknown>>, needsId = false) => {
      currentStep = { key, outcome: "started" };
      operation.steps.push(currentStep);
      // Persist write intent before issuing a non-idempotent request.
      save();
      writeInFlight = true;
      const result = await boundedCloneRequest(action());
      const value = requireResult(result);
      const raw = jsonObject(value) ? value : {};
      currentStep.returnedId = identity(value);
      if (typeof raw.operationId === "string") currentStep.operationId = raw.operationId;
      if (raw.operationId || raw.status === "Running" || raw.status === "Pending" || raw.statusCode === 202 || (needsId && !currentStep.returnedId)) {
        currentStep.outcome = "indeterminate";
        save();
        throw new Error(`${key} returned an asynchronous or unidentifiable result. Its completion contract is not verified; stop and reconcile without retrying POST.`);
      }
      currentStep.outcome = "returned";
      // Keep returned IDs durable even if the next verification or storage write fails.
      save();
      writeInFlight = false;
      return value;
    };
    const group = await write("create-group", () => backend.createGroup(structuredClone(plan.group)), true);
    const groupId = identity(group)!;
    requireNewIdentity(groupId);
    if (membershipId(groupId) === membershipId(plan.sourceId)) throw new Error("Creation returned the source group identity. No writes to that identity are permitted.");
    operation.destinationId = groupId; save();
    if (!sameGroup(await readResult(backend.readGroup(groupId)), plan, groupId) || !await readResult(backend.readEmptyMembership(groupId))
      || (await readResult(backend.readRules(groupId))).length || (await readResult(backend.readAssignments(groupId))).length) {
      throw new Error("New destination is not an empty, unconfigured group with the requested properties. Stop; do not adopt or overwrite existing configuration.");
    }
    for (const rule of plan.rules) {
      await sourceUnchanged(plan, backend);
      const created = await write(`create-rule:${rule.sourceId}`, () => backend.createRule(groupId, ruleCreateBody(rule, groupId)));
      // The registered POST permits 204. Only the known new group's exact read-back
      // can identify that result; never retry POST or adopt a resource by name.
      let storedRules: RuleSetDto[];
      try {
        storedRules = await readResult(backend.readRules(groupId));
      } catch (error) {
        if (!identity(created)) writeInFlight = true;
        throw error;
      }
      const candidates = storedRules.filter((entry) => identity(entry)
        && !operation.rules.some((mapped) => membershipId(mapped.destinationId) === membershipId(entry.id ?? ""))
        && sameSettings(entry.parameters, rule.parameters)
        && canonical(entry.environmentFilter) === canonical(ruleCreateBody(rule, groupId).environmentFilter));
      const id = identity(created) ?? (candidates.length === 1 ? identity(candidates[0]) : undefined);
      if (!id) {
        writeInFlight = true;
        throw new Error("Rule creation has no unique destination-scoped read-back identity. Do not retry creation; review the new group's rules.");
      }
      requireNewIdentity(id);
      if (plan.sourceRuleIds.map(membershipId).includes(membershipId(id)) || operation.rules.some((entry) => membershipId(entry.destinationId) === membershipId(id))) {
        throw new Error("Model A creation reused a source or destination resource identity.");
      }
      operation.rules.push({ sourceId: rule.sourceId, destinationId: id }); save();
      if (!sameRules(storedRules, { ...plan, rules: plan.rules.slice(0, operation.rules.length) }, operation)) throw new Error("Created Model A rules did not preserve complete settings and destination-only scope.");
    }
    await sourceUnchanged(plan, backend);
    const createdPolicy = await write("create-policy", () => backend.createPolicy(structuredClone(plan.policy)), true);
    const policyId = identity(createdPolicy)!;
    requireNewIdentity(policyId);
    if (membershipId(policyId) === membershipId(plan.sourcePolicyId)) throw new Error("Policy creation returned the source ID; source policy must never be patched or assigned.");
    operation.policyId = policyId; save();
    if ((await readResult(backend.readPolicyAssignments(policyId))).length) throw new Error("New policy has existing assignments. It is not an exclusive operation-created policy.");
    if (!samePolicy(await readResult(backend.readPolicy(policyId)), plan, policyId)) {
      if ((await readResult(backend.readPolicyAssignments(policyId))).length) throw new Error("New policy acquired an assignment before repair. No shared policy will be patched.");
      await write("repair-policy", () => backend.patchPolicy(policyId, structuredClone(plan.policy)));
      if (!samePolicy(await readResult(backend.readPolicy(policyId)), plan, policyId)) throw new Error("Policy PATCH failed full-fidelity verification; no assignment was attempted.");
    }
    await sourceUnchanged(plan, backend);
    if (!await readResult(backend.readEmptyMembership(groupId)) || (await readResult(backend.readAssignments(groupId))).length) throw new Error("Destination changed before assignment. No existing policy or membership will be overwritten.");
    await write("assign-policy", () => backend.assign(policyId, groupId));
    const publication = await verifyDestination(plan, operation, backend);
    operation.phase = publication !== "unknown" && publication === plan.publication
      ? plan.skipped?.length ? "created-with-omissions" : "verified" : "publication-pending";
    if (isCompletedClone(operation.phase)) operation.steps.forEach((step) => { step.outcome = "verified"; });
    save();
    return {
      operation,
      message: (operation.phase === "created-with-omissions"
        ? "Created with omissions. Copied settings and independent ACP verified; governance is incomplete and is not equivalent to the source. No environments copied; source unchanged."
        : operation.phase === "verified" ? "Independent copy verified: settings applied, its own ACP, and no environments. Source unchanged."
        : "Stored copy verified, but publication differs or is unknown. This is not a completed group clone. Admin publication/state verification is required.")
        + (plan.independentRules?.length || plan.trialRules?.length ? ` ${INDEPENDENT_RULE_NOTICE}` : "")
        + (plan.trialRules?.length ? " Managed app sharing matched this operation's reviewed values and destination-only scope." : ""),
      ...(isCompletedClone(operation.phase) ? { destinationUrl: groupPortalUrl(groupId) } : {}),
    };
  } catch (error) {
    operation.phase = writeInFlight ? "indeterminate" : "failed";
    if (currentStep && writeInFlight) currentStep.outcome = "indeterminate";
    const message = error instanceof Error ? error.message : String(error);
    try { save(); } catch (storageError) {
      return { operation, message: `${message} Recovery record could not be saved: ${String(storageError)}. Retain the displayed IDs; do not create another copy.` };
    }
    return { operation, message: `${message} No rollback or cleanup was attempted. Review recorded returned IDs for partial/orphan resources.` };
  } finally {
    activeOperations.delete(operation.id);
  }
}

export async function reconcileGroupClone(plan: ClonePlan, operation: CloneOperation, backend: CloneBackend, store: CloneStore): Promise<CloneOutcome> {
  if (activeOperations.has(operation.id)) return { operation, message: "Wait for this operation to stop before reconciliation." };
  const current = structuredClone(store.read(operation.id) ?? operation);
  if (current.planFingerprint !== await fingerprint(planIdentity(plan)) || canonical(current.skipped ?? []) !== canonical(plan.skipped ?? [])
    || canonical(current.independentRules ?? []) !== canonical(plan.independentRules ?? [])
    || canonical(current.trialRules ?? []) !== canonical(plan.trialRules ?? [])) return {
    operation: { ...current, phase: isCompletedClone(current.phase) ? "blocked" : current.phase },
    message: "The recovery plan does not match this operation. No current verification is established. Do not adopt resources by name or retry creation.",
  };
  try {
    const publication = await verifyDestination(plan, current, backend);
    current.phase = publication !== "unknown" && publication === plan.publication
      ? plan.skipped?.length ? "created-with-omissions" : "verified" : "publication-pending";
    if (isCompletedClone(current.phase)) current.steps.forEach((step) => { step.outcome = "verified"; });
    current.updatedAt = Date.now(); store.save(current);
    return { operation: current, message: (current.phase === "created-with-omissions"
      ? "Created copy reconciled with the recorded skipped rules. Copied settings verified, but governance remains incomplete; no writes were retried."
      : current.phase === "verified" ? "Existing operation reconciled and fully verified; no writes were retried."
      : "Stored configuration reconciled. Publication is pending/unverified; this is not clone success.")
      + (plan.independentRules?.length || plan.trialRules?.length ? ` ${INDEPENDENT_RULE_NOTICE}` : "")
      + (plan.trialRules?.length ? " Managed app sharing read-back matched this operation." : ""),
    ...(isCompletedClone(current.phase) ? { destinationUrl: groupPortalUrl(current.destinationId!) } : {}) };
  } catch (error) {
    if (isCompletedClone(current.phase)) current.phase = "failed";
    return { operation: current, message: `Read-only reconciliation did not establish completion: ${String(error)}. Known IDs and uncertain steps remain recorded. Admin recovery is required; no deletion or POST retry was attempted.` };
  }
}
