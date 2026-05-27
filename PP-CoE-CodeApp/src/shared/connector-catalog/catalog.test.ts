/**
 * Unit tests for the connector catalog.
 *
 * Uses the `vi.hoisted` pattern (matches `data/userEnrichment.test.ts`)
 * so the mocks aren't constrained by the generated connector's strict
 * `IOperationResult<T>` shape — `tsc -b` is stricter than `--noEmit`
 * about the failure variant requiring `data: undefined`.
 *
 * `__resetCatalogForTests` between cases keeps the module-scope state
 * clean.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { listConnectorsMock, listEnvsMock } = vi.hoisted(() => ({
  listConnectorsMock: vi.fn(),
  listEnvsMock: vi.fn(),
}));

vi.mock("../../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    ListConnectors: listConnectorsMock,
    ListEnvironmentsForUser: listEnvsMock,
  },
}));

import {
  classify,
  anyConnectorPremium,
  loadCatalog,
  __resetCatalogForTests,
} from "./catalog";

beforeEach(() => {
  __resetCatalogForTests();
  listConnectorsMock.mockReset();
  listEnvsMock.mockReset();
});

describe("connector catalog", () => {
  it("classify returns Unknown before the catalog loads", () => {
    expect(classify("shared_sharepointonline")).toEqual({
      tier: "Unknown",
      publisher: "",
      known: false,
    });
  });

  it("hydrates from ListConnectors and classifies Standard/Premium", async () => {
    listEnvsMock.mockResolvedValue({
      success: true,
      data: { value: [{ id: "env-1" }] },
    });
    listConnectorsMock.mockResolvedValue({
      success: true,
      data: {
        value: [
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
            name: "shared_sharepointonline",
            properties: {
              displayName: "SharePoint",
              tier: "Standard",
              publisher: "Microsoft",
            },
          },
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

    const sp = classify("shared_sharepointonline");
    expect(sp.tier).toBe("Standard");
    expect(sp.publisher).toBe("Microsoft");
    expect(sp.known).toBe(true);

    const sql = classify("shared_sql");
    expect(sql.tier).toBe("Premium");
    expect(sql.known).toBe(true);

    // Unknown ids stay Unknown — that's how custom connectors get flagged.
    const custom = classify("shared_custom_5f_something");
    expect(custom).toEqual({ tier: "Unknown", publisher: "", known: false });
  });

  it("anyConnectorPremium treats Premium and Unknown as premium", async () => {
    listEnvsMock.mockResolvedValue({
      success: true,
      data: { value: [{ id: "env-1" }] },
    });
    listConnectorsMock.mockResolvedValue({
      success: true,
      data: {
        value: [
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
            name: "shared_sharepointonline",
            properties: { tier: "Standard", publisher: "Microsoft" },
          },
          {
            id: "/providers/Microsoft.PowerApps/apis/shared_sql",
            name: "shared_sql",
            properties: { tier: "Premium", publisher: "Microsoft" },
          },
        ],
      },
    });
    await loadCatalog();

    expect(anyConnectorPremium(["shared_sharepointonline"])).toBe(false);
    expect(
      anyConnectorPremium(["shared_sharepointonline", "shared_sql"]),
    ).toBe(true);
    // Unknown id triggers premium classification (custom connector path).
    expect(anyConnectorPremium(["shared_sharepointonline", "x_custom"])).toBe(
      true,
    );
    expect(anyConnectorPremium([])).toBe(false);
  });

  it("falls back to the next env when the first is empty", async () => {
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
              properties: { tier: "Standard", publisher: "Microsoft" },
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

  it("surfaces the underlying error when every env fails", async () => {
    listEnvsMock.mockResolvedValue({
      success: true,
      data: { value: [{ id: "env-1" }] },
    });
    listConnectorsMock.mockResolvedValue({
      success: false,
      error: { message: "Forbidden", status: 403, requestId: "abc" },
    });

    const result = await loadCatalog();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Forbidden");
    }
  });
});
