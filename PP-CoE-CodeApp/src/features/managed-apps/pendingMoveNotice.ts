import { moveEntryUnresolved, type MoveRecord } from "./pdeMoves";

let dismissedState = "";
const listeners = new Set<() => void>();

export function pendingMoveState(records: MoveRecord[]): string {
  const pending = records.flatMap((record) => record.pdes.filter((entry) => moveEntryUnresolved(record, entry, records))
    .map((entry) => JSON.stringify([record.id, record.destinationId, entry.environmentId, entry.phase, entry.remove, entry.add, entry.observedGroupId ?? null])))
    .sort();
  return pending.length ? JSON.stringify(pending) : "";
}

export const pendingMoveNotice = {
  getSnapshot: () => dismissedState,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  dismiss: (state: string) => {
    dismissedState = state;
    for (const listener of listeners) listener();
  },
};
