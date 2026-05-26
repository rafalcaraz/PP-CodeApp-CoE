/**
 * Zone-move ACP impact — "if I moved env E into env group G, which
 * connectors used by resources in E would NOT be on G's Advanced
 * Connector Policy (ACP) allow-list?"
 *
 * Powers the analysis section in `EnvMoveDemoDialog` (zones Tier-2
 * Kanban "preview the future" dialog). Strictly a preview surface — no
 * mutations.
 *
 * Companion to `acpImpact.ts` but pivoted:
 *   - `acpImpact.queryAcpImpact`: pick a connector and an env group →
 *     "which resources in any env in this group use that connector
 *     today" (one connector across all envs in the group).
 *   - this module: pick a single env and a target env group →
 *     "which connectors used by THIS env's resources would NOT be on
 *     the TARGET group's ACP allow-list" (all connectors used by one
 *     env, diffed against one group's allow-list).
 *
 * V1 scope: connector-membership diff only (matches the framing in
 * `acpDiff.ts`). Per-action ACP differences are deferred — connector
 * presence is the more impactful signal and matches how users
 * mentally model "this connector got blocked".
 *
 * `shared_` prefix mismatch:
 * Power Apps + Copilot Studio agents publish prefixed connector slugs
 * (e.g. `shared_sql`), while Power Automate flows publish bare slugs
 * (e.g. `sql`). The shared inventory `__connectorBag` filter handles
 * this for FILTER queries via `connectorIdVariants`. Here we apply
 * the same trick on the client side:
 *   1. Normalize every used connector to its bare form before bagging.
 *   2. When checking membership against the ACP allow-list, expand the
 *      bare slug into both forms and accept either match.
 * Without that, a flow using `sql` against an ACP allow-list whose
 * entry is `shared_sql` would silently be classified "at risk" when
 * it's actually allowed (or vice-versa).
 */

import {
  friendlyConnectorName,
  getEnvironmentNameMap,
  ResourceType,
  runRawQuery,
  where,
  orderBy,
  type DataResult,
} from "./inventory";
import {
  extractAcpSnapshot,
  type AcpSnapshot,
  type AcpAllowedConnector,
} from "./acpDiff";
import { getEnvironmentGroupAcpStatus } from "./dlpPolicies";
import { connectorIdVariants } from "./dlpImpact";
import type {
  Clause,
  ResourceItem,
} from "../generated/models/PowerPlatformforAdminsV2Model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resource types we sweep for connector usage. Same eight that the
 *  shared impact query loop uses (`IMPACT_RESOURCE_TYPES` in
 *  `dlpImpact.ts`); duplicated here to avoid a public export of an
 *  array that's only loosely a contract. */
const SWEEP_RESOURCE_TYPES: string[] = [
  ResourceType.CanvasApp,
  ResourceType.ModelDrivenApp,
  ResourceType.CodeApp,
  ResourceType.AppBuilderApp,
  ResourceType.CloudFlow,
  ResourceType.AgentFlow,
  ResourceType.WorkflowAgentFlow,
  ResourceType.CopilotStudioAgent,
];

/** Hard cap on `skipToken` pages. Mirrors `dlpImpact.PAGE_CAP`; one
 *  env is small enough that 20 pages × 500 = 10 000 rows is way more
 *  than we'd ever expect in a single environment. */
const PAGE_CAP = 20;
/** Page size for the resource sweep. Matches `dlpImpact.PAGE_SIZE`. */
const PAGE_SIZE = 500;

/** Top-N resources surfaced per at-risk connector in the dialog. The
 *  full list is still available via the existing security/impact view
 *  (the dialog renders a "view all" link). */
export const ZONE_MOVE_IMPACT_TOP_N = 5;

/** Lifecycle state of the target group's ACP — drives the dialog
 *  framing more than the per-row data does. */
export type TargetAcpState =
  | "not-configured" // No ConnectorManagement rule on the group.
  | "advisory" // ConnectorManagement rule exists but `acpOnly` is off.
  | "enforced"; // ConnectorManagement rule exists AND `acpOnly` is on.

