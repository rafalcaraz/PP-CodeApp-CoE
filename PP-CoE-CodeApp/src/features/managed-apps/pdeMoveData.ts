import { PowerPlatformforAdminsV2Service } from "../../generated";
import { invalidateInventoryCache } from "../../data/inventory";
import { formatApiError } from "../../shared/api-explorer/schema";
import { preparePdeMoves, type MovePreview } from "./governance";
import { membershipId } from "./data";
import { readLivePdeMembership } from "./pdeMembership";
import { jsonObject } from "./groupClone";
import { executePdeMoves, reconcilePdeMove, type MoveBackend, type MoveProgress, type MoveRecord, type MoveStore } from "./pdeMoves";

export const MOVE_NOTICE = "Requires the Power Platform Administrator role (not checked in advance). Destination published rules apply. Moving between groups removes then adds the PDE; if adding fails, it may remain outside any group. No automatic retry or rollback.";
const API_VERSION = "2024-10-01";
const PREFIX = "ppcoe:managed-apps:pde-move:v1:";
const phases = ["planned", "removing", "removed", "adding", "verified", "already-member", "failed", "indeterminate", "detached", "stopped"];
const writes = ["none", "started", "accepted", "denied", "uncertain"];
function validRecord(value: unknown): value is MoveRecord {
  return jsonObject(value) && Object.keys(value).every((key) => ["version", "id", "destinationId", "previewHash", "updatedAt", "pdes"].includes(key))
    && value.version === 1 && ["id", "destinationId", "previewHash"].every((key) => typeof value[key] === "string" && !!value[key])
    && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && Array.isArray(value.pdes) && value.pdes.length > 0
    && new Set(value.pdes.map((entry) => jsonObject(entry) ? entry.environmentId : null)).size === value.pdes.length && value.pdes.every((entry) =>
      jsonObject(entry) && Object.keys(entry).every((key) => ["environmentId", "sourceId", "phase", "remove", "add", "observedGroupId", "recoveryOf"].includes(key))
      && typeof entry.environmentId === "string" && !!membershipId(entry.environmentId) && typeof entry.sourceId === "string"
      && phases.includes(String(entry.phase)) && writes.includes(String(entry.remove)) && writes.includes(String(entry.add))
      && (entry.observedGroupId === undefined || typeof entry.observedGroupId === "string")
      && (entry.recoveryOf === undefined || (Array.isArray(entry.recoveryOf) && entry.recoveryOf.length > 0
        && entry.recoveryOf.every((id) => typeof id === "string" && !!id && id !== value.id)
        && new Set(entry.recoveryOf).size === entry.recoveryOf.length)));
}
export const pdeMoveStore: MoveStore = {
  list: () => {
    const records: MoveRecord[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!validRecord(raw) || `${PREFIX}${raw.id}` !== key) throw new Error("Invalid PDE transfer journal. Retain recorded identities and resolve storage before issuing writes.");
      records.push(raw);
    }
    return records;
  },
  save: (record) => {
    if (!validRecord(record)) throw new Error("Unsafe PDE transfer journal. Only identities, fingerprints and outcomes can be stored.");
    localStorage.setItem(`${PREFIX}${record.id}`, JSON.stringify(record));
  },
};

function rejected(error: unknown): boolean {
  if (!jsonObject(error)) return false;
  const status = error.statusCode ?? error.status ?? (jsonObject(error.error) ? error.error.statusCode ?? error.error.status : undefined);
  return typeof status === "number" && status >= 400 && status < 500;
}
async function write(action: () => ReturnType<typeof PowerPlatformforAdminsV2Service.AddEnvironmentToGroup>) {
  try {
    const result = await action();
    if (!result.success) {
      const message = formatApiError(result.error);
      if (rejected(result.error) || /\b(unauthorized|forbidden|access denied|permission denied)\b/i.test(message)) return { ok: false as const, error: message };
      throw new Error(`Membership request failed without a conclusive rejection status: ${message}. It may still complete.`);
    }
    return { ok: true as const, data: undefined };
  } catch (error) {
    if (rejected(error)) return { ok: false as const, error: formatApiError(error) };
    throw error;
  } finally { invalidateInventoryCache(); }
}
export const pdeMoveBackend: MoveBackend = {
  prepare: (selection, destinationId) => preparePdeMoves(selection, destinationId),
  read: (environmentId) => readLivePdeMembership(environmentId),
  remove: (sourceId, environmentId) => write(() => PowerPlatformforAdminsV2Service.RemoveEnvironmentFromGroup(sourceId, environmentId, API_VERSION)),
  add: (destinationId, environmentId) => write(() => PowerPlatformforAdminsV2Service.AddEnvironmentToGroup(destinationId, environmentId, API_VERSION)),
  pause: () => new Promise((resolve) => setTimeout(resolve, 5000)),
};

export async function executeLivePdeMoves(preview: MovePreview, confirmed: boolean, recoveryIds: string[] = [], onProgress?: (progress: MoveProgress) => void) {
  if (!navigator.locks) throw new Error("This browser cannot safely serialize transfer attempts across tabs. Use a browser supporting Web Locks.");
  return navigator.locks.request("ppcoe:managed-apps:pde-transfer", { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another tab is executing or reconciling PDE transfers. Wait; do not retry.");
    return executePdeMoves(preview, pdeMoveBackend, pdeMoveStore, confirmed, recoveryIds, onProgress);
  });
}
export async function reconcileLivePdeMove(record: MoveRecord) {
  if (!navigator.locks) throw new Error("Web Locks are required for safe journal reconciliation across tabs.");
  return navigator.locks.request("ppcoe:managed-apps:pde-transfer", { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another tab is executing a PDE transfer. Wait before reconciliation.");
    return reconcilePdeMove(record, pdeMoveBackend, pdeMoveStore);
  });
}
export async function checkPreviousPdeMoves(environmentIds: string[], signal?: AbortSignal) {
  if (!navigator.locks) throw new Error("Web Locks are required for safe journal reconciliation across tabs.");
  return navigator.locks.request("ppcoe:managed-apps:pde-transfer", { ifAvailable: true }, async (lock) => {
    signal?.throwIfAborted();
    if (!lock) throw new Error("Another tab is executing a PDE transfer. Wait before checking previous moves.");
    const ids = new Set(environmentIds.map(membershipId));
    const records = pdeMoveStore.list().filter((record) => !ids.size || record.pdes.some((entry) => ids.has(membershipId(entry.environmentId))));
    const outcomes = [];
    for (const record of records) outcomes.push(await reconcilePdeMove(record, pdeMoveBackend, pdeMoveStore, signal, environmentIds));
    return outcomes;
  });
}
