import { formatApiError } from "../../shared/api-explorer/schema";
import { loadRuleSyncEnvironments, membershipId, readCancelled, type DataResult } from "./data";
import { groupCloneBackend, updateGroupRule } from "./groupCloneData";
import { boundedCloneRequest, jsonObject } from "./groupClone";
import { applyRuleSync, planRuleSync, reconcileRuleSync, type SyncBackend, type SyncOutcome, type SyncPlan, type SyncRecord, type SyncSnapshot, type SyncStore } from "./ruleSync";

export const ruleSyncBackend: SyncBackend = {
  read: async (id) => {
    const [snapshot, environments] = await Promise.all([
      groupCloneBackend.readSource(id), loadRuleSyncEnvironments(id),
    ]);
    if (!snapshot.ok) return snapshot;
    if (!environments.ok) return environments;
    if (membershipId(snapshot.data.group.id ?? "") !== membershipId(id)) return { ok: false, error: "Returned group identity differs from the checked group. No sync can be prepared." };
    const scope = await groupCloneBackend.readPolicyAssignments(snapshot.data.policy.id!);
    if (!scope.ok) return scope;
    if (scope.data.filter((entry) => entry.resourceType === "EnvironmentGroup"
      && membershipId(entry.resourceId ?? "") === membershipId(snapshot.data.group.id ?? "")).length !== 1) {
      return { ok: false, error: "Full policy assignment scope contradicts the group's applied assignment. Safe applicability cannot be verified." };
    }
    return { ok: true, data: { ...snapshot.data,
      environments: [...environments.data].sort((a, b) => a.id.localeCompare(b.id)),
      policyScope: [...scope.data].sort((a, b) => `${a.resourceType}/${a.resourceId}`.localeCompare(`${b.resourceType}/${b.resourceId}`)),
    } };
  },
  updateRule: updateGroupRule,
  patchPolicy: groupCloneBackend.patchPolicy,
};

export async function readRuleSyncSource(id: string, signal?: AbortSignal): Promise<DataResult<SyncSnapshot>> {
  try {
    const result = await boundedCloneRequest(ruleSyncBackend.read(id));
    return readCancelled(signal) ?? result;
  } catch (error) { return { ok: false, error: formatApiError(error) }; }
}
export async function prepareRuleSync(sourceId: string, selected: string[], targets: string[], signal?: AbortSignal): Promise<DataResult<SyncPlan>> {
  try {
    if (!targets.length || targets.some((id) => !membershipId(id) || membershipId(id) === membershipId(sourceId))
      || new Set(targets.map(membershipId)).size !== targets.length) return { ok: false, error: "Select distinct destination groups, not the source." };
    const source = await readRuleSyncSource(sourceId, signal);
    if (!source.ok) return source;
    const snapshots: SyncSnapshot[] = [];
    for (const id of targets) {
      if (readCancelled(signal)) return readCancelled(signal)!;
      const target = await readRuleSyncSource(id, signal);
      if (!target.ok) return { ok: false, error: `Destination ${id}: ${target.error}` };
      snapshots.push(target.data);
    }
    return readCancelled(signal) ?? { ok: true, data: await planRuleSync(source.data, selected, snapshots) };
  } catch (error) { return { ok: false, error: formatApiError(error) }; }
}

const PREFIX = "ppcoe:managed-apps:rule-sync:v1:";
function validRecord(value: unknown): value is SyncRecord {
  if (!jsonObject(value) || Object.keys(value).some((key) => !["version", "id", "sourceId", "sourceFingerprint", "planFingerprint", "updatedAt", "phase", "targets"].includes(key))) return false;
  return value.version === 1 && ["id", "sourceId", "sourceFingerprint", "planFingerprint"].every((key) => typeof value[key] === "string" && !!value[key])
    && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
    && ["running", "verified", "partial", "indeterminate", "blocked"].includes(String(value.phase))
    && Array.isArray(value.targets) && value.targets.every((target) => jsonObject(target)
      && Object.keys(target).every((key) => ["id", "policyId", "expected", "phase", "steps"].includes(key))
      && ["id", "policyId", "expected"].every((key) => typeof target[key] === "string" && !!target[key])
      && ["pending", "verified", "no-change", "indeterminate", "blocked"].includes(String(target.phase))
      && Array.isArray(target.steps) && target.steps.every((step) => jsonObject(step)
        && Object.keys(step).every((key) => ["kind", "resourceId", "expected", "phase"].includes(key))
        && ["settings", "policy"].includes(String(step.kind))
        && typeof step.resourceId === "string" && !!step.resourceId && typeof step.expected === "string" && !!step.expected
        && ["pending", "started", "verified"].includes(String(step.phase))))
    && (value.phase !== "verified" || (value.targets.length > 0 && value.targets.every((target) => ["verified", "no-change"].includes(String(target.phase))
      && Array.isArray(target.steps) && target.steps.every((step: unknown) => jsonObject(step) && step.phase === "verified"))));
}
export const ruleSyncStore: SyncStore = {
  all: () => {
    const records: SyncRecord[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!validRecord(value) || key !== `${PREFIX}${value.id}`) throw new Error("Sync recovery records are invalid. Retain known IDs and resolve storage before applying.");
      records.push(value);
    }
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  save: (record) => {
    if (!validRecord(record)) throw new Error("Unsafe sync journal: only IDs, fingerprints and outcomes may be stored.");
    localStorage.setItem(`${PREFIX}${record.id}`, JSON.stringify(record));
    window.dispatchEvent(new Event("ppcoe:managed-apps:rule-sync:changed"));
  },
};
export function ruleSyncRuntimeBlocker(): string {
  return typeof navigator.locks?.request === "function" ? ""
    : "This browser cannot lock concurrent governance updates. Use a secure browser with Web Locks support.";
}
async function lockedSync<T>(operation: () => Promise<T>): Promise<T> {
  const blocker = ruleSyncRuntimeBlocker();
  if (blocker) throw new Error(blocker);
  return navigator.locks.request("ppcoe:managed-apps:rule-sync", { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another sync is running in this browser. No writes started; wait and read a fresh preview.");
    return operation();
  });
}
export function runRuleSync(plan: SyncPlan, confirmed: boolean, signal?: AbortSignal,
  progress?: (record: SyncRecord) => void): Promise<SyncOutcome> {
  return lockedSync(() => applyRuleSync(plan, ruleSyncBackend, ruleSyncStore, confirmed, signal, progress));
}
export function reconcileRuleSyncRecord(record: SyncRecord): Promise<SyncOutcome> {
  return lockedSync(() => reconcileRuleSync(record, ruleSyncBackend, ruleSyncStore));
}
