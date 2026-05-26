/**
 * Pure diff logic for two Application Control Policy (ACP)
 * configurations — i.e. the `ConnectorManagement` rule + the
 * `AdvancedConnectorPoliciesOnly` flag, as they exist on two
 * environment groups.
 *
 * No React / Fluent imports on purpose — easy to unit-test, and the
 * same diff feeds both the future ACP Comparator and any ACP-aware
 * Impact analyzer.
 *
 * The shape we compute:
 *   - `summary` — counts for KPI tiles (totals, A-only, B-only, mode
 *     changes, ACP-only flag parity, configured-on-both check)
 *   - `connectors` — one row per connector in (A ∪ B) with the
 *     allowed-actions / connection-types modes on each side and
 *     whether they differ
 *   - `acpOnly` — pulled from the group's
 *     `AdvancedConnectorPoliciesOnly.inputs.EnableAdvancedConnectorPoliciesOnly`
 *     flag (already surfaced by `summarizeAcpStatus` in
 *     `dlpPolicies.ts`)
 *
 * V1 scope: connector-membership diff + per-connector
 * `AllowedActionsMode` / `AllowedConnectionTypesMode` comparison.
 * V2 adds per-action set diffs (`AllowedActions[]`) — computing
 * added/removed operations between two ACP snapshots and surfacing
 * them as expandable drill-down rows in the Comparator UI.
 */

import type { Policy } from "../generated/models/PowerPlatformforAdminsV2Model";
import { friendlyConnectorName } from "./inventory";

// ---------------------------------------------------------------------------
// Schema literals (confirmed via captured tenant payload — see
// docs/governance-rules-catalog.md and docs/admin-payload-samples.md)
// ---------------------------------------------------------------------------

/** Rule id of the "Advanced connector policies (preview)" rule. */
const ACP_RULE_ID = "ConnectorManagement";
/** Rule id of the "Advanced connector policies only (preview)" rule. */
const ACP_ONLY_RULE_ID = "AdvancedConnectorPoliciesOnly";
/** Boolean flag inside `AdvancedConnectorPoliciesOnly.inputs`. */
const ACP_ONLY_FLAG = "EnableAdvancedConnectorPoliciesOnly";

// ---------------------------------------------------------------------------
// Per-side extraction
// ---------------------------------------------------------------------------

/** Modes observed on a `ConnectorManagement.AllowedConnectorList[]`
 *  entry. `Unknown` is a safety valve for future modes we haven't
 *  documented — passes through to the UI as a literal label. */
export type AcpMode = "AllAllowed" | "SomeAllowed" | "Unknown";

/** One row in the flattened, deduplicated ACP allowed-connector list
 *  for a single env group. */
export interface AcpAllowedConnector {
  /** Inventory-shaped slug (e.g. `shared_sql`). Lowercased. */
  id: string;
  /** Original ARM-path id from the rule
   *  (e.g. `/providers/Microsoft.PowerApps/apis/shared_sql`). */
  rawId: string;
  /** Friendly display name via `friendlyConnectorName`. */
  name: string;
  allowedActionsMode: AcpMode;
  /** Operation IDs explicitly allowed when `allowedActionsMode === "SomeAllowed"`.
   *  Empty / not meaningful when `AllAllowed`. */
  allowedActions: string[];
  allowedConnectionTypesMode: AcpMode;
}

/** Compact summary of one env group's ACP posture — what
 *  `diffAcpStatuses` needs to compute a diff. */
export interface AcpSnapshot {
  /** At least one `ConnectorManagement` rule is present on this group. */
  configured: boolean;
  /** `EnableAdvancedConnectorPoliciesOnly === true` on this group. */
  acpOnly: boolean;
  /** Allowed connectors, flattened across every `ConnectorManagement`
   *  rule attached to the group, deduplicated by slug. Stable order
   *  (alphabetized by friendly name). */
  allowed: AcpAllowedConnector[];
}

function normalizeSlug(rawId: string): string {
  if (!rawId) return "";
  const idx = rawId.lastIndexOf("/");
  return (idx >= 0 ? rawId.substring(idx + 1) : rawId).toLowerCase();
}

function coerceMode(value: unknown): AcpMode {
  if (value === "AllAllowed") return "AllAllowed";
  if (value === "SomeAllowed") return "SomeAllowed";
  return "Unknown";
}

/**
 * Extract an `AcpSnapshot` from the `Policy[]` returned by
 * `getEnvironmentGroupEffectivePolicies` (which is what
 * `getEnvironmentGroupAcpStatus` wraps). Walks every rule on every
 * policy attached to the group and merges them.
 *
 * Why merge across policies: a single env group can have multiple
 * policies, each with its own `ConnectorManagement` rule. The
 * effective allow-list is the union (a connector allowed on either
 * policy is allowed). When the same connector appears in multiple
 * rules with different modes, the more-permissive mode wins:
 *
 *   - `AllAllowed` beats `SomeAllowed` (full > restricted)
 *   - `SomeAllowed` action lists are unioned (sum of explicitly
 *     allowed actions across the rules)
 *
 * Tightening that merge rule later (intersection? policy precedence?)
 * is doable but waits on real tenant payloads showing the case.
 */
