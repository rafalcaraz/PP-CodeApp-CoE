/**
 * Tenant-wide connector catalog.
 *
 * The inventory schema now exposes
 * `microsoft.powerplatformconnector/connectors` as a tenant catalog resource.
 * It is the primary source because it removes environment fan-out and adds
 * release, deprecation, description, and operation metadata.
 *
 * The resource is still Preview and unavailable in sovereign clouds, so the
 * established environment-scoped `ListConnectors` path remains as a fallback.
 * Consumers keep one stable catalog/classification API regardless of source.
 */

import { useEffect, useReducer } from "react";
import { PowerPlatformforAdminsV2Service } from "../../generated";
import type {
  Clause,
  ResourceItem,
  ResourceQueryRequest,
} from "../../generated/models/PowerPlatformforAdminsV2Model";

type CatalogResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STORAGE_KEY = "ppcoe.connectorCatalog.v2";
const TTL_MS = 24 * 60 * 60 * 1000;
const API_VERSION = "2024-10-01";
const TABLE = "PowerPlatformResources";
const CONNECTOR_RESOURCE_TYPE =
  "microsoft.powerplatformconnector/connectors";
const PAGE_SIZE = 500;
const MAX_CATALOG_PAGES = 25;
const MAX_ENVS_TRIED = 5;

export interface ConnectorCatalogOperation {
  operationId: string;
  displayName: string;
  description: string;
  method: string;
}

export interface ConnectorEntry {
  connectorId: string;
  displayName: string;
  description: string;
  tier: string;
  publisher: string;
  releaseTag: string;
  isDeprecated: boolean;
  operations: ConnectorCatalogOperation[];
}

export type CatalogSource =
  | "inventory"
  | "list-connectors-fallback";

export interface ConnectorCatalog {
  entries: Map<string, ConnectorEntry>;
  fetchedAt: number;
  source: CatalogSource;
  /** True only after the source was paged to exhaustion. */
  complete: boolean;
}

export interface Classification {
  tier: "Standard" | "Premium" | "Unknown";
  publisher: string;
  known: boolean;
  reason: "catalog" | "not-found" | "catalog-unavailable";
}

export type CatalogStatus = "idle" | "loading" | "ready" | "error";

let _catalog: ConnectorCatalog | undefined;
let _status: CatalogStatus = "idle";
let _lastError = "";
let _loadPromise: Promise<CatalogResult<ConnectorCatalog>> | undefined;
const _listeners = new Set<() => void>();

function notify(): void {
  for (const listener of _listeners) listener();
}

export function subscribeCatalog(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

export function getCatalog(): ConnectorCatalog | undefined {
  return _catalog;
}

export function getCatalogStatus(): {
  status: CatalogStatus;
  error: string;
} {
  return { status: _status, error: _lastError };
}

function normalizeSlug(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const idx = trimmed.lastIndexOf("/");
  return (idx >= 0 ? trimmed.substring(idx + 1) : trimmed).toLowerCase();
}

export function classify(connectorId: string): Classification {
  const slug = normalizeSlug(connectorId);
  if (!slug || !_catalog) {
    return {
      tier: "Unknown",
      publisher: "",
      known: false,
      reason: "catalog-unavailable",
    };
  }
  const alternateSlug = slug.startsWith("shared_")
    ? slug.substring("shared_".length)
    : `shared_${slug}`;
  const entry =
    _catalog.entries.get(slug) ||
    _catalog.entries.get(alternateSlug);
  if (!entry) {
    return {
      tier: "Unknown",
      publisher: "",
      known: false,
      reason: _catalog.complete ? "not-found" : "catalog-unavailable",
    };
  }
  const tier = entry.tier.toLowerCase();
  return {
    tier:
      tier === "premium"
        ? "Premium"
        : tier === "standard"
          ? "Standard"
          : "Unknown",
    publisher: entry.publisher,
    known: true,
    reason: "catalog",
  };
}

/** Unknown connectors are treated as premium only when a complete catalog is
 * available and the connector is absent. A catalog that has not loaded cannot
 * support a licensing inference. */
export function anyConnectorPremium(connectorIds: string[]): boolean {
  for (const id of connectorIds) {
    const classification = classify(id);
    if (
      classification.tier === "Premium" ||
      classification.reason === "not-found"
    ) {
      return true;
    }
  }
  return false;
}

interface PersistShape {
  fetchedAt: number;
  source: CatalogSource;
  complete: boolean;
  entries: ConnectorEntry[];
}

function isCatalogSource(value: unknown): value is CatalogSource {
  return (
    value === "inventory" ||
    value === "list-connectors-fallback"
  );
}

function loadFromStorage(): ConnectorCatalog | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    if (
      typeof parsed.fetchedAt !== "number" ||
      !isCatalogSource(parsed.source) ||
      parsed.complete !== true ||
      !Array.isArray(parsed.entries) ||
      Date.now() - parsed.fetchedAt > TTL_MS
    ) {
      return undefined;
    }
    const entries = new Map<string, ConnectorEntry>();
    for (const entry of parsed.entries) {
      if (
        entry &&
        typeof entry.connectorId === "string" &&
        entry.connectorId
      ) {
        entries.set(normalizeSlug(entry.connectorId), entry);
      }
    }
    if (entries.size === 0) return undefined;
    return {
      entries,
      fetchedAt: parsed.fetchedAt,
      source: parsed.source,
      complete: true,
    };
  } catch {
    return undefined;
  }
}

