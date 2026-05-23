/**
 * Standard custom groups — the user-managed counterpart to Microsoft
 * environment groups.
 *
 * **Why this exists.** Microsoft environment groups are a Managed
 * Environment feature; they accept Managed envs only. Standard envs
 * cannot live in any MS env group — Microsoft refuses to ship the
 * construct. This module is the parallel: a user-managed grouping that
 * holds Standard envs, persisted to localStorage, fully editable,
 * placeable in Zones just like a real MS env group.
 *
 * Type purity is critical: a Standard custom group contains Standard
 * envs ONLY (a Managed env going into one would be a category error,
 * losing the "this should be in a proper MS group" actionable signal).
 * `addEnvToStandardGroup` enforces this at the data layer — the UI
 * doesn't have to remember.
 *
 * **Exclusive env membership.** Like MS env groups, a Standard env can
 * be in at most one Standard custom group at a time. Calling
 * `addEnvToStandardGroup` automatically removes the env from any
 * other custom group it was previously in.
 *
 * Mirrors the shape of `data/zones.ts` (same read/write/CRUD pattern,
 * same local-tab change event, same migration story for an eventual
 * Dataverse promotion).
 */

import { STANDARD_GROUPS_KEY, customRef, clearAssignmentsFor } from "./zones";

export interface StandardCustomGroup {
  id: string;
  displayName: string;
  description: string;
  /** Hex color string. Drives the chip / column accent. */
  color: string;
  /** Single-character/emoji glyph shown next to the name. */
  icon: string;
  /**
   * Environment IDs belonging to this group. Standard envs only —
   * `addEnvToStandardGroup` enforces the type check. v2 of this module
   * shipped groups without this field; reads default it to `[]` for
   * backwards compatibility.
   */
  envIds: string[];
  createdAt: string;
  updatedAt: string;
}

const LOCAL_CHANGE_EVENT = "ppcoe:zones:changed";

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emitLocalChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
  } catch {
    /* no-op */
  }
}

