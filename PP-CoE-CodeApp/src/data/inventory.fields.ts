/**
 * Per-resource-type field catalog for the inventory layer.
 *
 * The dashboard tile editor (and the Queries view) needs to offer field
 * suggestions in several places — Group by, Filter field, Sort by, Table
 * columns, Date field. Until this module landed those pickers all read
 * from a single flat list (`COMMON_FIELD_SUGGESTIONS` in `inventory.ts`),
 * which had two problems:
 *
 *   1. **Wrong fields suggested.** Picking *Copilot Studio agent* still
 *      surfaced `properties.appType` and `properties.flowTriggerType`
 *      (neither of which exists on agent payloads).
 *   2. **Right fields missing.** Agent-specific fields the connector
 *      actually returns (`schemaName`, `channels`, `authentication`,
 *      `lastPublishedAt`, `isWebSearchEnabledForKnowledge`, …) were
 *      never offered.
 *
 * The catalog below codifies what each resource type actually exposes,
 * sourced from the row converters (`toAppRow`, `toFlowRow`, `toAgentRow`
 * in `inventory.ts`) and `docs/inventory-schema-samples.md`. Adding a
 * field is a one-line change here.
 *
 * **Hard rule:** the picker only *suggests* — freeform typing is still
 * allowed everywhere. We never reject an unknown path. So out-of-date
 * catalog entries cost nothing beyond a missing suggestion.
 */

import { ResourceType, type ResourceTypeValue } from "./inventory";

/** Best-effort logical type of a field — drives intent-based filtering
 *  (e.g. only `kind: "date"` fields appear in the dateField picker)
 *  and lets future UIs render type-appropriate value controls. */
export type InventoryFieldKind =
  | "string"
  | "boolean"
  | "number"
  | "date"
  | "array"
  | "object";

/** Where a picker is being rendered. Lets `getFieldSuggestions` tailor
 *  the returned list — e.g. arrays and objects don't make sense as a
 *  Group-by field server-side, but are fine as Table columns. */
export type FieldPickerIntent =
  | "groupBy"
  | "filter"
  | "sort"
  | "column"
  | "dateField";

export interface InventoryField {
  /** Dotted path into the inventory payload. e.g. "properties.schemaName". */
  path: string;
  /** Friendly label shown next to the path in pickers. */
  label: string;
  /** Best-effort field kind for intent-based filtering. */
  kind: InventoryFieldKind;
  /** UI grouping shown as the `OptionGroup` label. e.g. "Identity",
   *  "Lifecycle", "Governance", "Behavior", "Sharing", "Connectors". */
  group: string;
  /** Optional one-liner shown as helper text in the option. */
  help?: string;
}

// ---------------------------------------------------------------------------
// Shared fields — present on (practically) every resource type. Listed
// once and merged into every per-type field set. Keeps the per-type
// blocks below focused on what's *specific* to each type.
// ---------------------------------------------------------------------------

const BASE_FIELDS: InventoryField[] = [
  { path: "type", label: "Resource type", kind: "string", group: "Identity" },
  { path: "name", label: "Resource ID (GUID)", kind: "string", group: "Identity" },
  { path: "location", label: "Region", kind: "string", group: "Identity" },
  { path: "properties.displayName", label: "Display name", kind: "string", group: "Identity" },
  { path: "properties.createdAt", label: "Created at", kind: "date", group: "Lifecycle" },
  { path: "properties.createdBy", label: "Created by", kind: "string", group: "Lifecycle" },
];

/** Fields shared by *almost* every type — included by default in each
 *  type's bag unless that type is explicitly known not to have them.
 *  Environments / env-groups have a slightly different shape and pick
 *  their own subset. */
const COMMON_LIFECYCLE: InventoryField[] = [
  { path: "properties.lastModifiedAt", label: "Last modified at", kind: "date", group: "Lifecycle" },
  { path: "properties.lastModifiedBy", label: "Last modified by", kind: "string", group: "Lifecycle" },
];

