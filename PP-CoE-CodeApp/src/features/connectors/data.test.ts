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
  getConnectorOperationEvidence,
  filterConnectorOperationUsage,
  loadConnectorOperationUsage,
  type ConnectorUsageRecord,
} from "./data";
import { toAgentRow, toAppRow, toFlowRow } from "../../data/inventory";

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

describe("connector-scoped operation usage", () => {
  const referenceOnly = (): ConnectorUsageRecord => ({
    kind: "apps",
    row: toAppRow({
      ...resource("app-reference"),
      properties: { powerPlatformConnectors: [{ connectorId: "shared_sql" }] },
    }),
  });
  const agent = (): ConnectorUsageRecord => ({
    kind: "agents",
    row: toAgentRow({
      ...resource("agent-tools"),
      type: "microsoft.copilotstudio/agents",
      properties: {
        powerPlatformConnectors: [
          { connectorId: "shared_sql" },
          { connectorId: "shared_sharepointonline", operations: [
            { operationId: "GetItems", isEnabled: true, usedAs: "Tool" },
            { operationId: "DeleteItem", isEnabled: false },
            { operationId: "GetItems", isEnabled: true },
            { operationId: " " },
          ] },
          { connectorId: "shared_office365", operations: [{ operationId: "SendEmailV2" }] },
        ],
      },
    }),
  });

  it("never infers actions from a reference-only app or another connector's operations", () => {
    expect(getConnectorOperationEvidence(referenceOnly(), "sql")).toEqual([]);
    expect(getConnectorOperationEvidence(agent(), "shared_sql")).toEqual([]);
    expect(getConnectorOperationEvidence(agent(), "office365")).toEqual([
      { operationId: "SendEmailV2", role: "action", isEnabled: undefined },
    ]);
  });

  it("normalizes ARM IDs, casing and shared prefixes; deduplicates and labels disabled operations", () => {
    expect(getConnectorOperationEvidence(agent(), "/providers/Microsoft.PowerApps/apis/SHAREPOINTONLINE"))
      .toEqual([
        { operationId: "GetItems", role: "action", isEnabled: true },
        { operationId: "DeleteItem", role: "action", isEnabled: false },
      ]);
    const legacy: ConnectorUsageRecord = {
      kind: "apps",
      row: toAppRow({ ...resource("legacy"), properties: {
        connectors: [{ connectorId: "/providers/Microsoft.PowerApps/apis/shared_sql" }],
      } }),
    };
    expect(getConnectorOperationEvidence(legacy, "sql")).toEqual([]);
  });

  it.each([
    { trigger: "shared_sharepointonline", triggerOperation: "OnNewItem" },
    { trigger: { connectorId: "shared_sharepointonline", operationId: "OnNewItem" } },
  ])("labels modern and legacy flow triggers without attributing them to other connectors: %j", (properties) => {
    const flow: ConnectorUsageRecord = {
      kind: "flows",
      row: toFlowRow({ ...resource("flow"), type: "microsoft.flow/flows", properties }),
    };
    expect(getConnectorOperationEvidence(flow, "sharepointonline"))
      .toEqual([{ operationId: "OnNewItem", role: "trigger" }]);
    expect(getConnectorOperationEvidence(flow, "sql")).toEqual([]);
  });

  it("supports any/all selected operations per resource and excludes unknown-operation references", () => {
    const records = [referenceOnly(), agent()].map((item) => ({
      resource: item,
      operations: getConnectorOperationEvidence(item, "sharepointonline"),
    }));
    expect(filterConnectorOperationUsage(records, [], "all")).toHaveLength(1);
    expect(filterConnectorOperationUsage(records, ["getitems", "Missing"], "any")).toHaveLength(1);
    expect(filterConnectorOperationUsage(records, ["GetItems", "Missing"], "all")).toHaveLength(0);
    expect(filterConnectorOperationUsage(records, ["GETITEMS", "DeleteItem"], "all")).toHaveLength(1);
    expect(filterConnectorOperationUsage(records, ["GetItems", "SendEmailV2"], "all")).toHaveLength(0);
  });

  it("drains all resource kinds before exact matching, preserving reference-only rows for coverage", async () => {
    const matching = { ...resource("app-reference"), properties: {
      powerPlatformConnectors: [{ connectorId: "shared_sql" }],
    } };
    runRawQueryMock
      .mockResolvedValueOnce({ ok: true, data: { items: [matching], totalRecords: 2, skipToken: "next" } })
      .mockResolvedValueOnce({ ok: true, data: { items: [{ ...resource("app-other"), properties: {
        powerPlatformConnectors: [{ connectorId: "shared_other", operations: [{ operationId: "shared_sql" }] }],
      } }], totalRecords: 2 } })
      .mockResolvedValueOnce({ ok: true, data: { items: [], totalRecords: 0 } })
      .mockResolvedValueOnce({ ok: true, data: { items: [], totalRecords: 0 } });
    const result = await loadConnectorOperationUsage("sql");
    expect(result.ok && result.data).toHaveLength(1);
    expect(result.ok && result.data[0].operations).toEqual([]);
    expect(runRawQueryMock).toHaveBeenCalledTimes(4);
    expect(runRawQueryMock.mock.calls[1][1]).toEqual({ Top: 500, Skip: 1, SkipToken: "next" });
  });

  it("does not return successful partial results for a later resource-kind error", async () => {
    runRawQueryMock
      .mockResolvedValueOnce({ ok: true, data: { items: [resource("app")], totalRecords: 1 } })
      .mockResolvedValueOnce({ ok: false, error: "Connector access denied" });
    expect(await loadConnectorOperationUsage("sql")).toEqual({ ok: false, error: "Connector access denied" });
  });

  it("refuses an empty continuation page and page-cap truncation", async () => {
    runRawQueryMock.mockResolvedValueOnce({
      ok: true, data: { items: [], totalRecords: 8, skipToken: "more" },
    });
    expect((await loadConnectorOperationUsage("sql")).ok).toBe(false);
    runRawQueryMock.mockImplementation(async () => ({
      ok: true, data: { items: [resource("app")], totalRecords: 1000, skipToken: `token-${runRawQueryMock.mock.calls.length}` },
    }));
    const capped = await loadConnectorOperationUsage("sql");
    expect(capped).toEqual({ ok: false, error: expect.stringMatching(/safety limit/i) });
  });

  it("stops a cancelled scan before issuing another request", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await loadConnectorOperationUsage("sql", controller.signal);
    expect(result.ok).toBe(false);
    expect(runRawQueryMock).not.toHaveBeenCalled();
  });
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
