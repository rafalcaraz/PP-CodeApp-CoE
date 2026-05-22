import { useContext } from "react";
import { FeatureFlagsContext } from "./context";
import type { FeatureFlagKey, FeatureFlagsState } from "./types";

function useFlagsContext() {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) {
    throw new Error(
      "Feature-flag hooks must be used inside <FeatureFlagsProvider>.",
    );
  }
  return ctx;
}

/** Returns the current boolean value of a single flag. */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useFlagsContext().flags[key];
}

/** Returns the full flag state — useful for the Settings page renderer. */
export function useAllFeatureFlags(): FeatureFlagsState {
  return useFlagsContext().flags;
}

/** Returns the setter so the Settings page (or dev tools) can flip a flag. */
export function useSetFeatureFlag() {
  return useFlagsContext().setFlag;
}
