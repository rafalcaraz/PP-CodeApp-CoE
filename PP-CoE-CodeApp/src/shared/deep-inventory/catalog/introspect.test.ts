/**
 * Unit tests for the observed-schema introspector.
 *
 * Focus on the rolling-window semantics, value-cap behavior, and the
 * presentInPct computation. Persistence is exercised separately.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  emptyObservedSchema,
  updateObservedSchema,
  loadObservedSchema,
  saveObservedSchema,
  clearObservedSchema,
} from "./introspect";

describe("updateObservedSchema", () => {
  it("registers every leaf path with the correct inferred type", () => {
    const schema = updateObservedSchema(
      emptyObservedSchema("admin-apps"),
      [
        {
          properties: { embeddedApp: { type: "SharepointFormApp" }, usesPremiumApi: true },
        },
      ]
    );
    const embed = schema.paths.get("properties.embeddedApp.type");
    expect(embed?.inferredType).toBe("string");
    expect(embed?.presentInPct).toBe(100);
    expect(embed?.observedValues).toEqual(["SharepointFormApp"]);

    const premium = schema.paths.get("properties.usesPremiumApi");
    expect(premium?.inferredType).toBe("boolean");
    expect(premium?.observedValues).toEqual(["true"]);
  });

  it("unions observed values across batches", () => {
    let schema = emptyObservedSchema("admin-apps");
    schema = updateObservedSchema(schema, [
      { properties: { embeddedApp: { type: "SharepointFormApp" } } },
    ]);
    schema = updateObservedSchema(schema, [
      { properties: { embeddedApp: { type: "TeamsApp" } } },
    ]);
    const entry = schema.paths.get("properties.embeddedApp.type");
    // observedValues is sorted alphabetically.
    expect(entry?.observedValues).toEqual(["SharepointFormApp", "TeamsApp"]);
  });

  it("computes presentInPct correctly across mixed-presence records", () => {
    const records = [
      { properties: { usesPremiumApi: true } },
      { properties: { usesPremiumApi: false } },
      { properties: {} },
      { properties: { usesPremiumApi: true } },
    ];
    const schema = updateObservedSchema(
      emptyObservedSchema("admin-apps"),
      records
    );
    const entry = schema.paths.get("properties.usesPremiumApi");
    expect(entry).toBeDefined();
    // 3 of 4 records carried the field → 75%.
    expect(entry?.presentInPct).toBeCloseTo(75, 1);
    expect(schema.windowRecords).toBe(4);
  });

  it("marks tooManyValues once distinct count exceeds the cap", () => {
    const records = [];
    for (let i = 0; i < 60; i++) {
      records.push({ id: `value-${i}` });
    }
    const schema = updateObservedSchema(emptyObservedSchema("admin-apps"), records);
    const entry = schema.paths.get("id");
    expect(entry?.tooManyValues).toBe(true);
    expect(entry?.observedValues).toBeUndefined();
  });

  it("caps the window at windowSize and applies decay", () => {
    let schema = emptyObservedSchema("admin-apps", 4);
    for (let i = 0; i < 4; i++) {
      schema = updateObservedSchema(schema, [{ a: 1 }]);
    }
    expect(schema.windowRecords).toBe(4);
    expect(schema.paths.get("a")?.presentInPct).toBe(100);

    // Push one more record where `a` is absent. With windowSize=4 the
    // decay factor is 4/5, so previous presence (4) becomes 3.2, then
    // divided by the new windowRecords (still 4 since we're capped)
    // yields 80%.
    schema = updateObservedSchema(schema, [{ b: 1 }]);
    expect(schema.windowRecords).toBe(4);
    expect(schema.paths.get("a")?.presentInPct).toBeLessThan(100);
    // b is brand new and appeared once in the latest window.
    expect(schema.paths.get("b")?.presentInPct).toBeGreaterThan(0);
  });

  it("returns the input unchanged when records is empty", () => {
    const schema = emptyObservedSchema("admin-apps");
    const next = updateObservedSchema(schema, []);
    expect(next).toBe(schema);
  });
});

describe("persistence", () => {
  beforeEach(() => {
    clearObservedSchema("admin-apps");
  });

  it("round-trips through localStorage", () => {
    let schema = emptyObservedSchema("admin-apps");
    schema = updateObservedSchema(schema, [
      { properties: { embeddedApp: { type: "SharepointFormApp" } } },
    ]);
    saveObservedSchema(schema);
    const loaded = loadObservedSchema("admin-apps");
    expect(loaded.paths.get("properties.embeddedApp.type")?.observedValues).toEqual([
      "SharepointFormApp",
    ]);
    expect(loaded.windowRecords).toBe(1);
  });

  it("returns an empty schema when nothing is stored", () => {
    const loaded = loadObservedSchema("admin-apps");
    expect(loaded.paths.size).toBe(0);
    expect(loaded.windowRecords).toBe(0);
  });

  it("returns an empty schema when stored payload is malformed", () => {
    localStorage.setItem("deep-inventory:observed:admin-apps:v1", "not json");
    const loaded = loadObservedSchema("admin-apps");
    expect(loaded.paths.size).toBe(0);
  });
});
