// ---------------------------------------------------------------------------
// Registry of feature flags exposed to the CoE Code App.
//
// Add new flags here. Each entry drives both the runtime gate (via the
// useFeatureFlag hook) and the toggle row rendered on the Settings page.
// Keep the `key` literal-typed so consumers get autocomplete and can't
// reference a flag that doesn't exist.
// ---------------------------------------------------------------------------

export type FeatureFlagKey = "copilotStudioAssistant" | "zones" | "agentSkills";

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
  {
    key: "zones",
    label: "Zones (drag-and-drop env group organization)",
    description:
      "Adds the Zones view: a personal, drag-and-drop layer for " +
      "grouping Microsoft environment groups into your own pillars / " +
      "business units / sub-organizations. Microsoft does not provide " +
      "a parent layer over environment groups (they explicitly tell " +
      "admins to \"use naming conventions\"). Zones fills that gap " +
      "with localStorage-backed assignments — no changes are made to " +
      "any Microsoft data.",
    defaultValue: false,
  },
  {
    key: "agentSkills",
    label: "Agent skills viewer",
    description:
      "Adds a Skills area to the Copilot Studio agent detail page for " +
      "newer agents that support skills. Retrieves the agent's skill " +
      "components from Dataverse and lets you browse the skill file tree " +
      "and render individual files (markdown / code). Bundled-skill file " +
      "contents are sampled from mock fixtures until the file-download " +
      "flow is available.",
    defaultValue: true,
  },
];

export type FeatureFlagsState = Record<FeatureFlagKey, boolean>;