/** A resource that uses an at-risk connector. Mirrors the slim shape
 *  used by `DlpImpactRow` (id + type + name + env + owner + href).
 *  Kept independent so the field set can drift as the dialog
 *  evolves. */
export interface ImpactedResource {
  id: string;
  type: string;
  displayName: string;
  environmentId: string;
  environmentName: string;
  ownerId: string;
  ownerDisplayName: string;
  /** App-style hash route for the resource's detail page. Empty for
   *  types without a detail surface. */
  detailHref: string;
}

/** A connector used by at least one resource in the env. */
export interface UsedConnector {
  /** Bare slug (no `shared_` prefix). Lowercased. Canonical key for
   *  both bagging and de-duplication. */
  slug: string;
  /** Friendly display name (`friendlyConnectorName`). */
  displayName: string;
  /** Whichever form the resource(s) actually published. Useful for
   *  debugging payload-shape oddities; not required for the diff. */
  publishedForms: string[];
  /** Resources in the source env that use this connector. */
  resources: ImpactedResource[];
  /** Distinct operation IDs observed across all resources for this
   *  connector. Sorted alphabetically. Empty for connector-only usage
   *  (e.g. app-builder apps or Knowledge sources with no operationId). */
  operationsUsed: string[];
}

/** Used connector + at-risk classification + the slice of resources to
 *  render in the dialog (top-N). Full resource list is still
 *  available on `.resources`. */
export interface AtRiskConnector extends UsedConnector {
  /** Always `true` here — present as an explicit flag so the type
   *  stays parallel with `UsedConnector` in the result envelope. */
  atRisk: true;
  /** Top-N resources for the inline expand; the dialog renders this
   *  and a "+N more" link when `resources.length > topResources.length`. */
  topResources: ImpactedResource[];
  /** Why this connector is at risk:
   *  - `"blocked"`: connector is not on the allow-list at all
   *  - `"action-restricted"`: connector IS allowed but with `SomeAllowed`
   *    mode and the resource(s) use operations that aren't in the list */
  riskLevel: "blocked" | "action-restricted";
  /** When `riskLevel === "action-restricted"`, the specific operations
   *  used by resources that are NOT in the target ACP's allowed list.
   *  Empty for `"blocked"` connectors. */
  restrictedOperations: string[];
}

export interface ZoneMoveImpactSummary {
  /** Total resources scanned in the source env (across all eight
   *  inventory resource types). */
  totalResources: number;
  /** Distinct connectors observed across those resources. */
  totalConnectors: number;
  /** Distinct at-risk connectors (i.e. used by env but NOT on target
   *  group's allow-list). 0 when target group has no ACP. */
  atRiskConnectors: number;
  /** Distinct resources that use at least one at-risk connector. A
   *  resource using two at-risk connectors is counted once. */
  impactedResources: number;
}

export interface ZoneMoveImpactRanAgainst {
  envId: string;
  envDisplayName: string;
  targetGroupId: string;
  targetGroupDisplayName: string;
}

