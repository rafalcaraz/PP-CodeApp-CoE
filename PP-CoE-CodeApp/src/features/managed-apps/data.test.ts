import { beforeEach, describe, expect, it, vi } from "vitest";

const { runRawQuery, appQuery, envQuery, groupQuery, assignments, getPolicy, peekUser } = vi.hoisted(() => ({
  runRawQuery: vi.fn(), appQuery: vi.fn(), envQuery: vi.fn(), groupQuery: vi.fn(),
  assignments: vi.fn(), getPolicy: vi.fn(), peekUser: vi.fn(),
}));
vi.mock("../../data/inventory", async () => {
  const actual = await vi.importActual<typeof import("../../data/inventory")>("../../data/inventory");
  return { ...actual, runRawQuery };
});
vi.mock("../../generated", async () => {
  const actual = await vi.importActual<typeof import("../../generated")>("../../generated");
  return { ...actual, PowerPlatformforAdminsV2Service: {
    ...actual.PowerPlatformforAdminsV2Service,
    ListRuleAssignmentsByEnvironmentGroupId: assignments, GetRuleBasedPolicyByID: getPolicy,
  } };
});
vi.mock("../../data/userEnrichment", () => ({
  peekUser, resolveUsers: vi.fn(), subscribeCacheVersion: vi.fn(), getCacheVersion: () => 0,
}));

import {
  buildBoard, createBoardInventoryLoader, loadEmptyGroupMembership, loadGroupPolicies, loadManagedApps, loadPdeApps, loadPdeResources, loadPdeMemberships, matchesApp, membershipId,
  originLabel, readManagedApp, matchesContext, groupPdeApps, pdeMoveBlocker, type EnvironmentRow,
} from "./data";

