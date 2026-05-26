/**
 * Curated property registry for the `admin-apps` source.
 *
 * Each entry surfaces a payload field the platform team has decided
 * is worth a friendly label and a validated filter UI. Adding a row
 * here is the lightweight way to promote a discovered field into the
 * "first-class" catalog — no other code change required.
 *
 * Rules of thumb when adding entries:
 *
 *  - **Only fields not on `AppRow`.** If `QueryResources` already
 *    surfaces the field via the inventory graph, prefer extending
 *    the base list view; deep-scan is for fields the base graph
 *    doesn't expose.
 *  - **Stable id, in camelCase.** Saved queries reference properties
 *    by id; renaming an id breaks every saved query that used it.
 *  - **`addedIn` is required.** Even when undated in development —
 *    use today's date as a sentinel so drift reports can identify
 *    stale entries. `lastVerified` is optional and bumped manually
 *    when a maintainer audits the catalog against real responses.
 *  - **Filter `kind` should match the real payload.** Don't declare
 *    `enum` when the connector returns free-form text — the picker
 *    will offer a hardcoded dropdown of stale values; use `string`
 *    instead so the UI offers contains / equals.
 *
 * The shapes referenced here come from the `Get_AdminApps` payload —
 * see `docs/admin-connector-inventory.md` (and the
 * `Get_AdminApp` PowerApp model) for field documentation.
 */

import type { CuratedProperty } from "./types";

/** Provisional "added in this version" date used as a sentinel until
 *  we have release-driven versioning. Bumping this on every PR isn't
 *  necessary — it's just for drift reporting. */
const ADDED_IN = "2026-05-26";

export const CURATED_ADMIN_APPS: CuratedProperty[] = [
  // ── Embedded app (SharePoint / Teams / Power BI / D365) ────────────
  {
    id: "embeddedAppType",
    label: "Embedded app type",
    path: "properties.embeddedApp.type",
    group: "Embedded app",
    filter: {
      kind: "enum",
      // Common values from observed payloads. The introspector adds
      // any new values it sees; the picker shows the union.
      values: ["SharepointFormApp", "TeamsApp", "PowerBI", "D365"],
    },
    source: "admin-apps",
    addedIn: ADDED_IN,
    helpText:
      "Sub-classification for canvas apps embedded in another product. " +
      "'SharepointFormApp' identifies SharePoint list form apps.",
  },
  {
    id: "embeddedAppSiteId",
    label: "Embedded SharePoint site",
    path: "properties.embeddedApp.siteId",
    group: "Embedded app",
    filter: { kind: "string" },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },
  {
    id: "embeddedAppListUrl",
    label: "Embedded list URL",
    path: "properties.embeddedApp.listUrl",
    group: "Embedded app",
    filter: { kind: "string" },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },

  // ── Licensing posture ──────────────────────────────────────────────
  {
    id: "usesPremiumApi",
    label: "Uses premium API",
    path: "properties.usesPremiumApi",
    group: "Licensing",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: ADDED_IN,
    helpText: "True when the app uses any premium-tier connector or action.",
  },
  {
    id: "usesOnlyGrandfatheredPremiumApis",
    label: "Only grandfathered premium APIs",
    path: "properties.usesOnlyGrandfatheredPremiumApis",
    group: "Licensing",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: ADDED_IN,
    helpText:
      "True when every premium API in the app is grandfathered (no per-user " +
      "license required for existing users).",
  },
  {
    id: "appPlanClassification",
    label: "Plan classification",
    path: "properties.appPlanClassification",
    group: "Licensing",
    filter: { kind: "enum", values: ["Standard", "Premium"] },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },

  // ── Connectivity ───────────────────────────────────────────────────
  {
    id: "usesOnPremiseGateway",
    label: "Uses on-premises gateway",
    path: "properties.usesOnPremiseGateway",
    group: "Connectivity",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },
  {
    id: "usesCustomApi",
    label: "Uses custom connector",
    path: "properties.usesCustomApi",
    group: "Connectivity",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },

  // ── Governance / DLP ───────────────────────────────────────────────
  {
    id: "dlpStatus",
    label: "DLP evaluation",
    path: "properties.executionRestrictions.dataLossPreventionEvaluationResult.status",
    group: "Governance",
    filter: {
      kind: "enum",
      values: ["Compliant", "NonCompliant", "Pending"],
    },
    source: "admin-apps",
    addedIn: ADDED_IN,
    helpText:
      "Last-evaluated DLP result for the app. NonCompliant apps are blocked " +
      "from running until the offending connector configuration is fixed.",
  },

  // ── Lifecycle ──────────────────────────────────────────────────────
  {
    id: "lifeCycleId",
    label: "Lifecycle state",
    path: "properties.lifeCycleId",
    group: "Lifecycle",
    filter: { kind: "enum", values: ["Draft", "Published"] },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },
  {
    id: "isFeaturedApp",
    label: "Featured app",
    path: "properties.isFeaturedApp",
    group: "Lifecycle",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },
  {
    id: "isHeroApp",
    label: "Hero app",
    path: "properties.isHeroApp",
    group: "Lifecycle",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: ADDED_IN,
  },
];
