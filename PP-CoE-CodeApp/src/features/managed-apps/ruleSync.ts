import type { PolicyRequest, RuleAssignment, RuleSetDto } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { membershipId, type DataResult, type EnvironmentRow } from "./data";
import { boundedCloneRequest, canonical, fingerprint, planGroupClone, type CloneSnapshot } from "./groupClone";

type Bucket = NonNullable<RuleSetDto["parameters"]>[number];
type Setting = NonNullable<Bucket["value"]>[number];
type Module = NonNullable<PolicyRequest["ruleSets"]>[number];
export interface SyncSnapshot extends CloneSnapshot {
  environments: EnvironmentRow[];
  policyScope: RuleAssignment[];
}
export type SyncRule = { key: string; label: string } & (
  { kind: "setting"; bucket: Pick<Bucket, "type" | "resourceType">; setting: Setting }
  | { kind: "policy"; module: Module }
);
export interface SyncCatalog {
  rules: SyncRule[];
  exclusions: Array<{ label: string; reason: string }>;
  blockers: string[];
}
export interface SyncChange { key: string; label: string; action: "add" | "replace" | "no-change"; before: unknown; after: unknown }
export type SyncStep = { resourceId: string; after: SyncSnapshot } & (
  { kind: "settings"; body: RuleSetDto } | { kind: "policy"; body: PolicyRequest }
);
export interface SyncTarget {
  id: string; name: string; before: SyncSnapshot; after: SyncSnapshot;
  changes: SyncChange[]; steps: SyncStep[]; blockers: string[];
}
export interface SyncPlan {
  sourceId: string; sourceName: string; sourceFingerprint: string;
  selected: string[]; targets: SyncTarget[]; blockers: string[]; exclusions: SyncCatalog["exclusions"];
}
export interface SyncBackend {
  read(id: string): Promise<DataResult<SyncSnapshot>>;
  updateRule(id: string, body: RuleSetDto): Promise<DataResult<unknown>>;
  patchPolicy(id: string, body: PolicyRequest): Promise<DataResult<unknown>>;
}

const portableSettings = new Set([
  "SolutionChecker/NotSpecified/solutionCheckerMode", "SolutionChecker/NotSpecified/suppressValidationEmails",
  "GenerativeAISettings/NotSpecified/crossGeoCopilotDataMovementEnabled", "GenerativeAISettings/NotSpecified/bingChatEnabled",
  "Copilot/App/DisableAiGeneratedDescriptions", "Lifecycle/NotSpecified/RetentionPeriod",
  "Sharing/App/CanShareWithSecurityGroups", "Sharing/App/IsGroupSharingDisabled", "Sharing/App/MaximumShareLimit",
  "Sharing/Flow/CanShareWithSecurityGroups", "Sharing/Flow/MaximumShareLimit",
  "Sharing/AuthoringBot/CanShareWithSecurityGroups", "Sharing/UsersBot/CanShareWithSecurityGroups", "Sharing/UsersBot/MaximumShareLimit",
  "CopilotAuth/NotSpecified/allowchatswithoutentraauth",
  "AdminDigest/NotSpecified/IncludeOnHomePageInsights", "AdminDigest/NotSpecified/ExcludeEnvironmentFromAnalysis",
]);
const words = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2");
const settingKey = (bucket: Pick<Bucket, "type" | "resourceType">, setting: Setting) =>
  JSON.stringify(["setting", bucket.type, bucket.resourceType, setting.id]);
function portableModule(rule: Module): boolean {
  if (rule.version !== "1.0") return false;
  const inputs = rule.inputs ?? {};
  if (rule.id === "ConnectorManagement") {
    return Object.keys(inputs).every((key) => key === "AllowedConnectorList")
      && Array.isArray(inputs.AllowedConnectorList)
      && inputs.AllowedConnectorList.every((connector) => connector && typeof connector === "object"
        && Object.keys(connector).every((key) => ["AllowedConnector", "AllowedActionsMode", "AllowedActions",
          "AllowedConnectionTypesMode", "AllowedConnectionTypes"].includes(key)));
  }
  const keys = rule.id === "CopilotTranscripts" ? ["BlockAccessToSessionTranscriptsForCopilotStudio", "BlockTranscriptRecordingForCopilotStudio"]
    : rule.id === "AdvancedConnectorPoliciesOnly" ? ["EnableAdvancedConnectorPoliciesOnly"] : [];
  return keys.length > 0 && Object.keys(inputs).length === keys.length && keys.every((key) => typeof inputs[key] === "boolean");
}

