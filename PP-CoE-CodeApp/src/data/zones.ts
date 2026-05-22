/**
 * Zones — user-defined parent grouping over Microsoft environment groups
 *          AND user-managed Standard custom groups.
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
 * whatever they want) and drop groups inside them. The groups themselves
 * can be either real Microsoft environment groups (Managed envs only,
 * read-only from us) OR Standard custom groups (Standard envs only, fully
 * owned by us in localStorage). See `data/standardGroups.ts`.
 *
 * **Storage layout.** Three keys, intentionally separated so renaming or
 * deleting one entity doesn't rewrite unrelated blobs:
 *
 *   `ppcoe.zones.v1`            → Zone[]
 *   `ppcoe.standardGroups.v1`   → StandardCustomGroup[]  (separate module)
 *   `ppcoe.zoneAssignments.v1`  → ZoneAssignments
 *
 * Assignment keys are `${kind}:${id}` strings (`ms:abc-def-...` for a
 * Microsoft env group, `custom:xyz-...` for a Standard custom group).
 * v1 of this module used bare env-group IDs as keys; those are migrated
 * on first read after the upgrade.
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

/**
 * Reference to a group placed in a zone. `kind` discriminates between
 * Microsoft env groups (Managed) and Standard custom groups (Standard) —
 * the two are NOT interchangeable. Type purity is enforced upstream
 * (e.g., a Standard env can never land in an MS group; an MS env group
 * always holds Managed envs only).
 */
export type GroupKind = "ms" | "custom";

export interface GroupRef {
  kind: GroupKind;
  id: string;
}

export const msRef = (id: string): GroupRef => ({ kind: "ms", id });
export const customRef = (id: string): GroupRef => ({ kind: "custom", id });

export function refToKey(ref: GroupRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function keyToRef(key: string): GroupRef {
  const colonAt = key.indexOf(":");
  if (colonAt < 0) {
    // Legacy bare key (pre-v2). Existed only for MS env groups.
    return { kind: "ms", id: key };
  }
  const kind = key.slice(0, colonAt) as GroupKind;
  return { kind, id: key.slice(colonAt + 1) };
}

/**
 * Map of `${kind}:${id}` → where the group lives. Absence = unassigned.
 */
export type ZoneAssignments = Record<string, ZoneAssignment>;

export interface ZoneAssignment {
  zoneId: string;
  /** Optional — when omitted, the group sits in the zone's default lane. */
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
  return (
    key === ZONES_KEY ||
    key === ASSIGNMENTS_KEY ||
    key === STANDARD_GROUPS_KEY
  );
}

/** Re-exported for `data/standardGroups.ts` to avoid circular imports. */
export const STANDARD_GROUPS_KEY = "ppcoe.standardGroups.v1";

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
 * Delete a zone. Every group assigned to it (or any of its sections) is
 * returned to the implicit Unassigned bucket — the alternative is
 * orphans, which would confuse the UI and lose data silently. Affects
 * BOTH MS env groups and Standard custom groups equally; the zone is
 * type-agnostic.
 */
export function deleteZone(id: string): void {
  const items = readZones().filter((z) => z.id !== id);
  writeZones(items);
  const assignments = readAssignments();
  let changed = false;
  for (const [refKey, location] of Object.entries(assignments)) {
    if (location.zoneId === id) {
      delete assignments[refKey];
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
 * Remove a section from a zone. Groups previously placed in that
 * section drop back to the zone's default lane (the zone still owns
 * them — we don't yank assignments to Unassigned, that would feel
 * destructive for a section delete). Type-agnostic across MS and
 * Standard custom groups.
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
  for (const [refKey, location] of Object.entries(assignments)) {
    if (location.zoneId === zoneId && location.sectionId === sectionId) {
      assignments[refKey] = { zoneId };
      changed = true;
    }
  }
  if (changed) writeAssignments(assignments);
}

// ---------------------------------------------------------------------------
// Assignment CRUD (GroupRef → zone/section)
// ---------------------------------------------------------------------------

function readAssignments(): ZoneAssignments {
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return migrateLegacyKeysIfNeeded(parsed as Record<string, ZoneAssignment>);
  } catch {
    return {};
  }
}

/**
 * v1 of this module keyed assignments by bare env-group IDs (always
 * Microsoft). v2 keys by `${kind}:${id}`. Detect bare keys and rewrite
 * them in-place to `ms:${id}`. Idempotent — running on already-migrated
 * data is a no-op.
 */
function migrateLegacyKeysIfNeeded(
  map: Record<string, ZoneAssignment>,
): ZoneAssignments {
  let needsWrite = false;
  const out: ZoneAssignments = {};
  for (const [key, location] of Object.entries(map)) {
    if (key.includes(":")) {
      out[key] = location;
    } else {
      out[`ms:${key}`] = location;
      needsWrite = true;
    }
  }
  if (needsWrite) {
    try {
      localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(out));
      // Don't emit a local change event — this is a silent transparent
      // migration, not a user-visible state change.
    } catch {
      /* quota or privacy mode — silent, app still works on in-memory copy */
    }
  }
  return out;
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
 * Place a group (MS env group OR Standard custom group) into a zone
 * and optionally a section. Calling with `null` removes the assignment,
 * returning the group to Unassigned.
 */
export function setAssignment(
  ref: GroupRef,
  target: { zoneId: string; sectionId?: string } | null,
): void {
  const map = readAssignments();
  const key = refToKey(ref);
  if (!target) {
    if (key in map) {
      delete map[key];
      writeAssignments(map);
    }
    return;
  }
  map[key] = target.sectionId
    ? { zoneId: target.zoneId, sectionId: target.sectionId }
    : { zoneId: target.zoneId };
  writeAssignments(map);
}

/**
 * Remove every assignment that points at the given group ref. Used when
 * a Standard custom group is deleted — its assignment (if any) is wiped
 * so we don't leave a phantom placement.
 */
export function clearAssignmentsFor(ref: GroupRef): void {
  const map = readAssignments();
  const key = refToKey(ref);
  if (key in map) {
    delete map[key];
    writeAssignments(map);
  }
}

/** Bulk replace assignments (used by import / migration). */
export function replaceAllAssignments(next: ZoneAssignments): void {
  writeAssignments({ ...next });
}
