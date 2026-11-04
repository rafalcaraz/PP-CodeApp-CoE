import { fingerprint, canonical } from "./groupClone";
import { membershipId, type DataResult } from "./data";
import type { GroupEvidence, MovePreview, MoveSelection, PdeMovePreview } from "./governance";

export type MovePhase = "planned" | "removing" | "removed" | "adding" | "verified" | "already-member" | "failed" | "indeterminate" | "detached" | "stopped";
export type MoveProgressPhase = "queued" | "preparing" | "removing" | "adding" | "verifying" | "moved" | "already-member" | "needs-attention" | "stopped";
export interface MoveProgress { environmentId: string; phase: MoveProgressPhase }
export interface MoveRecord {
  version: 1;
  id: string;
  destinationId: string;
  previewHash: string;
  updatedAt: number;
  pdes: Array<{
    environmentId: string;
    sourceId: string;
    phase: MovePhase;
    remove: "none" | "started" | "accepted" | "denied" | "uncertain";
    add: "none" | "started" | "accepted" | "denied" | "uncertain";
    observedGroupId?: string;
    recoveryOf?: string[];
  }>;
}
export type MembershipCheckReason = "read-failed" | "pending" | "conflict";
export interface MoveOutcome {
  record: MoveRecord; messages: string[];
  verificationIssues?: Array<{ environmentId: string; reason: MembershipCheckReason }>;
  verifiedMemberships?: MembershipRead[];
}
export interface MembershipRead {
  environmentId: string; groupId: string; hasDataverse: boolean;
  evidence?: { source: "GetEnvironmentByIdForUser"; readAt: number; inventoryReadAt: number; inventoryGroupId: string };
}
export interface MoveBackend {
  prepare: (selection: MoveSelection[], destinationId: string) => Promise<DataResult<MovePreview>>;
  read: (environmentId: string) => Promise<DataResult<MembershipRead>>;
  remove: (sourceId: string, environmentId: string) => Promise<DataResult<void>>;
  add: (destinationId: string, environmentId: string) => Promise<DataResult<void>>;
  pause: () => Promise<void>;
}
export interface MoveStore { list: () => MoveRecord[]; save: (record: MoveRecord) => void }
export function moveWriteStatus(entry: MoveRecord["pdes"][number]): string {
  if (entry.remove === "none" && entry.add === "none") return "No membership writes were attempted by this operation.";
  if (entry.phase === "verified") return "Destination membership was verified for this operation. Historical request flags are retained.";
  if (entry.remove === "started" || entry.remove === "uncertain" || entry.add === "started" || entry.add === "uncertain") return "A membership write was attempted; completion is uncertain. Reconcile before any retry.";
  return `Recorded requests: remove ${entry.remove}; add ${entry.add}. Current membership must be verified separately.`;
}