export async function ruleSyncCatalog(source: SyncSnapshot): Promise<SyncCatalog> {
  const checked = await planGroupClone(source, "Validation only");
  const rules: SyncRule[] = [];
  const exclusions = (checked.skipped ?? []).map((entry) => ({ label: entry.id, reason: entry.reasons.join(" ") }));
  for (const resource of checked.rules) for (const bucket of resource.parameters ?? []) for (const setting of bucket.value ?? []) {
    const label = `${words(bucket.type ?? "")} / ${words(bucket.resourceType ?? "")}: ${words(setting.id ?? "")}`;
    if (source.rules.length !== 1 || !portableSettings.has(`${bucket.type}/${bucket.resourceType}/${setting.id}`)) {
      exclusions.push({ label, reason: source.rules.length !== 1
        ? "Multiple source group-rule resources have ambiguous selective precedence."
        : "No reviewed portable setting contract in this first version. Resource pointers and unknown settings are not copied." });
    } else rules.push({ kind: "setting", key: settingKey(bucket, setting), label, bucket: { type: bucket.type, resourceType: bucket.resourceType }, setting });
  }
  for (const module of checked.policy.ruleSets ?? []) {
    if (!portableModule(module)) exclusions.push({ label: words(module.id ?? ""), reason: "This policy rule's complete portable input contract is not enabled for selective sync." });
    else rules.push({ kind: "policy", key: JSON.stringify(["policy", module.id]), label: words(module.id ?? ""), module });
  }
  const keys = rules.map((rule) => rule.key.toLowerCase());
  return { rules, exclusions, blockers: [...checked.blockers,
    ...(source.publication !== "applied" ? ["Only applied API settings can be synced; pending browser edits are not included."] : []),
    ...(new Set(keys).size !== keys.length ? ["Source rule identities are ambiguous."] : []),
  ] };
}

function exclusive(rule: RuleSetDto, groupId: string): boolean {
  const filter = rule.environmentFilter;
  return filter?.type === "Include" && filter.values?.length === 1
    && filter.values[0].type === "EnvironmentGroup" && membershipId(filter.values[0].id ?? "") === membershipId(groupId);
}
function exclusivePolicy(snapshot: SyncSnapshot): boolean {
  return snapshot.policyScope.length === 1 && snapshot.policyScope.every((entry) =>
    entry.resourceType === "EnvironmentGroup" && membershipId(entry.resourceId ?? "") === membershipId(snapshot.group.id ?? "")
    && membershipId(entry.policyId ?? "") === membershipId(snapshot.policy.id ?? "")
    && Object.keys(entry).every((key) => ["policyId", "resourceId", "resourceType", "ruleSetCount", "tenantId"].includes(key)));
}
function updateCounts(snapshot: SyncSnapshot) {
  const count = snapshot.policy.ruleSets?.length;
  if (snapshot.policy.ruleSetCount !== undefined) snapshot.policy.ruleSetCount = count;
  for (const entry of [...snapshot.assignments, ...snapshot.policyScope]) if (entry.ruleSetCount !== undefined) entry.ruleSetCount = count;
}

