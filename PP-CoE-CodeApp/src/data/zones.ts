/**
 * Zones — user-defined parent grouping over Microsoft environment groups.
 *
 * **Why this exists.** Microsoft's Power Platform admin model does not
 * support a hierarchy over environment groups. From the official
 * Environment Strategy docs:
 *
 * > "Although you can't configure the group hierarchy yet, you can use a
 * > combination of naming conventions and rule configuration to implement
 * > your conceptual design."
 *
 * This module gives admins the parent layer Microsoft refused to ship:
 * users assemble their own "Zones" (BU / pillar / region / capability —
 * whatever they want) and drop environment groups inside them. No
 * Microsoft data is touched; everything lives in localStorage and is
 * scoped to the current browser profile.
 *
 * **Storage layout.** Two keys, intentionally separated so renaming or
 * deleting a Zone doesn't rewrite the assignment blob and vice versa:
 *
 *   `ppcoe.zones.v1`            → Zone[]
 *   `ppcoe.zoneAssignments.v1`  → ZoneAssignments (envGroupId → location)
 *
 * **Migration path.** Mirror of `savedQueries.ts`: pure functions wrap
 * localStorage so a future Dataverse promotion (see `docs/roadmap.md` →
 * "Zone-based governance experiments") can swap the backend without
 * touching any view.
 */

