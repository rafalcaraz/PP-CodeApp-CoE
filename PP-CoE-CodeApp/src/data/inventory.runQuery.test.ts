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
  it("drops rows with duplicate `name` values from the connector", async () => {
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
            properties: { displayName: "First", environmentType: "Sandbox", isManaged: false },
          },
          {
            name: "dup-id", // duplicate — should be dropped
            type: "microsoft.powerplatform/environments",
            location: "us",
            properties: { displayName: "Second (dup)", environmentType: "Sandbox", isManaged: false },
          },
          {
            name: "unique-id",
            type: "microsoft.powerplatform/environments",
            location: "us",
            properties: { displayName: "Third", environmentType: "Sandbox", isManaged: false },
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
});
