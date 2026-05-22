// ---------------------------------------------------------------------------
// Registry of feature flags exposed to the CoE Code App.
//
// Add new flags here. Each entry drives both the runtime gate (via the
// useFeatureFlag hook) and the toggle row rendered on the Settings page.
// Keep the `key` literal-typed so consumers get autocomplete and can't
// reference a flag that doesn't exist.
// ---------------------------------------------------------------------------

export type FeatureFlagKey = "copilotStudioAssistant";

export interface FeatureFlagDefinition {
  key: FeatureFlagKey;
  label: string;
  description: string;
  defaultValue: boolean;
}

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    key: "copilotStudioAssistant",
    label: "CoE Assistant (Copilot Studio)",
    description:
      "Show the floating CoE Assistant chat panel that talks to a " +
      "Microsoft Copilot Studio agent. Leave this off if your " +
      "organization does not permit AI / Copilot Studio.",
    defaultValue: false,
  },
];

export type FeatureFlagsState = Record<FeatureFlagKey, boolean>;
