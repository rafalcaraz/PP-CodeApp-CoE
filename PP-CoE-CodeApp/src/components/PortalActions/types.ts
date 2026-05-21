/**
 * Portal actions — types.
 *
 * Reusable "open this entity in an external Power Platform portal" bar that
 * sits at the top of detail pages (agent, app, flow, environment, env group).
 *
 * The engine is built around a small registry of `PortalDefinition`s. To add a
 * new portal (e.g. Power Pages, Dataverse Tables Editor, Solutions explorer),
 * append one entry in `registry.ts` — no detail page changes required.
 */
import type { ReactElement } from "react";
import { ResourceType, type ResourceTypeValue } from "../../data/inventory";

/**
 * Narrow union of the entity kinds the app surfaces today. Decoupled from the
 * raw `microsoft.*` resource type strings so portal URL builders can branch on
 * a stable, exhaustive shape without re-parsing those strings.
 */
export type PortalEntityKind =
  | "agent"
  | "canvasApp"
  | "modelDrivenApp"
  | "codeApp"
  | "appBuilderApp"
  | "cloudFlow"
  | "agentFlow"
  | "workflowAgentFlow"
  | "environment"
  | "environmentGroup";

/**
 * Convert a raw inventory `type` string (e.g. `microsoft.powerapps/canvasapps`)
 * into the corresponding `PortalEntityKind`. Returns `null` for any type the
 * portal engine doesn't recognise so callers can no-op gracefully.
 */
export function resourceTypeToEntityKind(
  type: ResourceTypeValue | string
): PortalEntityKind | null {
  switch (type) {
    case ResourceType.CopilotStudioAgent:
      return "agent";
    case ResourceType.CanvasApp:
      return "canvasApp";
    case ResourceType.ModelDrivenApp:
      return "modelDrivenApp";
    case ResourceType.CodeApp:
      return "codeApp";
    case ResourceType.AppBuilderApp:
      return "appBuilderApp";
    case ResourceType.CloudFlow:
      return "cloudFlow";
    case ResourceType.AgentFlow:
      return "agentFlow";
    case ResourceType.WorkflowAgentFlow:
      return "workflowAgentFlow";
    case ResourceType.Environment:
      return "environment";
    case ResourceType.EnvironmentGroup:
      return "environmentGroup";
    default:
      return null;
  }
}

/**
 * Everything a portal URL builder might need. Most fields are optional because
 * different portals require different bits — the URL builder declares its own
 * requirements via `isApplicable(ctx)`.
 *
 * `entityId` is always the bare GUID for the entity (the inventory data layer
 * stores `id` as `item.name`, which the API guarantees to be a GUID).
 * `environmentId` is likewise the bare environment GUID.
 */
export interface PortalContext {
  entityKind: PortalEntityKind;
  /** GUID of the entity itself. */
  entityId: string;
  /** GUID of the environment the entity lives in. Omit for env-groups. */
  environmentId?: string;
  /** Agent schema name (`crXXX_myAgent`) — preferred Copilot Studio URL key. */
  schemaName?: string;
  /** Model-driven app logical name (Dataverse table-prefixed). */
  logicalName?: string;
  /** Model-driven app's `appmodule` row GUID, if different from `entityId`. */
  appModuleId?: string;
  /** Cloud flow's workflow row GUID, when the maker URL needs it. */
  workflowEntityId?: string;
}

/**
 * Stable identifier for the set of portals we know about. New entries can be
 * added freely; existing entries should not be renamed (some tests / telemetry
 * may key off this value down the line).
 */
export type PortalKind =
  | "copilotStudio"
  | "ppac"
  | "ppacMcsCredits"
  | "powerAppsMaker"
  | "powerAutomateMaker";

/**
 * Registry entry. Each portal definition is consulted for every context; the
 * registry produces the list of `PortalAction`s the bar should render.
 */
export interface PortalDefinition {
  kind: PortalKind;
  /** Short human-readable portal name, e.g. "Copilot Studio". */
  portalName: string;
  /**
   * Per-entity-kind label override. Allows the same portal to show as
   * "Open in Power Apps" on a canvas app and "Open apps in Power Apps" on an
   * environment. Falls back to `Open in {portalName}` when omitted.
   */
  label?: (ctx: PortalContext) => string;
  /** Optional short description / tooltip. */
  description?: (ctx: PortalContext) => string;
  /** Icon element shown on the toolbar button. */
  icon: ReactElement;
  /** Whether this portal is applicable to the given context. */
  isApplicable: (ctx: PortalContext) => boolean;
  /** Build the absolute URL to open. Only called when `isApplicable` is true. */
  buildUrl: (ctx: PortalContext) => string;
}

/**
 * Concrete action produced from a definition + context. The bar renders one of
 * these per button.
 */
export interface PortalAction {
  kind: PortalKind;
  portalName: string;
  label: string;
  description: string;
  icon: ReactElement;
  url: string;
}
