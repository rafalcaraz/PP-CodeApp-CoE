import { PowerPlatformforAdminsV2Service } from "../../generated";
import { formatApiError } from "../../shared/api-explorer/schema";
import { loadPdeMemberships, membershipId, readEnvironmentGroupMembership, readCancelled, type ManagedAppsInventory, type DataResult } from "./data";
import { jsonObject } from "./groupClone";
import type { MembershipRead } from "./pdeMoves";

export function parsePdeMembership(raw: unknown, requestedId: string): DataResult<MembershipRead> {
  const fail = (field: string, reason: string): DataResult<MembershipRead> => ({
    ok: false, error: `Cannot verify this PDE's current membership. [GetEnvironmentByIdForUser: ${field}: ${reason}]`,
  });
  if (!jsonObject(raw)) return fail("response", "expected a flat EnvironmentResponse object");
  if (typeof raw.id !== "string" || !membershipId(raw.id)) return fail("id", "missing or not a nonempty string");
  if (membershipId(raw.id) !== membershipId(requestedId)) return fail("id", "does not match the requested environment; resource-path identities are not inferred");
  if (typeof raw.state !== "string" || raw.state.toLowerCase() !== "enabled") return fail("state", "expected Enabled; missing, unknown or nonactive states cannot authorize a transfer");
  // The repository's anonymized real admin response returns the Unix epoch
  // even for an Enabled environment. It is not a real deletion event.
  if (raw.deletedDateTime !== undefined && raw.deletedDateTime !== null && raw.deletedDateTime !== ""
    && (typeof raw.deletedDateTime !== "string" || Date.parse(raw.deletedDateTime) !== 0)) {
    return fail("deletedDateTime", "a deletion timestamp or invalid value was returned");
  }

  const membership = readEnvironmentGroupMembership(raw);
  if (!membership.ok) return fail("environmentGroupId", membership.error);
  if (raw.dataverseId !== undefined && typeof raw.dataverseId !== "string") return fail("dataverseId", "expected a string when returned");
  return { ok: true, data: {
    environmentId: raw.id, groupId: membership.data,
    hasDataverse: typeof raw.dataverseId === "string" && !!membershipId(raw.dataverseId),
  } };
}

export async function readLivePdeMembership(environmentId: string, signal?: AbortSignal): Promise<DataResult<MembershipRead>> {
  try {
    const result = await PowerPlatformforAdminsV2Service.GetEnvironmentByIdForUser(environmentId, "2024-10-01");
    if (!result.success) return { ok: false, error: formatApiError(result.error) };
    const direct = parsePdeMembership(result.data, environmentId);
    if (!direct.ok) return direct;
    if (jsonObject(result.data) && result.data.type !== undefined && result.data.type !== "Developer") {
      return { ok: false, error: "Cannot verify this PDE's eligibility. [GetEnvironmentByIdForUser.type: expected Developer when returned.]" };
    }
    const readAt = Date.now();
    const inventory = await loadPdeMemberships([environmentId], signal);
    const cancelled = readCancelled(signal);
    if (cancelled) return cancelled;
    if (!inventory.ok) return { ok: false, error: `Cannot verify this PDE's managed Developer eligibility. [Fresh inventory: ${inventory.error}]` };
    const matching = inventory.data.filter((entry) => membershipId(entry.id) === membershipId(environmentId));
    if (inventory.data.length !== 1 || matching.length !== 1 || !matching[0].isManaged || matching[0].environmentType !== "Developer") {
      return { ok: false, error: "Cannot verify this PDE's managed Developer eligibility. [Fresh inventory: expected exactly one matching managed Developer environment.]" };
    }
    return { ok: true, data: { ...direct.data, evidence: {
      source: "GetEnvironmentByIdForUser", readAt, inventoryReadAt: Date.now(),
      inventoryGroupId: membershipId(matching[0].environmentGroupId),
    } } };
  } catch (error) {
    return { ok: false, error: `Membership read failed: ${formatApiError(error)}` };
  }
}

export const RECENT_MEMBERSHIP_MS = 60_000;
export function withRecentPdeMemberships(inventory: ManagedAppsInventory, reads: MembershipRead[], now = Date.now()): ManagedAppsInventory {
  const recent = new Map<string, MembershipRead>();
  for (const read of reads) {
    if (!read.evidence || !Number.isFinite(read.evidence.readAt) || read.evidence.readAt > now || now - read.evidence.readAt >= RECENT_MEMBERSHIP_MS || !read.hasDataverse) continue;
    const id = membershipId(read.environmentId);
    if ((recent.get(id)?.evidence?.readAt ?? -1) <= read.evidence.readAt) recent.set(id, read);
  }
  return { ...inventory, environments: inventory.environments.map((environment) => {
    const read = recent.get(membershipId(environment.id));
    if (!read || !environment.isManaged || environment.environmentType !== "Developer") return environment;
    return { ...environment, environmentGroupId: read.groupId,
      environmentGroup: inventory.groups.find((group) => membershipId(group.id) === read.groupId)?.displayName || read.groupId };
  }) };
}