export function extractAcpSnapshot(policies: Policy[]): AcpSnapshot {
  let configured = false;
  let acpOnly = false;
  const byId = new Map<string, AcpAllowedConnector>();

  for (const p of policies) {
    for (const rule of p.ruleSets ?? []) {
      const id = rule.id ?? "";
      if (id === ACP_ONLY_RULE_ID) {
        const inputs = (rule.inputs ?? {}) as Record<string, unknown>;
        if (inputs[ACP_ONLY_FLAG] === true) acpOnly = true;
        continue;
      }
      if (id !== ACP_RULE_ID) continue;
      configured = true;
      const inputs = (rule.inputs ?? {}) as Record<string, unknown>;
      const list = inputs.AllowedConnectorList;
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const rawConnector =
          typeof entry.AllowedConnector === "string"
            ? entry.AllowedConnector
            : "";
        const slug = normalizeSlug(rawConnector);
        if (!slug) continue;

        const incomingActionsMode = coerceMode(entry.AllowedActionsMode);
        const incomingConnTypesMode = coerceMode(entry.AllowedConnectionTypesMode);
        const incomingActions = Array.isArray(entry.AllowedActions)
          ? (entry.AllowedActions as unknown[]).filter(
              (a): a is string => typeof a === "string"
            )
          : [];

        const existing = byId.get(slug);
        if (!existing) {
          byId.set(slug, {
            id: slug,
            rawId: rawConnector,
            name: friendlyConnectorName(slug) || slug,
            allowedActionsMode: incomingActionsMode,
            allowedActions: incomingActions,
            allowedConnectionTypesMode: incomingConnTypesMode,
          });
          continue;
        }
        // Merge — more-permissive wins. `AllAllowed` beats anything;
        // `SomeAllowed` lists are unioned (deduped).
        if (existing.allowedActionsMode !== "AllAllowed") {
          if (incomingActionsMode === "AllAllowed") {
            existing.allowedActionsMode = "AllAllowed";
            existing.allowedActions = [];
          } else if (incomingActions.length > 0) {
            const merged = new Set(existing.allowedActions);
            for (const a of incomingActions) merged.add(a);
            existing.allowedActions = Array.from(merged).sort();
            existing.allowedActionsMode = incomingActionsMode;
          }
        }
        if (existing.allowedConnectionTypesMode !== "AllAllowed") {
          if (incomingConnTypesMode === "AllAllowed") {
            existing.allowedConnectionTypesMode = "AllAllowed";
          }
        }
      }
    }
  }

  const allowed = Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return { configured, acpOnly, allowed };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Per-action set diff when both sides are `SomeAllowed`. */
export interface AcpActionsDiff {
  /** Operations allowed on A but not B. */
  removedInB: string[];
  /** Operations allowed on B but not A. */
  addedInB: string[];
  /** Operations allowed on both sides. */
  common: string[];
}

export interface AcpConnectorRow {
  id: string;
  name: string;
  presentInA: boolean;
  presentInB: boolean;
  /** Action mode on each side. `null` when the connector isn't
   *  present on that side at all (i.e. effectively blocked because
   *  the ACP allow-list is exclusive). */
  modeA: AcpMode | null;
  modeB: AcpMode | null;
  /** Connection-types mode on each side. Same `null` semantics. */
  connTypesModeA: AcpMode | null;
  connTypesModeB: AcpMode | null;
  /** Convenience flags for the table renderer. */
  membershipDiffers: boolean;
  modeDiffers: boolean;
  /** True when both sides are present AND the action lists differ
   *  (either mode changed to/from SomeAllowed, or the SomeAllowed
   *  action sets are not identical). */
  actionsDiffer: boolean;
  /** Structured diff of the allowed-actions lists. `null` when not
   *  meaningful (connector absent from one side, or both are
   *  `AllAllowed`). */
  actionsDiff: AcpActionsDiff | null;
  /** Action lists on each side (raw). */
  actionsA: string[];
  actionsB: string[];
}

export interface AcpDiffSummary {
  totalConnectors: number;
  aOnly: number;
  bOnly: number;
  inBoth: number;
  /** Connectors in both lists but with at least one mode or action-set differing. */
  modeChanged: number;
  /** Connectors in both lists where the per-action allowed sets differ
   *  (subset of `modeChanged`). */
  actionsChanged: number;
  acpOnlySame: boolean;
  configuredSame: boolean;
  configuredA: boolean;
  configuredB: boolean;
  acpOnlyA: boolean;
  acpOnlyB: boolean;
}

export interface AcpDiffResult {
  summary: AcpDiffSummary;
  /** Sorted: diff rows (a-only, b-only, mode-changed) first; matching
   *  rows after, alphabetized. */
  connectors: AcpConnectorRow[];
}

/** Compute the structured per-action diff between two connector entries.
 *  Returns `null` when the diff is not meaningful (connector absent from
 *  one side, or both sides are `AllAllowed`). */
