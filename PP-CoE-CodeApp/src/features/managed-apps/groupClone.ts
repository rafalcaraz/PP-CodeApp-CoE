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
  rules: Array<{ sourceId: string; parameters: RuleSetDto["parameters"] }>;
  policy: PolicyRequest;
  publication: PublicationState;
  copied: Array<{ identity: string; path: string; value: unknown }>;
  unsupported?: Array<{ path: string; value: unknown }>;
  blockers: string[];
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

export async function planGroupClone(snapshot: CloneSnapshot, name: string, now = Date.now()): Promise<ClonePlan> {
  const blockers = [...snapshot.blockers];
  const sourceId = snapshot.group.id ?? "";
  const sourcePolicyId = snapshot.policy.id ?? "";
  const sourceRuleIds = snapshot.rules.map((rule) => rule.id ?? "");
  const copied: ClonePlan["copied"] = [];
  const unsupported: NonNullable<ClonePlan["unsupported"]> = [];
  const checkFields = (value: object, allowed: Set<string>, path: string) => {
    for (const [key, entry] of Object.entries(value)) {
      if (allowed.has(key)) continue;
      unsupported.push({ path: `${path}.${key}`, value: structuredClone(entry) });
      blockers.push(`${path}.${key} isn't in the writable API contract. Its returned value is retained in copy details.`);
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
  const rules = snapshot.rules.map((rule) => {
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
    checkFields(rule, new Set(["id", "lastModified", "parameters", "environmentFilter"]), `GroupRules.${rule.id}`);
    const buckets = new Set<string>();
    for (const bucket of rule.parameters ?? []) {
      const bucketKey = `${bucket.type}/${bucket.resourceType}`;
      if (!bucket.type || !bucket.resourceType || !Array.isArray(bucket.value) || buckets.has(bucketKey)) {
        blockers.push(`GroupRules.${rule.id}/${bucketKey} has missing values or a duplicate bucket.`);
      }
      checkFields(bucket, new Set(["type", "resourceType", "value", "lastModifiedDate"]), `GroupRules.${rule.id}/${bucketKey}`);
      checkTimestamp(bucket, `GroupRules.${rule.id}/${bucketKey}`);
      buckets.add(bucketKey);
      const settingIds = new Set<string>();
      for (const setting of bucket.value ?? []) {
        const path = `ModelA.${bucketKey}/${setting.id}`;
        copied.push({ identity: rule.id ?? "", path, value: setting.value });
        if (!setting.id || typeof setting.value !== "string" || settingIds.has(setting.id)) {
          blockers.push(`${path} cannot be copied losslessly: missing/duplicate identity or non-string value.`);
        }
        checkFields(setting, new Set(["id", "value"]), path);
        settingIds.add(setting.id ?? "");
        if (inputReferences(setting.value, [sourceId, sourcePolicyId, ...sourceRuleIds])) {
          blockers.push(`${path} references source-owned resources without a verified remapping contract.`);
        }
      }
    }
    return {
      sourceId: rule.id ?? "",
      parameters: rule.parameters?.map(({ type, resourceType, value }) => ({ type, resourceType, value: structuredClone(value) })),
    };
  });
  if (new Set(sourceRuleIds.map(membershipId)).size !== sourceRuleIds.length) blockers.push("Duplicate Model A resource identities were returned.");
  for (const rule of snapshot.policy.ruleSets ?? []) {
    copied.push({ identity: sourcePolicyId, path: `ModelB.${rule.id} v${rule.version}`, value: structuredClone(rule.inputs) });
    if (!rule.id || !rule.version || !jsonObject(rule.inputs) || !validJson(rule.inputs) || moduleIds.has(rule.id)) {
      blockers.push(`Model B ${rule.id || "(missing module)"} has missing/duplicate identity, version or unsupported inputs.`);
    }
    checkFields(rule, new Set(["id", "version", "inputs", "lastModifiedDate"]), `PolicyRules.${rule.id}`);
    checkTimestamp(rule, `PolicyRules.${rule.id}`);
    moduleIds.add(rule.id ?? "");
    if (inputReferences(rule.inputs, [sourceId, sourcePolicyId, ...sourceRuleIds])) {
      blockers.push(`Model B ${rule.id} references source-owned resources without a verified remapping contract.`);
    }
    if (rule.id === "ConnectorManagement") {
      const connectors = rule.inputs?.AllowedConnectorList;
      const ids = new Set<string>();
      if (!Array.isArray(connectors)) blockers.push("ACP connector collection is missing.");
      else for (const connector of connectors) {
        if (!jsonObject(connector) || typeof connector.AllowedConnector !== "string"
          || !connector.AllowedConnector.trim() || ids.has(connector.AllowedConnector.toLowerCase())
          || !["AllAllowed", "SomeAllowed"].includes(String(connector.AllowedActionsMode))
          || !["AllAllowed", "SomeAllowed"].includes(String(connector.AllowedConnectionTypesMode))
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
  if (!moduleIds.has("ConnectorManagement")) blockers.push("No source ACP module is available for an independent copy.");
  if (snapshot.policy.ruleSetCount !== undefined && snapshot.policy.ruleSetCount !== snapshot.policy.ruleSets?.length) blockers.push("Source policy rule count is incomplete.");
  copied.unshift({ identity: sourceId, path: "Group.description", value: snapshot.group.description });
  return {
    sourceId, sourcePolicyId, sourceRuleIds, sourceFingerprint: await fingerprint(sourceIdentity(snapshot)),
    preparedAt: now, group: { displayName: destinationName, description: snapshot.group.description },
    rules, policy: {
      name: `${destinationName} - ${snapshot.policy.name || sourcePolicyId}`,
      ruleSets: snapshot.policy.ruleSets?.map(({ id, version, inputs }) => ({ id, version, inputs: structuredClone(inputs) })),
    },
    publication: snapshot.publication, copied, unsupported, blockers: [...new Set(blockers)],
  };
}

export function ruleCreateBody(rule: ClonePlan["rules"][number], destinationId: string): RuleSetDto {
  return {
    environmentFilter: { type: "Include", values: [{ id: destinationId, type: "EnvironmentGroup" }] },
    parameters: structuredClone(rule.parameters),
  };
}

export type ClonePhase = "planned" | "blocked" | "running" | "failed" | "indeterminate" | "publication-pending" | "verified";
export interface CloneStep {
  key: string;
  outcome: "started" | "returned" | "verified" | "failed" | "indeterminate";
  returnedId?: string;
  operationId?: string;
}
export interface CloneOperation {
  version: 1;
  id: string;
  sourceId: string;
  sourceFingerprint: string;
  planFingerprint: string;
  phase: ClonePhase;
  destinationId?: string;
  policyId?: string;
  rules: Array<{ sourceId: string; destinationId: string }>;
  steps: CloneStep[];
  updatedAt: number;
}

export interface CloneStore {
  read(id: string): CloneOperation | undefined;
  save(operation: CloneOperation): void;
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
    && group.description === plan.group.description && !group.parentGroupId && !group.childrenGroupIds?.length
    && Object.keys(group).every((key) => groupMetadata.has(key));
}
function samePolicy(policy: Policy, plan: ClonePlan, id: string): boolean {
  return membershipId(policy.id ?? "") === membershipId(id) && policy.name === plan.policy.name
    && sameSettings(policy.ruleSets, plan.policy.ruleSets)
    && Object.keys(policy).every((key) => policyFields.has(key))
    && (policy.ruleSetCount === undefined || policy.ruleSetCount === plan.policy.ruleSets?.length);
}
function sameRules(rules: RuleSetDto[], plan: ClonePlan, operation: CloneOperation): boolean {
  return rules.length === plan.rules.length && operation.rules.length === plan.rules.length
    && new Set(operation.rules.map((rule) => membershipId(rule.destinationId))).size === plan.rules.length
    && plan.rules.every((rule) => {
      const mapped = operation.rules.find((entry) => entry.sourceId === rule.sourceId);
      const stored = rules.find((entry) => membershipId(entry.id ?? "") === membershipId(mapped?.destinationId ?? ""));
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
  return {
    version: 1, id: crypto.randomUUID(), sourceId: plan.sourceId, sourceFingerprint: plan.sourceFingerprint,
    planFingerprint: await fingerprint(planIdentity(plan)), phase: "planned", rules: [], steps: [], updatedAt: Date.now(),
  };
}

function planIdentity(plan: ClonePlan): unknown {
  return { ...plan, preparedAt: 0 };
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

export async function executeGroupClone(plan: ClonePlan, requested: CloneOperation, backend: CloneBackend, store: CloneStore, confirmed: boolean): Promise<CloneOutcome> {
  const operation = structuredClone(store.read(requested.id) ?? requested);
  const save = () => { operation.updatedAt = Date.now(); store.save(structuredClone(operation)); };
  if (activeOperations.has(operation.id)) return { operation, message: "This operation is already running. Do not submit another copy." };
  if (operation.phase !== "planned" || operation.destinationId || operation.policyId || operation.rules.length || operation.steps.length) {
    return { operation, message: "Creation is never retried. Reconcile this operation by its recorded IDs; review remaining resources manually." };
  }
  activeOperations.add(operation.id);
  let currentStep: CloneStep | undefined;
  let writeInFlight = false;
  try {
    if (!confirmed) throw new Error("Confirm the source, new empty destination, independent ACP, full copied scope and publication changes before tenant writes.");
    if (operation.sourceId !== plan.sourceId || operation.sourceFingerprint !== plan.sourceFingerprint || operation.planFingerprint !== await fingerprint(planIdentity(plan))) throw new Error("The operation does not match the reviewed copy plan.");
    const blockers = [...plan.blockers, ...backend.executionBlockers(plan)];
    if (blockers.length) { operation.phase = "blocked"; save(); return { operation, message: blockers.join(" ") }; }
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
      if (plan.sourceRuleIds.map(membershipId).includes(membershipId(id)) || operation.rules.some((entry) => membershipId(entry.destinationId) === membershipId(id))) {
        throw new Error("Model A creation reused a source or destination resource identity.");
      }
      operation.rules.push({ sourceId: rule.sourceId, destinationId: id }); save();
      if (!sameRules(storedRules, { ...plan, rules: plan.rules.slice(0, operation.rules.length) }, operation)) throw new Error("Created Model A rules did not preserve complete settings and destination-only scope.");
    }
    await sourceUnchanged(plan, backend);
    const createdPolicy = await write("create-policy", () => backend.createPolicy(structuredClone(plan.policy)), true);
    const policyId = identity(createdPolicy)!;
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
    operation.phase = publication !== "unknown" && publication === plan.publication ? "verified" : "publication-pending";
    if (operation.phase === "verified") operation.steps.forEach((step) => { step.outcome = "verified"; });
    save();
    return {
      operation,
      message: operation.phase === "verified" ? "Independent copy verified: settings applied, its own ACP, and no environments. Source unchanged."
        : "Stored copy verified, but publication differs or is unknown. This is not a completed group clone. Admin publication/state verification is required.",
      ...(operation.phase === "verified" ? { destinationUrl: groupPortalUrl(groupId) } : {}),
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
  if (current.planFingerprint !== await fingerprint(planIdentity(plan))) return {
    operation: { ...current, phase: current.phase === "verified" ? "blocked" : current.phase },
    message: "The recovery plan does not match this operation. No current verification is established. Do not adopt resources by name or retry creation.",
  };
  try {
    const publication = await verifyDestination(plan, current, backend);
    current.phase = publication !== "unknown" && publication === plan.publication ? "verified" : "publication-pending";
    if (current.phase === "verified") current.steps.forEach((step) => { step.outcome = "verified"; });
    current.updatedAt = Date.now(); store.save(current);
    return { operation: current, message: current.phase === "verified" ? "Existing operation reconciled and fully verified; no writes were retried."
      : "Stored configuration reconciled. Publication is pending/unverified; this is not clone success.",
    ...(current.phase === "verified" ? { destinationUrl: groupPortalUrl(current.destinationId!) } : {}) };
  } catch (error) {
    if (current.phase === "verified") current.phase = "failed";
    return { operation: current, message: `Read-only reconciliation did not establish completion: ${String(error)}. Known IDs and uncertain steps remain recorded. Admin recovery is required; no deletion or POST retry was attempted.` };
  }
}
