/**
 * Portal actions — registry.
 *
 * One entry per external Power Platform portal we know how to deep-link into.
 * Add a portal: append to `PORTAL_REGISTRY`. Add an entity kind: extend the
 * `isApplicable` / `buildUrl` for the relevant portals.
 *
 * URL formats are best-effort and based on the maker-portal URLs in use as of
 * early 2026. Power Platform's maker URLs are stable enough for this purpose
 * but not contractual; broken links should be reported and tweaked here.
 */
import { createElement } from "react";
import {
  BotRegular,
  AppsRegular,
  FlowRegular,
  SettingsRegular,
  MoneyRegular,
} from "@fluentui/react-icons";
import type {
  PortalAction,
  PortalContext,
  PortalDefinition,
  PortalEntityKind,
} from "./types";

const COPILOT_STUDIO_BASE = "https://copilotstudio.microsoft.com";
const PPAC_BASE = "https://admin.powerplatform.microsoft.com";
const PPAC_PREVIEW_BASE = "https://admin.preview.powerplatform.microsoft.com";
const POWER_APPS_BASE = "https://make.powerapps.com";
const POWER_AUTOMATE_BASE = "https://make.powerautomate.com";

const APP_MAKER_KINDS: ReadonlySet<PortalEntityKind> = new Set([
  "canvasApp",
  "modelDrivenApp",
  "codeApp",
  "appBuilderApp",
]);

const FLOW_MAKER_KINDS: ReadonlySet<PortalEntityKind> = new Set([
  "cloudFlow",
  "agentFlow",
  "workflowAgentFlow",
]);

