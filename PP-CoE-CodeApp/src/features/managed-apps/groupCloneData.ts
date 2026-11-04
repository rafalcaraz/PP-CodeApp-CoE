import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../../.power/schemas/appschemas/dataSourcesInfo";
import { invalidateInventoryCache } from "../../data/inventory";
import type { EnvironmentGroup, Policy, RuleAssignment, RuleSetDto } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { formatApiError } from "../../shared/api-explorer/schema";
import { loadEmptyGroupMembership, loadPolicy, membershipId, readCancelled, type DataResult } from "./data";
import { loadGroupEvidenceBatch } from "./governance";
import {
  boundedCloneRequest, canonical, jsonObject, planGroupClone,
  type CloneBackend, type CloneOperation, type ClonePlan, type CloneSnapshot, type CloneStore,
} from "./groupClone";

export const PUBLICATION_BLOCKER =
  "Live writes are gated: the registered API has no verified source draft/published selector, group Publish rules operation or authoritative publication read-back. POST, PATCH and assignment are not proof of publication.";
export const MODEL_A_BLOCKER =
  "Model A group-only GET/POST is registered. Fresh ruleset ID generation, destination cardinality and stored parameter fidelity still require an authorized disposable-group verification.";
export const AUTHORIZATION_NOTICE =
  "Group management requires tenant administrator authority; governance writes require the actual caller's permission (service principals: Power Platform contributor/owner). Reads do not prove write permission. Authorization errors are reported, not bypassed; no action-level permission endpoint is invented.";

const operations = {
  GetEnvironmentGroup: false, GetRuleSet: false, ListRuleAssignmentsByEnvironmentGroupId: false,
  ListRuleAssignmentsByPolicyId: false, CreateEnvironmentGroup: true, CreateRuleSet: true,
  CreateRuleBasedPolicy: true, PatchRuleBasedPolicy: true, CreateEnviornmentGroupRuleBasedAssignment: true,
};
type OperationName = keyof typeof operations;

async function call(operationName: OperationName, parameters: Record<string, unknown>): Promise<DataResult<unknown>> {
  try {
    const result = await boundedCloneRequest(getClient(dataSourcesInfo).executeAsync<Record<string, unknown>, unknown>({
      connectorOperation: { tableName: "powerplatformadminv2", operationName, parameters: { "api-version": "2024-10-01", ...parameters } },
    }));
    if (!result.success) return { ok: false, error: formatApiError(result.error) };
    // The connector SDK does not provide an established HTTP status/header envelope here.
    // A body-less or asynchronous creation is handled as indeterminate by the orchestrator.
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  } finally {
    if (operations[operationName]) invalidateInventoryCache();
  }
}

async function collection<T>(result: DataResult<unknown>, validate: (value: unknown) => value is T, label: string): Promise<DataResult<T[]>> {
  if (!result.ok) return result;
  const body = result.data;
  if (!jsonObject(body) || !Array.isArray(body.value)) return { ok: false, error: `${label} omitted its collection; empty completion cannot be inferred from a body-less SDK response.` };
  if (body["@odata.nextLink"] || body.nextLink) return { ok: false, error: `${label} returned continuation not supported by the registered group operation. Full-copy evidence is incomplete.` };
  if (!body.value.every(validate)) return { ok: false, error: `${label} returned incomplete identities or malformed data.` };
  return { ok: true, data: body.value };
}
function assignment(value: unknown): value is RuleAssignment {
  return jsonObject(value) && typeof value.policyId === "string" && !!membershipId(value.policyId)
    && typeof value.resourceId === "string" && !!membershipId(value.resourceId) && typeof value.resourceType === "string";
}
function modelARule(value: unknown): value is RuleSetDto {
  return jsonObject(value) && typeof value.id === "string" && !!membershipId(value.id) && Array.isArray(value.parameters);
}
async function readGroup(id: string): Promise<DataResult<EnvironmentGroup>> {
  const result = await call("GetEnvironmentGroup", { groupId: id });
  if (!result.ok) return result;
  if (!jsonObject(result.data) || typeof result.data.id !== "string" || membershipId(result.data.id) !== membershipId(id)) {
    return { ok: false, error: "Group read-back omitted or changed the actual identity." };
  }
  return { ok: true, data: result.data };
}
async function readRules(id: string): Promise<DataResult<RuleSetDto[]>> {
  return collection(await call("GetRuleSet", { groupId: id }), modelARule, "Group Model A rules");
}
async function readAssignments(id: string): Promise<DataResult<RuleAssignment[]>> {
  const result = await collection(await call("ListRuleAssignmentsByEnvironmentGroupId", {
    environmentGroupId: id, includeRuleSetCounts: true,
  }), assignment, "Group policy assignments");
  if (result.ok && result.data.some((item) => item.resourceType !== "EnvironmentGroup" || membershipId(item.resourceId ?? "") !== membershipId(id))) {
    return { ok: false, error: "Assignment response includes another resource scope." };
  }
  return result;
}