export function diffActions(
  modeA: AcpMode | null,
  modeB: AcpMode | null,
  actionsA: string[],
  actionsB: string[]
): AcpActionsDiff | null {
  // Not present on one side → membership diff is the story, not actions.
  if (modeA === null || modeB === null) return null;
  // Both AllAllowed → no action-level restriction at all.
  if (modeA === "AllAllowed" && modeB === "AllAllowed") return null;

  // At least one side is SomeAllowed (or Unknown, treated as restricted).
  // Treat AllAllowed as "all operations" — represented as an empty set
  // meaning "no restrictions" rather than "no operations".
  const setA = modeA === "AllAllowed" ? null : new Set(actionsA);
  const setB = modeB === "AllAllowed" ? null : new Set(actionsB);

  // AllAllowed → SomeAllowed: everything not in B's list is "removed"
  // (but we can't enumerate "all" — surface B's list as the new state).
  if (setA === null && setB !== null) {
    return {
      removedInB: [], // Can't enumerate what was removed from "all"
      addedInB: [],
      common: Array.from(setB).sort(),
    };
  }
  // SomeAllowed → AllAllowed: everything was "added" (restrictions lifted).
  if (setA !== null && setB === null) {
    return {
      removedInB: [],
      addedInB: [], // Can't enumerate "all" that was added
      common: Array.from(setA).sort(),
    };
  }
  // Both SomeAllowed — proper set diff.
  const removedInB: string[] = [];
  const common: string[] = [];
  for (const op of setA!) {
    if (setB!.has(op)) common.push(op);
    else removedInB.push(op);
  }
  const addedInB: string[] = [];
  for (const op of setB!) {
    if (!setA!.has(op)) addedInB.push(op);
  }
  return {
    removedInB: removedInB.sort(),
    addedInB: addedInB.sort(),
    common: common.sort(),
  };
}

/** Compute the full diff between two `AcpSnapshot`s. Pure. */
export function diffAcpStatuses(a: AcpSnapshot, b: AcpSnapshot): AcpDiffResult {
  const byA = new Map(a.allowed.map((c) => [c.id, c]));
  const byB = new Map(b.allowed.map((c) => [c.id, c]));
  const allIds = new Set<string>([...byA.keys(), ...byB.keys()]);

  const connectors: AcpConnectorRow[] = [];
  let aOnly = 0;
  let bOnly = 0;
  let inBoth = 0;
  let modeChanged = 0;

  for (const id of allIds) {
    const ea = byA.get(id);
    const eb = byB.get(id);
    const presentInA = Boolean(ea);
    const presentInB = Boolean(eb);
    const name = ea?.name ?? eb?.name ?? id;
    const modeA = ea ? ea.allowedActionsMode : null;
    const modeB = eb ? eb.allowedActionsMode : null;
    const connTypesModeA = ea ? ea.allowedConnectionTypesMode : null;
    const connTypesModeB = eb ? eb.allowedConnectionTypesMode : null;

    const membershipDiffers = presentInA !== presentInB;

    const actionsAList = ea?.allowedActions ?? [];
    const actionsBList = eb?.allowedActions ?? [];
    const actionsDiff = diffActions(modeA, modeB, actionsAList, actionsBList);
    const actionsDiffer =
      presentInA && presentInB &&
      (actionsDiff !== null &&
        (actionsDiff.removedInB.length > 0 ||
         actionsDiff.addedInB.length > 0 ||
         modeA !== modeB));

    const modeDiffers =
      presentInA && presentInB &&
      (modeA !== modeB || connTypesModeA !== connTypesModeB || actionsDiffer);

    if (membershipDiffers) {
      if (presentInA) aOnly++;
      else bOnly++;
    } else {
      inBoth++;
      if (modeDiffers) modeChanged++;
    }

    connectors.push({
      id,
      name,
      presentInA,
      presentInB,
      modeA,
      modeB,
      connTypesModeA,
      connTypesModeB,
      membershipDiffers,
      modeDiffers,
      actionsDiffer,
      actionsDiff,
      actionsA: actionsAList,
      actionsB: actionsBList,
    });
  }

  connectors.sort((x, y) => {
    // Diff rows first.
    const xDiff = x.membershipDiffers || x.modeDiffers;
    const yDiff = y.membershipDiffers || y.modeDiffers;
    if (xDiff !== yDiff) return xDiff ? -1 : 1;
    return x.name.localeCompare(y.name);
  });

  return {
    summary: {
      totalConnectors: connectors.length,
      aOnly,
      bOnly,
      inBoth,
      modeChanged,
      actionsChanged: connectors.filter((c) => c.actionsDiffer).length,
      acpOnlySame: a.acpOnly === b.acpOnly,
      configuredSame: a.configured === b.configured,
      configuredA: a.configured,
      configuredB: b.configured,
      acpOnlyA: a.acpOnly,
      acpOnlyB: b.acpOnly,
    },
    connectors,
  };
}
