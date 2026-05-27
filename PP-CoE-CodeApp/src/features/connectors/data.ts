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

/** Calls `ListConnectors` for a single environment and returns a lean
 *  row shape + the raw response (so the view can dump the full payload
 *  into a debug accordion). */
export async function listConnectorsForEnv(
  environmentId: string,
): Promise<DataResult<{ rows: ConnectorRow[]; raw: ListConnectorsResponse }>> {
  if (!environmentId) {
    return { ok: false, error: "Environment id is required." };
  }
  // ListConnectors signature: (environmentId, $filter, api_version)
  // We pass an empty filter to get every connector available in the env.
  const result = await PowerPlatformforAdminsV2Service.ListConnectors(
    environmentId,
    "",
    API_VERSION,
  );
  if (!result.success) {
    const msg =
      result.error instanceof Error
        ? result.error.message
        : typeof result.error === "string"
          ? result.error
          : "ListConnectors failed";
    return { ok: false, error: msg };
  }
  const raw = result.data ?? {};
  const rows = (raw.value ?? []).map(toRow);
  return { ok: true, data: { rows, raw } };
}