export const PORTAL_REGISTRY: PortalDefinition[] = [
  // ---------------------------------------------------------------------------
  // Copilot Studio — agents only.
  // The bot key in the Copilot Studio URL is the agent's GUID (inventory `id`,
  // which is `item.name`). `schemaName` looks tempting but is NOT what the
  // portal routes on — using it 404s.
  // ---------------------------------------------------------------------------
  {
    kind: "copilotStudio",
    portalName: "Copilot Studio",
    icon: createElement(BotRegular),
    isApplicable: (ctx) => ctx.entityKind === "agent" && !!ctx.environmentId,
    buildUrl: (ctx) => {
      const env = encodeURIComponent(ctx.environmentId ?? "");
      const bot = encodeURIComponent(ctx.entityId);
      return `${COPILOT_STUDIO_BASE}/environments/${env}/bots/${bot}/overview`;
    },
    description: () => "Open this agent in the Copilot Studio maker portal.",
  },

  // ---------------------------------------------------------------------------
  // Power Platform Admin Center (PPAC) — environments and environment groups.
  // ---------------------------------------------------------------------------
  {
    kind: "ppac",
    portalName: "Power Platform Admin Center",
    icon: createElement(SettingsRegular),
    isApplicable: (ctx) =>
      ctx.entityKind === "environment" || ctx.entityKind === "environmentGroup",
    buildUrl: (ctx) => {
      if (ctx.entityKind === "environmentGroup") {
        return `${PPAC_BASE}/manage/envgroups/${encodeURIComponent(
          ctx.entityId
        )}/details`;
      }
      // environment
      return `${PPAC_BASE}/manage/environments/environment/${encodeURIComponent(
        ctx.entityId
      )}/hub`;
    },
    label: (ctx) =>
      ctx.entityKind === "environmentGroup"
        ? "Open group in admin center"
        : "Open environment in admin center",
    description: () =>
      "Manage this resource in the Power Platform Admin Center.",
  },

  // ---------------------------------------------------------------------------
  // Power Apps maker — apps (all four kinds) and environment app-list landing.
  // ---------------------------------------------------------------------------
  {
    kind: "powerAppsMaker",
    portalName: "Power Apps",
    icon: createElement(AppsRegular),
    isApplicable: (ctx) =>
      !!ctx.environmentId &&
      (APP_MAKER_KINDS.has(ctx.entityKind) || ctx.entityKind === "environment"),
    buildUrl: (ctx) => {
      const env = encodeURIComponent(ctx.environmentId ?? "");
      if (ctx.entityKind === "environment") {
        return `${POWER_APPS_BASE}/environments/${env}/apps`;
      }
      const id = encodeURIComponent(ctx.entityId);
      if (ctx.entityKind === "canvasApp") {
        return `${POWER_APPS_BASE}/environments/${env}/canvas/canvasapps/${id}/details`;
      }
      // model-driven / code / app-builder all share the generic /apps/{id} path
      return `${POWER_APPS_BASE}/environments/${env}/apps/${id}`;
    },
    label: (ctx) =>
      ctx.entityKind === "environment"
        ? "Open apps in Power Apps"
        : "Open in Power Apps",
    description: (ctx) =>
      ctx.entityKind === "environment"
        ? "Browse this environment's apps in the Power Apps maker portal."
        : "Open this app in the Power Apps maker portal.",
  },

  // ---------------------------------------------------------------------------
  // Power Automate maker — flows (all three kinds) and environment flow-list.
  // ---------------------------------------------------------------------------
  {
    kind: "powerAutomateMaker",
    portalName: "Power Automate",
    icon: createElement(FlowRegular),
    isApplicable: (ctx) =>
      !!ctx.environmentId &&
      (FLOW_MAKER_KINDS.has(ctx.entityKind) ||
        ctx.entityKind === "environment"),
    buildUrl: (ctx) => {
      const env = encodeURIComponent(ctx.environmentId ?? "");
      if (ctx.entityKind === "environment") {
        return `${POWER_AUTOMATE_BASE}/environments/${env}/flows`;
      }
      const id = encodeURIComponent(ctx.entityId);
      return `${POWER_AUTOMATE_BASE}/environments/${env}/flows/${id}/details`;
    },
    label: (ctx) =>
      ctx.entityKind === "environment"
        ? "Open flows in Power Automate"
        : "Open in Power Automate",
    description: (ctx) =>
      ctx.entityKind === "environment"
        ? "Browse this environment's flows in the Power Automate maker portal."
        : "Open this flow in the Power Automate maker portal.",
  },

  // ---------------------------------------------------------------------------
  // PPAC (preview) — Copilot Studio credit consumption / management view for
  // an environment. Lives on the *preview* admin host today; revisit when the
  // page moves to the GA `admin.powerplatform.microsoft.com` host.
  // ---------------------------------------------------------------------------
  {
    kind: "ppacMcsCredits",
    portalName: "MCS credits",
    icon: createElement(MoneyRegular),
    isApplicable: (ctx) => ctx.entityKind === "environment",
    buildUrl: (ctx) =>
      `${PPAC_PREVIEW_BASE}/billing/licenses/CopilotStudio/environmentview/${encodeURIComponent(
        ctx.entityId
      )}`,
    label: () => "Manage MCS credits",
    description: () =>
      "View and manage Microsoft Copilot Studio credit consumption for this environment.",
  },
];

/**
 * Resolve the applicable portal actions for the given context.
 *
 * Order in the returned list matches the order of definitions in
 * `PORTAL_REGISTRY`, so the toolbar layout is predictable and tweakable from
 * a single place.
 */
export function getPortalActions(ctx: PortalContext): PortalAction[] {
  const actions: PortalAction[] = [];
  for (const def of PORTAL_REGISTRY) {
    if (!def.isApplicable(ctx)) continue;
    const label = def.label?.(ctx) ?? `Open in ${def.portalName}`;
    const description = def.description?.(ctx) ?? `Open in ${def.portalName}.`;
    actions.push({
      kind: def.kind,
      portalName: def.portalName,
      label,
      description,
      icon: def.icon,
      url: def.buildUrl(ctx),
    });
  }
  return actions;
}
