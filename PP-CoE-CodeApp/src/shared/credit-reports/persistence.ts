import { useSyncExternalStore } from "react";
import { readCreditReport, utcDay } from "./files";
import { getCreditReportCaptures, hydrateCreditReportCaptures, subscribeCreditReportCaptures } from "./store";
import { assignCreditReportTenant } from "./collection";
import { REPORT_NAMES, type CreditReport } from "./types";

const DATABASE = "pp-coe-credit-reports";
const STORE = "captures";
const MAX_SAVED_BYTES = 100 * 1024 * 1024;
type SavedCapture = Pick<CreditReport, "id" | "schemaVersion" | "name" | "source" | "loadedAt" | "requestedRange" | "tenantAssignment" | "fileName" | "original">;
interface SavedCollection { key: "collection"; version: 1; captures: SavedCapture[] }
interface RetentionState {
  ready: boolean;
  enabled: boolean;
  busy: boolean;
  savedAt?: string;
  error?: string;
}
let state: RetentionState = { ready: false, enabled: false, busy: false };
let initialization: Promise<void> | undefined;
let queue = Promise.resolve();
const listeners = new Set<() => void>();
function update(patch: Partial<RetentionState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useCreditReportRetention() {
  return useSyncExternalStore(subscribe, () => state);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Browser storage is not available in this player.")); return; }
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error ?? new Error("Could not open browser storage."));
    request.onblocked = () => { blocked = true; reject(new Error("Browser storage is blocked by another app tab. Close it and retry.")); };
  });
}
async function readCollection(): Promise<unknown> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get("collection");
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error("Reading saved captures was aborted."));
      tx.onerror = () => reject(tx.error ?? new Error("Could not read saved captures."));
    });
  } finally { db.close(); }
}
async function writeCollection(captures?: readonly CreditReport[]) {
  if (captures && captures.reduce((sum, capture) => sum + capture.original.size, 0) > MAX_SAVED_BYTES) {
    throw new Error("Browser retention is limited to 100 MiB of originals. Export and remove older captures, then retry saving. The previous saved collection is unchanged.");
  }
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (captures) {
        const saved: SavedCollection = {
          key: "collection", version: 1,
          captures: captures.map(({ id, schemaVersion, name, source, loadedAt, requestedRange, tenantAssignment, fileName, original }) =>
            ({ id, schemaVersion, name, source, loadedAt, requestedRange, tenantAssignment, fileName, original })),
        };
        store.put(saved);
      } else store.delete("collection");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Saving browser captures was aborted. The previous collection is unchanged."));
      tx.onerror = () => reject(tx.error ?? new Error("Browser captures could not be saved. Export a ZIP to keep a backup."));
    });
  } finally { db.close(); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
export async function restoreSavedCreditReports(value: unknown): Promise<CreditReport[]> {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.captures)) throw new Error("Unsupported saved capture collection. Export current data before clearing browser retention.");
  const restored: CreditReport[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const item of value.captures) {
    if (!isRecord(item) || item.schemaVersion !== 1 || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.loadedAt !== "string" || !Number.isFinite(Date.parse(item.loadedAt))
      || typeof item.fileName !== "string" || !(item.original instanceof Blob)
      || !REPORT_NAMES.some((name) => name === item.name)
      || !["upload", "connector", "power-platform-api"].includes(String(item.source))) {
      throw new Error("A saved capture has invalid metadata. No saved captures were restored.");
    }
    let requestedRange: CreditReport["requestedRange"];
    bytes += item.original.size;
    if (bytes > MAX_SAVED_BYTES) throw new Error("Saved originals exceed the 100 MiB browser retention limit. No saved captures were restored.");
    if (item.requestedRange !== undefined) {
      if (!isRecord(item.requestedRange) || typeof item.requestedRange.startDate !== "string" || typeof item.requestedRange.endDate !== "string") {
        throw new Error("A saved capture has invalid request dates.");
      }
      requestedRange = { startDate: utcDay(item.requestedRange.startDate), endDate: utcDay(item.requestedRange.endDate) };
      if (requestedRange.startDate > requestedRange.endDate) throw new Error("A saved capture has reversed request dates.");
    }
    const name = REPORT_NAMES.find((name) => name === item.name)!;
    const source = item.source === "connector" ? "connector" : item.source === "power-platform-api" ? "power-platform-api" : "upload";
    const parsed = await readCreditReport(item.original, item.fileName, { source, expected: name, requestedRange });
    let restoredCapture: CreditReport = { ...parsed, id: item.id, loadedAt: item.loadedAt };
    if (item.tenantAssignment !== undefined) {
      if (!isRecord(item.tenantAssignment) || typeof item.tenantAssignment.tenantId !== "string"
        || typeof item.tenantAssignment.assignedAt !== "string" || !Number.isFinite(Date.parse(item.tenantAssignment.assignedAt))) {
        throw new Error("A saved tenant assignment is invalid.");
      }
      restoredCapture = {
        ...assignCreditReportTenant(restoredCapture, item.tenantAssignment.tenantId),
        tenantAssignment: { tenantId: item.tenantAssignment.tenantId.trim().toLowerCase(), assignedAt: item.tenantAssignment.assignedAt },
      };
    }
    restored.push(restoredCapture);
    ids.add(item.id);
  }
  return restored;
}

function enqueueSave(captures: readonly CreditReport[] | undefined) {
  update({ busy: true });
  queue = queue.then(async () => {
    try {
      await writeCollection(captures);
      update({ savedAt: captures ? new Date().toISOString() : undefined, error: undefined });
    } catch (reason) {
      update({ error: `${reason instanceof Error ? reason.message : String(reason)} ${captures ? "" : "Deletion failed; previously saved reports may return on reload. Retry deletion. "}Current session data remains available; export it as a ZIP.` });
    }
  });
  const pending = queue;
  void pending.then(() => { if (pending === queue) update({ busy: false }); });
  return pending;
}

export function initializeCreditReportRetention() {
  initialization ??= (async () => {
    update({ busy: true });
    try {
      const saved = await readCollection();
      if (saved !== undefined) {
        const restored = await restoreSavedCreditReports(saved);
        hydrateCreditReportCaptures(restored);
        update({ enabled: true });
      }
    } catch (reason) {
      update({ error: `${reason instanceof Error ? reason.message : String(reason)} Browser history was not restored. Current session data is unchanged.` });
    } finally { update({ ready: true, busy: false }); }
    let previous = getCreditReportCaptures();
    subscribeCreditReportCaptures(() => {
      const current = getCreditReportCaptures();
      if (current === previous) return;
      previous = current;
      if (state.enabled) void enqueueSave(current);
    });
  })();
  return initialization;
}
export async function setCreditReportRetention(enabled: boolean) {
  await initializeCreditReportRetention();
  update({ enabled });
  await enqueueSave(enabled ? getCreditReportCaptures() : undefined);
}