export interface Zone {
  id: string;
  name: string;
  description: string;
  /** Hex color string (e.g. `#0078d4`). Drives the column accent stripe. */
  color: string;
  /** Single-character/emoji glyph shown next to the name. */
  icon: string;
  /** Optional named sub-groupings inside the zone. Order is preserved. */
  sections: ZoneSection[];
  /** Display position among user zones (ascending). */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneSection {
  id: string;
  name: string;
}

/** Map of environmentGroupId → where it lives. Absence = unassigned. */
export type ZoneAssignments = Record<string, ZoneAssignment>;

export interface ZoneAssignment {
  zoneId: string;
  /** Optional — when omitted, the env group sits in the zone's default lane. */
  sectionId?: string;
}

const ZONES_KEY = "ppcoe.zones.v1";
const ASSIGNMENTS_KEY = "ppcoe.zoneAssignments.v1";

// Storage event broadcasts a custom local-tab nudge so the `useZones`
// hook can react in the same tab as the writer (the browser only fires
// `storage` events in *other* tabs).
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

export function ZONES_CHANGE_EVENT(): string {
  return LOCAL_CHANGE_EVENT;
}

export function isZonesStorageKey(key: string | null): boolean {
  return key === ZONES_KEY || key === ASSIGNMENTS_KEY;
}

// ---------------------------------------------------------------------------
// Zone CRUD
// ---------------------------------------------------------------------------

function readZones(): Zone[] {
  try {
    const raw = localStorage.getItem(ZONES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Zone[];
  } catch {
    return [];
  }
}

function writeZones(items: Zone[]): void {
  try {
    localStorage.setItem(ZONES_KEY, JSON.stringify(items));
    emitLocalChange();
  } catch {
    /* quota or privacy mode — silent */
  }
}

/** Read all zones, ordered by their persisted `order` (ascending). */
export function listZones(): Zone[] {
  return readZones()
    .slice()
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function getZone(id: string): Zone | null {
  return readZones().find((z) => z.id === id) ?? null;
}

export interface ZoneInput {
  name: string;
  description?: string;
  color: string;
  icon: string;
}

/** Create a new zone and append it to the end of the order. */
export function createZone(input: ZoneInput): Zone {
  const items = readZones();
  const nextOrder = items.reduce((max, z) => Math.max(max, z.order), -1) + 1;
  const zone: Zone = {
    id: genId("zone"),
    name: input.name.trim() || "Untitled zone",
    description: (input.description ?? "").trim(),
    color: input.color,
    icon: input.icon || "✨",
    sections: [],
    order: nextOrder,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeZones([...items, zone]);
  return zone;
}

export function updateZone(
  id: string,
  patch: Partial<Pick<Zone, "name" | "description" | "color" | "icon">>,
): Zone | null {
  const items = readZones();
  const idx = items.findIndex((z) => z.id === id);
  if (idx < 0) return null;
  const current = items[idx];
  const next: Zone = {
    ...current,
    ...(patch.name !== undefined
      ? { name: patch.name.trim() || current.name }
      : {}),
    ...(patch.description !== undefined
      ? { description: patch.description.trim() }
      : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon || current.icon } : {}),
    updatedAt: nowIso(),
  };
  items[idx] = next;
  writeZones(items);
  return next;
}

/**
 * Delete a zone. Every env group assigned to it (or any of its sections)
 * is returned to the implicit Unassigned bucket — the alternative is
 * orphans, which would confuse the UI and lose data silently.
 */
export function deleteZone(id: string): void {
  const items = readZones().filter((z) => z.id !== id);
  writeZones(items);
  const assignments = readAssignments();
  let changed = false;
  for (const [envGroupId, location] of Object.entries(assignments)) {
    if (location.zoneId === id) {
      delete assignments[envGroupId];
      changed = true;
    }
  }
  if (changed) writeAssignments(assignments);
}

/**
 * Persist a new ordering for the zones. `orderedIds` is the desired
 * display order. Any zones not in `orderedIds` keep their existing
 * relative position appended at the end.
 */
export function reorderZones(orderedIds: string[]): void {
  const items = readZones();
  const byId = new Map(items.map((z) => [z.id, z]));
  const seen = new Set<string>();
  const ordered: Zone[] = [];
  for (const id of orderedIds) {
    const z = byId.get(id);
    if (z && !seen.has(id)) {
      ordered.push(z);
      seen.add(id);
    }
  }
  for (const z of items) {
    if (!seen.has(z.id)) ordered.push(z);
  }
  const renumbered = ordered.map((z, idx) => ({ ...z, order: idx }));
  writeZones(renumbered);
}

// ---------------------------------------------------------------------------
// Section CRUD (nested under a zone)
// ---------------------------------------------------------------------------

export function addSection(zoneId: string, name: string): ZoneSection | null {
  const items = readZones();
  const idx = items.findIndex((z) => z.id === zoneId);
  if (idx < 0) return null;
  const section: ZoneSection = {
    id: genId("sec"),
    name: name.trim() || "Untitled section",
  };
  const next: Zone = {
    ...items[idx],
    sections: [...items[idx].sections, section],
    updatedAt: nowIso(),
  };
  items[idx] = next;
  writeZones(items);
  return section;
}

export function renameSection(
  zoneId: string,
  sectionId: string,
  name: string,
): void {
  const items = readZones();
  const idx = items.findIndex((z) => z.id === zoneId);
  if (idx < 0) return;
  const zone = items[idx];
  const nextSections = zone.sections.map((s) =>
    s.id === sectionId ? { ...s, name: name.trim() || s.name } : s,
  );
  items[idx] = { ...zone, sections: nextSections, updatedAt: nowIso() };
  writeZones(items);
}

/**
 * Remove a section from a zone. Env groups previously placed in that
 * section drop back to the zone's default lane (the zone still owns
 * them — we don't yank assignments to Unassigned, that would feel
 * destructive for a section delete).
 */
export function deleteSection(zoneId: string, sectionId: string): void {
  const items = readZones();
  const idx = items.findIndex((z) => z.id === zoneId);
  if (idx < 0) return;
  const zone = items[idx];
  items[idx] = {
    ...zone,
    sections: zone.sections.filter((s) => s.id !== sectionId),
    updatedAt: nowIso(),
  };
  writeZones(items);
  const assignments = readAssignments();
  let changed = false;
  for (const [envGroupId, location] of Object.entries(assignments)) {
    if (location.zoneId === zoneId && location.sectionId === sectionId) {
      assignments[envGroupId] = { zoneId };
      changed = true;
    }
  }
  if (changed) writeAssignments(assignments);
}

// ---------------------------------------------------------------------------
// Assignment CRUD (envGroupId → zone/section)
// ---------------------------------------------------------------------------

function readAssignments(): ZoneAssignments {
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ZoneAssignments;
  } catch {
    return {};
  }
}

function writeAssignments(map: ZoneAssignments): void {
  try {
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(map));
    emitLocalChange();
  } catch {
    /* quota or privacy mode — silent */
  }
}

export function listAssignments(): ZoneAssignments {
  return readAssignments();
}

/**
 * Place an env group into a zone (and optionally a section). Calling
 * with `null` removes the assignment, returning the env group to
 * Unassigned.
 */
export function setAssignment(
  envGroupId: string,
  target: { zoneId: string; sectionId?: string } | null,
): void {
  const map = readAssignments();
  if (!target) {
    if (envGroupId in map) {
      delete map[envGroupId];
      writeAssignments(map);
    }
    return;
  }
  map[envGroupId] = target.sectionId
    ? { zoneId: target.zoneId, sectionId: target.sectionId }
    : { zoneId: target.zoneId };
  writeAssignments(map);
}

/** Bulk replace assignments (used by import / migration). */
export function replaceAllAssignments(next: ZoneAssignments): void {
  writeAssignments({ ...next });
}