export interface ZoneMoveImpactResult {
  /** Lifecycle of the target group's ACP — drives top-level messaging. */
  targetAcpState: TargetAcpState;
  /** Sorted at-risk-first by `displayName`; empty when
   *  `targetAcpState === "not-configured"` or when every used
   *  connector is on the allow-list. */
  atRiskConnectors: AtRiskConnector[];
  /** Every connector used by the env's resources, alphabetized by
   *  `displayName`. Includes both allowed and at-risk entries so the
   *  dialog can show the "all N allowed" tally. */
  usedConnectors: UsedConnector[];
  summary: ZoneMoveImpactSummary;
  ranAgainst: ZoneMoveImpactRanAgainst;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** ARM-path-aware connector slug extractor. Mirrors the private
 *  `normalizeConnectorId` in `inventory.ts` — duplicated here to keep
 *  this module a pure data-shaper without widening `inventory.ts`'s
 *  public surface. */
function lastPathSegment(id: string): string {
  if (!id) return "";
  const idx = id.lastIndexOf("/");
  return (idx >= 0 ? id.substring(idx + 1) : id).trim();
}

/** Strip a leading `shared_` if present. Bare form is the canonical
 *  key for both bagging and ACP membership tests. */
function toBareForm(slug: string): string {
  const lc = slug.trim().toLowerCase();
  return lc.startsWith("shared_") ? lc.substring("shared_".length) : lc;
}

function readStr(item: ResourceItem, key: string): string {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const v = props[key];
  return typeof v === "string" ? v : "";
}

function readNestedStr(item: ResourceItem, ...keys: string[]): string {
  let node: unknown = (item.properties ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    if (node && typeof node === "object" && k in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[k];
    } else {
      return "";
    }
  }
  return typeof node === "string" ? node : "";
}

function ownerDisplayName(item: ResourceItem): string {
  return (
    readStr(item, "ownerDisplayName") ||
    readNestedStr(item, "owner", "displayName") ||
    readNestedStr(item, "owner", "email") ||
    readNestedStr(item, "createdBy", "displayName") ||
    readStr(item, "ownerId")
  );
}

function detailHrefFor(type: string, id: string): string {
  const safeId = encodeURIComponent(id);
  switch (type) {
    case ResourceType.CanvasApp:
    case ResourceType.ModelDrivenApp:
    case ResourceType.CodeApp:
    case ResourceType.AppBuilderApp:
      return `/apps/${safeId}`;
    case ResourceType.CloudFlow:
    case ResourceType.AgentFlow:
    case ResourceType.WorkflowAgentFlow:
      return `/flows/${safeId}`;
    case ResourceType.CopilotStudioAgent:
      return `/agents/${safeId}`;
    default:
      return "";
  }
}

function toImpactedResource(item: ResourceItem): ImpactedResource {
  const type = item.type ?? "";
  const id = item.name ?? "";
  return {
    id,
    type,
    displayName: readStr(item, "displayName"),
    environmentId: readStr(item, "environmentId"),
    environmentName: readStr(item, "environmentName"),
    ownerId: readStr(item, "ownerId"),
    ownerDisplayName: ownerDisplayName(item),
    detailHref: detailHrefFor(type, id),
  };
}

/** Read the raw connector slug list a resource publishes. Handles
 *  every shape we know about:
 *    - `properties.powerPlatformConnectors[].connectorId` (canvas /
 *      cloud-flow / agent — most common)
 *    - `properties.connectors[].connectorId` (app-builder apps —
 *      sometimes carries ARM paths)
 *    - `properties.connectors[].id` (alternate key seen on some
 *      app-builder payloads)
 *    - `properties.trigger.connectorId` (cloud-flow trigger — separate
 *      from the connector array because flows can have a connector
 *      that's *only* the trigger and never appears in the body)
 *
 *  Returns the raw published form (post `lastPathSegment` strip).
 *  Caller normalizes to bare form. Pulling raw lets us surface the
 *  `publishedForms` debug field without a second pass. */
export function readPublishedConnectorIds(item: ResourceItem): string[] {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const out: string[] = [];

  const arrays: unknown[] = [];
  if (Array.isArray(props.powerPlatformConnectors))
    arrays.push(...props.powerPlatformConnectors);
  if (Array.isArray(props.connectors)) arrays.push(...props.connectors);

  for (const entry of arrays) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const rawId =
      typeof e.connectorId === "string"
        ? e.connectorId
        : typeof e.id === "string"
        ? e.id
        : "";
    const slug = lastPathSegment(rawId);
    if (slug) out.push(slug);
  }

  // Trigger-only connector for cloud flows. Same shape as a single
  // entry in `powerPlatformConnectors` but published separately.
  const trigger = props.trigger;
  if (trigger && typeof trigger === "object") {
    const t = trigger as Record<string, unknown>;
    const rawTrig =
      typeof t.connectorId === "string"
        ? t.connectorId
        : typeof t.id === "string"
        ? t.id
        : "";
    const tSlug = lastPathSegment(rawTrig);
    if (tSlug) out.push(tSlug);
  }

  return out;
}

/** Extract operation IDs per connector from a resource item.
 *  Returns a Map of bareSlug → operationIds found.
 *  Only `powerPlatformConnectors[].operations[]` carries operation data;
 *  plain `connectors[]` (app-builder) does not. */
