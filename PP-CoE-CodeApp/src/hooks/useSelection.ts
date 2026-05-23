/**
 * `useSelection` — small generic Set-based selection hook for
 * multi-select UX (think Gmail / file-manager).
 *
 * Standard interaction patterns this enables:
 *  - Click a checkbox → toggle that one item
 *  - Shift+click → range select between last click and current (only if
 *    the caller passes an `orderedIds` list to anchor the range)
 *  - Cmd/Ctrl+click → toggle single without affecting other selections
 *  - Select all visible → caller's responsibility (just calls `set` with
 *    the visible IDs)
 *
 * The hook stays minimal: it owns the Set, exposes mutator helpers,
 * and computes the size. Caller decides what counts as "all" and where
 * range anchors live. Generic over the id type (`string` by default).
 */

import { useCallback, useState, useMemo } from "react";

export interface UseSelectionResult<T = string> {
  selected: Set<T>;
  isSelected: (id: T) => boolean;
  toggle: (id: T) => void;
  add: (ids: T | T[]) => void;
  remove: (ids: T | T[]) => void;
  set: (ids: T[]) => void;
  clear: () => void;
  count: number;
}

export function useSelection<T = string>(): UseSelectionResult<T> {
  const [selected, setSelected] = useState<Set<T>>(() => new Set<T>());

  const isSelected = useCallback(
    (id: T) => selected.has(id),
    [selected],
  );

  const toggle = useCallback((id: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const add = useCallback((ids: T | T[]) => {
    const list = Array.isArray(ids) ? ids : [ids];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of list) next.add(id);
      return next;
    });
  }, []);

  const remove = useCallback((ids: T | T[]) => {
    const list = Array.isArray(ids) ? ids : [ids];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of list) next.delete(id);
      return next;
    });
  }, []);

  const set = useCallback((ids: T[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set<T>()));
  }, []);

  const count = useMemo(() => selected.size, [selected]);

  return { selected, isSelected, toggle, add, remove, set, clear, count };
}
