/**
 * Compact helpers shared by the page and (eventually) any
 * dashboard/tile that wants to surface owner-health rollups.
 *
 * Lives in `_ownerless/` because all current consumers are inside the
 * feature; if a non-security view ever needs the same primitives,
 * they'll move up to `shared/` per the boundary rules.
 */

import {
  friendlyResourceType,
  shortResourceType,
  type ResourceTypeValue,
} from "../../../data/inventory";
import type { OwnerBucket, OwnerEntry } from "./types";

/** Human-readable label for a bucket — drives tab text + headings. */
export function bucketLabel(bucket: OwnerBucket): string {
  switch (bucket) {
    case "unresolved":
      return "Unresolved";
    case "disabled":
      return "Disabled";
    case "guest":
      return "Guest";
    case "active":
      return "Active";
    case "sentinel":
      return "Sentinel";
  }
}

/** One-line description used as the tab subtitle / first paragraph
 *  on a bucket. Copy is intentionally aligned with the taxonomy in
 *  `docs/inventory-schema-samples.md` so the page never claims more
 *  certainty than the data layer supports. */
export function bucketDescription(bucket: OwnerBucket): string {
  switch (bucket) {
    case "unresolved":
      return (
        "Could not locate a current valid user for this owner GUID. " +
        "This may be a deleted user account OR a service principal " +
        "(e.g. a Power Platform Pipelines deployment identity). " +
        "Stage 3 of this tool will split the two."
      );
    case "disabled":
      return (
        "Owner exists in Entra but the account is disabled " +
        "(accountEnabled = false). Often a departed employee in the " +
        "grace period before deletion."
      );
    case "guest":
      return (
        "Owner is an external guest user. Often a governance flag in " +
        "tenants that don't expect guest makers."
      );
    case "active":
      return "Owner is an active member user in good standing.";
    case "sentinel":
      return (
        "Owner GUID matches a well-known placeholder pattern (e.g. " +
        "00000000-0000-0000-0000-…). These are system / synthesized " +
        "rows, not real ownership."
      );
  }
}

/** Aggregate per-type counts for an owner entry, sorted by count desc.
 *  Powers the "12 apps · 4 flows · 1 agent" inline breakdown. */
export function typeBreakdown(
  entry: OwnerEntry,
): Array<{ type: ResourceTypeValue; count: number; label: string; shortLabel: string }> {
  const counts = new Map<ResourceTypeValue, number>();
  for (const r of entry.affectedResources) {
    counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({
      type,
      count,
      label: friendlyResourceType(type),
      shortLabel: shortResourceType(type),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Build the "12 apps · 4 flows · 1 agent" string. Plural-aware (well,
 *  the short labels already are — "apps", "flows", "agents"). */
export function formatTypeBreakdown(entry: OwnerEntry): string {
  const parts = typeBreakdown(entry);
  if (parts.length === 0) return "—";
  return parts.map((p) => `${p.count} ${p.shortLabel}`).join(" · ");
}

/** Detail-page route for a single affected resource. Keeps the routing
 *  contract in one place so the page doesn't open-code three different
 *  URL shapes. */
export function detailPathFor(resource: {
  id: string;
  type: ResourceTypeValue;
}): string | null {
  switch (resource.type) {
    case "microsoft.powerapps/canvasapps":
    case "microsoft.powerapps/modeldrivenapps":
    case "microsoft.powerapps/codeapps":
    case "microsoft.powerapps/apps":
      return `/apps/${encodeURIComponent(resource.id)}`;
    case "microsoft.powerautomate/cloudflows":
    case "microsoft.powerautomate/agentflows":
    case "microsoft.powerautomate/m365agentflows":
      return `/flows/${encodeURIComponent(resource.id)}`;
    case "microsoft.copilotstudio/agents":
      return `/agents/${encodeURIComponent(resource.id)}`;
    default:
      return null;
  }
}

/** Format a millisecond timestamp as a relative string ("12 min ago",
 *  "2 hr ago", "yesterday"). Kept inline rather than pulling in a date
 *  library — the use is trivial and we already avoid that dependency
 *  app-wide. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.round((now - timestamp) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const m = Math.round(diffSec / 60);
    return `${m} min ago`;
  }
  if (diffSec < 86_400) {
    const h = Math.round(diffSec / 3600);
    return `${h} hr ago`;
  }
  const d = Math.round(diffSec / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Format an elapsed duration in ms as a compact "1m 23s" / "45s" string.
 *  Used in the live progress card. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
