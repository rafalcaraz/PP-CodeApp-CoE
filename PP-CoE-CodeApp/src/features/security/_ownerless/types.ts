/**
 * Owner-scan domain types — shared between the controller, the page,
 * and the controller tests.
 *
 * See `docs/inventory-schema-samples.md#owner--creator-guid-resolution`
 * for the taxonomy that drives the bucket definitions. Bucket choices
 * here intentionally mirror that taxonomy so UI copy can stay aligned
 * with the docs (and so Stage 3 SPN disambiguation can split
 * `unresolved` cleanly later).
 */

import type { ResourceTypeValue } from "../../../data/inventory";
import type { UserRef } from "../../../data/userEnrichment";

/** Phases the scan can be in. */
export type ScanPhase =
  | "idle"
  | "loading-inventory"
  | "resolving-owners"
  | "completed"
  | "cancelled"
  | "error";

/**
 * Owner-health buckets, ordered by typical action priority.
 *
 *  - `unresolved` — Owner GUID isn't present in `aaduser`. Per the
 *    inventory-schema doc, this is either a deleted user OR a service
 *    principal. Stage 3 will split this; v1 surfaces the ambiguity in
 *    UI copy.
 *  - `disabled`   — Owner exists in Entra but `accountEnabled = false`
 *    (often a departed employee in grace period).
 *  - `guest`      — Owner is an external guest (`userType = "Guest"`).
 *  - `active`     — Active member user. Included for completeness.
 *  - `sentinel`   — Owner GUID matches a well-known placeholder pattern
 *    (e.g. `00000000-0000-0000-0000-…`). System / synthesized rows.
 */
export type OwnerBucket =
  | "unresolved"
  | "disabled"
  | "guest"
  | "active"
  | "sentinel";

export const OWNER_BUCKETS: readonly OwnerBucket[] = [
  "unresolved",
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
  /** Distinct owners that have been resolved (success or definitive
   *  null). Only meaningful during/after the `resolving-owners` phase. */
  ownersResolved: number;
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

/** Per-owner result entry. `user === null` means "looked up, not in
 *  aaduser" — the controller folds that into the `unresolved` /
 *  `sentinel` buckets per the bucketing rules. */
export interface OwnerEntry {
  ownerId: string;
  user: UserRef | null;
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

/** Pared-down result persisted to localStorage. Affected resources are
 *  NOT persisted: a large tenant could easily blow past the 5 MB
 *  per-origin quota with a full per-owner list. We store enough to
 *  show a meaningful "Last scan" summary; the UI prompts a re-scan if
 *  the user wants drill-ins. */
export interface ScanSnapshot {
  version: 1;
  scannedAt: number;
  totalResources: number;
  noOwnerCount: number;
  bucketCounts: Record<OwnerBucket, number>;
  ownerIdsByBucket: Record<OwnerBucket, string[]>;
}