async function readSource(id: string, signal?: AbortSignal): Promise<DataResult<CloneSnapshot>> {
  // Tenant rules expose potentially unresolved applicability which the direct group read alone cannot establish.
  const [batch, group, rules, assignments] = await Promise.all([
    loadGroupEvidenceBatch([id], signal), readGroup(id), readRules(id), readAssignments(id),
  ]);
  if (!group.ok) return group;
  if (!rules.ok) return rules;
  if (!assignments.ok) return assignments;
  const evidence = batch[0];
  if (!evidence || !evidence.rulesets.ok) return { ok: false, error: evidence?.rulesets.ok === false ? evidence.rulesets.error : "Complete tenant rule applicability is unavailable." };
  if (!evidence.details.ok) return evidence.details;
  if (!evidence.policies.ok) return evidence.policies;
  if (canonical(group.data) !== canonical(evidence.details.data)) return { ok: false, error: "Group changed between independent source reads. Refresh to retry." };
  if (canonical(rules.data) !== canonical(evidence.rulesets.data.matching)) return { ok: false, error: "Direct group and tenant rules differ. Scope or source state is ambiguous; no partial copy is prepared." };
  const ids = [...new Set(assignments.data.map((item) => membershipId(item.policyId ?? "")))];
  if (ids.length !== 1 || assignments.data.length !== 1 || evidence.policies.data.length !== 1) {
    return { ok: false, error: "The documented independent copy path requires exactly one source group policy; no policy union or positional selection is allowed." };
  }
  const policy: Policy = evidence.policies.data[0];
  if (membershipId(policy.id ?? "") !== ids[0]) return { ok: false, error: "Policy changed between source assignment reads." };
  return { ok: true, data: {
    group: group.data, rules: rules.data, assignments: assignments.data, policy,
    publication: "unknown", publicationEvidence: "",
    blockers: evidence.rulesets.data.unresolved.length ? ["Tenant rules have unresolved applicability; exact Model A coverage is not established."] : [],
  } };
}

export const groupCloneBackend: CloneBackend = {
  readSource,
  executionBlockers: (plan) => [PUBLICATION_BLOCKER, ...(plan.rules.length ? [MODEL_A_BLOCKER] : []),
    "Connector response status/headers and authoritative empty-membership verification must be established before enabling writes; uncertain creates cannot be retried safely."],
  createGroup: (body) => call("CreateEnvironmentGroup", { body }),
  createRule: (groupId, body) => call("CreateRuleSet", { groupId, body }),
  createPolicy: (body) => call("CreateRuleBasedPolicy", { body }),
  patchPolicy: (policyId, body) => call("PatchRuleBasedPolicy", { policyId, body }),
  assign: (policyId, groupId) => call("CreateEnviornmentGroupRuleBasedAssignment", { policyId, groupId, body: {} }),
  readGroup, readRules, readPolicy: loadPolicy, readAssignments,
  readPolicyAssignments: async (policyId) => {
    const result = await collection(await call("ListRuleAssignmentsByPolicyId", { policyId, includeRuleSetCounts: true }), assignment, "Policy resource assignments");
    if (result.ok && result.data.some((entry) => membershipId(entry.policyId ?? "") !== membershipId(policyId))) {
      return { ok: false, error: "Policy assignment read-back changed policy identity." };
    }
    return result;
  },
  readEmptyMembership: loadEmptyGroupMembership,
  readPublication: async () => ({ ok: false, error: PUBLICATION_BLOCKER }),
};

