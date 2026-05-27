/**
 * Connectors feature — data layer.
 *
 * Thin wrapper around the Power Platform for Admins V2 connector's
 * `ListConnectors` action. Returns the connectors available in a single
 * environment.
 *
 * Why this lives here (and not in `shared/inventory-core/`) for now:
 * the feature is intentionally scoped to "show me what one env returns"
 * — a discovery tool. If/when we move to a tenant-wide connector
 * catalog (fanout across all envs, used to flag premium apps/flows),
 * the per-env fetcher will graduate to `shared/deep-inventory/sources/`
 * and this module will re-export from there.
 */

import { PowerPlatformforAdminsV2Service } from "../../generated";
import type {
  GetConnectorByIdResponse,
  ListConnectorsResponse,
} from "../../generated/models/PowerPlatformforAdminsV2Model";
import type { DataResult } from "../../data/inventory";

/** Matches the api-version used by `adminApps` so the two stay in sync
 *  on connector version bumps. */
const API_VERSION = "2024-10-01";

/** Lean shape for the table view. Keeps a `raw` escape hatch so callers
 *  that want to inspect undocumented fields can do so without forcing
 *  every field through a typed surface. */
export interface ConnectorRow {
  /** ARM-style id, e.g. `/providers/Microsoft.PowerApps/apis/shared_sharepointonline` */
  id: string;
  /** The trailing slug, e.g. `shared_sharepointonline`. Stable join key
   *  against `ResourceConnector.connectorId` on apps/flows. */
  connectorId: string;
  /** Friendly display name (e.g. "SharePoint"). */
  displayName: string;
  /** `"Standard"`, `"Premium"`, or whatever the connector returns. The
   *  string is what drives premium classification across the app. */
  tier: string;
  /** Publisher string from the connector metadata (e.g. "Microsoft"). */
  publisher: string;
  /** True when this is a custom connector authored in the tenant. */
  isCustomApi: boolean;
  /** Raw payload for the per-row drill-down / debug accordion. */
  raw: GetConnectorByIdResponse;
}

function normalizeConnectorSlug(armId: string): string {
  if (!armId) return "";
  const idx = armId.lastIndexOf("/");
  return idx >= 0 ? armId.substring(idx + 1) : armId;
}

function toRow(item: GetConnectorByIdResponse): ConnectorRow {
  const armId = item.id ?? "";
  const props = item.properties ?? {};
  const displayName =
    (typeof props.displayName === "string" && props.displayName) ||
    item.name ||
    normalizeConnectorSlug(armId) ||
    "(unnamed)";
  return {
    id: armId,
    connectorId: normalizeConnectorSlug(armId),
    displayName,
    tier: typeof props.tier === "string" ? props.tier : "",
    publisher: typeof props.publisher === "string" ? props.publisher : "",
    // The V2 model exposes `isCustomApi` as a sibling of `properties`
    // on the GetConnectorByIdResponse. Read it defensively in case the
    // upstream contract shifts it into `properties` in the future.
    isCustomApi:
      Boolean((item as { isCustomApi?: boolean }).isCustomApi) ||
      Boolean((props as { isCustomApi?: boolean }).isCustomApi),
    raw: item,
  };
}

/** Best-effort error message extractor. Mirrors the same shape-tolerant
 *  pattern used by `shared/deep-inventory/sources/adminApps.ts` so the
 *  full HTTP status / message / requestId all surface to the UI instead
 *  of collapsing to "ListConnectors failed". */
function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (typeof e.statusCode === "number") parts.push(`HTTP ${e.statusCode}`);
    if (typeof e.code === "string" && e.code) parts.push(`code ${e.code}`);
    if (typeof e.requestId === "string" && e.requestId)
      parts.push(`requestId ${e.requestId}`);
    // Many connector errors nest the real message under `.error.message`.
    const inner = e.error as Record<string, unknown> | undefined;
    if (inner && typeof inner === "object") {
      if (typeof inner.message === "string" && inner.message)
        parts.push(inner.message);
      if (typeof inner.code === "string" && inner.code)
        parts.push(`inner code ${inner.code}`);
    }
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Calls `ListConnectors` for a single environment and returns a lean
 *  row shape + the raw response (so the view can dump the full payload
 *  into a debug accordion). */
export async function listConnectorsForEnv(
  environmentId: string,
): Promise<DataResult<{ rows: ConnectorRow[]; raw: ListConnectorsResponse }>> {
  if (!environmentId) {
    return { ok: false, error: "Environment id is required." };
  }
  // ListConnectors signature: (environmentId, $filter, api_version).
  // Despite the path-level environmentId, the connector also requires
  // `environment eq '<envId>'` in $filter — otherwise it returns
  // HTTP 400 / MissingEnvironmentFilter. This matches what the CoE
  // Starter Kit's `Admin | Sync Template v3 (Connectors)` flow sends
  // (see research notes on `Get-Connectors`).
  const $filter = `environment eq '${environmentId}'`;
  const result = await PowerPlatformforAdminsV2Service.ListConnectors(
    environmentId,
    $filter,
    API_VERSION,
  );
  if (!result.success) {
    // Surface the raw error in the console so the full object (with any
    // nested cause / fetch response) is inspectable while we're still
    // hardening this end-to-end. Cheap and Power-Apps-player-safe.
    console.error("[connectors] ListConnectors failed", {
      environmentId,
      apiVersion: API_VERSION,
      error: result.error,
    });
    return { ok: false, error: formatError(result.error) };
  }
  const raw = result.data ?? {};
  const rows = (raw.value ?? []).map(toRow);
  return { ok: true, data: { rows, raw } };
}
