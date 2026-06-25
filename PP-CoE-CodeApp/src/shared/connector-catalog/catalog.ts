/**
 * Tenant-wide connector catalog.
 *
 * Why this exists: the Power Platform for Admins `ListConnectors`
 * action is per-environment, but the Microsoft-published connector
 * catalog is global — `shared_sql` is Premium in every environment it
 * appears in. So a single `ListConnectors(envId)` call against any env
 * the signed-in admin can reach is enough to classify every `shared_*`
 * reference any app or flow in the tenant uses.
 *
 * Strategy:
 *
 *  1. On first access, try to hydrate from localStorage (24h TTL).
 *  2. If cache is missing or stale, list envs, pick the first one that
 *     actually returns connectors, persist its catalog.
 *  3. Expose a sync `classify(connectorId)` that other code (apps and
 *     flows lists) calls at render time. Returns `Unknown` when the
 *     catalog hasn't loaded yet or when the id is not in the snapshot —
 *     callers treat Unknown as "premium / custom" since custom
 *     connectors aren't in the OOB Microsoft catalog and are billed as
 *     premium per Microsoft licensing.
 *  4. Subscribers (the `useConnectorCatalog` hook) re-render when the
 *     catalog finishes loading so the columns flip from `—` to a real
 *     badge with no extra wiring at the call site.
 *
 * Notes:
 *
 *  - We don't enumerate custom connectors per-env. That would require
 *    a tenant-wide fanout and yield no extra classification signal —
 *    every custom connector is premium by definition.
 *  - localStorage payload is small (~600 entries × small object = under
 *    100 KB), well within the 5 MB browser budget.
 *  - This module imports `data/inventory` (for `listEnvironmentsPage`)
 *    and `generated/` (for `ListConnectors`). It MUST NOT import from
 *    `features/*` per the boundary rules in copilot-instructions.md.
 */

import { useEffect, useReducer } from "react";
import { PowerPlatformforAdminsV2Service } from "../../generated";

/** Shape-compatible with the app-wide `DataResult` in `data/inventory`
 *  but defined locally because `shared/*` modules aren't allowed to
 *  import from `data/inventory` (boundary rule in copilot-instructions).
 *  Callers can interop with the app-wide `DataResult` transparently. */
type CatalogResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** localStorage key. Bumped if the serialized shape changes — the
 *  hydrator throws away any value it can't deserialize cleanly. */
const STORAGE_KEY = "ppcoe.connectorCatalog.v1";

/** Cached catalogs older than this are ignored on hydrate and silently
 *  refreshed on the next `loadCatalog` call. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Matches the api-version used elsewhere on the V2 admin connector. */
const API_VERSION = "2024-10-01";

/** Defensive cap on how many environments we'll probe looking for one
 *  that returns connectors. Practically every env returns the full
 *  catalog, so the very first hit usually succeeds — but a brand-new
 *  trial env can briefly return an empty list while it provisions. */
const MAX_ENVS_TRIED = 5;

/** One row of the catalog. Pruned to the fields apps/flows actually
 *  need at render time — the full payload stays out of memory. */
export interface ConnectorEntry {
  /** Stable connector slug, e.g. `shared_sql`. */
  connectorId: string;
  /** Friendly name from the connector metadata. */
  displayName: string;
  /** Raw tier string from the connector (`"Standard"`, `"Premium"`, or
   *  occasionally other values). Kept as the source string so callers
   *  can read it as-is; the normalized form is on `Classification`. */
  tier: string;
  /** Publisher string (e.g. `"Microsoft"`, `"Plumsail"`). Empty when
   *  the connector didn't include it. */
  publisher: string;
}

/** Diagnostics captured during a catalog fetch. Temporary — surfaced in
 *  the Connectors page's Diagnostics panel to investigate the count gap
 *  (app shows fewer connectors than the DLP "prebuilt connectors" list).
 *  Remove (or gate behind an off-by-default flag) once root cause is
 *  confirmed. */
export interface CatalogDiagnostics {
  /** Raw `value.length` returned by ListConnectors before any dedup. */
  rawCount: number;
  /** Entry count after slug-keyed dedup (i.e. the Map size). */
  dedupedCount: number;
  /** rawCount - dedupedCount: how many rows collapsed on duplicate slugs. */
  droppedToDedup: number;
  /** Continuation token found on the raw response, if any. Its presence
   *  means the API paged the result and we're only seeing page one. */
  continuationToken: string;
  /** Which raw field the continuation token came from (for diagnostics). */
  continuationField: string;
  /** Env id the snapshot was sourced from. */
  envId: string;
}

/** The in-memory representation of the catalog. */
export interface ConnectorCatalog {
  entries: Map<string, ConnectorEntry>;
  /** When the snapshot was taken (epoch ms). Drives TTL eviction. */
  fetchedAt: number;
  /** Which env id the snapshot was sourced from. Useful for
   *  diagnostics — the catalog itself is the same across envs but it's
   *  occasionally useful to know "this came from env X". */
  envId: string;
  /** Optional fetch diagnostics. Absent on catalogs hydrated from an
   *  older localStorage snapshot. */
  diagnostics?: CatalogDiagnostics;
}