function evidenceIdentity(evidence: GroupEvidence | undefined) {
  if (!evidence) return null;
  return { details: evidence.details, rulesets: evidence.rulesets, policies: evidence.policies };
}
function impactIdentity(pde: PdeMovePreview, includeSource = true) {
  return {
    environmentId: membershipId(pde.environmentId),
    sourceId: includeSource ? membershipId(pde.environment?.environmentGroupId ?? "") : "",
    apps: [...pde.apps].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
    resourceCount: pde.resourceCount,
    resources: [...(pde.resources ?? pde.apps)].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
    source: includeSource ? evidenceIdentity(pde.sourceEvidence) : null,
    destination: evidenceIdentity(pde.destinationEvidence),
  };
}
function completeEvidence(evidence: GroupEvidence | undefined): boolean {
  return !!evidence?.details.ok && !!evidence.rulesets.ok && evidence.rulesets.data.unresolved.length === 0 && !!evidence.policies.ok;
}
export function moveBlockers(preview: MovePreview): string[] {
  const errors: string[] = [];
  if (!membershipId(preview.destination.id) || !preview.pdes.length) errors.push("A fresh destination and at least one PDE are required.");
  if (new Set(preview.pdes.map((pde) => membershipId(pde.environmentId))).size !== preview.pdes.length) errors.push("Duplicate PDE identities are not a safe move plan.");
  for (const pde of preview.pdes) {
    if (pde.status === "error" || !pde.environment?.isManaged || pde.environment.environmentType !== "Developer") errors.push(`${pde.environmentId}: complete managed Developer eligibility/impact is required.`);
    if (!pde.resources || pde.resourceCount !== pde.resources.length
      || pde.resources.some((resource) => membershipId(resource.environmentId) !== membershipId(pde.environmentId))
      || new Set(pde.resources.map((resource) => `${resource.type}:${resource.id}`)).size !== pde.resources.length
      || pde.apps.some((app) => !pde.resources?.some((resource) => app.id === resource.id && app.type === resource.type))) {
      errors.push(`${pde.environmentId}: full resource identities and complete sibling impact are required.`);
    }
    if (pde.status === "already-member") continue;
    if (!completeEvidence(pde.destinationEvidence)
      || membershipId(pde.destinationEvidence?.groupId ?? "") !== membershipId(preview.destination.id)
      || (membershipId(pde.environment?.environmentGroupId ?? "")
        && (!completeEvidence(pde.sourceEvidence) || membershipId(pde.sourceEvidence?.groupId ?? "") !== membershipId(pde.environment?.environmentGroupId ?? "")))) {
      errors.push(`${pde.environmentId}: source/destination governance evidence is incomplete or has unresolved applicability.`);
    }
  }
  return errors;
}
export function moveNeedsCheck(entry: MoveRecord["pdes"][number]): boolean {
  if (entry.phase === "verified" || entry.phase === "already-member") return false;
  return entry.remove === "started" || entry.remove === "accepted" || entry.remove === "uncertain"
    || entry.add === "started" || entry.add === "accepted" || entry.add === "uncertain";
}
export function moveCanResume(entry: MoveRecord["pdes"][number]): boolean {
  return entry.phase === "detached" && entry.remove === "accepted"
    && (entry.add === "none" || entry.add === "denied") && entry.observedGroupId === "";
}
export function moveEntryUnresolved(record: MoveRecord, entry: MoveRecord["pdes"][number], records: MoveRecord[]): boolean {
  return moveNeedsCheck(entry) && !records.some((later) => later.id !== record.id && later.pdes.some((recovery) =>
    membershipId(recovery.environmentId) === membershipId(entry.environmentId)
    && recovery.phase === "verified" && recovery.recoveryOf?.includes(record.id)));
}
export function movePhaseLabel(entry: MoveRecord["pdes"][number], reason?: MembershipCheckReason): string {
  if (entry.phase === "verified") return "Moved";
  if (entry.phase === "already-member") return "Already in destination";
  if (entry.phase === "detached") return moveCanResume(entry) ? "Outside any group; ready for a confirmed add" : "Outside any group; status needs checking";
  if (moveNeedsCheck(entry)) {
    if (reason === "read-failed") return "Membership read failed; completion not confirmed";
    if (reason === "pending") return "Move requested; waiting for membership update";
    if (reason === "conflict") return "Unexpected group membership; move not confirmed";
    return "Move request not yet verified";
  }
  return "Not moved";
}
export function moveOutcomeLabel(outcome: MoveOutcome, entry: MoveRecord["pdes"][number]): string {
  const observed = outcome.verifiedMemberships?.find((read) => membershipId(read.environmentId) === membershipId(entry.environmentId));
  if (entry.phase === "verified" && observed?.evidence && observed.groupId === membershipId(outcome.record.destinationId)
    && observed.evidence.inventoryGroupId !== observed.groupId) return "Moved; inventory is updating";
  return movePhaseLabel(entry, outcome.verificationIssues?.find((issue) => issue.environmentId === entry.environmentId)?.reason);
}
export class PreviousMoveNeedsCheck extends Error {
  constructor() {
    super("A previous move needs its completion checked. No new membership writes were attempted. Choose Check previous move (read only), then prepare a fresh preview.");
    this.name = "PreviousMoveNeedsCheck";
  }
}
async function bounded<T>(request: Promise<T>, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out; a membership write may still complete. Check status before retrying.")), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function readMembership(backend: MoveBackend, environmentId: string, timeoutMs = 30_000): Promise<MembershipRead> {
  const result = await bounded(backend.read(environmentId), timeoutMs);
  if (!result.ok) throw new Error(result.error);
  if (membershipId(result.data.environmentId) !== membershipId(environmentId) || typeof result.data.groupId !== "string") throw new Error("Membership read omitted or changed the environment identity.");
  if (result.data.evidence && (!Number.isFinite(result.data.evidence.readAt)
    || result.data.evidence.readAt > Date.now() || Date.now() - result.data.evidence.readAt >= 60_000)) throw new Error("Direct membership evidence expired or has an invalid timestamp. Read it again before any write.");
  return { ...result.data, groupId: membershipId(result.data.groupId) };
}
class MembershipCompletionError extends Error {
  readonly reason: MembershipCheckReason;
  readonly observedGroupId?: string;
  constructor(reason: MembershipCheckReason, detail: string, observedGroupId?: string) {
    super(`Membership completion was not verified. ${detail} No write is retried.`);
    this.reason = reason;
    this.observedGroupId = observedGroupId;
  }
}
async function waitMembership(backend: MoveBackend, environmentId: string, target: string, previous: string, signal?: AbortSignal): Promise<MembershipRead> {
  let current: MembershipRead | undefined;
  let reason: MembershipCheckReason = "pending";
  let detail = "No matching membership update was returned.";
  const deadline = Date.now() + 60_000;
  for (let attempt = 0; attempt < 12; attempt++) {
    signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      current = await readMembership(backend, environmentId, Math.min(30_000, remaining));
    } catch (error) {
      reason = "read-failed";
      detail = `Last membership read failed: ${String(error)}`;
      signal?.throwIfAborted();
      if (Date.now() < deadline) await backend.pause();
      continue;
    }
    signal?.throwIfAborted();
    if (!current.hasDataverse) throw new Error("Direct read could not verify retained Dataverse eligibility during membership completion.");
    if (current.groupId === target) return current;
    reason = current.groupId === previous ? "pending" : "conflict";
    detail = `Last readable group: ${current.groupId || "ungrouped"}; expected ${target || "ungrouped"}.`;
    if (Date.now() < deadline) await backend.pause();
  }
  throw new MembershipCompletionError(reason, detail, current?.groupId);
}
function previewIdentity(preview: MovePreview) {
  return { destination: preview.destination, pdes: preview.pdes.map((pde) => impactIdentity(pde)).sort((a, b) => a.environmentId.localeCompare(b.environmentId)) };
}

