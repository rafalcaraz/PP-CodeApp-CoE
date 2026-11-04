import { beforeEach, describe, expect, it, vi } from "vitest";
const { read, add, remove, invalidate, memberships } = vi.hoisted(() => ({
  read: vi.fn(), add: vi.fn(), remove: vi.fn(), invalidate: vi.fn(), memberships: vi.fn(),
}));
vi.mock("./data", async () => ({ ...await vi.importActual<typeof import("./data")>("./data"), loadPdeMemberships: memberships }));
vi.mock("../../generated", () => ({
  PowerPlatformforAdminsV2Service: { GetEnvironmentByIdForUser: read, AddEnvironmentToGroup: add, RemoveEnvironmentFromGroup: remove },
}));
vi.mock("../../data/inventory", async () => ({
  ...await vi.importActual<typeof import("../../data/inventory")>("../../data/inventory"), invalidateInventoryCache: invalidate,
}));
import { pdeMoveBackend, pdeMoveStore } from "./pdeMoveData";
import type { MoveRecord } from "./pdeMoves";
import envAdmin from "../../test/fixtures/get-environment-by-id-for-user.json";
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  read.mockResolvedValue({ success: true, data: { id: "synthetic-pde", state: "Enabled", dataverseId: "synthetic-dataverse", environmentGroupId: "synthetic-source" } });
  memberships.mockResolvedValue({ ok: true, data: [{ id: "synthetic-pde", isManaged: true, environmentType: "Developer", environmentGroupId: "synthetic-source" }] });
  add.mockResolvedValue({ success: true }); remove.mockResolvedValue({ success: true });
});
describe("actual Admins V2 membership binding and durable storage", () => {
  it("does not execute membership actions on import or direct eligibility read", async () => {
    expect(await pdeMoveBackend.read("synthetic-pde")).toMatchObject({
      ok: true, data: { environmentId: "synthetic-pde", groupId: "synthetic-source", hasDataverse: true },
    });
    expect(read).toHaveBeenCalledWith("synthetic-pde", "2024-10-01");
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it.each([undefined, { id: "wrong" }, { id: "synthetic-pde", state: "Enabled", environmentGroupId: {} }, { id: "synthetic-pde", deletedDateTime: "yesterday" }])("rejects malformed/deleted identity before inference", async (data) => {
    read.mockResolvedValue({ success: true, data });
    expect((await pdeMoveBackend.read("synthetic-pde")).ok).toBe(false);
  });
  it("distinguishes a valid unassigned environment from missing Dataverse eligibility", async () => {
    read.mockResolvedValue({ success: true, data: { id: "synthetic-pde", state: "Enabled", environmentGroupId: "" } });
    memberships.mockResolvedValue({ ok: true, data: [{ id: "synthetic-pde", isManaged: true, environmentType: "Developer", environmentGroupId: "" }] });
    expect(await pdeMoveBackend.read("synthetic-pde")).toMatchObject({ ok: true, data: { environmentId: "synthetic-pde", groupId: "", hasDataverse: false } });
  });
  it.each([undefined, null])("corroborates omitted/null direct membership with fresh ungrouped inventory, never writes", async (groupId) => {
    read.mockResolvedValue({ success: true, data: { ...envAdmin, type: "Developer", environmentGroupId: groupId } });
    memberships.mockResolvedValue({ ok: true, data: [{ id: envAdmin.id, isManaged: true, environmentType: "Developer", environmentGroupId: "" }] });
    // Omission is different from an own property with an invalid undefined value.
    if (groupId === undefined) read.mockResolvedValue({ success: true, data: { ...envAdmin, type: "Developer" } });
    expect(await pdeMoveBackend.read(envAdmin.id)).toMatchObject({ ok: true, data: { environmentId: envAdmin.id, groupId: "", hasDataverse: true } });
    expect(memberships).toHaveBeenCalledWith([envAdmin.id], undefined);
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("uses the complete direct ungrouped resource despite lagging grouped inventory", async () => {
    read.mockResolvedValue({ success: true, data: { ...envAdmin, type: "Developer" } });
    memberships.mockResolvedValue({ ok: true, data: [{ id: envAdmin.id, isManaged: true, environmentType: "Developer", environmentGroupId: "synthetic-group" }] });
    expect(await pdeMoveBackend.read(envAdmin.id)).toMatchObject({ ok: true, data: { groupId: "", evidence: { source: "GetEnvironmentByIdForUser", inventoryGroupId: "synthetic-group", readAt: expect.any(Number), inventoryReadAt: expect.any(Number) } } });
  });
  it("rejects omitted membership when its fresh corroboration fails, instead of treating it as ungrouped", async () => {
    read.mockResolvedValue({ success: true, data: { ...envAdmin, type: "Developer" } });
    memberships.mockResolvedValue({ ok: false, error: "Incomplete inventory response" });
    const result = await pdeMoveBackend.read(envAdmin.id);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("Fresh inventory");
  });
  it.each([
    { data: [] },
    { data: [{ id: envAdmin.id, isManaged: true, environmentType: "Developer", environmentGroupId: "" }, { id: "other", isManaged: true, environmentType: "Developer", environmentGroupId: "" }] },
    { data: [{ id: "wrong", isManaged: true, environmentType: "Developer", environmentGroupId: "" }] },
    { data: [{ id: envAdmin.id, isManaged: false, environmentType: "Developer", environmentGroupId: "" }] },
  ])("rejects missing, duplicate/outside-scope or ineligible corroboration", async ({ data }) => {
    read.mockResolvedValue({ success: true, data: { ...envAdmin, type: "Developer" } });
    memberships.mockResolvedValue({ ok: true, data });
    expect((await pdeMoveBackend.read(envAdmin.id)).ok).toBe(false);
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it.each(["synthetic-old-group", ""])("prioritizes an explicit direct group over inventory group %s without writing", async (inventoryGroupId) => {
    memberships.mockResolvedValue({ ok: true, data: [{ id: "synthetic-pde", isManaged: true, environmentType: "Developer", environmentGroupId: inventoryGroupId }] });
    expect(await pdeMoveBackend.read("synthetic-pde")).toMatchObject({ ok: true, data: {
      groupId: "synthetic-source", evidence: { inventoryGroupId, readAt: expect.any(Number), inventoryReadAt: expect.any(Number) },
    } });
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("does not substitute inventory for an unavailable direct response or conflicting direct eligibility", async () => {
    read.mockResolvedValueOnce({ success: false, error: { message: "Synthetic direct read denied" } })
      .mockResolvedValueOnce({ success: true, data: { id: "synthetic-pde", state: "Enabled", type: "Production", environmentGroupId: "synthetic-source", dataverseId: "synthetic-db" } });
    expect(await pdeMoveBackend.read("synthetic-pde")).toMatchObject({ ok: false, error: expect.stringContaining("Synthetic direct read denied") });
    expect(await pdeMoveBackend.read("synthetic-pde")).toMatchObject({ ok: false, error: expect.stringContaining("expected Developer") });
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("uses bodyless registered add/remove signatures and invalidates cache", async () => {
    expect(await pdeMoveBackend.remove("synthetic-source", "synthetic-pde")).toEqual({ ok: true, data: undefined });
    expect(await pdeMoveBackend.add("synthetic-destination", "synthetic-pde")).toEqual({ ok: true, data: undefined });
    expect(remove).toHaveBeenCalledExactlyOnceWith("synthetic-source", "synthetic-pde", "2024-10-01");
    expect(add).toHaveBeenCalledExactlyOnceWith("synthetic-destination", "synthetic-pde", "2024-10-01");
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it("preserves actual explicit permission errors but treats nonconclusive SDK failures as ambiguous", async () => {
    add.mockResolvedValue({ success: false, error: { statusCode: 403, message: "Forbidden" } });
    expect((await pdeMoveBackend.add("destination", "synthetic-pde")).ok).toBe(false);
    add.mockResolvedValue({ success: false, error: { message: "Connection interrupted" } });
    await expect(pdeMoveBackend.add("destination", "synthetic-pde")).rejects.toThrow(/may still complete/);
  });
  it("rejects malformed or payload-bearing recovery records rather than hiding them", () => {
    localStorage.setItem("ppcoe:managed-apps:pde-move:v1:unsafe", JSON.stringify({ version: 1, policyPayload: { name: "unsafe" } }));
    expect(() => pdeMoveStore.list()).toThrow(/Invalid/);
  });
  it("persists only identifiers, hash and actual phases", () => {
    const record: MoveRecord = {
      version: 1, id: "synthetic-operation", destinationId: "synthetic-destination", previewHash: "synthetic-hash",
      updatedAt: Date.now(), pdes: [{ environmentId: "synthetic-pde", sourceId: "synthetic-source", phase: "removing", remove: "started", add: "none" }],
    };
    pdeMoveStore.save(record);
    expect(pdeMoveStore.list()).toEqual([record]);
  });
  it("retains per-PDE recovery linkage without rewriting or deleting the original record", () => {
    const original: MoveRecord = {
      version: 1, id: "synthetic-original", destinationId: "old-destination", previewHash: "old-hash", updatedAt: 123,
      pdes: [{ environmentId: "synthetic-pde", sourceId: "source", phase: "detached", remove: "accepted", add: "none", observedGroupId: "" }],
    };
    const recovery: MoveRecord = { ...original, id: "synthetic-recovery", destinationId: "new-destination",
      pdes: [{ environmentId: "synthetic-pde", sourceId: "", phase: "adding", remove: "none", add: "started", recoveryOf: [original.id] }] };
    pdeMoveStore.save(original); pdeMoveStore.save(recovery);
    expect(pdeMoveStore.list()).toEqual([original, recovery]);
    expect(() => pdeMoveStore.save({ ...recovery, pdes: [{ ...recovery.pdes[0], recoveryOf: [recovery.id] }] })).toThrow(/Unsafe/);
  });
});