/** Normalized classification result returned by `classify`. */
export interface Classification {
  /** "Standard" / "Premium" — or "Unknown" when the connector isn't
   *  in the OOB snapshot. Callers should treat Unknown as Premium for
   *  licensing purposes (custom connectors are billed as premium). */
  tier: "Standard" | "Premium" | "Unknown";
  /** Empty string when the connector isn't in the catalog. */
  publisher: string;
  /** True when the connector was found in the catalog. */
  known: boolean;
}

/** Catalog status — drives loading/error UI on the Connectors page. */
export type CatalogStatus = "idle" | "loading" | "ready" | "error";

let _catalog: ConnectorCatalog | undefined;
let _status: CatalogStatus = "idle";
let _lastError = "";
let _loadPromise: Promise<CatalogResult<ConnectorCatalog>> | undefined;
const _listeners = new Set<() => void>();

function notify(): void {
  for (const l of _listeners) l();
}

/** Subscribe to catalog state changes. Returns an unsubscribe function. */
export function subscribeCatalog(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Read the current catalog without triggering a load. */
export function getCatalog(): ConnectorCatalog | undefined {
  return _catalog;
}

/** Read the current catalog status without triggering a load. */
export function getCatalogStatus(): {
  status: CatalogStatus;
  error: string;
} {
  return { status: _status, error: _lastError };
}

/** Synchronous classification. Safe to call before the catalog loads —
 *  returns `{ tier: "Unknown", known: false }` in that case. */
export function classify(connectorId: string): Classification {
  if (!connectorId) {
    return { tier: "Unknown", publisher: "", known: false };
  }
  const cat = _catalog;
  if (!cat) {
    return { tier: "Unknown", publisher: "", known: false };
  }
  const entry = cat.entries.get(connectorId);
  if (!entry) {
    return { tier: "Unknown", publisher: "", known: false };
  }
  const t = entry.tier.toLowerCase();
  return {
    tier: t === "premium" ? "Premium" : t === "standard" ? "Standard" : "Unknown",
    publisher: entry.publisher,
    known: true,
  };
}

/** Convenience rollup: any connector in the list is premium-or-unknown.
 *  Apps/flows that pull this come back `true` when ANY of their
 *  connectors is Premium OR not in the OOB catalog (custom). */
export function anyConnectorPremium(connectorIds: string[]): boolean {
  for (const id of connectorIds) {
    const c = classify(id);
    if (c.tier === "Premium" || c.tier === "Unknown") return true;
  }
  return false;
}

interface PersistShape {
  fetchedAt: number;
  envId: string;
  entries: ConnectorEntry[];
  diagnostics?: CatalogDiagnostics;
}

function loadFromStorage(): ConnectorCatalog | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PersistShape;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== "number" ||
      !Array.isArray(parsed.entries)
    ) {
      return undefined;
    }
    if (Date.now() - parsed.fetchedAt > TTL_MS) {
      return undefined;
    }
    const entries = new Map<string, ConnectorEntry>();
    for (const e of parsed.entries) {
      if (e && typeof e.connectorId === "string" && e.connectorId) {
        entries.set(e.connectorId, e);
      }
    }
    return {
      entries,
      fetchedAt: parsed.fetchedAt,
      envId: typeof parsed.envId === "string" ? parsed.envId : "",
      diagnostics: parsed.diagnostics,
    };
  } catch {
    return undefined;
  }
}

