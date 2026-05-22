/**
 * DLP (Data Loss Prevention) policies — narrow wrapper over the legacy
 * Power Platform for Admins connector.
 *
 * **Scope.** Just the two read operations needed today for the DLP
 * Comparator / DLP Analysis mini-apps:
 *   - `listDlpPolicies`   → `ListPoliciesV2`
 *   - `getDlpPolicy(id)`  → `GetPolicyV2`
 *
 * Nothing else is wrapped on purpose. Add more here only when a UI
 * feature actually needs it.
 *
 * **Why a wrapper.** The generated `PowerPlatformforAdminsService` works
 * but is verbose at the call site (raw `IOperationResult` unwrap, opaque
 * error shape). The wrapper:
 *   - returns the same `DataResult<T>` shape every other module here uses
 *   - normalizes connector errors into readable strings
 *   - drains `nextLink` paging so callers always get the full list
 *
 * **Generator note.** The legacy connector's generated TS ships with
 * invalid syntax (hyphenated `api-version` parameter names) and is
 * auto-healed by `scripts/fixup-generated-connectors.mjs` via the
 * `postinstall` hook. See `docs/connector-generator-fixup.md`.
 */

import { PowerPlatformforAdminsService } from "../generated";
import type {
  PolicyV2,
  ResourceArray_PolicyV2,
} from "../generated/models/PowerPlatformforAdminsModel";
import type { DataResult } from "./inventory";

/** Best-effort error normalization. Mirrors the helper in
 *  `adminEnrichment.ts`; kept local to avoid a circular import while the
 *  shape is still settling. */
function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (typeof e.requestId === "string" && e.requestId)
      parts.push(`requestId ${e.requestId}`);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Pull a `$skiptoken` value out of a `nextLink` URL the connector returns.
 *  The connector emits absolute URLs whose query string carries the token
 *  the next request needs. Anything else (no query, no token) ends paging. */
function extractSkipToken(nextLink: string | undefined): string | undefined {
  if (!nextLink) return undefined;
  try {
    const url = new URL(nextLink);
    return url.searchParams.get("$skiptoken") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch a single DLP policy by id.
 *
 * Backed by the legacy connector's `GetPolicyV2` operation. The `policy`
 * argument is the policy GUID (the `name` field on `PolicyV2`).
 *
 * The returned `PolicyV2` includes:
 *   - `defaultConnectorsClassification` — catch-all bucket for connectors
 *     not explicitly listed (`"Confidential" | "General" | "Blocked"`)
 *   - `connectorGroups[]` — explicit per-bucket connector membership
 *   - `environmentType` + `environments[]` — scoping (`AllEnvironments`,
 *     `OnlyEnvironments`, `ExceptEnvironments`, `SingleEnvironment`)
 *   - `isLegacySchemaVersion` — true for old-shape policies that don't
 *     surface rule-based-policy data
 */
export async function getDlpPolicy(
  policyId: string
): Promise<DataResult<PolicyV2>> {
  if (!policyId) return { ok: false, error: "Policy id is required." };
  try {
    const result = await PowerPlatformforAdminsService.GetPolicyV2(policyId);
    if (!result.success) {
      return { ok: false, error: formatError(result.error) };
    }
    if (!result.data) {
      return { ok: false, error: "Connector returned no policy data." };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

/**
 * Fetch *all* DLP policies the caller can access, draining `nextLink`
 * pages from the connector. Use this for the DLP Comparator picker /
 * inventory-style screens where you need the full set; if you ever need
 * a single page (e.g. infinite-scroll UI), expose `listDlpPoliciesPage`
 * separately rather than overloading this function.
 *
 * `top` is forwarded to the connector as `$top` per page and defaults to
 * the connector's own default when omitted.
 */
export async function listDlpPolicies(
  opts: { top?: number } = {}
): Promise<DataResult<PolicyV2[]>> {
  const acc: PolicyV2[] = [];
  let skiptoken: string | undefined;
  try {
    do {
      const result = await PowerPlatformforAdminsService.ListPoliciesV2(
        undefined,
        skiptoken,
        opts.top
      );
      if (!result.success) {
        return { ok: false, error: formatError(result.error) };
      }
      const page: ResourceArray_PolicyV2 = result.data ?? {};
      if (page.value?.length) acc.push(...page.value);
      skiptoken = extractSkipToken(page.nextLink);
    } while (skiptoken);
    return { ok: true, data: acc };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
