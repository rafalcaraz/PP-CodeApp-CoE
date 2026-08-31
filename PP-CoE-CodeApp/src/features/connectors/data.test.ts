import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadCatalogMock,
  runRawQueryMock,
  runAggregateCountMock,
  backfillEnvironmentNamesMock,
} = vi.hoisted(() => ({
  loadCatalogMock: vi.fn(),
  runRawQueryMock: vi.fn(),
  runAggregateCountMock: vi.fn(),
  backfillEnvironmentNamesMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../shared/connector-catalog", async () => {
  const actual = await vi.importActual<
    typeof import("../../shared/connector-catalog")
  >("../../shared/connector-catalog");
  return {
    ...actual,
    loadCatalog: loadCatalogMock,
  };
});

vi.mock("../../data/inventory", async () => {
  const actual = await vi.importActual<typeof import("../../data/inventory")>(
    "../../data/inventory",
  );
  return {
    ...actual,
    runRawQuery: runRawQueryMock,
    runAggregateCount: runAggregateCountMock,
    backfillEnvironmentNames: backfillEnvironmentNamesMock,
  };
});

import {
  connectorIdVariants,
  exportConnectorUsage,
  getConnectorDetail,
  listConnectorUsagePage,
  loadConnectorUsageSummary,
} from "./data";

function resource(id: string, environmentId = "env-1") {
  return {
    name: id,
    type: "microsoft.powerapps/canvasapps",
    location: "unitedstates",
    properties: {
      displayName: `App ${id}`,
      environmentId,
      environmentName: `Environment ${environmentId}`,
      lastModifiedAt: "2026-05-01T00:00:00Z",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("connector detail data", () => {
  it("matches bare and shared connector ID variants", () => {
    expect(connectorIdVariants("shared_sql")).toEqual(["shared_sql", "sql"]);
    expect(
      connectorIdVariants("/providers/Microsoft.PowerApps/apis/sql"),
    ).toEqual(["sql", "shared_sql"]);
  });

  it("finds catalog entries through either connector ID shape", async () => {
    const entry = {
      connectorId: "shared_sql",
      displayName: "SQL Server",
      description: "",
      tier: "Premium",
      publisher: "Microsoft",
      releaseTag: "Production",
      isDeprecated: false,
      operations: [],
    };
    loadCatalogMock.mockResolvedValue({
      ok: true,
      data: {
        entries: new Map([["shared_sql", entry]]),
        fetchedAt: Date.now(),
        source: "inventory",
        complete: true,
      },
    });

    const result = await getConnectorDetail("sql");

    expect(result).toEqual({
      ok: true,
      data: { entry, source: "inventory", complete: true },
    });
  });

  it("uses has_any and sends both the continuation token and cumulative skip", async () => {
    runRawQueryMock.mockResolvedValue({
      ok: true,
      data: {
        items: [resource("app-1")],
        totalRecords: 31,
        skipToken: "next-token",
      },
    });

    const result = await listConnectorUsagePage(
      "apps",
      "shared_sql",
      "current-token",
      15,
      30,
    );

    expect(result.ok).toBe(true);
    expect(runRawQueryMock).toHaveBeenCalledTimes(1);
    const [clauses, options] = runRawQueryMock.mock.calls[0];
    expect(options).toEqual({
      Top: 15,
      Skip: 30,
      SkipToken: "current-token",
    });
    expect(clauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $type: "where",
          FieldName: "__connectorBag",
          Operator: "has_any",
          Values: ["'shared_sql'", "'sql'"],
        }),
      ]),
    );
  });

  it("stops paging when inventory repeats a continuation token", async () => {
    runRawQueryMock.mockResolvedValue({
      ok: true,
      data: {
        items: [resource("app-1")],
        totalRecords: 50,
        skipToken: "stuck-token",
      },
    });

    const result = await listConnectorUsagePage(
      "apps",
      "shared_sql",
      "stuck-token",
    );

    expect(result.ok && result.data.nextSkipToken).toBeUndefined();
    expect(result.ok && result.data.pagingWarning).toMatch(
      /same continuation token/i,
    );
  });

  it("builds usage KPIs from server-side type and environment aggregates", async () => {
    runAggregateCountMock
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { name: "microsoft.powerapps/canvasapps", value: 3 },
          { name: "microsoft.powerautomate/cloudflows", value: 4 },
          { name: "microsoft.powerautomate/agentflows", value: 2 },
          { name: "microsoft.copilotstudio/agents", value: 5 },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { name: "env-1", value: 8 },
          { name: "env-2", value: 6 },
          { name: "(empty)", value: 1 },
        ],
      });

    await expect(loadConnectorUsageSummary("shared_sql")).resolves.toEqual({
      ok: true,
      data: {
        total: 14,
        apps: 3,
        flows: 6,
        agents: 5,
        environments: 2,
      },
    });
  });

  it("drains export pages with cumulative skip and deduplicates resources", async () => {
    runRawQueryMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [resource("app-1"), resource("app-2")],
          totalRecords: 3,
          skipToken: "page-2",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [resource("app-2"), resource("app-3")],
          totalRecords: 3,
        },
      });

    const result = await exportConnectorUsage("apps", "shared_sql");

    expect(result.ok && result.data).toHaveLength(3);
    expect(runRawQueryMock.mock.calls[0][1]).toEqual({
      Top: 500,
      Skip: 0,
      SkipToken: "",
    });
    expect(runRawQueryMock.mock.calls[1][1]).toEqual({
      Top: 500,
      Skip: 2,
      SkipToken: "page-2",
    });
  });

  it("cancels an incomplete export when the token repeats", async () => {
    runRawQueryMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [resource("app-1")],
          totalRecords: 2,
          skipToken: "stuck",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [resource("app-2")],
          totalRecords: 2,
          skipToken: "stuck",
        },
      });

    const result = await exportConnectorUsage("apps", "shared_sql");

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringMatching(/Export was cancelled/i),
      }),
    );
  });
});