export async function planRuleSync(source: SyncSnapshot, selected: string[], destinations: SyncSnapshot[]): Promise<SyncPlan> {
  const catalog = await ruleSyncCatalog(source);
  const chosen = catalog.rules.filter((rule) => selected.includes(rule.key));
  const sourceId = source.group.id ?? "";
  const blockers = [...catalog.blockers];
  if (!selected.length || new Set(selected).size !== selected.length || chosen.length !== selected.length) blockers.push("Select supported individual rules; the selection is empty, duplicate or unavailable.");
  if (!destinations.length || new Set(destinations.map((target) => membershipId(target.group.id ?? ""))).size !== destinations.length) blockers.push("Select distinct destination groups.");
  const targets: SyncTarget[] = [];
  for (const before of destinations) {
    const id = before.group.id ?? "";
    // Unlike copying, an in-place update must retain the target's own existing resource references.
    const checked = await planGroupClone(before, "Validation only", before.group.description, Date.now(), { preserveExistingReferences: true });
    const target: SyncTarget = { id, name: before.group.displayName || id, before, after: structuredClone(before), changes: [], steps: [], blockers: [...checked.blockers] };
    if (membershipId(id) === membershipId(sourceId)) target.blockers.push("The source group cannot be a destination.");
    if (before.publication !== "applied") target.blockers.push("Destination applied state is unavailable.");
    if (before.environments.some((environment) => !environment.isManaged)) target.blockers.push("The destination includes an environment not confirmed as managed.");
    const settings = chosen.filter((rule) => rule.kind === "setting");
    if (settings.length && (before.rules.length !== 1 || checked.rules.length !== 1 || !exclusive(before.rules[0], id))) {
      target.blockers.push("Selected group settings require one losslessly writable resource scoped only to this destination. Missing, shared or unsupported resources are not created/replaced.");
    } else if (settings.length) {
      if (source.rules.some((rule) => membershipId(rule.id ?? "") === membershipId(before.rules[0].id ?? ""))) {
        target.blockers.push("Destination reuses a source-owned rule resource ID. No source resource may be updated.");
      }
      const parameters = structuredClone(checked.rules[0].parameters ?? []);
      for (const rule of settings) {
        let bucket = parameters.find((entry) => entry.type === rule.bucket.type && entry.resourceType === rule.bucket.resourceType);
        const existing = bucket?.value?.find((entry) => entry.id === rule.setting.id);
        target.changes.push({ key: rule.key, label: rule.label, action: !existing ? "add" : existing.value === rule.setting.value ? "no-change" : "replace",
          before: existing?.value, after: rule.setting.value });
        if (!bucket) { bucket = { ...rule.bucket, value: [] }; parameters.push(bucket); }
        bucket.value ??= [];
        if (existing) existing.value = rule.setting.value;
        else bucket.value.push(structuredClone(rule.setting));
      }
      if (target.changes.some((change) => change.action !== "no-change")) {
        target.after.rules[0].parameters = parameters;
        const body: RuleSetDto = { id: before.rules[0].id, environmentFilter: structuredClone(before.rules[0].environmentFilter), parameters };
        target.steps.push({ kind: "settings", resourceId: before.rules[0].id!, body, after: structuredClone(target.after) });
      }
    }
    const modules: Module[] = [];
    for (const rule of chosen.filter((entry) => entry.kind === "policy")) {
      const previous = before.policy.ruleSets?.find((entry) => entry.id === rule.module.id);
      const comparable = previous && { id: previous.id, version: previous.version, inputs: previous.inputs };
      const action = !previous ? "add" : canonical(comparable) === canonical(rule.module) ? "no-change" : "replace";
      target.changes.push({ key: rule.key, label: rule.label, action, before: comparable, after: rule.module });
      if (action !== "no-change" && previous) {
        const unsupported = checked.skipped?.find((entry) => entry.kind === "policy-module" && entry.id === previous.id);
        if (unsupported || !portableModule(previous)) {
          target.blockers.push(`Existing selected rule ${rule.label} cannot be updated losslessly: ${unsupported?.reasons.join(" ") ?? "Its complete input/version contract is not enabled."}`);
          continue;
        }
      }
      if (action !== "no-change") modules.push(structuredClone(rule.module));
    }
    if (modules.length) {
      if (membershipId(before.policy.id ?? "") === membershipId(source.policy.id ?? "")) target.blockers.push("Destination reuses the source ACP identity. The source policy may not be updated.");
      if (!exclusivePolicy(before)) target.blockers.push("The target ACP is shared or its full assignment scope is ambiguous. No policy fork or reassignment is performed.");
      const rules = target.after.policy.ruleSets ?? [];
      for (const module of modules) {
        const index = rules.findIndex((entry) => entry.id === module.id);
        if (index >= 0) rules[index] = module; else rules.push(module);
      }
      target.after.policy.ruleSets = rules;
      updateCounts(target.after);
      target.steps.push({ kind: "policy", resourceId: before.policy.id!, body: { ruleSets: modules }, after: structuredClone(target.after) });
    }
    targets.push(target);
  }
  return { sourceId, sourceName: source.group.displayName || sourceId, sourceFingerprint: await fingerprint(source),
    selected: [...selected], targets, exclusions: catalog.exclusions,
    blockers: [...new Set([...blockers, ...targets.flatMap((target) => target.blockers.map((reason) => `${target.name}: ${reason}`))])] };
}

