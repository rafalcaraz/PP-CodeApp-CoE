import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FeatureFlagsContext, type FeatureFlagsContextValue } from "./context";
import { getStorageKey, readFlag, writeFlag } from "./storage";
import {
  FEATURE_FLAGS,
  type FeatureFlagKey,
  type FeatureFlagsState,
} from "./types";

function initialState(): FeatureFlagsState {
  // `as FeatureFlagsState` is safe because we iterate the canonical
  // FEATURE_FLAGS registry — every key in the type ends up filled.
  const next = {} as FeatureFlagsState;
  for (const def of FEATURE_FLAGS) {
    next[def.key] = readFlag(def.key, def.defaultValue);
  }
  return next;
}

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlagsState>(initialState);

  const setFlag = useCallback((key: FeatureFlagKey, value: boolean) => {
    setFlags((prev) => ({ ...prev, [key]: value }));
    writeFlag(key, value);
  }, []);

  // Cross-tab sync: when another tab toggles a flag, the storage event
  // fires here so this tab's UI stays in lockstep.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (!event.key) return;
      const def = FEATURE_FLAGS.find(
        (entry) => getStorageKey(entry.key) === event.key,
      );
      if (!def) return;
      const nextValue =
        event.newValue === null ? def.defaultValue : event.newValue === "true";
      setFlags((prev) => ({ ...prev, [def.key]: nextValue }));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const value = useMemo<FeatureFlagsContextValue>(
    () => ({ flags, setFlag }),
    [flags, setFlag],
  );

  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}
