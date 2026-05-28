/**
 * Tests for the owner-scan controller singleton.
 *
 * Mocks the shared inventory pagers and the resolver. Each test calls
 * `__resetForTests()` to wipe singleton state so a previous test's
 * snapshot doesn't bleed in.
 *
 * Coverage:
 *   - Pure `bucketFor` rule across all five buckets
 *   - Happy-path scan: walks 3 streams, resolves owners, buckets
 *   - Multi-page paging within a stream (skip + skipToken both passed)
 *   - Defensive termination when a page returns zero rows with a stale skipToken
 *   - No-owner rows are counted, not bucketed
 *   - Pager error → phase=error
 *   - `startScan` is a no-op while one is already running
 *   - Cancellation between pages → phase=cancelled
 *   - Subscribers are notified on phase changes; unsubscribe stops them
 *   - Snapshot round-trip via localStorage (fromSnapshot=true on re-import)
 *   - clearLastSnapshot wipes in-memory + localStorage
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppRow, FlowRow, AgentRow } from "../../../data/inventory";
import type { UserRef } from "../../../data/userEnrichment";

const {
  listAppsPageMock,
  listFlowsPageMock,
  listAgentsPageMock,
  resolveUsersMock,
  resolveServicePrincipalsMock,
} = vi.hoisted(() => ({
  listAppsPageMock: vi.fn(),
  listFlowsPageMock: vi.fn(),
  listAgentsPageMock: vi.fn(),
  resolveUsersMock: vi.fn(),
  resolveServicePrincipalsMock: vi.fn(),
}));

vi.mock("../../../data/inventory", async () => {
  // Preserve the real module's type-only exports (ResourceType etc.)
  // so the controller's `ResourceTypeValue` cast still resolves; only
  // the three paging functions are replaced with vitest mocks.
  const actual = await vi.importActual<
    typeof import("../../../data/inventory")
  >("../../../data/inventory");
  return {
    ...actual,
    listAppsPage: listAppsPageMock,
    listFlowsPage: listFlowsPageMock,
    listAgentsPage: listAgentsPageMock,
  };
});

vi.mock("../../../data/userEnrichment", () => ({
  resolveUsers: resolveUsersMock,
}));

vi.mock("../../../data/spnEnrichment", () => ({
  resolveServicePrincipals: resolveServicePrincipalsMock,
}));

import {
  __resetForTests,
  bucketFor,
  cancelScan,
  clearLastSnapshot,
  getProgress,
  getResult,
  isRunning,
  startScan,
  subscribe,
} from "./ownerScanController";
import type { ServicePrincipalRef } from "../../../data/spnEnrichment";

// ─── Fixture helpers ──────────────────────────────────────────────────────

const OWNER_ACTIVE = "11111111-1111-1111-1111-111111111111";
const OWNER_DISABLED = "22222222-2222-2222-2222-222222222222";
const OWNER_GUEST = "33333333-3333-3333-3333-333333333333";
const OWNER_MISSING = "44444444-4444-4444-4444-444444444444";
const OWNER_SENTINEL = "00000000-0000-0000-0000-5157eaa02fcd";
const OWNER_ACTIVE_2 = "55555555-5555-5555-5555-555555555555";
const OWNER_SP = "66666666-6666-6666-6666-666666666666";

const SNAPSHOT_KEY = "ppcoe.ownerScan.lastSnapshot.v2";

function spRef(id: string, overrides: Partial<ServicePrincipalRef> = {}): ServicePrincipalRef {
  return {
    id,
    displayName: "Pipelines",
    appId: "abc",
    servicePrincipalType: "Application",
    appOwnerOrganizationId: "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
    accountEnabled: true,
    kind: "tenant",
    ownerCount: null,
    ...overrides,
  };
}

function userRef(id: string, overrides: Partial<UserRef> = {}): UserRef {
  return {
    id,
    displayName: "Test User",
    upn: "test@contoso.example",
    mail: "test@contoso.example",
    enabled: true,
    userType: "Member",
    ...overrides,
  };
}

function makeAppRow(id: string, ownerId: string, envId = "env-a"): AppRow {
  return {
    id,
    type: "microsoft.powerapps/canvasapps",
    displayName: `App ${id}`,
    environmentId: envId,
    environmentName: "Env A",
    ownerId,
    ownerDisplayName: "",
    createdAt: "",
    createdBy: ownerId,
    lastModifiedAt: "",
    lastModifiedBy: ownerId,
    lastLaunchedAt: "",
    appType: "",
    subType: "",
    region: "",
    tenantId: "",
    isFeatured: false,
    bypassConsent: false,
    isQuarantined: false,
    sharedUsersCount: 0,
    sharedGroupsCount: 0,
    logicalName: "",
    appModuleId: "",
    connectors: [],
  };
}

function makeFlowRow(id: string, ownerId: string): FlowRow {
  return {
    id,
    type: "microsoft.powerautomate/cloudflows",
    displayName: `Flow ${id}`,
    environmentId: "env-a",
    environmentName: "Env A",
    ownerId,
    ownerDisplayName: "",
    state: "Started",
    status: "",
    createdAt: "",
    createdBy: ownerId,
    lastModifiedAt: "",
    lastModifiedBy: ownerId,
    region: "",
    tenantId: "",
    flowTriggerType: "",
    trigger: null,
    workflowEntityId: "",
    connectors: [],
  };
}

function makeAgentRow(id: string, ownerId: string): AgentRow {
  return {
    id,
    type: "microsoft.copilotstudio/agents",
    displayName: `Agent ${id}`,
    schemaName: `agent_${id}`,
    environmentId: "env-a",
    environmentName: "Env A",
    ownerId,
    ownerDisplayName: "",
    createdAt: "",
    createdBy: ownerId,
    lastPublishedAt: "",
    region: "",
    tenantId: "",
    entraAppId: "",
    titleId: "",
    createdIn: "",
    authentication: "",
    orchestration: "",
    model: "",
    instructionsCharactersCount: 0,
    isWebSearchEnabledForKnowledge: false,
    channels: [],
    sharedWithEditors: { userCount: 0, groupCount: 0, entireTenant: false },
    sharedWithViewers: { userCount: 0, groupCount: 0, entireTenant: false },
    isManaged: false,
    isQuarantined: false,
    distinctConnectors: 0,
    distinctConnectorOperations: 0,
    connectors: [],
  };
}

function singlePage<R>(rows: R[]) {
  return {
    ok: true as const,
    data: { rows, skipToken: undefined, totalRecords: rows.length },
  };
}

function emptyPage<R>() {
  return {
    ok: true as const,
    data: { rows: [] as R[], skipToken: undefined, totalRecords: 0 },
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────

beforeEach(() => {
  listAppsPageMock.mockReset();
  listFlowsPageMock.mockReset();
  listAgentsPageMock.mockReset();
  resolveUsersMock.mockReset();
  resolveServicePrincipalsMock.mockReset();
  // Sensible default: no SPs resolved unless a test opts in. Saves
  // every test from having to set this explicitly.
  resolveServicePrincipalsMock.mockResolvedValue(new Map());
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("bucketFor (pure rule)", () => {
  it("buckets a null result with a sentinel GUID as sentinel", () => {
    expect(bucketFor(OWNER_SENTINEL, null, null)).toBe("sentinel");
  });

  it("buckets a null user + null SP with a regular GUID as unresolved", () => {
    expect(bucketFor(OWNER_MISSING, null, null)).toBe("unresolved");
  });

  it("buckets a null user + resolved SP as service-principal", () => {
    expect(bucketFor(OWNER_SP, null, spRef(OWNER_SP))).toBe(
      "service-principal",
    );
  });

  it("user resolution wins over SP resolution when both somehow non-null", () => {
    expect(
      bucketFor(
        OWNER_ACTIVE,
        userRef(OWNER_ACTIVE),
        spRef(OWNER_ACTIVE),
      ),
    ).toBe("active");
  });

  it("buckets a disabled user as disabled (wins over guest)", () => {
    expect(
      bucketFor(
        OWNER_DISABLED,
        userRef(OWNER_DISABLED, { enabled: false }),
        null,
      ),
    ).toBe("disabled");
    expect(
      bucketFor(
        OWNER_DISABLED,
        userRef(OWNER_DISABLED, { enabled: false, userType: "Guest" }),
        null,
      ),
    ).toBe("disabled");
  });

  it("buckets an enabled guest user as guest", () => {
    expect(
      bucketFor(
        OWNER_GUEST,
        userRef(OWNER_GUEST, { userType: "Guest" }),
        null,
      ),
    ).toBe("guest");
  });

  it("buckets an enabled member as active", () => {
    expect(bucketFor(OWNER_ACTIVE, userRef(OWNER_ACTIVE), null)).toBe("active");
  });
});

describe("startScan — happy path", () => {
  it("walks 3 streams, resolves distinct owners, buckets them, and finishes", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([
        makeAppRow("app-1", OWNER_ACTIVE),
        makeAppRow("app-2", OWNER_DISABLED),
        // Duplicate owner GUID — both rows must land in the same entry.
        makeAppRow("app-3", OWNER_ACTIVE),
      ]),
    );
    listFlowsPageMock.mockResolvedValueOnce(
      singlePage([
        makeFlowRow("flow-1", OWNER_GUEST),
        makeFlowRow("flow-2", OWNER_MISSING),
      ]),
    );
    listAgentsPageMock.mockResolvedValueOnce(
      singlePage([
        makeAgentRow("agent-1", OWNER_SENTINEL),
        makeAgentRow("agent-2", OWNER_ACTIVE_2),
      ]),
    );

    resolveUsersMock.mockResolvedValue(
      new Map<string, UserRef | null>([
        [OWNER_ACTIVE, userRef(OWNER_ACTIVE)],
        [OWNER_DISABLED, userRef(OWNER_DISABLED, { enabled: false })],
        [OWNER_GUEST, userRef(OWNER_GUEST, { userType: "Guest" })],
        [OWNER_MISSING, null],
        [OWNER_SENTINEL, null],
        [OWNER_ACTIVE_2, userRef(OWNER_ACTIVE_2)],
      ]),
    );

    await startScan();

    const progress = getProgress();
    expect(progress.phase).toBe("completed");
    expect(progress.error).toBeNull();
    expect(progress.inventoryWalked).toBe(7);
    expect(progress.distinctOwners).toBe(6);
    expect(progress.ownersResolved).toBe(6);
    expect(progress.noOwnerCount).toBe(0);

    const result = getResult();
    expect(result).not.toBeNull();
    expect(result!.fromSnapshot).toBe(false);
    expect(result!.totalResources).toBe(7);
    expect(result!.buckets.active.sort()).toEqual(
      [OWNER_ACTIVE, OWNER_ACTIVE_2].sort(),
    );
    expect(result!.buckets.disabled).toEqual([OWNER_DISABLED]);
    expect(result!.buckets.guest).toEqual([OWNER_GUEST]);
    expect(result!.buckets.unresolved).toEqual([OWNER_MISSING]);
    expect(result!.buckets.sentinel).toEqual([OWNER_SENTINEL]);

    // The duplicated owner picked up both rows.
    expect(
      result!.ownerIndex.get(OWNER_ACTIVE)!.affectedResources,
    ).toHaveLength(2);
  });

  it("calls resolveUsers exactly once with the de-duplicated owner list", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([
        makeAppRow("a1", OWNER_ACTIVE),
        makeAppRow("a2", OWNER_ACTIVE),
      ]),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map([[OWNER_ACTIVE, userRef(OWNER_ACTIVE)]]),
    );

    await startScan();

    expect(resolveUsersMock).toHaveBeenCalledTimes(1);
    const arg = resolveUsersMock.mock.calls[0][0] as string[];
    expect(arg).toEqual([OWNER_ACTIVE]);
  });
});

describe("startScan — SP resolution (Stage 3)", () => {
  it("sends null-user GUIDs (excluding sentinels) to resolveServicePrincipals and buckets resolved SPs as service-principal", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([
        makeAppRow("app-1", OWNER_ACTIVE),
        makeAppRow("app-2", OWNER_SP),
        makeAppRow("app-3", OWNER_MISSING),
        makeAppRow("app-4", OWNER_SENTINEL),
      ]),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());

    // User resolver: ACTIVE is real, the rest miss.
    resolveUsersMock.mockResolvedValue(
      new Map<string, UserRef | null>([
        [OWNER_ACTIVE, userRef(OWNER_ACTIVE)],
        [OWNER_SP, null],
        [OWNER_MISSING, null],
        [OWNER_SENTINEL, null],
      ]),
    );
    // SP resolver: OWNER_SP is a real SP; OWNER_MISSING isn't.
    // Sentinel must NOT appear in the input (excluded by the controller).
    resolveServicePrincipalsMock.mockImplementation(
      async (ids: string[]) => {
        expect(ids).toContain(OWNER_SP);
        expect(ids).toContain(OWNER_MISSING);
        expect(ids).not.toContain(OWNER_SENTINEL);
        expect(ids).not.toContain(OWNER_ACTIVE);
        return new Map([
          [OWNER_SP, spRef(OWNER_SP, { kind: "first-party" })],
          [OWNER_MISSING, null],
        ]);
      },
    );

    await startScan();

    expect(getProgress().phase).toBe("completed");
    expect(getProgress().spnsResolved).toBe(2);

    const result = getResult();
    expect(result!.buckets.active).toEqual([OWNER_ACTIVE]);
    expect(result!.buckets["service-principal"]).toEqual([OWNER_SP]);
    expect(result!.buckets.unresolved).toEqual([OWNER_MISSING]);
    expect(result!.buckets.sentinel).toEqual([OWNER_SENTINEL]);

    const spEntry = result!.ownerIndex.get(OWNER_SP);
    expect(spEntry?.servicePrincipal?.kind).toBe("first-party");
    expect(spEntry?.user).toBeNull();
  });

  it("skips the SP resolution call entirely when every owner resolved against aaduser", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([makeAppRow("app-1", OWNER_ACTIVE)]),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map([[OWNER_ACTIVE, userRef(OWNER_ACTIVE)]]),
    );

    await startScan();
    expect(resolveServicePrincipalsMock).not.toHaveBeenCalled();
    expect(getProgress().spnsResolved).toBe(0);
  });
});

describe("startScan — paging", () => {
  it("follows skipToken through multiple pages and passes both skip + skipToken", async () => {
    listAppsPageMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [makeAppRow("a1", OWNER_ACTIVE)],
          skipToken: "page-2-token",
          totalRecords: 3,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [makeAppRow("a2", OWNER_DISABLED)],
          skipToken: "page-3-token",
          totalRecords: 3,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [makeAppRow("a3", OWNER_GUEST)],
          skipToken: undefined,
          totalRecords: 3,
        },
      });
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map<string, UserRef | null>([
        [OWNER_ACTIVE, userRef(OWNER_ACTIVE)],
        [OWNER_DISABLED, userRef(OWNER_DISABLED, { enabled: false })],
        [OWNER_GUEST, userRef(OWNER_GUEST, { userType: "Guest" })],
      ]),
    );

    await startScan();

    expect(listAppsPageMock).toHaveBeenCalledTimes(3);
    // listAppsPage signature: (filters, skipToken, pageSize, skip)
    const secondCall = listAppsPageMock.mock.calls[1];
    expect(secondCall[1]).toBe("page-2-token");
    expect(secondCall[3]).toBe(1);
    const thirdCall = listAppsPageMock.mock.calls[2];
    expect(thirdCall[1]).toBe("page-3-token");
    expect(thirdCall[3]).toBe(2);

    expect(getProgress().inventoryWalked).toBe(3);
  });

  it("terminates a stream when it returns zero rows even if skipToken is present", async () => {
    listAppsPageMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [makeAppRow("a1", OWNER_ACTIVE)],
          skipToken: "looping-token",
          totalRecords: 1,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [],
          skipToken: "looping-token",
          totalRecords: 1,
        },
      });
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map([[OWNER_ACTIVE, userRef(OWNER_ACTIVE)]]),
    );

    await startScan();
    expect(listAppsPageMock).toHaveBeenCalledTimes(2);
    expect(getProgress().phase).toBe("completed");
  });
});

describe("startScan — edge cases", () => {
  it("counts rows with missing or malformed ownerId in noOwnerCount", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([
        makeAppRow("a1", OWNER_ACTIVE),
        makeAppRow("a2", ""),
        makeAppRow("a3", "not-a-guid"),
      ]),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map([[OWNER_ACTIVE, userRef(OWNER_ACTIVE)]]),
    );

    await startScan();
    const result = getResult();
    expect(result!.noOwnerCount).toBe(2);
    expect(result!.totalResources).toBe(3);
    expect(result!.ownerIndex.size).toBe(1);
  });

  it("sets phase=error and captures the message when a pager fails", async () => {
    listAppsPageMock.mockResolvedValueOnce({
      ok: false,
      error: "HTTP 503 — Service unavailable",
    });
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());

    await startScan();
    const progress = getProgress();
    expect(progress.phase).toBe("error");
    expect(progress.error).toContain("Service unavailable");
    expect(progress.finishedAt).not.toBeNull();
    expect(resolveUsersMock).not.toHaveBeenCalled();
  });

  it("startScan is a no-op when one is already running", async () => {
    let releaseApps: (() => void) | null = null;
    listAppsPageMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseApps = () =>
            resolve({
              ok: true,
              data: {
                rows: [makeAppRow("a1", OWNER_ACTIVE)],
                skipToken: undefined,
                totalRecords: 1,
              },
            });
        }),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map([[OWNER_ACTIVE, userRef(OWNER_ACTIVE)]]),
    );

    const firstRun = startScan();
    // Give the microtask queue a tick to actually start the scan and
    // flip isRunning() before we observe it.
    await Promise.resolve();
    expect(isRunning()).toBe(true);

    await startScan();
    expect(listAppsPageMock).toHaveBeenCalledTimes(1);

    releaseApps!();
    await firstRun;
    expect(getProgress().phase).toBe("completed");
  });
});

describe("startScan — cancellation", () => {
  it("sets phase=cancelled when aborted between pages", async () => {
    let releaseFirstPage: (() => void) | null = null;
    listAppsPageMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstPage = () =>
              resolve({
                ok: true,
                data: {
                  rows: [makeAppRow("a1", OWNER_ACTIVE)],
                  skipToken: "more",
                  totalRecords: 2,
                },
              });
          }),
      )
      .mockResolvedValueOnce(
        singlePage([makeAppRow("a2", OWNER_DISABLED)]),
      );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());

    const run = startScan();
    await Promise.resolve();
    cancelScan();
    releaseFirstPage!();
    await run;

    expect(getProgress().phase).toBe("cancelled");
    // No second page request after cancel.
    expect(listAppsPageMock).toHaveBeenCalledTimes(1);
    expect(resolveUsersMock).not.toHaveBeenCalled();
  });
});

describe("subscribers", () => {
  it("notifies subscribers across every lifecycle phase", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([makeAppRow("a1", OWNER_ACTIVE)]),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map([[OWNER_ACTIVE, userRef(OWNER_ACTIVE)]]),
    );

    const observed: string[] = [];
    const unsubscribe = subscribe(() => {
      observed.push(getProgress().phase);
    });
    await startScan();
    unsubscribe();

    expect(observed).toContain("loading-inventory");
    expect(observed).toContain("resolving-owners");
    expect(observed).toContain("completed");
  });

  it("unsubscribe stops further notifications", async () => {
    listAppsPageMock.mockResolvedValueOnce(emptyPage());
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(new Map());

    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    unsubscribe();
    await startScan();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("snapshot persistence", () => {
  it("persists a snapshot on completion and rehydrates as fromSnapshot=true on re-import", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([
        makeAppRow("a1", OWNER_ACTIVE),
        makeAppRow("a2", OWNER_DISABLED),
      ]),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map<string, UserRef | null>([
        [OWNER_ACTIVE, userRef(OWNER_ACTIVE)],
        [OWNER_DISABLED, userRef(OWNER_DISABLED, { enabled: false })],
      ]),
    );

    await startScan();
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull();

    // Force re-import — the new module instance runs its init code
    // (loadSnapshot()) and rehydrates from localStorage. The mocks
    // (registered via vi.mock at the top) persist across resetModules.
    vi.resetModules();
    const reloaded = await import("./ownerScanController");
    const result = reloaded.getResult();
    expect(result).not.toBeNull();
    expect(result!.fromSnapshot).toBe(true);
    expect(result!.totalResources).toBe(2);
    expect(result!.buckets.active).toEqual([OWNER_ACTIVE]);
    expect(result!.buckets.disabled).toEqual([OWNER_DISABLED]);
    // Affected resources are intentionally NOT persisted.
    expect(result!.ownerIndex.get(OWNER_ACTIVE)!.affectedResources).toEqual([]);
  });

  it("ignores a snapshot with an unrecognized version", async () => {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ version: 99, scannedAt: 0 }),
    );
    vi.resetModules();
    const reloaded = await import("./ownerScanController");
    expect(reloaded.getResult()).toBeNull();
  });

  it("clearLastSnapshot wipes both the in-memory result and localStorage", async () => {
    listAppsPageMock.mockResolvedValueOnce(
      singlePage([makeAppRow("a1", OWNER_ACTIVE)]),
    );
    listFlowsPageMock.mockResolvedValueOnce(emptyPage());
    listAgentsPageMock.mockResolvedValueOnce(emptyPage());
    resolveUsersMock.mockResolvedValue(
      new Map([[OWNER_ACTIVE, userRef(OWNER_ACTIVE)]]),
    );

    await startScan();
    expect(getResult()).not.toBeNull();
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull();

    clearLastSnapshot();
    expect(getResult()).toBeNull();
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});
