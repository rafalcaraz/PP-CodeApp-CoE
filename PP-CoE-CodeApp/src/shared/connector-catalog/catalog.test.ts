import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryResourcesMock, listConnectorsMock, listEnvsMock } = vi.hoisted(
  () => ({
    queryResourcesMock: vi.fn(),
    listConnectorsMock: vi.fn(),
    listEnvsMock: vi.fn(),
  }),
);

vi.mock("../../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    QueryResources: queryResourcesMock,
    ListConnectors: listConnectorsMock,
    ListEnvironmentsForUser: listEnvsMock,
  },
}));

import {
  __resetCatalogForTests,
  anyConnectorPremium,
  classify,
  loadCatalog,
} from "./catalog";

function inventoryConnector(
  connectorId: string,
  tier: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    name: connectorId,
    type: "microsoft.powerplatformconnector/connectors",
    properties: {
      connectorId,
      displayName: connectorId === "shared_sql" ? "SQL Server" : "SharePoint",
      description: "Connector description",
      tier,
      publisher: "Microsoft",
      releaseTag: "Production",
      isDeprecated: false,
      operations: [
        {
          operationId: "GetItems",
          displayName: "Get items",
          description: "Gets items",
          method: "GET",
        },
      ],
      ...overrides,
    },
  };
}

beforeEach(() => {
  __resetCatalogForTests();
  queryResourcesMock.mockReset();
  listConnectorsMock.mockReset();
  listEnvsMock.mockReset();
});

describe("connector catalog inventory source", () => {
  it("uses QueryResources as the primary source and maps rich metadata", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: {
        totalRecords: 2,
        data: [
          inventoryConnector("shared_sharepointonline", "Standard"),
          inventoryConnector("shared_sql", "Premium", {
            releaseTag: "Preview",
            isDeprecated: true,
          }),
        ],
      },
    });

    const result = await loadCatalog();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.source).toBe("inventory");
    expect(result.data.complete).toBe(true);
    expect(listEnvsMock).not.toHaveBeenCalled();
    expect(listConnectorsMock).not.toHaveBeenCalled();

    const sql = result.data.entries.get("shared_sql");
    expect(sql).toMatchObject({
      displayName: "SQL Server",
      description: "Connector description",
      tier: "Premium",
      releaseTag: "Preview",
      isDeprecated: true,
    });
    expect(sql?.operations).toEqual([
      {
        operationId: "GetItems",
        displayName: "Get items",
        description: "Gets items",
        method: "GET",
      },
    ]);
  });

  it("pages with both Skip and SkipToken until the catalog is complete", async () => {
    queryResourcesMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          totalRecords: 2,
          skipToken: "page-2",
          data: [inventoryConnector("shared_sharepointonline", "Standard")],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          totalRecords: 2,
          data: [inventoryConnector("shared_sql", "Premium")],
        },
      });

    const result = await loadCatalog();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.size).toBe(2);
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
    expect(queryResourcesMock.mock.calls[1][1].Options).toMatchObject({
      Skip: 1,
      SkipToken: "page-2",
    });
  });

  it("reuses the in-memory catalog unless a refresh is forced", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: {
        totalRecords: 1,
        data: [inventoryConnector("shared_sql", "Premium")],
      },
    });

    await loadCatalog();
    await loadCatalog();
    expect(queryResourcesMock).toHaveBeenCalledTimes(1);

    await loadCatalog({ force: true });
    expect(queryResourcesMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes ARM connector ids for lookup", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: {
        totalRecords: 1,
        data: [inventoryConnector("shared_sql", "Premium")],
      },
    });
    await loadCatalog();

    expect(
      classify("/providers/Microsoft.PowerApps/apis/SHARED_SQL"),
    ).toMatchObject({
      tier: "Premium",
      known: true,
      reason: "catalog",
    });
    expect(classify("sql")).toMatchObject({
      tier: "Premium",
      known: true,
      reason: "catalog",
    });
  });
});

describe("connector catalog classification", () => {
  it("does not infer premium while the catalog is unavailable", () => {
    expect(classify("shared_sharepointonline")).toEqual({
      tier: "Unknown",
      publisher: "",
      known: false,
      reason: "catalog-unavailable",
    });
    expect(anyConnectorPremium(["shared_sharepointonline"])).toBe(false);
  });

  it("infers a missing connector only after a complete catalog loads", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: {
        totalRecords: 1,
        data: [inventoryConnector("shared_sharepointonline", "Standard")],
      },
    });
    await loadCatalog();

    expect(classify("custom_connector")).toEqual({
      tier: "Unknown",
      publisher: "",
      known: false,
      reason: "not-found",
    });
    expect(anyConnectorPremium(["custom_connector"])).toBe(true);
    expect(anyConnectorPremium(["shared_sharepointonline"])).toBe(false);
  });
});

describe("connector catalog fallback", () => {
  it("falls back to ListConnectors when the preview resource is unsupported", async () => {
    queryResourcesMock.mockResolvedValue({
      success: false,
      error: { message: "Resource type unavailable", status: 400 },
    });
    listEnvsMock.mockResolvedValue({
      success: true,
      data: { value: [{ id: "env-1" }] },
    });
    listConnectorsMock.mockResolvedValue({
      success: true,
      data: {
        value: [
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_sql",
            name: "shared_sql",
            properties: {
              displayName: "SQL Server",
              tier: "Premium",
              publisher: "Microsoft",
            },
          },
        ],
      },
    });

    const result = await loadCatalog();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.source).toBe("list-connectors-fallback");
    expect(result.data.complete).toBe(false);
    expect(classify("shared_sql").tier).toBe("Premium");
    expect(classify("shared_missing")).toEqual({
      tier: "Unknown",
      publisher: "",
      known: false,
      reason: "catalog-unavailable",
    });
    expect(anyConnectorPremium(["shared_missing"])).toBe(false);
  });

  it("tries the next environment when the first fallback catalog is empty", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true,
      data: { totalRecords: 0, data: [] },
    });
    listEnvsMock.mockResolvedValue({
      success: true,
      data: { value: [{ id: "env-empty" }, { id: "env-good" }] },
    });
    listConnectorsMock.mockImplementation(async (envId: string) => {
      if (envId === "env-empty") {
        return { success: true, data: { value: [] } };
      }
      return {
        success: true,
        data: {
          value: [
            {
              id: "/providers/Microsoft.PowerApps/apis/shared_outlook",
              name: "shared_outlook",
              properties: {
                tier: "Standard",
                publisher: "Microsoft",
              },
            },
          ],
        },
      };
    });

    const result = await loadCatalog();
    expect(result.ok).toBe(true);
    expect(listConnectorsMock).toHaveBeenCalledTimes(2);
    expect(classify("shared_outlook").tier).toBe("Standard");
  });

  it("reports both primary and fallback failures", async () => {
    queryResourcesMock.mockResolvedValue({
      success: false,
      error: { message: "Preview unavailable" },
    });
    listEnvsMock.mockResolvedValue({
      success: false,
      error: { message: "Forbidden", status: 403 },
    });

    const result = await loadCatalog();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Preview unavailable");
      expect(result.error).toContain("Forbidden");
    }
  });
});
