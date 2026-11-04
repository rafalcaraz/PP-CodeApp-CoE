import { describe, expect, it } from "vitest";
import envAdmin from "../../test/fixtures/get-environment-by-id-for-user.json";
import { parsePdeMembership, withRecentPdeMemberships, RECENT_MEMBERSHIP_MS } from "./pdeMembership";
import type { ManagedAppsInventory } from "./data";
import type { MembershipRead } from "./pdeMoves";
describe("strict direct environment response parsing", () => {
  it("recognizes the existing complete anonymized response's optional absent group and Enabled epoch sentinel", () => {
    const result = parsePdeMembership(envAdmin, envAdmin.id);
    expect(result).toEqual({ ok: true, data: { environmentId: envAdmin.id, groupId: "", hasDataverse: true } });
    const explicit = parsePdeMembership({ ...envAdmin, environmentGroupId: "" }, envAdmin.id);
    expect(explicit).toEqual({ ok: true, data: { environmentId: envAdmin.id, groupId: "", hasDataverse: true } });
  });
  it("applies only the newest fresh exact-PDE direct evidence without mutating inventory, then expires it", () => {
    const now = 100_000;
    const inventory: ManagedAppsInventory = {
      apps: [], excludedApps: 0,
      groups: [{ id: "new", displayName: "Engineering", description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" }],
      environments: ["pde-one", "pde-two"].map((id) => ({
        id, displayName: id, environmentType: "Developer", isManaged: true, environmentGroupId: "old", environmentGroup: "Old group",
        region: "", createdAt: "", createdBy: "", lastModifiedAt: "", tenantId: "",
      })),
    };
    const current: MembershipRead = {
      environmentId: "PDE-ONE", groupId: "new", hasDataverse: true,
      evidence: { source: "GetEnvironmentByIdForUser", readAt: now, inventoryReadAt: now, inventoryGroupId: "old" },
    };
    const older = { ...current, groupId: "older", evidence: { ...current.evidence!, readAt: now - 1 } };
    const result = withRecentPdeMemberships(inventory, [current, older], now);
    expect(result.environments[0]).toMatchObject({ environmentGroupId: "new", environmentGroup: "Engineering" });
    expect(result.environments[1]).toBe(inventory.environments[1]);
    expect(inventory.environments[0].environmentGroupId).toBe("old");
    expect(withRecentPdeMemberships(inventory, [current], now + RECENT_MEMBERSHIP_MS).environments[0]).toBe(inventory.environments[0]);
    expect(withRecentPdeMemberships(inventory, [{ ...current, evidence: { ...current.evidence!, readAt: now + 1 } }], now).environments[0]).toBe(inventory.environments[0]);
  });
  it("normalizes casing and the zero GUID using existing identity rules", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(parsePdeMembership({ id: id.toUpperCase(), state: "Enabled", environmentGroupId: "00000000-0000-0000-0000-000000000000" }, id))
      .toEqual({ ok: true, data: { environmentId: id.toUpperCase(), groupId: "", hasDataverse: false } });
  });
  it.each([
    [undefined, "response"], [{ data: envAdmin }, "id"], [{ ...envAdmin, id: "" }, "id"],
    [{ ...envAdmin, id: "different" }, "id"],
    [{ ...envAdmin, id: `/providers/Microsoft.PowerApps/environments/${envAdmin.id}` }, "id"],
    [{ ...envAdmin, environmentGroupId: {} }, "environmentGroupId"],
    [{ ...envAdmin, environmentGroupId: null, environmentGroup: "Conflicting group" }, "environmentGroupId"],
    [{ ...envAdmin, state: "Disabled" }, "state"], [{ ...envAdmin, state: "Deleted" }, "state"],
    [{ ...envAdmin, state: undefined }, "state"], [{ ...envAdmin, state: "FutureState" }, "state"],
    [{ ...envAdmin, deletedDateTime: "2026-01-01T00:00:00Z" }, "deletedDateTime"],
    [{ ...envAdmin, deletedDateTime: "invalid" }, "deletedDateTime"],
  ])("rejects ambiguous/unsafe shapes with field-specific diagnostics", (raw, field) => {
    const result = parsePdeMembership(raw, envAdmin.id);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(`${field}:`);
    expect(JSON.stringify(result)).not.toContain(envAdmin.displayName);
  });
  it.each([null, "", "00000000-0000-0000-0000-000000000000"])("normalizes nullable/empty membership representations for a complete enabled resource", (environmentGroupId) => {
    expect(parsePdeMembership({ ...envAdmin, environmentGroupId }, envAdmin.id)).toMatchObject({ ok: true, data: { groupId: "" } });
  });
});