const COMMON_GOVERNANCE: InventoryField[] = [
  { path: "properties.isQuarantined", label: "Is quarantined", kind: "boolean", group: "Governance" },
  { path: "properties.isManaged", label: "Is managed", kind: "boolean", group: "Governance" },
];

const COMMON_OWNERSHIP: InventoryField[] = [
  { path: "properties.environmentId", label: "Environment ID", kind: "string", group: "Ownership" },
  { path: "properties.ownerId", label: "Owner ID", kind: "string", group: "Ownership" },
];

// ---------------------------------------------------------------------------
// Per-resource-type extras. Order matters — entries appear in the picker
// in the order listed (after `BASE_FIELDS`).
// ---------------------------------------------------------------------------

/** Fields specific to Canvas apps (`microsoft.powerapps/canvasapps`). */
const CANVAS_APP_FIELDS: InventoryField[] = [
  ...COMMON_OWNERSHIP,
  ...COMMON_LIFECYCLE,
  ...COMMON_GOVERNANCE,
  { path: "properties.lastLaunchedTime", label: "Last launched at", kind: "date", group: "Usage" },
  { path: "properties.appType", label: "App type", kind: "string", group: "Apps", help: "Canvas sub-classification (e.g. SharepointFormApp)." },
  { path: "properties.sharedUsersCount", label: "Shared users count", kind: "number", group: "Sharing" },
  { path: "properties.sharedGroupsCount", label: "Shared groups count", kind: "number", group: "Sharing" },
  { path: "properties.isFeaturedApp", label: "Is featured", kind: "boolean", group: "Governance" },
  { path: "properties.bypassConsent", label: "Bypass consent", kind: "boolean", group: "Governance" },
  { path: "properties.powerPlatformConnectors", label: "Connectors (raw array)", kind: "array", group: "Connectors", help: "Array of { connectorId, operations[] }. Use the 'Connector (any location)' sentinel for filtering." },
];

/** Fields specific to Model-driven apps (`microsoft.powerapps/modeldrivenapps`). */
const MODEL_DRIVEN_APP_FIELDS: InventoryField[] = [
  ...COMMON_OWNERSHIP,
  ...COMMON_LIFECYCLE,
  ...COMMON_GOVERNANCE,
  { path: "properties.logicalName", label: "Logical name", kind: "string", group: "Apps", help: "Dataverse logical name." },
  { path: "properties.appModuleId", label: "App module ID", kind: "string", group: "Apps", help: "Dataverse cross-reference." },
];

/** Fields specific to Code apps (`microsoft.powerapps/codeapps`). */
const CODE_APP_FIELDS: InventoryField[] = [
  ...COMMON_OWNERSHIP,
  ...COMMON_LIFECYCLE,
  ...COMMON_GOVERNANCE,
  { path: "properties.subType", label: "Sub-type", kind: "string", group: "Apps", help: "e.g. 'byocApp' for bring-your-own-code." },
];

/** Fields specific to App-builder apps (`microsoft.powerapps/apps`). */
const APP_BUILDER_FIELDS: InventoryField[] = [
  ...COMMON_OWNERSHIP,
  ...COMMON_LIFECYCLE,
  ...COMMON_GOVERNANCE,
  { path: "properties.subType", label: "Sub-type", kind: "string", group: "Apps", help: "e.g. 'appBuilderApp'." },
  { path: "properties.connectors", label: "Connectors (raw array)", kind: "array", group: "Connectors", help: "App-builder shape: { connectorId, connectionType }. Use the 'Connector (any location)' sentinel for filtering." },
];