function persist(catalog: ConnectorCatalog): void {
  try {
    const payload: PersistShape = {
      fetchedAt: catalog.fetchedAt,
      source: catalog.source,
      complete: catalog.complete,
      entries: Array.from(catalog.entries.values()),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in privacy mode. The in-memory catalog stays valid.
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readOperations(value: unknown): ConnectorCatalogOperation[] {
  if (!Array.isArray(value)) return [];
  const operations: ConnectorCatalogOperation[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const operation = asRecord(raw);
    const operationId = readString(operation, "operationId");
    if (!operationId || seen.has(operationId)) continue;
    seen.add(operationId);
    operations.push({
      operationId,
      displayName: readString(operation, "displayName"),
      description: readString(operation, "description"),
      method: readString(operation, "method"),
    });
  }
  return operations.sort((a, b) =>
    (a.displayName || a.operationId).localeCompare(
      b.displayName || b.operationId,
    ),
  );
}

function toConnectorEntry(item: ResourceItem): ConnectorEntry | null {
  const properties = asRecord(item.properties);
  const connectorId = normalizeSlug(
    readString(properties, "connectorId") ||
      item.name ||
      item.id ||
      "",
  );
  if (!connectorId) return null;
  return {
    connectorId,
    displayName:
      readString(properties, "displayName") ||
      item.name ||
      connectorId,
    description: readString(properties, "description"),
    tier: readString(properties, "tier"),
    publisher: readString(properties, "publisher"),
    releaseTag: readString(properties, "releaseTag"),
    isDeprecated: readBoolean(properties, "isDeprecated"),
    operations: readOperations(properties.operations),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.status === "number") {
      parts.push(`HTTP ${record.status}`);
    }
    if (typeof record.requestId === "string") {
      parts.push(`requestId ${record.requestId}`);
    }
    if (parts.length > 0) return parts.join(" - ");
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error || "Unknown error");
}

function isRateLimit(error: unknown): boolean {
  return /(\b429\b|rate ?limit|throttle|too many requests)/i.test(
    formatError(error),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryCatalogPage(
  skip: number,
  skipToken: string,
): Promise<CatalogResult<{ items: ResourceItem[]; skipToken: string }>> {
  const typeClause = {
    $type: "where",
    FieldName: "type",
    Operator: "==",
    Values: [`'${CONNECTOR_RESOURCE_TYPE}'`],
  } as unknown as Clause;
  const body: ResourceQueryRequest = {
    TableName: TABLE,
    Clauses: [typeClause],
    Options: { Top: PAGE_SIZE, Skip: skip, SkipToken: skipToken },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result =
        await PowerPlatformforAdminsV2Service.QueryResources(
          API_VERSION,
          body,
        );
      if (result.success) {
        return {
          ok: true,
          data: {
            items: result.data?.data ?? [],
            skipToken: result.data?.skipToken ?? "",
          },
        };
      }
      if (attempt === 0 && isRateLimit(result.error)) {
        await sleep(500);
        continue;
      }
      return { ok: false, error: formatError(result.error) };
    } catch (error) {
      if (attempt === 0 && isRateLimit(error)) {
        await sleep(500);
        continue;
      }
      return { ok: false, error: formatError(error) };
    }
  }
  return { ok: false, error: "Connector catalog query failed." };
}

async function fetchInventoryCatalog(): Promise<
  CatalogResult<ConnectorCatalog>
> {
  const entries = new Map<string, ConnectorEntry>();
  let skip = 0;
  let skipToken = "";
  let previousToken = "";

  for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
    const result = await queryCatalogPage(skip, skipToken);
    if (!result.ok) return result;
    for (const item of result.data.items) {
      const entry = toConnectorEntry(item);
      if (entry) entries.set(entry.connectorId, entry);
    }
    if (!result.data.skipToken) {
      if (entries.size === 0) {
        return {
          ok: false,
          error: "Connector inventory returned an empty catalog.",
        };
      }
      return {
        ok: true,
        data: {
          entries,
          fetchedAt: Date.now(),
          source: "inventory",
          complete: true,
        },
      };
    }
    if (result.data.skipToken === previousToken) {
      return {
        ok: false,
        error: "Connector inventory pagination repeated its continuation token.",
      };
    }
    previousToken = result.data.skipToken;
    skipToken = result.data.skipToken;
    skip += result.data.items.length;
  }

  return {
    ok: false,
    error: `Connector inventory exceeded the ${MAX_CATALOG_PAGES}-page safety cap.`,
  };
}

async function fetchCatalogFromEnvironment(
  envId: string,
): Promise<CatalogResult<ConnectorCatalog>> {
  try {
    const result = await PowerPlatformforAdminsV2Service.ListConnectors(
      envId,
      `environment eq '${envId}'`,
      API_VERSION,
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const entries = new Map<string, ConnectorEntry>();
    for (const rawItem of result.data?.value ?? []) {
      const item = rawItem as unknown as ResourceItem;
      const entry = toConnectorEntry(item);
      if (entry) entries.set(entry.connectorId, entry);
    }
    return {
      ok: true,
      data: {
        entries,
        fetchedAt: Date.now(),
        source: "list-connectors-fallback",
        // One environment is enough to enrich known connectors, but absence
        // from it does not prove a connector is tenant-wide unknown/custom.
        complete: false,
      },
    };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

async function fetchFallbackCatalog(): Promise<
  CatalogResult<ConnectorCatalog>
> {
  try {
    const envResult =
      await PowerPlatformforAdminsV2Service.ListEnvironmentsForUser(
        API_VERSION,
      );
    if (!envResult.success) {
      return { ok: false, error: formatError(envResult.error) };
    }
    const environments = envResult.data?.value ?? [];
    if (environments.length === 0) {
      return { ok: false, error: "No environments available to query." };
    }

    let lastError = "";
    for (
      let index = 0;
      index < environments.length && index < MAX_ENVS_TRIED;
      index++
    ) {
      const envId = environments[index].id;
      if (!envId) continue;
      const result = await fetchCatalogFromEnvironment(envId);
      if (result.ok && result.data.entries.size > 0) return result;
      if (!result.ok) lastError = result.error;
    }
    return {
      ok: false,
      error:
        lastError ||
        `ListConnectors returned no connectors from the first ${MAX_ENVS_TRIED} environments tried.`,
    };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

async function doLoad(): Promise<CatalogResult<ConnectorCatalog>> {
  const inventory = await fetchInventoryCatalog();
  if (inventory.ok) return inventory;

  const fallback = await fetchFallbackCatalog();
  if (fallback.ok) return fallback;
  return {
    ok: false,
    error:
      `Connector inventory failed: ${inventory.error}. ` +
      `ListConnectors fallback failed: ${fallback.error}`,
  };
}

export async function loadCatalog(opts?: {
  force?: boolean;
}): Promise<CatalogResult<ConnectorCatalog>> {
  const force = Boolean(opts?.force);
  if (!force && _catalog) return { ok: true, data: _catalog };

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
  if (_loadPromise) return _loadPromise;

  _status = "loading";
  notify();
  _loadPromise = (async () => {
    const result = await doLoad();
    if (result.ok) {
      _catalog = result.data;
      _status = "ready";
      _lastError = "";
      if (result.data.complete) persist(result.data);
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

export function useConnectorCatalog(): {
  catalog: ConnectorCatalog | undefined;
  status: CatalogStatus;
  error: string;
  classify: (connectorId: string) => Classification;
} {
  const [, forceUpdate] = useReducer((value: number) => value + 1, 0);
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
    // Ignore storage restrictions in test environments.
  }
}