const env: EnvironmentRow = {
  id: "pde-one", displayName: "Personal workspace", environmentType: "Developer", isManaged: true,
  environmentGroupId: "group-one", environmentGroup: "Renamed group", region: "", createdAt: "",
  createdBy: "", lastModifiedAt: "", tenantId: "",
};
const group = { id: "group-one", displayName: "Renamed group", description: "", createdAt: "", createdBy: "", lastModifiedAt: "", location: "" };
const resource = (name: string, environmentId = "pde-one") => ({
  name, type: "microsoft.powerapps/apps", properties: {
    environmentId, displayName: name, ownerId: "owner-one", createdBy: { id: "maker-one", displayName: "Avery Maker" },
    origin: "CopilotStudio", subType: "microsoftApp",
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  envQuery.mockResolvedValue({ ok: true, data: { items: [{ name: env.id, type: "microsoft.powerplatform/environments", properties: env }] } });
  groupQuery.mockResolvedValue({ ok: true, data: { items: [{ name: group.id, type: "microsoft.powerplatform/environmentgroups", properties: group }] } });
  runRawQuery.mockImplementation((clauses, options) => {
    const json = JSON.stringify(clauses);
    if (json.includes("microsoft.powerplatform/environments")) return envQuery(clauses, options);
    if (json.includes("microsoft.powerplatform/environmentgroups")) return groupQuery(clauses, options);
    return appQuery(clauses, options);
  });
  peekUser.mockReturnValue({ status: "unknown" });
});

describe("managed apps inventory", () => {
  it("starts app, environment and group reads independently before any collection completes", async () => {
    let finish!: (value: { ok: true; data: { items: [] } }) => void;
    envQuery.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("parallel-app")] } });
    const loading = loadManagedApps();
    expect(envQuery).toHaveBeenCalledOnce();
    expect(groupQuery).toHaveBeenCalledOnce();
    expect(appQuery).toHaveBeenCalledOnce();
    finish({ ok: true, data: { items: [] } });
    const result = await loading;
    expect(result.ok && result.data.apps).toHaveLength(1);
    expect(result.ok && buildBoard(result.data)[0].key).toBe("unresolved-pde");
  });
  it("preserves the original selected app resource including unmapped inventory properties", () => {
    const raw = { ...resource("Raw example"), futureField: { enabled: true },
      properties: { ...resource("Raw example").properties, unknownAppSetting: ["exact", "original"] } };
    const app = readManagedApp(raw);
    expect(app.raw).toBe(raw);
    expect(app.raw).toEqual(raw);
  });

  describe("board inventory loader", () => {
    const empty = { ok: true as const, data: { apps: [], environments: [], groups: [], excludedApps: 0 } };
    function deferredRead() {
      let finish!: (value: Awaited<ReturnType<typeof loadManagedApps>>) => void;
      const read = vi.fn<typeof loadManagedApps>(() => new Promise((resolve) => { finish = resolve; }));
      return { read, finish: (value = empty) => finish(value) };
    }
    it("deduplicates ordinary same-board reads without caching finished snapshots", async () => {
      const { read, finish } = deferredRead();
      const load = createBoardInventoryLoader(read);
      const first = load();
      const second = load();
      expect(read).toHaveBeenCalledOnce();
      finish();
      expect(await first).toEqual(empty);
      expect(await second).toEqual(empty);
      read.mockResolvedValue(empty);
      await load();
      expect(read).toHaveBeenCalledTimes(2);
      expect(read.mock.calls.every(([refresh]) => refresh === false)).toBe(true);
    });
    it("keeps subscribers independent and permits immediate StrictMode reattachment", async () => {
      const { read, finish } = deferredRead();
      const load = createBoardInventoryLoader(read);
      const cancelled = new AbortController();
      const first = load(false, cancelled.signal);
      cancelled.abort();
      const second = load();
      expect((await first).ok).toBe(false);
      expect(read).toHaveBeenCalledOnce();
      expect(read.mock.calls[0][1]?.aborted).toBe(false);
      finish();
      expect(await second).toEqual(empty);
    });
    it("cancels abandoned pagination, never joins aborted work and ignores old completion", async () => {
      const { read, finish } = deferredRead();
      const load = createBoardInventoryLoader(read);
      const controller = new AbortController();
      const old = load(false, controller.signal);
      controller.abort();
      await old;
      expect(read.mock.calls[0][1]?.aborted).toBe(true);
      const oldFinish = finish;
      const next = deferredRead();
      read.mockImplementation(next.read);
      const current = load();
      oldFinish();
      const joined = load();
      expect(read).toHaveBeenCalledTimes(2);
      next.finish();
      expect(await current).toEqual(empty);
      expect(await joined).toEqual(empty);
    });
    it("bypasses pending work on explicit refresh and keeps newer refresh work separate", async () => {
      const old = deferredRead();
      const fresh = deferredRead();
      const read = vi.fn<typeof loadManagedApps>().mockImplementationOnce(old.read).mockImplementationOnce(fresh.read);
      const load = createBoardInventoryLoader(read);
      const ordinary = load();
      const refresh = load(true);
      old.finish();
      await ordinary;
      const joinedFresh = load();
      expect(read).toHaveBeenCalledTimes(2);
      expect(read.mock.calls.map(([force]) => force)).toEqual([false, true]);
      fresh.finish();
      expect(await refresh).toEqual(empty);
      expect(await joinedFresh).toEqual(empty);
    });
    it("does not share pending data across separate board/account scope lifetimes", async () => {
      const one = deferredRead();
      const two = deferredRead();
      const firstScope = createBoardInventoryLoader(one.read);
      const secondScope = createBoardInventoryLoader(two.read);
      const first = firstScope();
      const second = secondScope();
      expect(one.read).toHaveBeenCalledOnce();
      expect(two.read).toHaveBeenCalledOnce();
      one.finish();
      two.finish();
      expect(await first).toEqual(empty);
      expect(await second).toEqual(empty);
    });
    it("retries rejected and incomplete reads instead of storing a successful snapshot", async () => {
      const read = vi.fn<typeof loadManagedApps>().mockRejectedValueOnce(new Error("synthetic transport failure"))
        .mockResolvedValueOnce({ ok: false, error: "Synthetic incomplete collection" }).mockResolvedValueOnce(empty);
      const load = createBoardInventoryLoader(read);
      await expect(load()).rejects.toThrow("synthetic transport failure");
      expect(await load()).toEqual({ ok: false, error: "Synthetic incomplete collection" });
      expect(await load()).toEqual(empty);
      expect(read).toHaveBeenCalledTimes(3);
    });
    it("does not submit a read for an already-cancelled subscriber", async () => {
      const read = vi.fn<typeof loadManagedApps>();
      const controller = new AbortController();
      controller.abort();
      expect((await createBoardInventoryLoader(read)(false, controller.signal)).ok).toBe(false);
      expect(read).not.toHaveBeenCalled();
    });
  });
  it("groups sibling apps once by normalized PDE identity without conflating same-named apps across environments", () => {
    const first = readManagedApp(resource("Same app", "PDE-ONE"));
    const second = readManagedApp(resource("Sibling", " pde-one "));
    const other = readManagedApp(resource("Same app", "pde-two"));
    expect(groupPdeApps([first, second, other])).toEqual([
      { environmentId: "pde-one", apps: [first, second] },
      { environmentId: "pde-two", apps: [other] },
    ]);
  });
  it.each([undefined, null, "", "00000000-0000-0000-0000-000000000000"])("normalizes absent/nullable raw membership only on complete environment resources", async (environmentGroupId) => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [{ name: env.id, type: "microsoft.powerplatform/environments", properties: { ...env, environmentGroup: "", environmentGroupId } }] } });
    const result = await loadPdeMemberships([env.id]);
    expect(result.ok && result.data[0].environmentGroupId).toBe("");
  });
  it.each([
    undefined, {}, { environmentGroupId: "" },
    { ...env, environmentGroupId: null }, { ...env, environmentGroupId: 123 },
  ])("does not interpret missing/malformed/conflicting environment properties as ungrouped", async (properties) => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [{ name: env.id, type: "microsoft.powerplatform/environments", properties }] } });
    expect((await loadPdeMemberships([env.id])).ok).toBe(false);
  });
  it("does not accept an incomplete membership page or an omitted result collection", async () => {
    envQuery.mockResolvedValue({ ok: true, data: {} });
    expect((await loadPdeMemberships([env.id])).ok).toBe(false);
    envQuery.mockResolvedValue({ ok: true, data: { items: [], skipToken: "repeat" } });
    expect((await loadPdeMemberships([env.id])).ok).toBe(false);
  });
  it("keeps board and move reads consistent about no assignment without claiming live verification", async () => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [{ name: env.id, type: "microsoft.powerplatform/environments", properties: { ...env, environmentGroupId: null, environmentGroup: null } }] } });
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("one")] } });
    const board = await loadManagedApps();
    expect(board.ok && buildBoard(board.data)[0]).toMatchObject({
      key: "ungrouped", description: expect.stringContaining("No group is reported in this inventory snapshot"),
    });
    const membership = await loadPdeMemberships([env.id]);
    expect(membership.ok && membership.data[0].environmentGroupId).toBe("");
  });
  it("reads fresh complete destination membership across all environment types, not only managed PDEs", async () => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [{
      name: "production-env", type: "microsoft.powerplatform/environments", properties: { ...env, environmentType: "Production", isManaged: false },
    }] } });
    expect(await loadEmptyGroupMembership("group-one")).toEqual({ ok: true, data: false });
    const [clauses, , opts] = runRawQuery.mock.calls[0];
    expect(JSON.stringify(clauses)).toContain("properties.environmentGroupId");
    expect(JSON.stringify(clauses)).not.toContain("environmentType");
    expect(JSON.stringify(clauses)).not.toContain("isManaged");
    expect(opts.forceFresh).toBe(true);
  });
  it("matches the managed-app subtype and retains other environments without widening move eligibility", async () => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [
      { name: env.id, type: "microsoft.powerplatform/environments", properties: env },
      { name: "production", type: "microsoft.powerplatform/environments", properties: { ...env, environmentType: "Production" } },
      { name: "unmanaged", type: "microsoft.powerplatform/environments", properties: { ...env, isManaged: false } },
    ] } });
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("one"), resource("two"), resource("outside", "production")] } });
    const result = await loadManagedApps();
    expect(result.ok && result.data.apps.map((app) => app.id)).toEqual(["one", "two", "outside"]);
    expect(result.ok && result.data.excludedApps).toBe(0);
    expect(envQuery).toHaveBeenCalledTimes(1);
    expect(groupQuery).toHaveBeenCalledTimes(1);
    expect(appQuery).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(appQuery.mock.calls[0][0])).toContain("microsoft.powerapps/apps");
    expect(JSON.stringify(appQuery.mock.calls[0][0])).toContain("microsoftApp");
    expect(JSON.stringify(envQuery.mock.calls[0][0])).not.toContain("environmentType");
    expect(pdeMoveBlocker(result.ok ? result.data.environments.find((entry) => entry.id === "production") : undefined)).toContain("Production");
    expect(result.ok && buildBoard(result.data)[0].groupId).toBe("group-one");
  });
  it("does not infer empty membership from authorization failure or incomplete pagination", async () => {
    envQuery.mockResolvedValueOnce({ ok: false, error: "403 denied" });
    expect(await loadEmptyGroupMembership("group-one")).toEqual({ ok: false, error: "403 denied" });
    envQuery.mockResolvedValue({ ok: true, data: { items: [], skipToken: "still-more" } });
    expect((await loadEmptyGroupMembership("group-one")).ok).toBe(false);
  });
  it("rejects out-of-group membership rows and missing destination identities", async () => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [{
      name: env.id, type: "microsoft.powerplatform/environments", properties: { ...env, environmentGroupId: "other-group" },
    }] } });
    expect((await loadEmptyGroupMembership("group-one")).ok).toBe(false);
    runRawQuery.mockClear();
    expect((await loadEmptyGroupMembership("")).ok).toBe(false);
    expect(runRawQuery).not.toHaveBeenCalled();
  });
  it("drains environment inventory beyond the legacy 25-page cap", async () => {
    envQuery.mockImplementation((_clauses, options) => {
      const page = options.Skip;
      return { ok: true, data: {
        items: [{ name: `pde-${page}`, type: "microsoft.powerplatform/environments", properties: { ...env, id: `pde-${page}` } }],
        skipToken: page < 25 ? `page-${page + 1}` : undefined,
      } };
    });
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("last-page", "pde-25")] } });
    const result = await loadManagedApps();
    expect(result.ok && result.data.environments).toHaveLength(26);
    expect(result.ok && result.data.apps.map((app) => app.id)).toEqual(["last-page"]);
  });

  it("does not render membership when group inventory fails", async () => {
    groupQuery.mockResolvedValue({ ok: false, error: "group denied" });
    expect(await loadManagedApps()).toEqual({ ok: false, error: "Environment groups: group denied" });
    expect(appQuery).toHaveBeenCalledOnce();
  });

  it("drains pages with token plus numeric Skip without dropping managed apps whose parent is missing", async () => {
    appQuery.mockResolvedValueOnce({ ok: true, data: { items: [resource("first")], totalRecords: 1, skipToken: "next" } })
      .mockResolvedValueOnce({ ok: true, data: { items: [resource("second"), resource("outside", "other-env")], totalRecords: 999 } });
    const result = await loadManagedApps();
    expect(result.ok && result.data.apps.map((app) => app.id)).toEqual(["first", "second", "outside"]);
    expect(result.ok && result.data.excludedApps).toBe(0);
    expect(appQuery.mock.calls[1][1]).toEqual({ Top: 500, Skip: 1, SkipToken: "next" });
    expect(JSON.stringify(appQuery.mock.calls[0][0])).toContain("microsoft.powerapps/apps");
  });
  it("counts the same managed-app set across eligible, ungrouped, missing and ineligible parents with normalized joins", async () => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [
      { name: " PDE-ONE ", type: "microsoft.powerplatform/environments", properties: env },
      { name: "ungrouped", type: "microsoft.powerplatform/environments", properties: { ...env, environmentGroupId: "", environmentGroup: "" } },
      { name: "production", type: "microsoft.powerplatform/environments", properties: { ...env, environmentType: "Production" } },
    ] } });
    const managed = [resource("eligible"), resource("ungrouped", "ungrouped"), resource("missing", "missing"), resource("other", "production")];
    appQuery.mockResolvedValue({ ok: true, data: { items: [...managed,
      { ...resource("builder"), properties: { ...resource("builder").properties, subType: "appBuilderApp" } },
      { ...resource("canvas"), type: "microsoft.powerapps/canvasapps" },
    ] } });
    const result = await loadManagedApps();
    expect(result.ok && result.data.apps.map((app) => app.id)).toEqual(managed.map((entry) => entry.name));
    if (!result.ok) throw new Error(result.error);
    const columns = buildBoard(result.data);
    expect(columns.flatMap((column) => column.apps)).toHaveLength(4);
    expect(columns.find((column) => column.key === "unresolved-pde")?.apps[0].id).toBe("missing");
    expect(columns.find((column) => column.key === "ungrouped")?.apps[0].id).toBe("ungrouped");
    expect(pdeMoveBlocker(result.data.environments.find((entry) => entry.id.trim() === "PDE-ONE"))).toBe("");
    expect(pdeMoveBlocker(result.data.environments.find((entry) => entry.id === "production"))).toContain("Production");
    expect(pdeMoveBlocker()).toContain("not returned");
  });
  it("retains managed apps when parent fields are incomplete but marks parent membership/eligibility unknown", async () => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [{ name: env.id, type: "microsoft.powerplatform/environments", properties: { displayName: "Incomplete" } }] } });
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("visible")] } });
    const result = await loadManagedApps();
    expect(result.ok && result.data.apps).toHaveLength(1);
    expect(result.ok && result.data.environments).toHaveLength(0);
    expect(result.ok && result.data.environmentIssues?.[env.id]).toContain("eligibility");
    expect(result.ok && buildBoard(result.data)[0].key).toBe("unresolved-pde");
  });
  it("does not display complete managed counts from partial environment pages", async () => {
    envQuery.mockResolvedValueOnce({ ok: true, data: { items: [{ name: env.id, type: "microsoft.powerplatform/environments", properties: env }], skipToken: "next" } })
      .mockResolvedValueOnce({ ok: false, error: "Synthetic partial environment read" });
    expect(await loadManagedApps()).toEqual({ ok: false, error: "PDE inventory: Synthetic partial environment read" });
    expect(appQuery).toHaveBeenCalledOnce();
  });

  it("fails closed on a later page error", async () => {
    appQuery.mockResolvedValueOnce({ ok: true, data: { items: [resource("first")], skipToken: "next" } })
      .mockResolvedValueOnce({ ok: false, error: "denied" });
    expect(await loadManagedApps()).toEqual({ ok: false, error: "Managed app inventory: denied" });
  });

  it("does not claim completeness when pagination stalls", async () => {
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("first")], skipToken: "same" } });
    expect((await loadManagedApps()).ok).toBe(false);
    expect(appQuery).toHaveBeenCalledTimes(2);
  });

  it("rejects missing identifiers rather than assigning a made-up PDE", async () => {
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("broken", "")] } });
    expect((await loadManagedApps()).ok).toBe(false);
  });

  it("preserves maker object identity and literal unknown origins", () => {
    const app = readManagedApp(resource("app"));
    expect(app.makerId).toBe("maker-one");
    expect(app.makerName).toBe("Avery Maker");
    expect(app.ownerDisplayName).toBe("");
    expect(originLabel("FutureSurface")).toBe("FutureSurface");
    expect(originLabel("")).toBe("Origin unavailable");
  });

  it("keeps duplicate app GUIDs in different PDEs separate", async () => {
    envQuery.mockResolvedValue({ ok: true, data: { items: [
      { name: env.id, type: "microsoft.powerplatform/environments", properties: env },
      { name: "pde-two", type: "microsoft.powerplatform/environments", properties: { ...env, id: "pde-two" } },
    ] } });
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("same"), resource("same", "pde-two")] } });
    const result = await loadManagedApps();
    expect(result.ok && result.data.apps.length).toBe(2);
  });

  it("inspects all app types in the PDE with complete pagination", async () => {
    appQuery.mockResolvedValueOnce({ ok: true, data: { items: [resource("first")], skipToken: "next" } })
      .mockResolvedValueOnce({ ok: true, data: { items: [{ ...resource("canvas"), type: "microsoft.powerapps/canvasapps" }] } });
    const result = await loadPdeApps("pde-one");
    expect(result.ok && result.data.length).toBe(2);
    expect(JSON.stringify(appQuery.mock.calls[0][0])).toContain("microsoft.powerapps/canvasapps");
    expect(appQuery.mock.calls[1][1].Skip).toBe(1);
  });
  it("forces fresh reads for inventory and PDE-wide impact", async () => {
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("app")] } });
    await loadManagedApps(true);
    await loadPdeResources("pde-one");
    expect(runRawQuery.mock.calls.every((call) => call[2]?.forceFresh === true)).toBe(true);
    expect(JSON.stringify(runRawQuery.mock.calls.at(-1)?.[0])).toContain("microsoft.powerautomate/cloudflows");
  });
  it("rejects PDE impact rows with missing or mismatched environment scope", async () => {
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("wrong", "pde-two")] } });
    expect((await loadPdeResources("pde-one")).ok).toBe(false);
  });
  it("preserves raw-page Skip when a page contains duplicates", async () => {
    const item = resource("one");
    appQuery.mockResolvedValueOnce({ ok: true, data: { items: [item], rawItems: [item, item], skipToken: "next" } })
      .mockResolvedValueOnce({ ok: true, data: { items: [resource("two")] } });
    const result = await loadPdeResources("pde-one");
    expect(result.ok && result.data.map((app) => app.id)).toEqual(["one", "two"]);
    expect(appQuery.mock.calls[1][1].Skip).toBe(2);
  });
  it("rejects conflicting duplicates even when the shared mapper deduplicates them", async () => {
    const first = resource("one");
    appQuery.mockResolvedValue({ ok: true, data: {
      items: [first], rawItems: [first, { ...first, properties: { ...first.properties, displayName: "Changed during read" } }],
    } });
    expect((await loadPdeResources("pde-one")).ok).toBe(false);
  });
  it("stops on repeated tokens even when the page adds identities", async () => {
    appQuery.mockResolvedValueOnce({ ok: true, data: { items: [resource("one")], skipToken: "repeated" } })
      .mockResolvedValueOnce({ ok: true, data: { items: [resource("two")], skipToken: "repeated" } });
    expect((await loadPdeResources("pde-one")).ok).toBe(false);
    expect(appQuery).toHaveBeenCalledTimes(2);
  });
  it("rejects explicit truncation without a continuation token instead of showing partial sibling impact", async () => {
    appQuery.mockResolvedValue({ ok: true, data: { items: [resource("one")], resultTruncated: "0" } });
    const result = await loadPdeResources("pde-one");
    expect(!result.ok && result.error).toContain("without a continuation token");
  });
  it("rejects missing type and out-of-scope PDE inspection rows", async () => {
    appQuery.mockResolvedValueOnce({ ok: true, data: { items: [{ ...resource("one"), type: "" }] } });
    expect((await loadPdeApps("pde-one")).ok).toBe(false);
    appQuery.mockResolvedValueOnce({ ok: true, data: { items: [resource("one", "wrong-pde")] } });
    expect((await loadPdeApps("pde-one")).ok).toBe(false);
  });
  it("stops scheduling pages after cancellation", async () => {
    const controller = new AbortController();
    appQuery.mockImplementationOnce(() => {
      controller.abort();
      return { ok: true, data: { items: [resource("one")], skipToken: "next" } };
    });
    expect((await loadPdeResources("pde-one", controller.signal)).ok).toBe(false);
    expect(appQuery).toHaveBeenCalledTimes(1);
  });
  it("drains a synthetic 10000-app inventory using deterministic identity ordering", async () => {
    appQuery.mockImplementation((_clauses, options) => ({
      ok: true, data: {
        items: Array.from({ length: 500 }, (_, index) => resource(`synthetic-${options.Skip + index}`)),
        totalRecords: 3,
        skipToken: options.Skip < 9500 ? `page-${options.Skip + 500}` : undefined,
      },
    }));
    const result = await loadManagedApps();
    expect(result.ok && result.data.apps).toHaveLength(10000);
    expect(appQuery).toHaveBeenCalledTimes(20);
    expect(appQuery.mock.calls[0][0].at(-1)).toEqual({
      $type: "orderby", FieldNamesAscDesc: { name: "asc", "tostring(properties.environmentId)": "asc", type: "asc" },
    });
  });
});