export async function executePdeMoves(preview: MovePreview, backend: MoveBackend, store: MoveStore, confirmed: boolean, recoveryIds: string[] = [], onProgress?: (progress: MoveProgress) => void): Promise<MoveOutcome> {
  if (!confirmed) throw new Error("Explicit whole-PDE impact and non-atomic transfer confirmation is required.");
  if (!Number.isFinite(preview.preparedAt) || preview.preparedAt > Date.now() || Date.now() - preview.preparedAt > 5 * 60_000) throw new Error("The impact preview expired or has an invalid timestamp. Read it again before confirming.");
  const blockers = moveBlockers(preview);
  if (blockers.length) throw new Error(blockers.join(" "));
  const ids = new Set(preview.pdes.map((pde) => membershipId(pde.environmentId)));
  const history = store.list();
  const conflicts = history.flatMap((record) => record.pdes.filter((entry) => ids.has(membershipId(entry.environmentId))
    && moveEntryUnresolved(record, entry, history)).map((entry) => ({ record, entry })));
  if (conflicts.some(({ record, entry }) => !recoveryIds.includes(record.id) || !moveCanResume(entry)
    || membershipId(preview.pdes.find((pde) => membershipId(pde.environmentId) === membershipId(entry.environmentId))?.environment?.environmentGroupId ?? "") !== "")) {
    throw new PreviousMoveNeedsCheck();
  }
  if (recoveryIds.some((id) => !conflicts.some(({ record }) => record.id === id))) throw new Error("Recovery history changed. Prepare a fresh impact preview before confirming.");
  const record: MoveRecord = {
    version: 1, id: crypto.randomUUID(), destinationId: membershipId(preview.destination.id),
    previewHash: await fingerprint(previewIdentity(preview)), updatedAt: Date.now(),
    pdes: preview.pdes.map((pde) => ({
      environmentId: membershipId(pde.environmentId), sourceId: membershipId(pde.environment!.environmentGroupId),
      phase: "planned", remove: "none", add: "none",
      ...(conflicts.some(({ entry }) => membershipId(entry.environmentId) === membershipId(pde.environmentId))
        ? { recoveryOf: conflicts.filter(({ entry }) => membershipId(entry.environmentId) === membershipId(pde.environmentId)).map(({ record }) => record.id) } : {}),
    })),
  };
  const messages: string[] = [];
  const verificationIssues: NonNullable<MoveOutcome["verificationIssues"]> = [];
  const verifiedMemberships: MembershipRead[] = [];
  const save = () => { record.updatedAt = Date.now(); store.save(structuredClone(record)); };
  save();
  for (let index = 0; index < record.pdes.length; index++) {
    const entry = record.pdes[index];
    const planned = preview.pdes[index];
    let writeInFlight = false;
    let checkPhase = "fresh impact preflight";
    try {
      onProgress?.({ environmentId: entry.environmentId, phase: "preparing" });
      const fresh = await bounded(backend.prepare([{ environmentId: entry.environmentId }], record.destinationId));
      if (!fresh.ok) throw new Error(fresh.error);
      const current = fresh.data.pdes.find((pde) => membershipId(pde.environmentId) === entry.environmentId);
      if (!current || moveBlockers(fresh.data).length || canonical(impactIdentity(current)) !== canonical(impactIdentity(planned))
        || canonical(fresh.data.destination) !== canonical(preview.destination)) throw new Error("Membership, full sibling impact or governance changed since confirmation. Prepare a new preview.");
      checkPhase = "direct membership preflight (before any write)";
      const membership = await readMembership(backend, entry.environmentId);
      entry.observedGroupId = membership.groupId;
      if (!membership.hasDataverse) throw new Error("A Dataverse-backed environment is required; no automatic upgrade is performed.");
      if (membership.groupId !== entry.sourceId) throw new Error("Direct environment membership differs from the impact preview. No writes are allowed.");
      if (membership.groupId === record.destinationId) {
        entry.phase = "already-member"; verifiedMemberships.push(membership); save();
        onProgress?.({ environmentId: entry.environmentId, phase: "already-member" });
        continue;
      }
      if (entry.sourceId) {
        checkPhase = "source removal";
        entry.phase = "removing"; entry.remove = "started"; save(); writeInFlight = true;
        onProgress?.({ environmentId: entry.environmentId, phase: "removing" });
        const removed = await bounded(backend.remove(entry.sourceId, entry.environmentId));
        writeInFlight = false;
        if (!removed.ok) { entry.remove = "denied"; throw new Error(`Remove failed: ${removed.error}`); }
        entry.remove = "accepted"; save();
        checkPhase = "source-removal completion read";
        onProgress?.({ environmentId: entry.environmentId, phase: "verifying" });
        const ungrouped = await waitMembership(backend, entry.environmentId, "", entry.sourceId);
        entry.observedGroupId = ungrouped.groupId; entry.phase = "removed"; save();
        // Removal unlocks inherited settings. Recheck affected resources and destination
        // configuration before starting the separately authorized add, never rollback.
        checkPhase = "post-removal impact preflight";
        onProgress?.({ environmentId: entry.environmentId, phase: "preparing" });
        const afterRemove = await bounded(backend.prepare([{ environmentId: entry.environmentId }], record.destinationId));
        if (!afterRemove.ok) throw new Error(afterRemove.error);
        const unassigned = afterRemove.data.pdes.find((pde) => membershipId(pde.environmentId) === entry.environmentId);
        if (!unassigned || moveBlockers(afterRemove.data).length || membershipId(unassigned.environment?.environmentGroupId ?? "") !== ""
          || canonical(impactIdentity(unassigned, false)) !== canonical(impactIdentity(planned, false))) throw new Error("Impact or destination changed after removal. PDE is detached; no add or automatic restore was attempted.");
      }
      checkPhase = "membership check before destination add";
      const beforeAdd = await readMembership(backend, entry.environmentId);
      if (beforeAdd.groupId || !beforeAdd.hasDataverse) throw new Error("Membership or Dataverse eligibility changed before add. No further write is allowed.");
      checkPhase = "destination add";
      entry.phase = "adding"; entry.add = "started"; save(); writeInFlight = true;
      onProgress?.({ environmentId: entry.environmentId, phase: "adding" });
      const added = await bounded(backend.add(record.destinationId, entry.environmentId));
      writeInFlight = false;
      if (!added.ok) { entry.add = "denied"; throw new Error(`Add failed: ${added.error}`); }
      entry.add = "accepted"; save();
      checkPhase = "destination-add completion read";
      onProgress?.({ environmentId: entry.environmentId, phase: "verifying" });
      const destination = await waitMembership(backend, entry.environmentId, record.destinationId, "");
      entry.observedGroupId = destination.groupId; entry.phase = "verified"; save();
      verifiedMemberships.push(destination);
      onProgress?.({ environmentId: entry.environmentId, phase: "moved" });
      messages.push(`${entry.environmentId}: destination membership verified. Rule enforcement is platform-managed, not independently certified.`);
    } catch (error) {
      if (error instanceof MembershipCompletionError && error.observedGroupId !== undefined) entry.observedGroupId = error.observedGroupId;
      if (writeInFlight) {
        if (entry.phase === "removing") entry.remove = "uncertain";
        if (entry.phase === "adding") entry.add = "uncertain";
        entry.phase = "indeterminate";
      } else if (entry.remove === "accepted" || entry.add === "accepted") entry.phase = "indeterminate";
      else entry.phase = "failed";
      if (moveNeedsCheck(entry)) onProgress?.({ environmentId: entry.environmentId, phase: "verifying" });
      try {
        const observed = await readMembership(backend, entry.environmentId);
        entry.observedGroupId = observed.groupId;
        if (observed.hasDataverse && (entry.add === "accepted" || entry.add === "uncertain") && observed.groupId === record.destinationId) {
          entry.phase = "verified";
          verifiedMemberships.push(observed);
          messages.push(`${entry.environmentId}: destination membership verified by the recovery read after an earlier request/read error. No write was retried.`);
        } else if (!writeInFlight && entry.remove === "accepted" && (entry.add === "denied" || entry.add === "none") && !observed.groupId) entry.phase = "detached";
      } catch (readError) { messages.push(`Read-only reconciliation failed: ${String(readError)}`); }
      if (entry.phase !== "verified" && error instanceof MembershipCompletionError) {
        verificationIssues.push({ environmentId: entry.environmentId, reason: error.reason });
      }
      for (const remaining of record.pdes.slice(index + 1)) remaining.phase = "stopped";
      save();
      onProgress?.({ environmentId: entry.environmentId, phase: entry.phase === "verified" ? "moved" : "needs-attention" });
      for (const remaining of record.pdes.slice(index + 1)) onProgress?.({ environmentId: remaining.environmentId, phase: "stopped" });
      messages.push(`${entry.environmentId}: Phase: ${checkPhase}. ${String(error)} ${moveWriteStatus(entry)} Remaining PDEs stopped. No automatic retry, restore or cleanup. Use the recorded IDs for read-only reconciliation or manual admin recovery.`);
      break;
    }
  }
  return { record, messages, verificationIssues, verifiedMemberships };
}