function readPublishedOperationsForConnector(
  item: ResourceItem
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const connectors = Array.isArray(props.powerPlatformConnectors)
    ? props.powerPlatformConnectors
    : [];

  for (const entry of connectors) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const rawId =
      typeof e.connectorId === "string"
        ? e.connectorId
        : typeof e.id === "string"
        ? e.id
        : "";
    const slug = lastPathSegment(rawId);
    const bare = toBareForm(slug);
    if (!bare) continue;

    const ops = Array.isArray(e.operations) ? e.operations : [];
    const opIds: string[] = [];
    for (const op of ops) {
      if (!op || typeof op !== "object") continue;
      const o = op as Record<string, unknown>;
      const opId = typeof o.operationId === "string" ? o.operationId : "";
      if (opId) opIds.push(opId);
    }
    if (opIds.length > 0) {
      const existing = result.get(bare) ?? [];
      existing.push(...opIds);
      result.set(bare, existing);
    }
  }
  return result;
}

/** Walk every resource item and group by bare connector slug. The
 *  result map's key is the bare form; `publishedForms` retains the raw
 *  forms (deduped) for debugging the rare "did this flow publish
 *  `shared_sql` or just `sql`?" question. Also tracks operations. */
export function extractUsedConnectors(items: ResourceItem[]): UsedConnector[] {
  const byBareSlug = new Map<
    string,
    {
      publishedForms: Set<string>;
      resources: Map<string, ImpactedResource>;
      operations: Set<string>;
    }
  >();

  for (const item of items) {
    const raw = readPublishedConnectorIds(item);
    if (raw.length === 0) continue;
    const resource = toImpactedResource(item);
    // Resources can publish the same connector twice (e.g. trigger +
    // body action). Dedup at the bare-form level so the resource isn't
    // counted twice for one connector.
    const seenBareForThisResource = new Set<string>();
    for (const published of raw) {
      const bare = toBareForm(published);
      if (!bare) continue;
      let bucket = byBareSlug.get(bare);
      if (!bucket) {
        bucket = {
          publishedForms: new Set<string>(),
          resources: new Map<string, ImpactedResource>(),
          operations: new Set<string>(),
        };
        byBareSlug.set(bare, bucket);
      }
      bucket.publishedForms.add(published.toLowerCase());
      if (!seenBareForThisResource.has(bare)) {
        // Map by id+type so same-id collisions across types (rare but
        // possible — apps and agents have separate id spaces but the
        // inventory keys overlap occasionally) still surface both.
        const key = `${resource.type}::${resource.id || resource.displayName}`;
        if (!bucket.resources.has(key)) {
          bucket.resources.set(key, resource);
        }
        seenBareForThisResource.add(bare);
      }
    }
    // Collect operations for this connector from the item.
    const ops = readPublishedOperationsForConnector(item);
    for (const [bareSlug, opIds] of ops) {
      const bucket = byBareSlug.get(bareSlug);
      if (bucket) {
        for (const opId of opIds) bucket.operations.add(opId);
      }
    }
  }

  const out: UsedConnector[] = [];
  for (const [bare, bucket] of byBareSlug) {
    const resources = Array.from(bucket.resources.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
    out.push({
      slug: bare,
      displayName: friendlyConnectorName(bare) || bare,
      publishedForms: Array.from(bucket.publishedForms).sort(),
      resources,
      operationsUsed: Array.from(bucket.operations).sort(),
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

/** Build the set of bare-form slugs on the target group's ACP
 *  allow-list. Each entry on the snapshot is already lowercased and
 *  ARM-path-stripped by `extractAcpSnapshot`; we just strip the
 *  optional `shared_` to land in the same bare-form keyspace as
 *  `extractUsedConnectors`. */
export function bareFormAllowSet(snapshot: AcpSnapshot): Set<string> {
  const out = new Set<string>();
  for (const c of snapshot.allowed) {
    const bare = toBareForm(c.id);
    if (bare) out.add(bare);
  }
  return out;
}

/** Is a used connector on the target group's allow-list? Uses
 *  `connectorIdVariants` so a `shared_sql` allow-list entry matches a
 *  flow that published bare `sql`, and vice-versa. */
export function isConnectorAllowed(
  bareSlug: string,
  allowSet: Set<string>
): boolean {
  if (!bareSlug) return false;
  for (const v of connectorIdVariants(bareSlug)) {
    if (allowSet.has(v)) return true;
    // `connectorIdVariants` already yields bare + `shared_` forms;
    // membership is bare-form so strip the prefix on the fly.
    if (v.startsWith("shared_") && allowSet.has(v.substring("shared_".length))) {
      return true;
    }
  }
  return false;
}

/** Classify the target group's ACP lifecycle. */
export function classifyTargetAcpState(
  snapshot: AcpSnapshot
): TargetAcpState {
  if (!snapshot.configured) return "not-configured";
  return snapshot.acpOnly ? "enforced" : "advisory";
}

/** Pure result builder. Composes the snapshot + the used connectors +
 *  the run metadata into a `ZoneMoveImpactResult`. Exported separately
 *  from the orchestrator so it can be unit-tested without any service
 *  mocks. */
export function buildZoneMoveImpactResult(args: {
  used: UsedConnector[];
  totalResourcesScanned: number;
  snapshot: AcpSnapshot;
  ranAgainst: ZoneMoveImpactRanAgainst;
}): ZoneMoveImpactResult {
  const { used, totalResourcesScanned, snapshot, ranAgainst } = args;
  const targetAcpState = classifyTargetAcpState(snapshot);

  // Not configured → every connector is implicitly fine (no ACP
  // restriction). Surface used connectors for context but flag zero
  // at-risk.
  const atRiskConnectors: AtRiskConnector[] = [];
  if (targetAcpState !== "not-configured") {
    const allowSet = bareFormAllowSet(snapshot);
    // Build a lookup for ACP entries so we can check action-level rules.
    const acpEntryByBare = new Map<string, AcpAllowedConnector>();
    for (const entry of snapshot.allowed) {
      const bare = toBareForm(entry.id);
      if (bare) acpEntryByBare.set(bare, entry);
    }

    for (const c of used) {
      if (!isConnectorAllowed(c.slug, allowSet)) {
        // Connector not on allow-list at all — fully blocked.
        atRiskConnectors.push({
          ...c,
          atRisk: true as const,
          riskLevel: "blocked",
          restrictedOperations: [],
          topResources: c.resources.slice(0, ZONE_MOVE_IMPACT_TOP_N),
        });
      } else {
        // Connector IS on the allow-list. Check for action-level restrictions.
        const acpEntry = acpEntryByBare.get(c.slug);
        if (
          acpEntry &&
          acpEntry.allowedActionsMode === "SomeAllowed" &&
          c.operationsUsed.length > 0
        ) {
          const allowedOps = new Set(
            acpEntry.allowedActions.map((a) => a.toLowerCase())
          );
          const restricted = c.operationsUsed.filter(
            (op) => !allowedOps.has(op.toLowerCase())
          );
          if (restricted.length > 0) {
            atRiskConnectors.push({
              ...c,
              atRisk: true as const,
              riskLevel: "action-restricted",
              restrictedOperations: restricted.sort(),
              topResources: c.resources.slice(0, ZONE_MOVE_IMPACT_TOP_N),
            });
          }
        }
      }
    }

    // At-risk first; within at-risk, sort by impacted-resource count
    // desc so the most-affected connector leads, then alphabetize.
    // Blocked connectors sort before action-restricted ones.
    atRiskConnectors.sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) {
        return a.riskLevel === "blocked" ? -1 : 1;
      }
      if (a.resources.length !== b.resources.length) {
        return b.resources.length - a.resources.length;
      }
      return a.displayName.localeCompare(b.displayName);
    });
  }

  // Distinct impacted resources (deduped across at-risk connectors).
  const impactedKeys = new Set<string>();
  for (const c of atRiskConnectors) {
    for (const r of c.resources) {
      impactedKeys.add(`${r.type}::${r.id || r.displayName}`);
    }
  }

  const summary: ZoneMoveImpactSummary = {
    totalResources: totalResourcesScanned,
    totalConnectors: used.length,
    atRiskConnectors: atRiskConnectors.length,
    impactedResources: impactedKeys.size,
  };

  return {
    targetAcpState,
    atRiskConnectors,
    usedConnectors: used,
    summary,
    ranAgainst,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** Drain every resource in `envId` across the eight inventory resource
 *  types. Returns raw `ResourceItem` so callers can read connector
 *  payload shapes that the typed `ResourceRow` projection drops. */
async function listRawResourcesInEnvironment(
  envId: string
): Promise<DataResult<ResourceItem[]>> {
  const clauses: Clause[] = [
    where(
      "type",
      "in~",
      SWEEP_RESOURCE_TYPES.map((t) => `'${t}'`)
    ),
    where("properties.environmentId", "==", [`'${envId}'`]),
    orderBy({ "tostring(properties.lastModifiedAt)": "desc" }),
  ];

  const items: ResourceItem[] = [];
  let skipToken: string | undefined;
  let skip = 0;
  for (let page = 0; page < PAGE_CAP; page++) {
    const res = await runRawQuery(clauses, {
      Top: PAGE_SIZE,
      Skip: skip,
      SkipToken: skipToken ?? "",
    });
    if (!res.ok) return { ok: false, error: res.error };
    items.push(...res.data.items);
    if (!res.data.skipToken) break;
    skipToken = res.data.skipToken;
    skip += res.data.items.length;
  }
  return { ok: true, data: items };
}

/**
 * Run the zone-move ACP impact analysis. Fetches the target group's
 * effective policies and the source env's full resource sweep in
 * parallel, extracts the per-resource connector bag, diffs against
 * the target ACP allow-list using bare-form normalization +
 * `connectorIdVariants`, and returns a structured result.
 *
 * Errors short-circuit — both halves must succeed for the diff to be
 * meaningful. Empty envs (no resources) and not-configured target
 * groups both return successful zero-impact results with the
 * appropriate `targetAcpState` so the UI can render an explanatory
 * message instead of an error.
 */
export async function analyzeZoneMoveAcpImpact(
  envId: string,
  envDisplayName: string,
  targetGroupId: string,
  targetGroupDisplayName: string
): Promise<DataResult<ZoneMoveImpactResult>> {
  if (!envId) return { ok: false, error: "Environment id is required." };
  if (!targetGroupId)
    return { ok: false, error: "Target environment group id is required." };

  const ranAgainst: ZoneMoveImpactRanAgainst = {
    envId,
    envDisplayName: envDisplayName || envId,
    targetGroupId,
    targetGroupDisplayName: targetGroupDisplayName || targetGroupId,
  };

  // Parallel: target group's ACP status + env resource sweep.
  const [acpRes, itemsRes] = await Promise.all([
    getEnvironmentGroupAcpStatus(targetGroupId),
    listRawResourcesInEnvironment(envId),
  ]);
  if (!acpRes.ok) return { ok: false, error: acpRes.error };
  if (!itemsRes.ok) return { ok: false, error: itemsRes.error };

  const snapshot = extractAcpSnapshot(acpRes.data.policies);

  // Backfill env display names on resources missing them (the
  // inventory map is cached, so this is essentially free on repeat
  // runs). Mirrors the pattern in `dlpImpact.runImpactQuery`.
  const items = itemsRes.data;
  const needsBackfill = items.some(
    (it) => readStr(it, "environmentId") && !readStr(it, "environmentName")
  );
  if (needsBackfill) {
    const envMap = await getEnvironmentNameMap();
    for (const it of items) {
      const envIdOnItem = readStr(it, "environmentId");
      const envNameOnItem = readStr(it, "environmentName");
      if (envIdOnItem && !envNameOnItem) {
        const name = envMap.get(envIdOnItem);
        if (name) {
          const props = (it.properties ?? {}) as Record<string, unknown>;
          props.environmentName = name;
        }
      }
    }
  }

  const used = extractUsedConnectors(items);

  return {
    ok: true,
    data: buildZoneMoveImpactResult({
      used,
      totalResourcesScanned: items.length,
      snapshot,
      ranAgainst,
    }),
  };
}
