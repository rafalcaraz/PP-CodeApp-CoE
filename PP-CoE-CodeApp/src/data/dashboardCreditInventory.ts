import { listAgentsPage, listEnvironments } from "./inventory";
import type { ConsumptionInventory, ManagedAppConsumptionInventory } from "../shared/credit-reports";
import { readManagedAppsEstate } from "./dashboardManagedAppSource";

export async function loadManagedAppConsumptionInventory(signal: AbortSignal): Promise<ManagedAppConsumptionInventory> {
  const result = await readManagedAppsEstate(signal, false, { includeAssignments: false });
  signal.throwIfAborted();
  if (!result.ok) throw new Error(result.error);
  const environments = result.data.environments ?? result.data.apps.map((app) => ({
    id: app.environmentId, name: app.environmentName, type: app.environmentType,
    groupId: app.groupId, groupName: app.groupName, membershipKnown: app.membershipKnown,
  }));
  return {
    loadedAt: result.data.capturedAt,
    apps: result.data.apps.map((app) => ({ environmentId: app.environmentId, resourceId: app.id, name: app.displayName })),
    environments: [...new Map(environments.map((env) => [env.id, {
      id: env.id, name: env.name,
      groupId: env.membershipKnown ? env.groupId : "", groupName: env.membershipKnown ? env.groupName : "",
      type: env.type,
    }])).values()],
  };
}

export async function loadConsumptionInventory(signal: AbortSignal): Promise<ConsumptionInventory> {
  const environments = await listEnvironments();
  signal.throwIfAborted();
  if (!environments.ok) throw new Error(environments.error);
  const agents: ConsumptionInventory["agents"][number][] = [];
  const seenTokens = new Set<string>();
  let token: string | undefined, skip = 0;
  do {
    const result = await listAgentsPage({}, token, 500, skip);
    signal.throwIfAborted();
    if (!result.ok) throw new Error(result.error);
    for (const row of result.data.rows) agents.push({
      environmentId: row.environmentId.toLowerCase(), resourceId: row.botId || row.id,
      resourceAliases: [...new Set([row.id, row.botId].map((id) => id.trim().toLowerCase()).filter(Boolean))],
      schemaName: row.schemaName, name: row.displayName,
    });
    skip += result.data.rows.length;
    token = result.data.skipToken;
    if (token && (seenTokens.has(token) || !result.data.rows.length)) throw new Error("Agent inventory paging did not advance. Retry matching; no partial match was applied.");
    if (token) seenTokens.add(token);
    if (skip > 200_000) throw new Error("Agent inventory exceeds the matching limit. No partial match was applied.");
  } while (token);
  return {
    loadedAt: new Date().toISOString(), agents,
    environments: environments.data.map((row) => ({
      id: row.id.toLowerCase(), name: row.displayName, groupId: row.environmentGroupId,
      groupName: row.environmentGroup, type: row.environmentType,
    })),
  };
}
