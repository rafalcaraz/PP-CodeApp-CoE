/**
 * Phase 4 tests for `inventory.ts` runQuery pagination & row mapping.
 *
 * Mocks the generated `PowerPlatformforAdminsV2Service.QueryResources`
 * with REAL captured response payloads (anonymized) so we exercise the
 * full path:
 *
 *   public API (listEnvironmentsPage / listAppsPage)
 *     ↓
 *   runQuery + cache + slot acquisition + 429 retry
 *     ↓
 *   __invokeQueryOnce + dedup
 *     ↓
 *   row mappers (toEnvironmentRow / toAppRow)
 *
 * This is the highest-risk untested seam in the data layer per
 * `AGENTS.md`'s warnings about pagination & the skipToken quirks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import envsPage1 from "../test/fixtures/query-resources-envs-page1.json";
import envsTruncated from "../test/fixtures/query-resources-envs-truncated.json";
import appsModelDriven from "../test/fixtures/query-resources-apps-modeldriven.json";

const { queryResourcesMock } = vi.hoisted(() => ({
  queryResourcesMock: vi.fn(),
}));

vi.mock("../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    QueryResources: queryResourcesMock,
  },
}));

// Import AFTER vi.mock so the mock is in place when inventory.ts evaluates.
import {
  getAgent,
  getApp,
  getFlow,
  invalidateInventoryCache,
  listAppsPage,
  listEnvironmentsPage,
} from "./inventory";

beforeEach(() => {
  queryResourcesMock.mockReset();
  invalidateInventoryCache();
});

// ---------------------------------------------------------------------------
// listEnvironmentsPage — happy path + envelope pass-through
// ---------------------------------------------------------------------------

describe("listEnvironmentsPage — envelope mapping", () => {
  it("maps rows, totalRecords, and skipToken from a real page-1 envelope", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: envsPage1,
    });

    const result = await listEnvironmentsPage();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totalRecords).toBe(732);
    expect(result.data.skipToken).toBe(envsPage1.skipToken);
    expect(result.data.rows).toHaveLength(envsPage1.data.length);

    // Spot-check the first row → EnvironmentRow mapping.
    const firstRaw = envsPage1.data[0];
    const firstRow = result.data.rows[0];
    expect(firstRow.id).toBe(firstRaw.name);
    expect(firstRow.displayName).toBe(firstRaw.properties.displayName);
    expect(firstRow.environmentType).toBe(firstRaw.properties.environmentType);
    expect(firstRow.region).toBe(firstRaw.location);
    expect(firstRow.isManaged).toBe(firstRaw.properties.isManaged);
    expect(firstRow.createdBy).toBe(firstRaw.properties.createdBy);
  });

  it("treats `skipToken: null` as undefined (no more pages)", async () => {
    // Production tenant edge case: count=232, totalRecords=732,
    // resultTruncated=1, but skipToken is null. We MUST surface this
    // as `undefined` so the UI doesn't try to follow a null token.
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: envsTruncated,
    });

    const result = await listEnvironmentsPage();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.skipToken).toBeUndefined();
    expect(result.data.totalRecords).toBe(732);
  });

  it("returns ok:false with the connector error message on failure", async () => {
    queryResourcesMock.mockResolvedValue({
      success: false,
      error: { message: "rate limited" },
    });
    const result = await listEnvironmentsPage();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/rate limited/);
  });

  it("forwards skip + skipToken into the QueryResources body", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: { totalRecords: 0, data: [], skipToken: null },
    });
    await listEnvironmentsPage("my-token", 250, 500);
    const callBody = queryResourcesMock.mock.calls[0][1];
    expect(callBody.Options).toMatchObject({
      Top: 250,
      Skip: 500,
      SkipToken: "my-token",
    });
  });
});

// ---------------------------------------------------------------------------
// listAppsPage — mapping for apps + nested owner objects
// ---------------------------------------------------------------------------

describe("listAppsPage — envelope mapping", () => {
  it("maps rows, totalRecords, and skipToken from a real model-driven apps envelope", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: appsModelDriven,
    });

    const result = await listAppsPage({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalRecords).toBe(9620);
    expect(result.data.skipToken).toBe(appsModelDriven.skipToken);
    expect(result.data.rows).toHaveLength(appsModelDriven.data.length);

    const firstRaw = appsModelDriven.data[0];
    const firstRow = result.data.rows[0];
    expect(firstRow.id).toBe(firstRaw.name);
    expect(firstRow.type).toBe(firstRaw.type);
    expect(firstRow.environmentId).toBe(firstRaw.properties.environmentId);
    expect(firstRow.ownerId).toBe(firstRaw.properties.ownerId);
    expect(firstRow.logicalName).toBe(firstRaw.properties.logicalName);
    expect(firstRow.appModuleId).toBe(firstRaw.properties.appModuleId);
  });
});

// ---------------------------------------------------------------------------
// Cache behavior — same body returns cached result without a second call
// ---------------------------------------------------------------------------

describe("runQuery cache (via listEnvironmentsPage)", () => {
  it("caches successful results so identical calls don't re-invoke the connector", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: envsPage1,
    });

    const a = await listEnvironmentsPage();
    const b = await listEnvironmentsPage();
    expect(a.ok && b.ok).toBe(true);
    expect(queryResourcesMock).toHaveBeenCalledTimes(1);
  });

  it("invalidateInventoryCache clears the cache so the next call re-invokes", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: envsPage1,
    });
    await listEnvironmentsPage();
    expect(queryResourcesMock).toHaveBeenCalledTimes(1);

    invalidateInventoryCache();
    await listEnvironmentsPage();
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache errors — a retry re-invokes the connector", async () => {
    queryResourcesMock
      .mockResolvedValueOnce({
        success: false,
        error: { message: "boom" },
      })
      // Same body, same retry — should call again instead of returning cached error.
      .mockResolvedValueOnce({
        success: true,
        data: envsPage1,
      });

    const first = await listEnvironmentsPage();
    expect(first.ok).toBe(false);
    const second = await listEnvironmentsPage();
    expect(second.ok).toBe(true);
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Row dedup — `__invokeQueryOnce` drops duplicate `name`s
// ---------------------------------------------------------------------------

describe("row dedup", () => {
  it("drops rows with duplicate identity key values from the connector", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: {
        totalRecords: 3,
        skipToken: null,
        data: [
          {
            name: "dup-id",
            type: "microsoft.powerplatform/environments",
            location: "us",
            properties: {
              displayName: "First",
              environmentType: "Sandbox",
              isManaged: false,
            },
          },
          {
            name: "dup-id", // duplicate — should be dropped
            type: "microsoft.powerplatform/environments",
            location: "us",
            properties: {
              displayName: "Second (dup)",
              environmentType: "Sandbox",
              isManaged: false,
            },
          },
          {
            name: "unique-id",
            type: "microsoft.powerplatform/environments",
            location: "us",
            properties: {
              displayName: "Third",
              environmentType: "Sandbox",
              isManaged: false,
            },
          },
        ],
      },
    });

    const result = await listEnvironmentsPage();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3 rows in → 2 out (first-seen wins).
    expect(result.data.rows).toHaveLength(2);
    expect(result.data.rows[0].displayName).toBe("First");
    expect(result.data.rows[1].displayName).toBe("Third");
  });

  it("keeps same name when environmentId differs", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: {
        totalRecords: 2,
        skipToken: null,
        data: [
          {
            name: "same-id",
            type: "microsoft.powerapps/canvasapps",
            location: "us",
            properties: {
              displayName: "Env A",
              environmentId: "env-a",
            },
          },
          {
            name: "same-id",
            type: "microsoft.powerapps/canvasapps",
            location: "us",
            properties: {
              displayName: "Env B",
              environmentId: "env-b",
            },
          },
        ],
      },
    });

    const result = await listAppsPage({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows).toHaveLength(2);
    expect(result.data.rows.map((r) => r.environmentId)).toEqual(["env-a", "env-b"]);
  });
});

describe("get* environment filters", () => {
  it("adds properties.environmentId clause when provided", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: { totalRecords: 0, data: [], skipToken: null },
    });

    await getApp("app-1", "env-1");
    await getFlow("flow-1", "env-2");
    await getAgent("agent-1", "env-3");

    const [appCall, flowCall, agentCall] = queryResourcesMock.mock.calls;
    const appClauses = appCall[1].Clauses as Array<{ $type: string; FieldName?: string }>;
    const flowClauses = flowCall[1].Clauses as Array<{ $type: string; FieldName?: string }>;
    const agentClauses = agentCall[1].Clauses as Array<{ $type: string; FieldName?: string }>;

    expect(
      appClauses.some((c) => c.$type === "where" && c.FieldName === "properties.environmentId")
    ).toBe(true);
    expect(
      flowClauses.some((c) => c.$type === "where" && c.FieldName === "properties.environmentId")
    ).toBe(true);
    expect(
      agentClauses.some((c) => c.$type === "where" && c.FieldName === "properties.environmentId")
    ).toBe(true);
  });

  it("keeps get* behavior when environmentId is omitted", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: { totalRecords: 0, data: [], skipToken: null },
    });

    await getApp("app-1");
    await getFlow("flow-1");
    await getAgent("agent-1");

    const [appCall, flowCall, agentCall] = queryResourcesMock.mock.calls;
    const appClauses = appCall[1].Clauses as Array<{ $type: string; FieldName?: string }>;
    const flowClauses = flowCall[1].Clauses as Array<{ $type: string; FieldName?: string }>;
    const agentClauses = agentCall[1].Clauses as Array<{ $type: string; FieldName?: string }>;

    expect(
      appClauses.some((c) => c.$type === "where" && c.FieldName === "properties.environmentId")
    ).toBe(false);
    expect(
      flowClauses.some((c) => c.$type === "where" && c.FieldName === "properties.environmentId")
    ).toBe(false);
    expect(
      agentClauses.some((c) => c.$type === "where" && c.FieldName === "properties.environmentId")
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runQueryAllPages — multi-page drain via listEnvironments()
//
// Pins the fix for the Environment-table pagination bug surfaced on the
// Zones board (MS env groups showing "0 envs" despite real membership):
// when the connector silently re-serves page 1 if only `SkipToken` is
// sent, the drain helper must advance via `Skip = rowsLoaded` to avoid
// dropping every page past the first.
// ---------------------------------------------------------------------------

describe("runQueryAllPages — multi-page Environment drain", () => {
  function envItem(id: string, displayName: string, groupId?: string) {
    return {
      name: id,
      type: "microsoft.powerplatform/environments",
      location: "us",
      properties: {
        displayName,
        environmentType: "Sandbox",
        isManaged: false,
        ...(groupId ? { environmentGroupId: groupId } : {}),
      },
    };
  }

  it("sends Skip = rowsLoaded on the second page (not Skip = 0)", async () => {
    // Page 1: 2 envs + a skipToken. Page 2: 1 env + no skipToken.
    queryResourcesMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          totalRecords: 3,
          skipToken: "token-page-2",
          data: [envItem("env-1", "Env 1"), envItem("env-2", "Env 2")],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          totalRecords: 3,
          skipToken: null,
          data: [envItem("env-3", "Env 3")],
        },
      });

    const { listEnvironments } = await import("./inventory");
    const result = await listEnvironments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(3);
    expect(result.data.map((e) => e.id).sort()).toEqual([
      "env-1",
      "env-2",
      "env-3",
    ]);

    // Verify the second call advanced Skip past page 1's row count —
    // this is the safety net that keeps drain working when the
    // connector ignores SkipToken for the Environment table.
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
    // QueryResources signature: (apiVersion, body) — body is arg[1].
    const secondCallBody = queryResourcesMock.mock.calls[1][1] as {
      Options: { Top: number; Skip: number; SkipToken: string };
    };
    expect(secondCallBody.Options.Skip).toBe(2);
    expect(secondCallBody.Options.SkipToken).toBe("token-page-2");
  });

  it("recovers all envs across MS env groups when the connector ignores SkipToken (silently re-serves page 1)", async () => {
    // Simulates the user-reported regression: tenant has envs spread
    // across multiple MS env groups, but the connector silently
    // re-serves page 1 on every SkipToken call. Without Skip-as-cursor
    // we'd only ever see page 1, so envs in groups that only appear on
    // later pages would never be discovered.
    //
    // With the fix, the connector handler can use `Skip` to figure out
    // which slice the caller actually wants. We model that by
    // returning different items based on the Skip value in the body.
    queryResourcesMock.mockImplementation((_apiVersion: string, body: {
      Options?: { Skip?: number };
    }) => {
      const skip = body?.Options?.Skip ?? 0;
      if (skip === 0) {
        return Promise.resolve({
          success: true,
          data: {
            totalRecords: 4,
            skipToken: "looks-like-paging-works",
            data: [
              envItem("env-A", "Env A", "group-red"),
              envItem("env-B", "Env B", "group-red"),
            ],
          },
        });
      }
      if (skip === 2) {
        return Promise.resolve({
          success: true,
          data: {
            totalRecords: 4,
            skipToken: null,
            data: [
              envItem("env-C", "Env C", "group-red"),
              envItem("env-D", "Env D", "group-yellow"),
            ],
          },
        });
      }
      // Any other Skip → return empty (defensive).
      return Promise.resolve({
        success: true,
        data: { totalRecords: 4, skipToken: null, data: [] },
      });
    });

    const { listEnvironments } = await import("./inventory");
    const result = await listEnvironments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(4);
    // Membership in MS env groups is now correctly derivable —
    // previously env-C and env-D would have been missing entirely
    // and `group-yellow` would have shown "0 envs" despite having one.
    const redMembers = result.data.filter(
      (e) => e.environmentGroupId === "group-red",
    );
    const yellowMembers = result.data.filter(
      (e) => e.environmentGroupId === "group-yellow",
    );
    expect(redMembers).toHaveLength(3);
    expect(yellowMembers).toHaveLength(1);
  });
});