/** Fields shared across all flow types (cloud / agent / workflow agent). */
const FLOW_SHARED: InventoryField[] = [
  ...COMMON_OWNERSHIP,
  ...COMMON_LIFECYCLE,
  ...COMMON_GOVERNANCE,
  { path: "properties.status", label: "Status", kind: "string", group: "Lifecycle", help: "Canonical run-state. Values: Activated, Suspended, Stopped, Started, NotStarted." },
  { path: "properties.state", label: "State (legacy)", kind: "string", group: "Lifecycle", help: "Older / alternate run-state field. Prefer 'status'." },
  { path: "properties.flowTriggerType", label: "Trigger type", kind: "string", group: "Behavior", help: "Instant, Automated, Recurrence, Manual." },
  { path: "properties.trigger.connectorId", label: "Trigger connector ID", kind: "string", group: "Behavior" },
  { path: "properties.trigger.operationId", label: "Trigger operation ID", kind: "string", group: "Behavior" },
  { path: "properties.workflowEntityId", label: "Workflow entity ID", kind: "string", group: "Behavior", help: "Dataverse-side ID for cross-referencing." },
  { path: "properties.powerPlatformConnectors", label: "Connectors (raw array)", kind: "array", group: "Connectors", help: "Use the 'Connector (any location)' sentinel for filtering." },
];

/** Fields specific to Copilot Studio agents (`microsoft.copilotstudio/agents`).
 *  Note: agents notably do NOT return `lastModifiedAt`, `lastModifiedBy`,
 *  `publishState`, or `state` (verified against real payloads). The only
 *  lifecycle timestamp is `lastPublishedAt`. */
const COPILOT_STUDIO_AGENT_FIELDS: InventoryField[] = [
  ...COMMON_OWNERSHIP,
  { path: "properties.isQuarantined", label: "Is quarantined", kind: "boolean", group: "Governance" },
  { path: "properties.isManaged", label: "Is managed", kind: "boolean", group: "Governance" },
  { path: "properties.lastPublishedAt", label: "Last published at", kind: "date", group: "Lifecycle", help: "Agents do NOT have a lastModifiedAt — this is the only lifecycle timestamp." },
  { path: "properties.schemaName", label: "Schema name", kind: "string", group: "Identity", help: "Carries solution publisher prefix (msdyn_, new_, <customer>_…). Use 'does not start with msdyn_' to hide first-party agents." },
  { path: "properties.entraAppId", label: "Entra app ID", kind: "string", group: "Identity" },
  { path: "properties.titleId", label: "Title ID", kind: "string", group: "Identity" },
  { path: "properties.createdIn", label: "Created in", kind: "string", group: "Identity", help: "Typically 'Copilot Studio'." },
  { path: "properties.authentication", label: "Authentication", kind: "string", group: "Behavior", help: "e.g. 'Microsoft Entra'." },
  { path: "properties.model", label: "Model", kind: "string", group: "Behavior", help: "e.g. 'Claude Sonnet 4.5', 'GPT-5 Chat'." },
  { path: "properties.orchestration", label: "Orchestration", kind: "string", group: "Behavior", help: "e.g. 'Generative'." },
  { path: "properties.instructionsCharactersCount", label: "Instructions length (chars)", kind: "number", group: "Behavior" },
  { path: "properties.isWebSearchEnabledForKnowledge", label: "Web search enabled", kind: "boolean", group: "Behavior" },
  { path: "properties.channels", label: "Channels", kind: "array", group: "Distribution", help: "Array of strings: Teams, Microsoft 365 Copilot, Direct Line Channels, …" },
  { path: "properties.sharedWithEditors.userCount", label: "Editors (user count)", kind: "number", group: "Sharing" },
  { path: "properties.sharedWithEditors.groupCount", label: "Editors (group count)", kind: "number", group: "Sharing" },
  { path: "properties.sharedWithViewers.userCount", label: "Viewers (user count)", kind: "number", group: "Sharing" },
  { path: "properties.sharedWithViewers.groupCount", label: "Viewers (group count)", kind: "number", group: "Sharing" },
  { path: "properties.sharedWithViewers.entireTenant", label: "Shared with entire tenant", kind: "boolean", group: "Sharing" },
  { path: "properties.capabilitiesCounts.distinctPowerPlatformConnectors", label: "Distinct connectors", kind: "number", group: "Connectors" },
  { path: "properties.capabilitiesCounts.distinctPowerPlatformConnectorsOperations", label: "Distinct connector operations", kind: "number", group: "Connectors" },
  { path: "properties.powerPlatformConnectors", label: "Connectors (raw array)", kind: "array", group: "Connectors" },
];

