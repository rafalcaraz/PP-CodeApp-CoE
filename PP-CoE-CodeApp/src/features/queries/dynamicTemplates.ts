/**
 * Dynamic query templates built from the live connector catalog.
 *
 * The static `QUERY_TEMPLATES` in `data/inventory.ts` are hard-coded
 * specs that don't know anything about the tenant. This module adds
 * templates whose filter values need to be computed at render time —
 * specifically the "find every resource that uses any premium
 * connector" template, which has to know the current list of premium
 * connector slugs.
 *
 * The slug list comes from the shared connector catalog
 * (`shared/connector-catalog/`). When the catalog hasn't loaded yet
 * `buildDynamicQueryTemplates` returns an empty array, so the
 * QueriesView simply doesn't show the dynamic cards until they're
 * meaningful — no disabled placeholders.
 *
 * Why this lives in the queries feature (not in shared):
 *
 *  - `QueryTemplate` and `QuerySpec` are defined in `data/inventory.ts`,
 *    which `shared/*` modules aren't allowed to import (boundary rule).
 *  - The queries feature is the only consumer; co-locating keeps the
 *    template list near the view that renders it.
 */

import {
  CONNECTOR_FIELD,
  ResourceType,
  type QuerySpec,
  type QueryTemplate,
} from "../../data/inventory";
import type { ConnectorCatalog } from "../../shared/connector-catalog";

/** Connectors used by every "premium resource" template. App-side and
 *  flow-side templates both include the OOB Microsoft / certified
 *  premium connector slugs plus the literal `customConnectors` token,
 *  which the underlying `has_any` matches against the stringified
 *  connector bag — catching custom connector ARM paths that include
 *  `/apis/customConnectors/`. Microsoft licensing treats every custom
 *  connector as premium, so this token is the right "catch-all" for
 *  the custom side. */
const CUSTOM_CONNECTOR_TOKEN = "customConnectors";

/** Build the value string for the `__connector in~ …` filter:
 *  every premium connector slug from the catalog, plus the
 *  `customConnectors` token to also catch custom-connector references.
 *  Returns `""` if the catalog has no premium entries — the caller
 *  should skip the template entirely in that case. */
export function buildPremiumConnectorMatchValue(
  catalog: ConnectorCatalog,
): string {
  const premiumSlugs: string[] = [];
  for (const entry of catalog.entries.values()) {
    if (entry.tier.toLowerCase() === "premium") {
      premiumSlugs.push(entry.connectorId);
    }
  }
  if (premiumSlugs.length === 0) return "";
  // Sort for stable output — easier diffing in saved-query exports.
  premiumSlugs.sort();
  premiumSlugs.push(CUSTOM_CONNECTOR_TOKEN);
  return premiumSlugs.join(",");
}

function premiumSpec(
  resourceTypes: ResourceSpecTypes,
  matchValue: string,
): QuerySpec {
  return {
    resourceTypes,
    filters: [{ field: CONNECTOR_FIELD, op: "in~", value: matchValue }],
    orderField: "properties.lastModifiedAt",
    orderDirection: "desc",
    limit: 200,
  };
}

type ResourceSpecTypes = QuerySpec["resourceTypes"];

const APP_TYPES: ResourceSpecTypes = [
  ResourceType.CanvasApp,
  ResourceType.ModelDrivenApp,
  ResourceType.CodeApp,
  ResourceType.AppBuilderApp,
];

const FLOW_TYPES: ResourceSpecTypes = [
  ResourceType.CloudFlow,
  ResourceType.AgentFlow,
  ResourceType.WorkflowAgentFlow,
];

const AGENT_TYPES: ResourceSpecTypes = [ResourceType.CopilotStudioAgent];

/**
 * Returns dynamic query templates derived from the supplied catalog.
 * Empty array when the catalog is missing or has no premium entries —
 * QueriesView merges this with `QUERY_TEMPLATES` and renders all of
 * them in the same grid, so an empty array means the dynamic cards
 * simply don't appear yet.
 */
export function buildDynamicQueryTemplates(
  catalog: ConnectorCatalog | undefined,
): QueryTemplate[] {
  if (!catalog) return [];
  const matchValue = buildPremiumConnectorMatchValue(catalog);
  if (!matchValue) return [];

  // Pre-count premium slugs (matchValue includes the appended custom
  // token, so subtract 1) for the human-readable description.
  const premiumCount = matchValue.split(",").length - 1;
  const sharedSuffix =
    `Matches against the ${premiumCount} premium connectors currently in the OOB ` +
    "catalog, plus a catch-all token for custom connectors (Microsoft licensing " +
    "treats every custom connector as premium).";

  return [
    {
      id: "premium-apps",
      name: "Apps using premium connectors",
      description: `Every app type (canvas, model-driven, code, app-builder) that declares a connection to a premium connector. ${sharedSuffix}`,
      spec: premiumSpec(APP_TYPES, matchValue),
    },
    {
      id: "premium-flows",
      name: "Flows using premium connectors",
      description: `Cloud flows, agent flows, and workflow agent flows that declare a connection to a premium connector. ${sharedSuffix}`,
      spec: premiumSpec(FLOW_TYPES, matchValue),
    },
    {
      id: "premium-agents",
      name: "Copilot Studio agents using premium connectors",
      description: `Agents that declare a connection to a premium connector. ${sharedSuffix}`,
      spec: premiumSpec(AGENT_TYPES, matchValue),
    },
  ];
}
