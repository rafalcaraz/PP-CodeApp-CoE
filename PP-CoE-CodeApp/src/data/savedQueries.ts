/**
 * Saved queries.
 *
 * A saved query persists everything needed to re-run a query the user
 * composed in the Queries view: either a visual `QuerySpec` (when the
 * builder was the source) or a raw `Clause[]` payload (when the user
 * pasted JSON). The connector contract — `Clause[]` — is always stored
 * so the query keeps running even if the visual builder shape evolves.
 *
 * Persistence is localStorage today; the public functions wrap it so we
 * can swap in a Dataverse-backed store later without touching the views
 * (see `docs/roadmap.md` → "Saved queries in a Dataverse table" for the
 * eventual migration plan).
 */

import type { QuerySpec } from "./inventory";
import type { Clause } from "../generated/models/PowerPlatformforAdminsV2Model";

export type SavedQuerySource = "builder" | "raw";

export interface SavedQuery {
  id: string;
  name: string;
  description: string;
  /** Where the clauses came from. "builder" means the visual builder produced
   *  them and `spec` is also present so loading round-trips the UI. "raw"
   *  means the user pasted them; only `clauses` is meaningful. */
  source: SavedQuerySource;
  /** Present iff `source === "builder"`. Lets the visual builder repopulate. */
  spec?: QuerySpec;
  /** Always present. This is what `runRawQuery` consumes. */
  clauses: Clause[];
  /** Default page size (`Top`) to use when running. */
  pageSize?: number;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "ppcoe.savedQueries.v1";

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readStore(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedQuery[];
  } catch {
    return [];
  }
}

function writeStore(items: SavedQuery[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota or privacy mode — silent */
  }
}

/** Read all saved queries, newest first. */
export function listSavedQueries(): SavedQuery[] {
  return readStore()
    .slice()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function getSavedQuery(id: string): SavedQuery | null {
  return readStore().find((q) => q.id === id) ?? null;
}

export interface SavedQueryInput {
  name: string;
  description: string;
  source: SavedQuerySource;
  spec?: QuerySpec;
  clauses: Clause[];
  pageSize?: number;
}

/** Create a new saved query. Returns the persisted row. */
export function createSavedQuery(input: SavedQueryInput): SavedQuery {
  const items = readStore();
  const q: SavedQuery = {
    id: genId("q"),
    name: input.name.trim() || "Untitled query",
    description: input.description.trim(),
    source: input.source,
    spec: input.source === "builder" ? input.spec : undefined,
    clauses: input.clauses,
    pageSize: input.pageSize,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeStore([q, ...items]);
  return q;
}

/** Patch fields on an existing saved query. Returns the new row, or null
 *  if not found. */
export function updateSavedQuery(
  id: string,
  patch: Partial<Pick<SavedQuery, "name" | "description">>
): SavedQuery | null {
  const items = readStore();
  const idx = items.findIndex((q) => q.id === id);
  if (idx < 0) return null;
  const next: SavedQuery = {
    ...items[idx],
    ...(patch.name !== undefined ? { name: patch.name.trim() || items[idx].name } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    updatedAt: nowIso(),
  };
  items[idx] = next;
  writeStore(items);
  return next;
}

export function deleteSavedQuery(id: string): void {
  writeStore(readStore().filter((q) => q.id !== id));
}