function readStandardGroups(): StandardCustomGroup[] {
  try {
    const raw = localStorage.getItem(STANDARD_GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Backwards compat: v2 groups have no `envIds`. Default to empty
    // array so all downstream code can assume the field exists.
    return (parsed as Partial<StandardCustomGroup>[]).map((g) => ({
      id: g.id ?? "",
      displayName: g.displayName ?? "",
      description: g.description ?? "",
      color: g.color ?? "#525252",
      icon: g.icon ?? "📦",
      envIds: Array.isArray(g.envIds) ? g.envIds : [],
      createdAt: g.createdAt ?? nowIso(),
      updatedAt: g.updatedAt ?? nowIso(),
    }));
  } catch {
    return [];
  }
}

function writeStandardGroups(items: StandardCustomGroup[]): void {
  try {
    localStorage.setItem(STANDARD_GROUPS_KEY, JSON.stringify(items));
    emitLocalChange();
  } catch {
    /* quota or privacy mode — silent */
  }
}

/** Read all standard custom groups, ordered by createdAt ascending. */
export function listStandardGroups(): StandardCustomGroup[] {
  return readStandardGroups()
    .slice()
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export function getStandardGroup(id: string): StandardCustomGroup | null {
  return readStandardGroups().find((g) => g.id === id) ?? null;
}

/**
 * Reverse lookup: given an env id, find the Standard custom group it
 * belongs to (or null). Used by the available-envs panel to render the
 * "currently in: X" label and to drive exclusive membership.
 */
export function findStandardGroupForEnv(
  envId: string,
): StandardCustomGroup | null {
  return readStandardGroups().find((g) => g.envIds.includes(envId)) ?? null;
}

export interface StandardCustomGroupInput {
  displayName: string;
  description?: string;
  color: string;
  icon: string;
}

export function createStandardGroup(
  input: StandardCustomGroupInput,
): StandardCustomGroup {
  const items = readStandardGroups();
  const group: StandardCustomGroup = {
    id: genId("sgrp"),
    displayName: input.displayName.trim() || "Untitled custom group",
    description: (input.description ?? "").trim(),
    color: input.color,
    icon: input.icon || "📦",
    envIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeStandardGroups([...items, group]);
  return group;
}

export function updateStandardGroup(
  id: string,
  patch: Partial<
    Pick<StandardCustomGroup, "displayName" | "description" | "color" | "icon">
  >,
): StandardCustomGroup | null {
  const items = readStandardGroups();
  const idx = items.findIndex((g) => g.id === id);
  if (idx < 0) return null;
  const current = items[idx];
  const next: StandardCustomGroup = {
    ...current,
    ...(patch.displayName !== undefined
      ? { displayName: patch.displayName.trim() || current.displayName }
      : {}),
    ...(patch.description !== undefined
      ? { description: patch.description.trim() }
      : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon || current.icon } : {}),
    updatedAt: nowIso(),
  };
  items[idx] = next;
  writeStandardGroups(items);
  return next;
}

/**
 * Delete a Standard custom group. Also wipes any zone assignment that
 * pointed at it so we don't leave a phantom placement behind. Envs
 * that were in the group simply become loose Standard envs (we don't
 * own their underlying records — they continue to exist in Microsoft).
 */
export function deleteStandardGroup(id: string): void {
  writeStandardGroups(readStandardGroups().filter((g) => g.id !== id));
  clearAssignmentsFor(customRef(id));
}

// ---------------------------------------------------------------------------
// Env membership
// ---------------------------------------------------------------------------

export type AddEnvResult =
  | { ok: true; group: StandardCustomGroup }
  | { ok: false; reason: string };

/**
 * Add a Standard environment to a Standard custom group. Returns a
 * discriminated result so the caller can show the precise rejection
 * reason. Three guardrails:
 *
 *   1. Group must exist.
 *   2. Env must be Standard (not Managed). Managed envs belong in a
 *      real MS env group; placing one here would lose the "this should
 *      be governed properly" actionable signal.
 *   3. Exclusive membership — if the env was in another custom group,
 *      it's removed there first (parallels MS env group behavior).
 */
export function addEnvToStandardGroup(
  groupId: string,
  env: { id: string; isManaged: boolean },
): AddEnvResult {
  if (env.isManaged) {
    return {
      ok: false,
      reason:
        "This environment is Managed. Managed environments belong in a Microsoft environment group, not a Standard custom group. Promote a group in PPAC instead.",
    };
  }
  const items = readStandardGroups();
  const targetIdx = items.findIndex((g) => g.id === groupId);
  if (targetIdx < 0) {
    return { ok: false, reason: "That Standard custom group no longer exists." };
  }
  // Remove from any other custom group first (exclusive membership).
  const cleaned = items.map((g, idx) =>
    idx === targetIdx
      ? g
      : g.envIds.includes(env.id)
        ? { ...g, envIds: g.envIds.filter((id) => id !== env.id), updatedAt: nowIso() }
        : g,
  );
  // Add to target (no-op if already present).
  const target = cleaned[targetIdx];
  if (target.envIds.includes(env.id)) {
    writeStandardGroups(cleaned);
    return { ok: true, group: target };
  }
  const updated: StandardCustomGroup = {
    ...target,
    envIds: [...target.envIds, env.id],
    updatedAt: nowIso(),
  };
  cleaned[targetIdx] = updated;
  writeStandardGroups(cleaned);
  return { ok: true, group: updated };
}

/**
 * Remove a Standard env from its Standard custom group (if any).
 * The env returns to loose Standard status; nothing else changes.
 */
export function removeEnvFromStandardGroup(envId: string): void {
  const items = readStandardGroups();
  let changed = false;
  const next = items.map((g) => {
    if (!g.envIds.includes(envId)) return g;
    changed = true;
    return {
      ...g,
      envIds: g.envIds.filter((id) => id !== envId),
      updatedAt: nowIso(),
    };
  });
  if (changed) writeStandardGroups(next);
}

/**
 * Bulk prune — drop any envIds from any custom group that are no longer
 * eligible to live there. Two cases trigger removal:
 *
 *   1. Env no longer exists in the tenant (deleted in PPAC)
 *   2. Env is now Managed (Microsoft moved it into an MS env group, or
 *      it was upgraded to Managed standalone) — type purity requires
 *      that custom groups hold Standard envs only
 *
 * Runs silently on every detail/Kanban load. No inbox prompts, no
 * confirmations — the source-of-truth for env state is Microsoft, and
 * we just respect the current state. This is the "silent drift
 * reconciliation" feature.
 */
export function pruneIneligibleEnvs(
  envIndex: Map<string, { id: string; isManaged: boolean }>,
): void {
  const items = readStandardGroups();
  let changed = false;
  const next = items.map((g) => {
    const kept = g.envIds.filter((id) => {
      const env = envIndex.get(id);
      // Drop if: env is gone (deleted in PPAC) OR env is now Managed
      // (belongs in an MS env group now, not a custom one).
      return env !== undefined && !env.isManaged;
    });
    if (kept.length === g.envIds.length) return g;
    changed = true;
    return { ...g, envIds: kept, updatedAt: nowIso() };
  });
  if (changed) writeStandardGroups(next);
}

/**
 * @deprecated Use `pruneIneligibleEnvs` instead. Kept as a shim so the
 * v3 Standard Custom Group Detail page keeps working until it's
 * migrated. New code should pass a full env index so the prune can
 * also drop now-Managed envs (silent drift).
 */
export function pruneDeletedEnvs(knownEnvIds: Set<string>): void {
  const items = readStandardGroups();
  let changed = false;
  const next = items.map((g) => {
    const kept = g.envIds.filter((id) => knownEnvIds.has(id));
    if (kept.length === g.envIds.length) return g;
    changed = true;
    return { ...g, envIds: kept, updatedAt: nowIso() };
  });
  if (changed) writeStandardGroups(next);
}

