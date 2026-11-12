import { useMemo, useState } from "react";
import { defaultView, isTableView, reconcileView, type TableView, type ViewColumn } from "./model";

export interface ViewPersistence {
  key: string;
  storage?: "local" | "session";
}
export function useTableView<T>(columns: ViewColumn<T>[], persistence?: ViewPersistence) {
  const [restored] = useState(() => {
    try {
      const raw = persistence && (persistence.storage === "session" ? sessionStorage : localStorage).getItem(persistence.key);
      if (!raw) return { view: defaultView(columns), error: "" };
      const parsed: unknown = JSON.parse(raw);
      if (!isTableView(parsed)) throw new Error("Unsupported table preferences");
      return { view: parsed, error: "" };
    } catch (error) {
      return { view: defaultView(columns), error: `View preferences could not be restored: ${error instanceof Error ? error.message : String(error)}. Reset view to replace them.` };
    }
  });
  const [stored, setStored] = useState(restored.view);
  const [error, setError] = useState(restored.error);
  const [blocked, setBlocked] = useState(!!restored.error);
  const view = useMemo(() => reconcileView(stored, columns), [stored, columns]);
  const change = (next: TableView, reset = false, persist = true) => {
    setStored(next);
    if (!persist) return;
    if (blocked && !reset) return;
    if (reset) setBlocked(false);
    try {
      if (persistence) (persistence.storage === "session" ? sessionStorage : localStorage).setItem(persistence.key, JSON.stringify(next));
      setError("");
    } catch (cause) {
      setError(`View is active but could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  return { view, change, error };
}