export async function prepareGroupClone(id: string, name: string, signal?: AbortSignal): Promise<DataResult<ClonePlan>> {
  const cancelled = readCancelled(signal);
  if (cancelled) return cancelled;
  try {
    const source = await boundedCloneRequest(readSource(id, signal));
    const afterRead = readCancelled(signal);
    if (afterRead) return afterRead;
    if (!source.ok) return source;
    const plan = await planGroupClone(source.data, name);
    plan.blockers = [...new Set([...plan.blockers, ...groupCloneBackend.executionBlockers(plan)])];
    return readCancelled(signal) ?? { ok: true, data: plan };
  } catch (error) {
    return { ok: false, error: formatApiError(error) };
  }
}

const STORE_PREFIX = "ppcoe:managed-apps:group-clone:v1:";

function operationRecord(value: unknown): value is CloneOperation {
  if (!jsonObject(value)) return false;
  const allowed = ["version", "id", "sourceId", "sourceFingerprint", "planFingerprint", "phase", "destinationId", "policyId", "rules", "steps", "updatedAt"];
  return Object.keys(value).every((key) => allowed.includes(key)) && value.version === 1
    && ["id", "sourceId", "sourceFingerprint", "planFingerprint"].every((key) => typeof value[key] === "string")
    && ["planned", "blocked", "running", "failed", "indeterminate", "publication-pending", "verified"].includes(String(value.phase))
    && typeof value.updatedAt === "number" && ["destinationId", "policyId"].every((key) => value[key] === undefined || typeof value[key] === "string")
    && Array.isArray(value.rules) && value.rules.every((entry) => jsonObject(entry) && Object.keys(entry).every((key) => ["sourceId", "destinationId"].includes(key))
      && typeof entry.sourceId === "string" && typeof entry.destinationId === "string")
    && Array.isArray(value.steps) && value.steps.every((entry) => jsonObject(entry) && Object.keys(entry).every((key) => ["key", "outcome", "returnedId", "operationId"].includes(key))
      && typeof entry.key === "string" && ["started", "returned", "verified", "failed", "indeterminate"].includes(String(entry.outcome))
      && ["returnedId", "operationId"].every((key) => entry[key] === undefined || typeof entry[key] === "string"))
    && (!["planned", "blocked"].includes(String(value.phase))
      || (value.destinationId === undefined && value.policyId === undefined && value.rules.length === 0 && value.steps.length === 0));
}

export const groupCloneStore: CloneStore = {
  read: (id) => {
    const raw = localStorage.getItem(`${STORE_PREFIX}${id}`);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!operationRecord(value) || value.id !== id) throw new Error("Invalid group-copy recovery record. Do not retry creation; retain resource identities for admin recovery.");
    return value;
  },
  save: (operation) => {
    if (!operationRecord(operation)) throw new Error("Unsafe group-copy recovery record; only operation IDs, fingerprints and outcomes may be stored.");
    localStorage.setItem(`${STORE_PREFIX}${operation.id}`, JSON.stringify(operation));
    window.dispatchEvent(new Event("ppcoe:managed-apps:group-clone:changed"));
  },
};

export function loadCloneOperations(sourceId: string): CloneOperation[] {
  const records: CloneOperation[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(STORE_PREFIX)) continue;
    const operation = groupCloneStore.read(key.slice(STORE_PREFIX.length));
    if (operation && membershipId(operation.sourceId) === membershipId(sourceId)) records.push(operation);
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}