describe("board identity and filters", () => {
  it("retains reported connector IDs, deduplicates them and distinguishes missing from explicit empty", () => {
    expect(readManagedApp({ name: "synthetic", properties: { powerPlatformConnectors: [{ connectorId: "shared_synthetic" }, { connectorId: "SHARED_SYNTHETIC" }] } }).connectorIds).toEqual(["SHARED_SYNTHETIC"]);
    expect(readManagedApp({ name: "synthetic", properties: { powerPlatformConnectors: [] } }).connectorIds).toEqual([]);
    expect(readManagedApp({ name: "synthetic", properties: {} }).connectorIds).toBeNull();
    expect(readManagedApp({ name: "synthetic", properties: { powerPlatformConnectors: [{}] } }).connectorIds).toBeNull();
  });
  it("searches PDE/group names and IDs case-insensitively with AND across advanced fields", () => {
    const app = readManagedApp(resource("Budget"));
    const column = buildBoard({ apps: [app], environments: [env], groups: [group], excludedApps: 0 })[0];
    expect(matchesContext(app, env, column, "PERSONAL group-one", { app: "", environment: "", group: "" })).toBe(true);
    expect(matchesContext(app, env, column, "", { app: "Budget", environment: "PDE-ONE", group: "group-one" })).toBe(true);
    expect(matchesContext(app, env, column, "", { app: "missing", environment: "PDE-ONE", group: "" })).toBe(false);
  });
  it("uses membership IDs, not a Default group name heuristic", () => {
    const inventory = { apps: [readManagedApp(resource("app"))], environments: [env], groups: [group, { ...group, id: "default-looking", displayName: "Default environment group" }], excludedApps: 0 };
    const columns = buildBoard(inventory);
    expect(columns[0].apps).toHaveLength(1);
    expect(columns).toHaveLength(1);
    expect(buildBoard(inventory, true)[1].apps).toHaveLength(0);
  });
  it("joins unique PDE identities to actual group membership without duplicating app cards or rendering empty PDEs", () => {
    const columns = buildBoard({
      apps: [readManagedApp(resource("one")), readManagedApp(resource("two", "PDE-ONE"))],
      environments: [env, structuredClone(env), { ...env, id: "empty-pde", environmentGroupId: "empty-group" }],
      groups: [group, { ...group, id: "empty-group" }], excludedApps: 0,
    });
    expect(columns).toHaveLength(1);
    expect(columns[0].groupId).toBe("group-one");
    expect(columns[0].apps.map((app) => app.id)).toEqual(["one", "two"]);
  });
  it("keeps missing PDE membership distinct from confirmed ungrouped apps and empty groups", () => {
    const columns = buildBoard({ apps: [readManagedApp(resource("unknown", "missing-pde"))], environments: [], groups: [group], excludedApps: 0 });
    expect(columns.map((column) => column.key)).toEqual(["unresolved-pde"]);
    expect(columns[0].apps).toHaveLength(1);
    expect(columns[0].description).toContain("unknown, not empty or ungrouped");
  });
  it("distinguishes absent group details from ungrouped sentinel", () => {
    const columns = buildBoard({
      apps: [readManagedApp(resource("unknown")), readManagedApp(resource("ungrouped", "pde-two"))],
      environments: [{ ...env, environmentGroupId: "missing" }, { ...env, id: "pde-two", environmentGroupId: "00000000-0000-0000-0000-000000000000" }],
      groups: [], excludedApps: 0,
    });
    expect(columns.map((column) => column.key)).toEqual(["missing:missing", "ungrouped"]);
    expect(membershipId("GROUP-ONE")).toBe("group-one");
  });
  it("searches maker names and resolved owner names without mutating membership", () => {
    const app = readManagedApp(resource("Budget app"));
    peekUser.mockImplementation((id: string) => id === "owner-one"
      ? { status: "resolved", user: { displayName: "Jordan Owner", upn: "synthetic-upn" } }
      : { status: "unknown" });
    expect(matchesApp(app, "avery budget", "*")).toBe(true);
    expect(matchesApp(app, "jordan", "CopilotStudio")).toBe(true);
    expect(matchesApp(app, "jordan", "FutureSurface")).toBe(false);
  });
});

