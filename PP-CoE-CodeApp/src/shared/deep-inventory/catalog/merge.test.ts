/**
 * Unit tests for the property-catalog merger and grouper.
 */
import { describe, it, expect } from "vitest";
import {
  mergePropertyCatalog,
  groupCatalog,
  OBSERVED_GROUP,
  ADMIN_APPS_HIDE_PREFIXES,
} from "./merge";
import { emptyObservedSchema, updateObservedSchema } from "./introspect";
import type { CuratedProperty } from "./types";

const CURATED: CuratedProperty[] = [
  {
    id: "embeddedAppType",
    label: "Embedded app type",
    path: "properties.embeddedApp.type",
    group: "Embedded app",
    filter: { kind: "enum", values: ["SharepointFormApp"] },
    source: "admin-apps",
    addedIn: "2026-05-26",
  },
  {
    id: "usesPremiumApi",
    label: "Uses premium API",
    path: "properties.usesPremiumApi",
    group: "Licensing",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: "2026-05-26",
  },
];

describe("mergePropertyCatalog", () => {
  it("returns just curated entries when observed is undefined", () => {
    const catalog = mergePropertyCatalog(CURATED, undefined);
    expect(catalog.size).toBe(2);
    const e1 = catalog.get("properties.embeddedApp.type");
    expect(e1?.origin).toBe("curated");
  });

  it("curated entries win over observed for the same path", () => {
    let observed = emptyObservedSchema("admin-apps");
    observed = updateObservedSchema(observed, [
      { properties: { embeddedApp: { type: "SharepointFormApp" } } },
    ]);
    const catalog = mergePropertyCatalog(CURATED, observed);
    const entry = catalog.get("properties.embeddedApp.type");
    expect(entry?.origin).toBe("curated");
  });

  it("observed paths not in curated are included as discovered", () => {
    let observed = emptyObservedSchema("admin-apps");
    observed = updateObservedSchema(observed, [
      { properties: { somethingNew: "foo" } },
    ]);
    const catalog = mergePropertyCatalog(CURATED, observed);
    const entry = catalog.get("properties.somethingNew");
    expect(entry?.origin).toBe("observed");
  });

  it("hides container paths (object/array) by default", () => {
    let observed = emptyObservedSchema("admin-apps");
    observed = updateObservedSchema(observed, [
      { properties: { tags: { foo: "bar" } } },
    ]);
    const catalog = mergePropertyCatalog(CURATED, observed);
    // `properties.tags` is an object node — hidden by default.
    expect(catalog.has("properties.tags")).toBe(false);
    // The leaf below it is still surfaced.
    expect(catalog.has("properties.tags.foo")).toBe(true);
  });

  it("honors hidePrefixes", () => {
    let observed = emptyObservedSchema("admin-apps");
    observed = updateObservedSchema(observed, [
      { properties: { appPlayUri: "https://signed" } },
    ]);
    const catalog = mergePropertyCatalog(CURATED, observed, {
      hidePrefixes: ADMIN_APPS_HIDE_PREFIXES,
    });
    expect(catalog.has("properties.appPlayUri")).toBe(false);
  });
});

describe("groupCatalog", () => {
  it("buckets curated entries by their group field", () => {
    const catalog = mergePropertyCatalog(CURATED, undefined);
    const groups = groupCatalog(catalog);
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("Embedded app");
    expect(labels).toContain("Licensing");
  });

  it("puts observed entries under the OBSERVED_GROUP", () => {
    let observed = emptyObservedSchema("admin-apps");
    observed = updateObservedSchema(observed, [
      { properties: { newField: "x" } },
    ]);
    const catalog = mergePropertyCatalog(CURATED, observed);
    const groups = groupCatalog(catalog);
    const observedGroup = groups.find((g) => g.label === OBSERVED_GROUP);
    expect(observedGroup).toBeDefined();
    expect(observedGroup?.entries.some((e) => e.path === "properties.newField")).toBe(true);
  });
});
