/**
 * Tests for the env-scoped resource roll-up primitives —
 * `countResourcesByTypeForEnvironments` and `countResourcesByEnvAndType`.
 *
 * These power the new Zone reporting cards (Zone Detail, Standard
 * custom group detail, Zones board per-column counters) so getting
 * the clause shape AND the result-merge math right matters more than
 * average — a regression here silently understates governance
 * dashboards rather than throwing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  buildEnvScopedRollupClauses,
  countResourcesByEnvAndType,
  countResourcesByTypeForEnvironments,
  invalidateInventoryCache,
  ResourceType,
} from "./inventory";

beforeEach(() => {
  queryResourcesMock.mockReset();
  invalidateInventoryCache();
});

// ---------------------------------------------------------------------------
// Clause builder — pure function
// ---------------------------------------------------------------------------

describe("buildEnvScopedRollupClauses", () => {
  it("emits == for a single env id and in~ for many", () => {
    const single = buildEnvScopedRollupClauses(["env-1"], ["type"]) as unknown as Array<Record<string, unknown>>;
    const envWhere = single.find(
      (c) => c.FieldName === "properties.environmentId",
    ) as { Operator: string; Values: string[] } | undefined;
    expect(envWhere?.Operator).toBe("==");
    expect(envWhere?.Values).toEqual(["'env-1'"]);

    const many = buildEnvScopedRollupClauses(["env-1", "env-2"], [
      "type",
    ]) as unknown as Array<Record<string, unknown>>;
    const envWhereMany = many.find(
      (c) => c.FieldName === "properties.environmentId",
    ) as { Operator: string; Values: string[] } | undefined;
    expect(envWhereMany?.Operator).toBe("in~");
    expect(envWhereMany?.Values).toEqual(["'env-1'", "'env-2'"]);
  });

  it("quotes resource-type values", () => {
    const clauses = buildEnvScopedRollupClauses(["env-1"], ["type"]) as unknown as Array<Record<string, unknown>>;
    const typeWhere = clauses.find((c) => c.FieldName === "type") as
      | { Values: string[] }
      | undefined;
    expect(typeWhere?.Values).toContain(`'${ResourceType.CanvasApp}'`);
    expect(typeWhere?.Values).toContain(`'${ResourceType.CopilotStudioAgent}'`);
    // AppBuilderApp is intentionally excluded — it double-counts with
    // its underlying canvas/model-driven sibling in roll-ups.
    expect(typeWhere?.Values).not.toContain(`'${ResourceType.AppBuilderApp}'`);
  });

  it("does NOT emit the env-id extend cast when only grouping by type", () => {
    const clauses = buildEnvScopedRollupClauses(["env-1"], ["type"]) as unknown as Array<Record<string, unknown>>;
    expect(clauses.find((c) => c.$type === "extend")).toBeUndefined();
    const summarize = clauses.find((c) => c.$type === "summarize") as
      | {
          SummarizeClauseExpression: { FieldList: string[] };
        }
      | undefined;
    expect(summarize?.SummarizeClauseExpression.FieldList).toEqual(["type"]);
  });

  it("emits an extend(envIdKey = tostring(...)) when grouping by env id", () => {
    // The connector rejects `summarize by properties.environmentId`
    // with a 400 because properties.environmentId is dynamic-typed.
    // The fix is to materialize a string-cast column first and group
    // by THAT — this test pins both halves of the workaround so a
    // future "clean up" can't silently break the rollup.
    const clauses = buildEnvScopedRollupClauses(["env-1"], [
      "type",
      "properties.environmentId",
    ]) as unknown as Array<Record<string, unknown>>;
    const extendClause = clauses.find((c) => c.$type === "extend") as
      | { FieldName: string; Expression: string }
      | undefined;
    expect(extendClause).toEqual({
      $type: "extend",
      FieldName: "envIdKey",
      Expression: "tostring(properties.environmentId)",
    });
    const summarize = clauses.find((c) => c.$type === "summarize") as
      | {
          SummarizeClauseExpression: {
            OperatorName: string;
            OperatorFieldName: string;
            FieldList: string[];
          };
        }
      | undefined;
    expect(summarize?.SummarizeClauseExpression.OperatorName).toBe("count");
    expect(summarize?.SummarizeClauseExpression.OperatorFieldName).toBe(
      "resourceCount",
    );
    expect(summarize?.SummarizeClauseExpression.FieldList).toEqual([
      "type",
      "envIdKey",
    ]);
  });

  it("orders results by resourceCount desc so the busiest type wins ties", () => {
    const clauses = buildEnvScopedRollupClauses(["env-1"], ["type"]) as unknown as Array<Record<string, unknown>>;
    const orderBy = clauses.find((c) => c.$type === "orderby") as
      | { FieldNamesAscDesc: Record<string, string> }
      | undefined;
    expect(orderBy?.FieldNamesAscDesc).toEqual({ resourceCount: "desc" });
  });
});

// ---------------------------------------------------------------------------
// countResourcesByTypeForEnvironments — merge across chunks
// ---------------------------------------------------------------------------

describe("countResourcesByTypeForEnvironments", () => {
  it("returns empty without hitting the wire when envIds is empty", async () => {
    const res = await countResourcesByTypeForEnvironments([]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
    expect(queryResourcesMock).not.toHaveBeenCalled();
  });

  it("maps summarize rows to {type, count} and re-sorts desc", async () => {
    queryResourcesMock.mockResolvedValueOnce({
      success: true,
      data: {
        data: [
          { type: ResourceType.CanvasApp, resourceCount: 3 },
          { type: ResourceType.CloudFlow, resourceCount: 10 },
        ],
        totalRecords: 2,
        skipToken: "",
      },
    });

    const res = await countResourcesByTypeForEnvironments(["env-1"]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([
      { type: ResourceType.CloudFlow, count: 10 },
      { type: ResourceType.CanvasApp, count: 3 },
    ]);
  });

  it("sums counts across multiple chunks for the same resource type", async () => {
    // Build 55 env IDs → splits into two chunks of 50 + 5.
    const envIds = Array.from({ length: 55 }, (_, i) => `env-${i}`);
    queryResourcesMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          data: [
            { type: ResourceType.CanvasApp, resourceCount: 7 },
            { type: ResourceType.CloudFlow, resourceCount: 2 },
          ],
          totalRecords: 2,
          skipToken: "",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          data: [
            { type: ResourceType.CanvasApp, resourceCount: 3 },
            { type: ResourceType.CopilotStudioAgent, resourceCount: 1 },
          ],
          totalRecords: 2,
          skipToken: "",
        },
      });

    const res = await countResourcesByTypeForEnvironments(envIds);
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byType = Object.fromEntries(
      res.data.map((r) => [r.type, r.count] as const),
    );
    expect(byType[ResourceType.CanvasApp]).toBe(10);
    expect(byType[ResourceType.CloudFlow]).toBe(2);
    expect(byType[ResourceType.CopilotStudioAgent]).toBe(1);
  });

  it("propagates the first chunk error and stops paging", async () => {
    const envIds = Array.from({ length: 51 }, (_, i) => `env-${i}`);
    queryResourcesMock.mockResolvedValueOnce({
      success: false,
      error: { message: "boom", status: 500 },
    });
    const res = await countResourcesByTypeForEnvironments(envIds);
    expect(res.ok).toBe(false);
    // Second chunk should never fire after the first one errors.
    expect(queryResourcesMock).toHaveBeenCalledTimes(1);
  });

  it("tolerates resourceCount nested inside properties (summarize quirk)", async () => {
    queryResourcesMock.mockResolvedValueOnce({
      success: true,
      data: {
        data: [
          {
            type: ResourceType.CanvasApp,
            properties: { resourceCount: 5 },
          },
        ],
        totalRecords: 1,
        skipToken: "",
      },
    });
    const res = await countResourcesByTypeForEnvironments(["env-1"]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([{ type: ResourceType.CanvasApp, count: 5 }]);
  });
});

// ---------------------------------------------------------------------------
// countResourcesByEnvAndType — per-(env,type) rows for per-group bucketing
// ---------------------------------------------------------------------------

describe("countResourcesByEnvAndType", () => {
  it("returns empty without hitting the wire when envIds is empty", async () => {
    const res = await countResourcesByEnvAndType([]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
    expect(queryResourcesMock).not.toHaveBeenCalled();
  });

  it("emits both grouping fields and reads envIdKey + legacy fallbacks", async () => {
    queryResourcesMock.mockResolvedValueOnce({
      success: true,
      data: {
        data: [
          // Shape A: synthetic envIdKey from our extend()-cast (the
          // primary shape today)
          {
            type: ResourceType.CanvasApp,
            envIdKey: "env-a",
            resourceCount: 4,
          },
          // Shape B: top-level environmentId (legacy fallback)
          {
            type: ResourceType.CloudFlow,
            environmentId: "env-b",
            resourceCount: 9,
          },
          // Shape C: nested under properties (legacy fallback)
          {
            type: ResourceType.AgentFlow,
            properties: { environmentId: "env-c", resourceCount: 5 },
          },
          // Shape D: dotted key (some tenants project it back as-is)
          {
            type: ResourceType.CopilotStudioAgent,
            "properties.environmentId": "env-d",
            resourceCount: 2,
          },
        ],
        totalRecords: 4,
        skipToken: "",
      },
    });

    const res = await countResourcesByEnvAndType([
      "env-a",
      "env-b",
      "env-c",
      "env-d",
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([
      { environmentId: "env-a", type: ResourceType.CanvasApp, count: 4 },
      { environmentId: "env-b", type: ResourceType.CloudFlow, count: 9 },
      { environmentId: "env-c", type: ResourceType.AgentFlow, count: 5 },
      { environmentId: "env-d", type: ResourceType.CopilotStudioAgent, count: 2 },
    ]);
  });

  it("drops rows missing either the env id or the type (defensive)", async () => {
    queryResourcesMock.mockResolvedValueOnce({
      success: true,
      data: {
        data: [
          { type: ResourceType.CanvasApp, resourceCount: 4 }, // no envId
          { environmentId: "env-x", resourceCount: 9 }, // no type
          {
            type: ResourceType.CloudFlow,
            environmentId: "env-y",
            resourceCount: 1,
          },
        ],
        totalRecords: 3,
        skipToken: "",
      },
    });
    const res = await countResourcesByEnvAndType(["env-x", "env-y"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual([
        { environmentId: "env-y", type: ResourceType.CloudFlow, count: 1 },
      ]);
    }
  });

  it("concatenates rows across multiple chunks rather than summing", async () => {
    const envIds = Array.from({ length: 51 }, (_, i) => `env-${i}`);
    queryResourcesMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          data: [
            { type: ResourceType.CanvasApp, environmentId: "env-0", resourceCount: 1 },
          ],
          totalRecords: 1,
          skipToken: "",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          data: [
            { type: ResourceType.CloudFlow, environmentId: "env-50", resourceCount: 2 },
          ],
          totalRecords: 1,
          skipToken: "",
        },
      });
    const res = await countResourcesByEnvAndType(envIds);
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
    if (res.ok) expect(res.data).toHaveLength(2);
  });
});