/** Fields specific to Environments (`microsoft.powerplatform/environments`).
 *  Environments don't have ownerId / quarantine; their lifecycle fields
 *  are also slightly different (no createdBy in some tenants — keep the
 *  base entry anyway, it's harmless when absent). */
const ENVIRONMENT_FIELDS: InventoryField[] = [
  { path: "properties.lastModifiedAt", label: "Last modified at", kind: "date", group: "Lifecycle" },
  { path: "properties.environmentType", label: "Environment type", kind: "string", group: "Identity", help: "Production, Default, Sandbox, Trial, Developer, Dataverse for Teams." },
  { path: "properties.isManaged", label: "Is managed", kind: "boolean", group: "Governance", help: "Managed Environment status." },
  { path: "properties.environmentGroup", label: "Environment group (name)", kind: "string", group: "Identity" },
  { path: "properties.environmentGroupId", label: "Environment group ID", kind: "string", group: "Identity" },
];

/** Environment groups (`microsoft.powerplatform/environmentgroups`).
 *  Sparsest of all types — no environmentId / ownerId since they ARE
 *  the grouping construct. */
const ENVIRONMENT_GROUP_FIELDS: InventoryField[] = [
  { path: "properties.description", label: "Description", kind: "string", group: "Identity" },
  ...COMMON_LIFECYCLE,
];

// ---------------------------------------------------------------------------
// Public map: every resource type → its full field bag (BASE + per-type).
// ---------------------------------------------------------------------------

/** Path → fields, indexed by every `ResourceTypeValue`. Each entry is the
 *  union of `BASE_FIELDS` and the type-specific extras above. Order:
 *  base fields first, then type-specific entries in the order declared. */
export const FIELDS_BY_RESOURCE_TYPE: Record<ResourceTypeValue, InventoryField[]> = {
  [ResourceType.CanvasApp]: [...BASE_FIELDS, ...CANVAS_APP_FIELDS],
  [ResourceType.ModelDrivenApp]: [...BASE_FIELDS, ...MODEL_DRIVEN_APP_FIELDS],
  [ResourceType.CodeApp]: [...BASE_FIELDS, ...CODE_APP_FIELDS],
  [ResourceType.AppBuilderApp]: [...BASE_FIELDS, ...APP_BUILDER_FIELDS],
  [ResourceType.CloudFlow]: [...BASE_FIELDS, ...FLOW_SHARED],
  [ResourceType.AgentFlow]: [...BASE_FIELDS, ...FLOW_SHARED],
  [ResourceType.WorkflowAgentFlow]: [...BASE_FIELDS, ...FLOW_SHARED],
  [ResourceType.CopilotStudioAgent]: [...BASE_FIELDS, ...COPILOT_STUDIO_AGENT_FIELDS],
  [ResourceType.Environment]: [...BASE_FIELDS, ...ENVIRONMENT_FIELDS],
  [ResourceType.EnvironmentGroup]: [...BASE_FIELDS, ...ENVIRONMENT_GROUP_FIELDS],
};

// ---------------------------------------------------------------------------
// Suggestion helper consumed by the UI.
// ---------------------------------------------------------------------------

/** Sentinel field paths injected for filter / column intents — they live
 *  in `inventory.ts` (CONNECTOR_FIELD, OPERATION_FIELD) but the labels
 *  are short enough to inline. Only surfaced when at least one resource
 *  type that can carry connectors is in scope. */
const CONNECTOR_SENTINELS: InventoryField[] = [
  {
    path: "__connector",
    label: "Connector (any location)",
    kind: "string",
    group: "Connectors",
    help: "Tokenised match across powerPlatformConnectors / connectors / trigger.",
  },
  {
    path: "__operation",
    label: "Operation (any location)",
    kind: "string",
    group: "Connectors",
    help: "Tokenised match across all connector operations.",
  },
];

