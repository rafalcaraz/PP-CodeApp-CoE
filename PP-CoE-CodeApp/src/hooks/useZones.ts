/**
 * `useZones` — reactive subscription to the Zones localStorage layer.
 *
 * The data module (`src/data/zones.ts`) does the actual reads + writes;
 * this hook just keeps a React component in sync with both:
 *  - cross-tab `storage` events (browser-native)
 *  - same-tab nudges via a custom DOM event fired by every write
 *
 * Mutations (create/update/delete/setAssignment) should be called
 * directly on the data module — the hook listens for the resulting
 * change events and re-reads.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ZONES_CHANGE_EVENT,
  isZonesStorageKey,
  listAssignments,
  listZones,
  type Zone,
  type ZoneAssignments,
} from "../data/zones";

export interface UseZonesResult {
  zones: Zone[];
  assignments: ZoneAssignments;
  refresh: () => void;
}

export function useZones(): UseZonesResult {
  const [zones, setZones] = useState<Zone[]>(() => listZones());
  const [assignments, setAssignments] = useState<ZoneAssignments>(() =>
    listAssignments(),
  );

  const refresh = useCallback(() => {
    setZones(listZones());
    setAssignments(listAssignments());
  }, []);

  useEffect(() => {
    const localHandler = () => refresh();
    const storageHandler = (event: StorageEvent) => {
      if (isZonesStorageKey(event.key)) refresh();
    };
    window.addEventListener(ZONES_CHANGE_EVENT(), localHandler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(ZONES_CHANGE_EVENT(), localHandler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [refresh]);

  return { zones, assignments, refresh };
}