// Only documented server response metadata is ignored. Every input and unrelated setting remains compared.
export function syncState(snapshot: SyncSnapshot): unknown {
  const value = structuredClone(snapshot);
  const responseDate = (object: object, key: string) => {
    if (!(key in object)) return;
    const date: unknown = Reflect.get(object, key);
    if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) throw new Error(`Invalid response timestamp ${key}; target fidelity cannot be verified.`);
    Reflect.deleteProperty(object, key);
  };
  responseDate(value.group, "lastModifiedTime"); delete value.group.lastModifiedBy;
  responseDate(value.policy, "lastModified"); responseDate(value.policy, "lastModifiedOffset");
  for (const module of value.policy.ruleSets ?? []) responseDate(module, "lastModifiedDate");
  value.policy.ruleSets?.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
  for (const rule of value.rules) {
    responseDate(rule, "lastModified");
    for (const bucket of rule.parameters ?? []) responseDate(bucket, "lastModifiedDate");
  }
  value.environments.sort((a, b) => a.id.localeCompare(b.id));
  value.policyScope.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return { ...value, environments: value.environments.map(({ id, displayName, environmentGroupId, environmentType, isManaged }) =>
    ({ id, displayName, environmentGroupId, environmentType, isManaged })) };
}
export const syncPlanFingerprint = (plan: SyncPlan) => fingerprint({
  sourceId: plan.sourceId, sourceFingerprint: plan.sourceFingerprint, selected: plan.selected,
  targets: plan.targets.map((target) => ({ id: target.id, before: target.before, steps: target.steps })),
});

export interface SyncRecord {
  version: 1; id: string; sourceId: string; sourceFingerprint: string; planFingerprint: string; updatedAt: number;
  phase: "running" | "verified" | "partial" | "indeterminate" | "blocked";
  targets: Array<{ id: string; policyId: string; expected: string; phase: "pending" | "verified" | "no-change" | "indeterminate" | "blocked";
    steps: Array<{ kind: "settings" | "policy"; resourceId: string; expected: string; phase: "pending" | "started" | "verified" }> }>;
}
export interface SyncStore { all(): SyncRecord[]; save(record: SyncRecord): void }
export interface SyncOutcome { record: SyncRecord; message: string }
function requireRead<T>(value: DataResult<T>): T { if (!value.ok) throw new Error(value.error); return value.data; }
const read = async (backend: SyncBackend, id: string) => requireRead(await boundedCloneRequest(backend.read(id)));
export const unresolvedSync = (record: SyncRecord) => record.phase === "running" || record.phase === "indeterminate"
  || record.targets.some((target) => target.phase === "indeterminate" || target.steps.some((step) => step.phase === "started"));

