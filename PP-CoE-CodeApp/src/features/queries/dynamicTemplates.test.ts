/**
 * Unit tests for the dynamic premium-connector query templates.
 */
import { describe, it, expect } from "vitest";
import { buildDynamicQueryTemplates, buildPremiumConnectorMatchValue } from "./dynamicTemplates";
import type { ConnectorCatalog } from "../../shared/connector-catalog";

function makeCatalog(entries: { id: string; tier: string }[]): ConnectorCatalog {
  return {
    fetchedAt: Date.now(),
    envId: "env-1",
    entries: new Map(
      entries.map((e) => [
        e.id,
        {
          connectorId: e.id,
          displayName: e.id,
          tier: e.tier,
          publisher: "Microsoft",
        },
      ]),
    ),
  };
}

describe("buildPremiumConnectorMatchValue", () => {
  it("returns empty when the catalog has no premium entries", () => {
    const catalog = makeCatalog([{ id: "shared_sharepointonline", tier: "Standard" }]);
    expect(buildPremiumConnectorMatchValue(catalog)).toBe("");
  });

  it("returns the comma-joined premium slugs + customConnectors token", () => {
    const catalog = makeCatalog([
      { id: "shared_sharepointonline", tier: "Standard" },
      { id: "shared_sql", tier: "Premium" },
      { id: "shared_documentdb", tier: "Premium" },
    ]);
    const v = buildPremiumConnectorMatchValue(catalog);
    expect(v).toBe("shared_documentdb,shared_sql,customConnectors");
  });
});

describe("buildDynamicQueryTemplates", () => {
  it("returns an empty array when the catalog is missing", () => {
    expect(buildDynamicQueryTemplates(undefined)).toEqual([]);
  });

  it("returns an empty array when no premium entries exist", () => {
    const catalog = makeCatalog([{ id: "shared_sharepointonline", tier: "Standard" }]);
    expect(buildDynamicQueryTemplates(catalog)).toEqual([]);
  });

  it("emits apps/flows/agents templates with the premium filter", () => {
    const catalog = makeCatalog([
      { id: "shared_sql", tier: "Premium" },
      { id: "shared_sharepointonline", tier: "Standard" },
    ]);
    const templates = buildDynamicQueryTemplates(catalog);
    expect(templates).toHaveLength(3);

    const ids = templates.map((t) => t.id);
    expect(ids).toEqual(["premium-apps", "premium-flows", "premium-agents"]);

    // Every template should carry exactly one __connector in~ filter
    // whose value contains the premium slug AND the custom-connector
    // catch-all token.
    for (const tpl of templates) {
      expect(tpl.spec.filters).toHaveLength(1);
      const f = tpl.spec.filters[0];
      expect(f.field).toBe("__connector");
      expect(f.op).toBe("in~");
      expect(f.value).toContain("shared_sql");
      expect(f.value).toContain("customConnectors");
    }
  });
});