describe("ACP completeness", () => {
  it("rejects partial policy reads", async () => {
    assignments.mockResolvedValue({ success: true, data: { value: [{ policyId: "p", resourceId: "group-one", resourceType: "EnvironmentGroup" }] } });
    getPolicy.mockResolvedValue({ success: false, error: { message: "denied" } });
    expect((await loadGroupPolicies("group-one")).ok).toBe(false);
  });
  it("rejects unread continuation links", async () => {
    assignments.mockResolvedValue({ success: true, data: { value: [], "@odata.nextLink": "next" } });
    expect((await loadGroupPolicies("group-one")).ok).toBe(false);
    expect(getPolicy).not.toHaveBeenCalled();
  });
  it("retains separate policy identities, including no ACP rules", async () => {
    const policies = [{ id: "first", ruleSets: [] }, { id: "second", ruleSets: [] }];
    assignments.mockResolvedValue({ success: true, data: { value: policies.map((policy) => ({ policyId: policy.id, resourceId: "group-one", resourceType: "EnvironmentGroup" })) } });
    getPolicy.mockImplementation((id) => ({ success: true, data: policies.find((policy) => policy.id === id) }));
    expect(await loadGroupPolicies("group-one")).toEqual({ ok: true, data: policies });
  });
  it.each([
    {},
    { value: [{ resourceId: "group-one", resourceType: "EnvironmentGroup" }] },
    { value: [{ policyId: "p", resourceId: "other-group", resourceType: "EnvironmentGroup" }] },
  ])("does not turn malformed assignments into empty configuration", async (data) => {
    assignments.mockResolvedValue({ success: true, data });
    expect((await loadGroupPolicies("group-one")).ok).toBe(false);
    expect(getPolicy).not.toHaveBeenCalled();
  });
  it.each([
    { id: "wrong-policy", ruleSets: [] },
    { id: "p", ruleSets: [], ruleSetCount: 1 },
    { id: "p", ruleSets: [{ id: "ConnectorManagement", inputs: {} }] },
  ])("rejects partial or wrong-identity policies", async (data) => {
    assignments.mockResolvedValue({ success: true, data: { value: [{ policyId: "p", resourceId: "group-one", resourceType: "EnvironmentGroup" }] } });
    getPolicy.mockResolvedValue({ success: true, data });
    expect((await loadGroupPolicies("group-one")).ok).toBe(false);
  });
  it("detects assignment/policy rule count drift", async () => {
    assignments.mockResolvedValue({ success: true, data: { value: [{ policyId: "p", resourceId: "group-one", resourceType: "EnvironmentGroup", ruleSetCount: 2 }] } });
    getPolicy.mockResolvedValue({ success: true, data: { id: "p", ruleSets: [] } });
    const result = await loadGroupPolicies("group-one");
    expect(!result.ok && result.error).toContain("changed between");
  });
});