function persist(catalog: ConnectorCatalog): void {
  try {
    const payload: PersistShape = {
      fetchedAt: catalog.fetchedAt,
      envId: catalog.envId,
      entries: Array.from(catalog.entries.values()),
      diagnostics: catalog.diagnostics,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / privacy mode — keep going with the in-memory catalog.
  }
}

function normalizeSlug(armId: string): string {
  if (!armId) return "";
  const idx = armId.lastIndexOf("/");
  return idx >= 0 ? armId.substring(idx + 1) : armId;
}

/** Probe one env. Returns ok with a (possibly empty) catalog, or fails
 *  with a stringified error suitable for surfacing. */
async function fetchCatalogFromEnv(
  envId: string,
): Promise<CatalogResult<ConnectorCatalog>> {
  const $filter = `environment eq '${envId}'`;
  const result = await PowerPlatformforAdminsV2Service.ListConnectors(
    envId,
    $filter,
    API_VERSION,
  );
  if (!result.success) {
    const err = result.error;
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : (() => {
              try {
                return JSON.stringify(err);
              } catch {
                return String(err);
              }
            })();
    return { ok: false, error: msg };
  }
  const items = result.data?.value ?? [];
  const entries = new Map<string, ConnectorEntry>();
  for (const item of items) {
    const armId = item.id ?? "";
    const slug = normalizeSlug(armId) || item.name || "";
    if (!slug) continue;
    const props = item.properties ?? {};
    entries.set(slug, {
      connectorId: slug,
      displayName:
        (typeof props.displayName === "string" && props.displayName) ||
        item.name ||
        slug,
      tier: typeof props.tier === "string" ? props.tier : "",
      publisher: typeof props.publisher === "string" ? props.publisher : "",
    });
  }

  // Defensively probe the raw response for a continuation token. The
  // generated `ListConnectorsResponse` only models `value`, so if the
  // admin connector pages its result we'd silently drop every page after
  // the first. Reading these off an untyped view (without editing
  // `generated/`) tells us whether truncation is happening.
  const rawResponse = result.data as unknown as Record<string, unknown>;
  let continuationToken = "";
  let continuationField = "";
  for (const field of ["@odata.nextLink", "nextLink", "skipToken"]) {
    const v = rawResponse?.[field];
    if (typeof v === "string" && v) {
      continuationToken = v;
      continuationField = field;
      break;
    }
  }

  const rawCount = items.length;
  const dedupedCount = entries.size;
  const diagnostics: CatalogDiagnostics = {
    rawCount,
    dedupedCount,
    droppedToDedup: rawCount - dedupedCount,
    continuationToken,
    continuationField,
    envId,
  };

  return {
    ok: true,
    data: { entries, fetchedAt: Date.now(), envId, diagnostics },
  };
}

/** Walk the env list returned by `ListEnvironmentsForUser` (the admin
 *  V2 connector's per-user env listing — only envs the calling admin
 *  can actually reach) and try each until one returns a non-empty
 *  catalog. Capped at MAX_ENVS_TRIED to avoid pathological fanout if
 *  the tenant has a long tail of broken envs.
 *
 *  We call the generated service directly rather than going through
 *  `data/inventory.listEnvironmentsPage` because `shared/` modules are
 *  not allowed to import from `data/inventory` (boundary rule). The
 *  generated service is leaf-safe to import from anywhere.
 */
async function doLoad(): Promise<CatalogResult<ConnectorCatalog>> {
  const envsResult = await PowerPlatformforAdminsV2Service.ListEnvironmentsForUser(
    API_VERSION,
  );
  if (!envsResult.success) {
    const err = envsResult.error;
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "ListEnvironmentsForUser failed",
    };
  }
  const envs = envsResult.data?.value ?? [];
  if (envs.length === 0) {
    return { ok: false, error: "No environments available to query." };
  }
  let lastError = "";
  for (let i = 0; i < envs.length && i < MAX_ENVS_TRIED; i++) {
    const envId = envs[i].id;
    if (!envId) continue;
    const result = await fetchCatalogFromEnv(envId);
    if (result.ok && result.data.entries.size > 0) {
      return result;
    }
    if (!result.ok) lastError = result.error;
  }
  return {
    ok: false,
    error:
      lastError ||
      `ListConnectors returned no connectors from the first ${MAX_ENVS_TRIED} environments tried.`,
  };
}

/**
 * Public load entrypoint. Idempotent — concurrent callers share the
 * same in-flight promise. Pass `{ force: true }` to skip the cache and
 * refresh from the connector.
 */
export async function loadCatalog(opts?: {
  force?: boolean;
}): Promise<CatalogResult<ConnectorCatalog>> {
  const force = Boolean(opts?.force);

  if (!force && _catalog) {
    return { ok: true, data: _catalog };
  }
  if (!force) {
    const cached = loadFromStorage();
    if (cached) {
      _catalog = cached;
      _status = "ready";
      _lastError = "";
      notify();
      return { ok: true, data: cached };
    }
  }
  if (_loadPromise && !force) {
    return _loadPromise;
  }

  _status = "loading";
  if (force) {
    // Keep the existing _catalog populated while refreshing so the UI
    // doesn't blink back to "Unknown" badges mid-refresh.
    notify();
  } else {
    notify();
  }

  _loadPromise = (async () => {
    const result = await doLoad();
    if (result.ok) {
      _catalog = result.data;
      _status = "ready";
      _lastError = "";
      persist(result.data);
    } else {
      _status = _catalog ? "ready" : "error";
      _lastError = result.error;
    }
    notify();
    return result;
  })();

  try {
    return await _loadPromise;
  } finally {
    _loadPromise = undefined;
  }
}

/** React hook. Returns the current catalog + a classifier; rerenders
 *  the consuming component when the catalog state changes. */
export function useConnectorCatalog(): {
  catalog: ConnectorCatalog | undefined;
  status: CatalogStatus;
  error: string;
  classify: (connectorId: string) => Classification;
} {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeCatalog(() => forceUpdate()), []);
  return {
    catalog: _catalog,
    status: _status,
    error: _lastError,
    classify,
  };
}

/** Test-only reset. NOT exported from `index.ts`. */
export function __resetCatalogForTests(): void {
  _catalog = undefined;
  _status = "idle";
  _lastError = "";
  _loadPromise = undefined;
  _listeners.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