const CONNECTOR_BEARING_TYPES: ReadonlySet<ResourceTypeValue> = new Set([
  ResourceType.CanvasApp,
  ResourceType.AppBuilderApp,
  ResourceType.CloudFlow,
  ResourceType.AgentFlow,
  ResourceType.WorkflowAgentFlow,
  ResourceType.CopilotStudioAgent,
]);

/** Intent → kinds the picker keeps. Intents not listed pass everything. */
const INTENT_KIND_ALLOW: Partial<Record<FieldPickerIntent, ReadonlySet<InventoryFieldKind>>> = {
  groupBy: new Set<InventoryFieldKind>(["string", "boolean", "number", "date"]),
  sort: new Set<InventoryFieldKind>(["string", "boolean", "number", "date"]),
  dateField: new Set<InventoryFieldKind>(["date"]),
  // filter and column intents pass every kind (sentinels handle arrays/objects).
};

/** Sentinel paths are always-on for filter/column intents but never for
 *  groupBy / sort / dateField (server can't index against them directly). */
const INTENT_ALLOWS_SENTINELS: ReadonlySet<FieldPickerIntent> = new Set<FieldPickerIntent>([
  "filter",
  "column",
]);

/** Returns the merged, intent-filtered, de-duplicated list of field
 *  suggestions for a tile editor combobox.
 *
 *  Behavior:
 *  - When `resourceTypes` is empty → union across every type (closest
 *    thing to "show me everything"). Useful for the "all resource
 *    types" tile case.
 *  - When non-empty → union across exactly the listed types. We pick
 *    union (not intersection) so the user sees every field they might
 *    plausibly want; the `group` label shows which scope contributes
 *    each entry.
 *  - Then filtered by intent (`groupBy` drops arrays/objects; `dateField`
 *    keeps only dates; `column` and `filter` pass everything).
 *  - Connector sentinels are appended for filter/column intents iff
 *    at least one selected type carries connectors.
 *  - De-duplicated by `path`, first-occurrence-wins so BASE_FIELDS
 *    keep their canonical metadata when a type also lists them.
 */
export function getFieldSuggestions(
  resourceTypes: ResourceTypeValue[],
  intent: FieldPickerIntent
): InventoryField[] {
  const types =
    resourceTypes.length > 0
      ? resourceTypes
      : (Object.keys(FIELDS_BY_RESOURCE_TYPE) as ResourceTypeValue[]);

  // First-occurrence-wins dedup. We rely on insertion order to keep the
  // grouping stable: shared/base fields first, then per-type extras in
  // declared order.
  const seen = new Map<string, InventoryField>();
  for (const t of types) {
    const bag = FIELDS_BY_RESOURCE_TYPE[t] ?? [];
    for (const f of bag) {
      if (!seen.has(f.path)) seen.set(f.path, f);
    }
  }

  // Apply intent-kind filter.
  const allowKinds = INTENT_KIND_ALLOW[intent];
  let suggestions = Array.from(seen.values());
  if (allowKinds) {
    suggestions = suggestions.filter((f) => allowKinds.has(f.kind));
  }

  // Append connector sentinels if relevant.
  if (
    INTENT_ALLOWS_SENTINELS.has(intent) &&
    types.some((t) => CONNECTOR_BEARING_TYPES.has(t))
  ) {
    suggestions.push(...CONNECTOR_SENTINELS);
  }

  return suggestions;
}

/** Convenience: group an `InventoryField[]` by `group` label, preserving
 *  first-seen order both for groups and within groups. Used by the
 *  picker to render Fluent `<OptionGroup>` sections. */
export function groupFields(fields: InventoryField[]): Array<{
  label: string;
  fields: InventoryField[];
}> {
  const groups = new Map<string, InventoryField[]>();
  for (const f of fields) {
    const key = f.group || "Other";
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  return Array.from(groups, ([label, fields]) => ({ label, fields }));
}
