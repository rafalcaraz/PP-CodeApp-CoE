import { createContext } from "react";
import type { FeatureFlagKey, FeatureFlagsState } from "./types";

export interface FeatureFlagsContextValue {
  flags: FeatureFlagsState;
  setFlag: (key: FeatureFlagKey, value: boolean) => void;
}

// Kept in its own module so the provider file only exports a component —
// this keeps `eslint-plugin-react-refresh` happy under Fast Refresh.
export const FeatureFlagsContext = createContext<
  FeatureFlagsContextValue | undefined
>(undefined);
