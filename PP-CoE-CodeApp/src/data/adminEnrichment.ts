/**
 * Supplemental admin enrichments — per-record, on-demand admin-scope calls.
 *
 * **What this module is.** A thin, typed wrapper around the
 * Power Platform for Admins V2 connector's *per-record* `Get_*` / `List_*`
 * operations (single environment, single app, role assignments, etc.).
 *
 * **What this module is NOT.** The bulk inventory path. That lives in
 * `./inventory.ts` and uses the connector's `QueryResources` action against
 * the Azure Resource Graph. Inventory powers list views, dashboards, and
 * counts; enrichment powers "tell me everything about THIS one thing"
 * actions on detail pages.
 *
 * **The rule.** Every function here is invoked **only** when a user clicks
 * an explicit "Load admin details" / "Fetch role assignments" / etc.
 * button on a detail page. Never auto-prefetched on mount, never part of
 * the bulk inventory load. See
 * `PP-CoE-CodeApp/docs/admin-connector-inventory.md` for the rationale.
 *
 * **No caching, no throttling here.** Per-record clicks are low-fanout,
 * and the user clicking "Refresh" expects a fresh call. If a future
 * enrichment fans out (e.g. "load role assignments for all 50 envs") we'll
 * add the same kind of slot limiter + TTL cache that `inventory.ts`
 * already uses — but keep it opt-in, not the default for every call.
 */

import { PowerPlatformforAdminsV2Service } from "../generated";
import type {
  EnvironmentResponse,
  PowerApp,
} from "../generated/models/PowerPlatformforAdminsV2Model";
import type { DataResult } from "./inventory";

const API_VERSION = "2024-10-01";

/** Best-effort extraction of a human-readable message from anything the
 *  `@microsoft/power-apps` runtime can throw. Mirrors the helper in
 *  `inventory.ts`; intentionally not extracted (yet) to keep this module
 *  self-contained while the enrichment pattern is still being shaped. */
function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (typeof e.requestId === "string" && e.requestId) parts.push(`requestId ${e.requestId}`);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Result of an environment admin-details enrichment.
 *  - `data` is the typed `EnvironmentResponse` shape from the generated model.
 *  - `raw` is the same payload as a plain `unknown` so callers can hand it
 *    straight to `<RawJsonAccordion>` without retyping. The connector's
 *    payload occasionally carries fields the generated model doesn't yet
 *    enumerate; surfacing the raw blob keeps that data accessible. */
export interface EnvironmentAdminDetails {
  data: EnvironmentResponse;
  raw: unknown;
}

/**
 * Fetch the admin-scope detail payload for a single environment.
 *
 * Backed by the connector's `GetEnvironmentByIdForUser` operation. Returns
 * fields not present on the inventory graph row — `state`, `adminMode`,
 * `backgroundOperationsState`, `protectionLevel`, `version`, `url`,
 * `domainName`, `azureRegion`, `dataverseId`, `deletedDateTime`,
 * `retentionDetails`, etc.
 *
 * **On-demand only.** Wire this behind an explicit user action, not a
 * `useEffect`.
 */
export async function getEnvironmentAdminDetails(
  envId: string
): Promise<DataResult<EnvironmentAdminDetails>> {
  if (!envId) return { ok: false, error: "Environment ID is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.GetEnvironmentByIdForUser(
      envId,
      API_VERSION
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const data = result.data ?? {};
    return { ok: true, data: { data, raw: data } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/** Result of an app admin-details enrichment.
 *  See `EnvironmentAdminDetails` for the rationale on the typed/raw split. */
export interface AppAdminDetails {
  data: PowerApp;
  raw: unknown;
}

/** Resource types for which `Get_AdminApp` is meaningful. The classic
 *  PowerApps admin endpoint covers canvas apps, code apps (canvas under
 *  the hood), and the unified app-builder ("apps") surface. Model-driven
 *  apps live in Dataverse and have no equivalent on this connector — UI
 *  should hide the enrichment card for that type entirely. */
const APP_ADMIN_SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  "microsoft.powerapps/canvasapps",
  "microsoft.powerapps/codeapps",
  "microsoft.powerapps/apps",
]);

/** Whether the given inventory resource type can be enriched by
 *  `getAppAdminDetails`. Lets the UI gate the button without leaking the
 *  list of supported types into every detail page. */
export function isAppAdminDetailsSupported(resourceType: string | undefined): boolean {
  return !!resourceType && APP_ADMIN_SUPPORTED_TYPES.has(resourceType);
}

/**
 * Fetch the admin-scope detail payload for a single Power App.
 *
 * Backed by the connector's `Get_AdminApp` operation. Returns the rich
 * `PowerApp` shape — owner principal, version, launch URI, document URI,
 * device targeting tags, Siena/publisher versions, etc.
 *
 * **Scope.** Only meaningful for canvas / code / app-builder apps; see
 * `isAppAdminDetailsSupported`. Callers should guard *before* calling so
 * model-driven apps don't trigger a hopeless API request.
 *
 * **On-demand only.** Same rule as `getEnvironmentAdminDetails` —
 * wire behind a user click, not a `useEffect`.
 */
export async function getAppAdminDetails(
  environmentId: string,
  appId: string
): Promise<DataResult<AppAdminDetails>> {
  if (!environmentId) return { ok: false, error: "Environment ID is required." };
  if (!appId) return { ok: false, error: "App ID is required." };
  try {
    const result = await PowerPlatformforAdminsV2Service.Get_AdminApp(
      environmentId,
      appId,
      API_VERSION
    );
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    const data = result.data ?? {};
    return { ok: true, data: { data, raw: data } };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
