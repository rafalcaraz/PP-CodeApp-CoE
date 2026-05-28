/**
 * Owner-scan domain types — shared between the controller, the page,
 * and the controller tests.
 *
 * See `docs/inventory-schema-samples.md#owner--creator-guid-resolution`
 * for the taxonomy that drives the bucket definitions. Bucket choices
 * here intentionally mirror that taxonomy so UI copy can stay aligned
 * with the docs (and so future SPN classification work can extend
 * the `unresolved` bucket without changing the existing tab shape).
 */

import type { ResourceTypeValue } from "../../../data/inventory";
import type {
  ServicePrincipalRef,
  SpKind,
} from "../../../data/spnEnrichment";
import type { UserRef } from "../../../data/userEnrichment";

export type { ServicePrincipalRef, SpKind };

/** Phases the scan can be in. */
export type ScanPhase =
  | "idle"
  | "loading-inventory"
  | "resolving-owners"
  | "resolving-spns"
  | "completed"
  | "cancelled"
  | "error";

/**
 * Owner-health buckets, ordered by typical action priority.
 *
 *  - `unresolved` — Owner GUID isn't present in `aaduser` **nor** in
 *    Graph's service-principal directory. Almost always a deleted
 *    user account (Graph covers SPs + managed identities, so a miss
 *    on both backends is genuine). Action: reassign the resource.
 *  - `service-principal` — Owner GUID resolves to an Entra service
 *    principal via Microsoft Graph. Per-row classification badges
 *    distinguish Microsoft first-party SPs (typically informational
 *    only) from custom tenant SPs (where the SP's own Entra owners
 *    become the escalation contact for the resource).
 *  - `disabled`   — Owner exists in Entra but `accountEnabled = false`
 *    (often a departed employee in grace period).
 *  - `guest`      — Owner is an external guest (`userType = "Guest"`).
 *  - `active`     — Active member user. Included for completeness.
 *  - `sentinel`   — Owner GUID matches a well-known placeholder pattern
 *    (e.g. `00000000-0000-0000-0000-…`). System / synthesized rows.
 *    Excluded from the SP resolution pass entirely — the pattern
 *    can't be a real SP Object ID.
 */
export type OwnerBucket =
  | "unresolved"
  | "service-principal"
  | "disabled"
  | "guest"
  | "active"
  | "sentinel";

export const OWNER_BUCKETS: readonly OwnerBucket[] = [
  "unresolved",
  "service-principal",
  "disabled",
  "guest",
  "active",
  "sentinel",
] as const;

/** Live progress snapshot. Read via `getProgress()`; subscribe for
 *  reactive updates via `subscribe()`. */
export interface ScanProgress {
  phase: ScanPhase;
  startedAt: number | null;
  finishedAt: number | null;
  /** Cumulative number of resource rows pulled across all paged streams. */
  inventoryWalked: number;
  /** Best-effort sum of `totalRecords` from the first page of each
   *  stream. `null` until at least one page has reported. Per the
   *  inventory rules, `totalRecords` is approximate — display copy
   *  should treat this as "~N", never as a precise denominator. */
  inventoryTotal: number | null;
  /** Distinct owner GUIDs seen so far. */
  distinctOwners: number;
  /** Distinct owners that have been resolved against `aaduser`
   *  (success or definitive null). Only meaningful during/after the
   *  `resolving-owners` phase. */
  ownersResolved: number;
  /** Distinct owners that have been classified through Graph (success
   *  or definitive null). Only meaningful during/after the
   *  `resolving-spns` phase. Counts only the GUIDs sent through the
   *  Graph pass — i.e. the subset that came back null from
   *  `aaduser` and weren't sentinels. */
  spnsResolved: number;
  /** Rows with no `ownerId` value at all. Tracked separately so the UI
   *  can call them out without confusing them with the `sentinel` bucket. */
  noOwnerCount: number;
  /** Set when the scan exited via `phase === "error"`. */
  error: string | null;
}

/** Compact descriptor for a resource attributed to a missing owner.
 *  Powers the Stage 2 drill-in. We intentionally do NOT include the
 *  full `AppRow` / `FlowRow` / `AgentRow` — those fields are read on
 *  demand from the resource's own detail page if the user clicks
 *  through. Keeping this lean bounds memory across large tenants. */
export interface AffectedResource {
  id: string;
  displayName: string;
  environmentId: string;
  type: ResourceTypeValue;
}

/** Per-owner result entry. Three resolution-state fields:
 *  - `user === null && servicePrincipal === null` → couldn't classify;
 *    falls into `unresolved` or `sentinel`.
 *  - `user !== null` → human user; falls into `active` / `disabled` /
 *    `guest` by the bucketing rule.
 *  - `user === null && servicePrincipal !== null` → service principal;
 *    falls into `service-principal`. The pre-classified `kind` field
 *    on `servicePrincipalRef` drives the per-row badge. */
export interface OwnerEntry {
  ownerId: string;
  user: UserRef | null;
  /** Set only when the Graph SP resolution pass found this GUID. The
   *  row's drill-in lazily fetches owners on demand via
   *  `fetchServicePrincipalOwners(id)`. */
  servicePrincipal: ServicePrincipalRef | null;
  bucket: OwnerBucket;
  affectedResources: AffectedResource[];
}

/** Complete in-memory scan result. Held by the controller singleton
 *  while the page is open. Replaced (not mutated) on each scan. */
export interface ScanResult {
  scannedAt: number;
  totalResources: number;
  noOwnerCount: number;
  /** Lookup keyed by normalized owner GUID. */
  ownerIndex: Map<string, OwnerEntry>;
  buckets: Record<OwnerBucket, string[]>;
  /** True when this result was rehydrated from the persisted snapshot
   *  rather than produced by a live scan. Drives "Re-scan to view
   *  affected resources" UI affordances — snapshots persist counts +
   *  owner GUIDs per bucket but NOT the affected-resource lists. */
  fromSnapshot: boolean;
}

/** Pared-down result persisted to localStorage. Affected resources +
 *  full SP refs are NOT persisted — both can be sizeable per tenant.
 *  Snapshot tells you counts + per-bucket ownerId lists; on rehydrate
 *  you get a `fromSnapshot: true` result and the UI prompts a re-scan
 *  for drill-in details.
 *
 *  Version bumped to 2 when `service-principal` joined the bucket list
 *  (Stage 3). v1 snapshots are silently ignored on load. */
export interface ScanSnapshot {
  version: 2;
  scannedAt: number;
  totalResources: number;
  noOwnerCount: number;
  bucketCounts: Record<OwnerBucket, number>;
  ownerIdsByBucket: Record<OwnerBucket, string[]>;
}
