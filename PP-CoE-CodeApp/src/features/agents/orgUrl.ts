/**
 * Environment org-URL resolver (memoized).
 *
 * The Skills direct-download fallback needs an environment's Dataverse org URL
 * (e.g. `https://contoso.crm.dynamics.com`) to build a `filedata/$value` link.
 * That URL lives on the admin-scope environment payload
 * (`EnvironmentResponse.url`), fetched on demand via `getEnvironmentAdminDetails`.
 *
 * Resolution is memoized per environment id (the in-flight promise is cached),
 * so repeated fallback clicks across files in the same environment don't refire
 * the admin call. Failures resolve to `null` rather than throwing — the caller
 * surfaces a friendly "couldn't resolve" message.
 */

import { getEnvironmentAdminDetails } from "./data";

const cache = new Map<string, Promise<string | null>>();

/** Clear the org-URL cache (tests / an eventual Refresh affordance). */
export function clearOrgUrlCache(): void {
  cache.clear();
}

/**
 * Resolve an environment's Dataverse org URL, or `null` when it can't be
 * determined. Memoized per environment id.
 */
export function resolveEnvironmentOrgUrl(
  environmentId: string,
): Promise<string | null> {
  const envId = environmentId.trim();
  if (!envId) return Promise.resolve(null);

  const cached = cache.get(envId);
  if (cached) return cached;

  const p = getEnvironmentAdminDetails(envId)
    .then((res) => {
      const url = res.ok ? res.data.data.url : undefined;
      return typeof url === "string" && url.length > 0 ? url : null;
    })
    .catch(() => null);

  cache.set(envId, p);
  return p;
}