export async function applyRuleSync(plan: SyncPlan, backend: SyncBackend, store: SyncStore, confirmed: boolean,
  signal?: AbortSignal, progress?: (record: SyncRecord) => void): Promise<SyncOutcome> {
  const record: SyncRecord = { version: 1, id: crypto.randomUUID(), sourceId: plan.sourceId, sourceFingerprint: plan.sourceFingerprint,
    planFingerprint: await syncPlanFingerprint(plan), updatedAt: Date.now(), phase: "blocked", targets: [] };
  const persist = () => { record.updatedAt = Date.now(); store.save(structuredClone(record)); progress?.(structuredClone(record)); };
  try {
    if (!confirmed || plan.blockers.length) throw new Error("A runnable fresh preview and explicit one-time confirmation are required.");
    const overlapping = new Set([plan.sourceId, ...plan.targets.map((target) => target.id)].map(membershipId));
    if (store.all().some((entry) => unresolvedSync(entry) && [entry.sourceId, ...entry.targets.map((target) => target.id)].some((id) => overlapping.has(membershipId(id))))) {
      throw new Error("A previous overlapping sync has running or uncertain writes. Reconcile its recorded IDs; do not retry.");
    }
    const source = await read(backend, plan.sourceId);
    const destinations: SyncSnapshot[] = [];
    for (const target of plan.targets) destinations.push(await read(backend, target.id));
    const fresh = await planRuleSync(source, plan.selected, destinations);
    if (fresh.blockers.length || await syncPlanFingerprint(fresh) !== record.planFingerprint) throw new Error("Source, target rules, policy scope or impacted environments changed. Read a new preview.");
    for (const target of plan.targets) record.targets.push({
      id: target.id, policyId: target.before.policy.id!, expected: await fingerprint(syncState(target.after)), phase: "pending",
      steps: await Promise.all(target.steps.map(async (step) => ({ kind: step.kind, resourceId: step.resourceId, expected: await fingerprint(syncState(step.after)), phase: "pending" as const }))),
    });
    record.phase = "running"; persist();
    for (const [index, target] of plan.targets.entries()) {
      const entry = record.targets[index];
      let expectedBefore = target.before;
      for (const [stepIndex, step] of target.steps.entries()) {
        if (signal?.aborted) throw new Error("Sync closed or cancelled. No further writes were started; inspect recorded outcomes.");
        if (await fingerprint(await read(backend, plan.sourceId)) !== plan.sourceFingerprint
          || canonical(syncState(await read(backend, target.id))) !== canonical(syncState(expectedBefore))) {
          throw new Error("Source or destination changed before a write. Remaining writes stopped; read a fresh preview.");
        }
        const status = entry.steps[stepIndex];
        status.phase = "started"; entry.phase = "indeterminate"; persist();
        const response = await boundedCloneRequest(step.kind === "settings"
          ? backend.updateRule(step.resourceId, structuredClone(step.body))
          : backend.patchPolicy(step.resourceId, structuredClone(step.body)));
        if (!response.ok) throw new Error(response.error);
        const actual = await read(backend, target.id);
        if (await fingerprint(syncState(actual)) !== status.expected) throw new Error("Write completion or unchanged unrelated settings could not be verified. Reconcile known IDs; do not retry the write.");
        status.phase = "verified"; entry.phase = "pending"; persist(); expectedBefore = actual;
      }
      if (await fingerprint(syncState(await read(backend, target.id))) !== entry.expected) throw new Error("Final destination verification differs from the preview.");
      entry.phase = target.steps.length ? "verified" : "no-change"; persist();
    }
    for (const [index, target] of plan.targets.entries()) {
      if (await fingerprint(syncState(await read(backend, target.id))) !== record.targets[index].expected) {
        record.targets[index].phase = "indeterminate"; persist();
        throw new Error("A previously verified destination changed during the batch. All-target completion cannot be claimed; reconcile recorded IDs.");
      }
    }
    if (await fingerprint(await read(backend, plan.sourceId)) !== plan.sourceFingerprint) throw new Error("The source changed during sync; target outcomes remain recorded, but full completion cannot be claimed.");
    record.phase = "verified"; persist();
    return { record, message: "Selected rules verified in every selected group. No ongoing link was created." };
  } catch (error) {
    record.phase = record.targets.some((target) => target.phase === "indeterminate") ? "indeterminate"
      : record.targets.some((target) => target.steps.some((step) => step.phase === "verified")) ? "partial" : "blocked";
    const message = error instanceof Error ? error.message : String(error);
    try { persist(); } catch (storageError) {
      return { record, message: `${message} Recovery storage failed: ${String(storageError)}. Writes may have completed; retain the displayed resource IDs and do not retry.` };
    }
    return { record, message };
  }
}

export async function reconcileRuleSync(record: SyncRecord, backend: SyncBackend, store: SyncStore): Promise<SyncOutcome> {
  const next = structuredClone(record);
  try {
    if (await fingerprint(await read(backend, record.sourceId)) !== record.sourceFingerprint) throw new Error("Source differs from the reviewed snapshot. Recovery cannot claim equivalence; no writes were retried.");
    for (const target of next.targets) {
      const actual = await fingerprint(syncState(await read(backend, target.id)));
      if (actual === target.expected) {
        target.phase = target.steps.length ? "verified" : "no-change";
        target.steps.forEach((step) => { step.phase = "verified"; });
      } else {
        const matching = target.steps.findIndex((step) => actual === step.expected);
        if (matching >= 0) {
          target.steps.forEach((step, index) => { if (index <= matching) step.phase = "verified"; });
          target.phase = target.steps.some((step) => step.phase === "started") ? "indeterminate" : "blocked";
        } else target.phase = "indeterminate";
      }
    }
    next.phase = next.targets.length && next.targets.every((target) => ["verified", "no-change"].includes(target.phase)) ? "verified"
      : next.targets.some((target) => target.phase === "indeterminate") ? "indeterminate" : "partial";
    next.updatedAt = Date.now(); store.save(next);
    return { record: next, message: next.phase === "verified" ? "Read-only reconciliation verified the reviewed state in all selected groups."
      : "Some groups remain incomplete or uncertain. Review recorded IDs; no writes were retried or rolled back." };
  } catch (error) { return { record: next, message: `Read-only recovery failed: ${String(error)}. No writes were retried.` }; }
}