export async function reconcilePdeMove(record: MoveRecord, backend: MoveBackend, store: MoveStore, signal?: AbortSignal, environmentIds: string[] = []): Promise<MoveOutcome> {
  const history = store.list();
  const current = history.find((entry) => entry.id === record.id);
  if (!current) throw new Error("The durable operation record is unavailable.");
  const next = structuredClone(current);
  const messages: string[] = [];
  const verificationIssues: NonNullable<MoveOutcome["verificationIssues"]> = [];
  const verifiedMemberships: MembershipRead[] = [];
  for (const entry of next.pdes) {
    signal?.throwIfAborted();
    if (environmentIds.length && !environmentIds.some((id) => membershipId(id) === membershipId(entry.environmentId))) continue;
    // Historical completion is immutable: a later legitimate transfer must not
    // turn an earlier verified operation into a detached/unfinished operation.
    if (!moveEntryUnresolved(current, entry, history)) {
      messages.push(`${entry.environmentId}: ${entry.phase}. ${moveWriteStatus(entry)} No unresolved request in this record; historical outcome retained.`);
      continue;
    }
    let observed: MembershipRead;
    try {
      observed = entry.add === "accepted" || entry.add === "started" || entry.add === "uncertain"
        ? await waitMembership(backend, entry.environmentId, membershipId(next.destinationId), "", signal)
        : await readMembership(backend, entry.environmentId);
      signal?.throwIfAborted();
      if (!observed.hasDataverse) throw new Error("Dataverse eligibility was not verified during read-only reconciliation.");
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof MembershipCompletionError && error.observedGroupId !== undefined) entry.observedGroupId = error.observedGroupId;
      verificationIssues.push({ environmentId: entry.environmentId, reason: error instanceof MembershipCompletionError ? error.reason : "read-failed" });
      messages.push(`${entry.environmentId}: read-only status check could not verify completion. ${String(error)}`);
      continue;
    }
    entry.observedGroupId = observed.groupId;
    if ((entry.add === "accepted" || entry.add === "started" || entry.add === "uncertain") && observed.groupId === membershipId(next.destinationId)) {
      entry.phase = "verified";
      verifiedMemberships.push(observed);
    } else if (entry.remove !== "none" && !observed.groupId) {
      // Keep uncertain writes unresolved: an accepted asynchronous add may still run.
      entry.phase = entry.add === "started" || entry.add === "accepted" || entry.add === "uncertain" || entry.remove === "uncertain" ? "indeterminate" : "detached";
    }
    messages.push(`${entry.environmentId}: current group ${observed.groupId || "ungrouped"}; phase ${entry.phase}. Read-only; no requests retried.`);
  }
  next.updatedAt = Date.now(); store.save(next);
  return { record: next, messages, verificationIssues, verifiedMemberships };
}
