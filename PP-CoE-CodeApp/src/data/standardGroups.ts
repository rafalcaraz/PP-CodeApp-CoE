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
 *
 * **Membership is not yet modeled.** v1 of Standard custom groups ships
 * them as named, draggable, placeable containers — but the "which envs
 * are in this group" UX is deliberately the next iteration. This is the
 * smallest meaningful step toward the Zone Detail experience.
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
    return parsed as StandardCustomGroup[];
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

/** Read all standard custom groups, newest first by createdAt. */
export function listStandardGroups(): StandardCustomGroup[] {
  return readStandardGroups()
    .slice()
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export function getStandardGroup(id: string): StandardCustomGroup | null {
  return readStandardGroups().find((g) => g.id === id) ?? null;
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
 * pointed at it so we don't leave a phantom placement behind.
 */
export function deleteStandardGroup(id: string): void {
  writeStandardGroups(readStandardGroups().filter((g) => g.id !== id));
  clearAssignmentsFor(customRef(id));
}
