/**
 * Unit tests for the drift detector.
 */
import { describe, it, expect } from "vitest";
import { detectDrift } from "./drift";
import { emptyObservedSchema, updateObservedSchema } from "./introspect";
import type { CuratedProperty } from "./types";

const CURATED: CuratedProperty[] = [
  {
    id: "embeddedAppType",
    label: "Embedded app type",
    path: "properties.embeddedApp.type",
    filter: { kind: "enum", values: ["SharepointFormApp"] },
    source: "admin-apps",
    addedIn: "2026-05-26",
  },
  {
    id: "usesPremiumApi",
    label: "Uses premium API",
    path: "properties.usesPremiumApi",
    filter: { kind: "boolean" },
    source: "admin-apps",
    addedIn: "2026-05-26",
  },
];

function buildObserved(records: object[], windowSize = 500) {
  let schema = emptyObservedSchema("admin-apps", windowSize);
  schema = updateObservedSchema(schema, records);
  return schema;
}

describe("detectDrift", () => {
  it("returns no warnings when observed schema is missing", () => {
    expect(detectDrift(CURATED, undefined)).toEqual([]);
  });

  it("returns no warnings when window is too small", () => {
    const observed = buildObserved([{ unrelated: 1 }]); // 1 record
    expect(detectDrift(CURATED, observed)).toEqual([]);
  });

  it("flags missing curated paths", () => {
    const records = Array.from({ length: 30 }, () => ({ unrelated: 1 }));
    const observed = buildObserved(records);
    const warnings = detectDrift(CURATED, observed);
    const kinds = warnings.map((w) => w.kind);
    expect(kinds).toContain("missing");
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag curated paths that are present in most records", () => {
    const records = Array.from({ length: 30 }, () => ({
      properties: { embeddedApp: { type: "SharepointFormApp" }, usesPremiumApi: false },
    }));
    const observed = buildObserved(records);
    const warnings = detectDrift(CURATED, observed);
    expect(warnings.filter((w) => w.kind === "missing")).toEqual([]);
    expect(warnings.filter((w) => w.kind === "presence-low")).toEqual([]);
  });

  it("flags presence-low when path is below threshold", () => {
    const present = Array.from({ length: 1 }, () => ({
      properties: { embeddedApp: { type: "SharepointFormApp" } },
    }));
    const absent = Array.from({ length: 50 }, () => ({ unrelated: 1 }));
    const observed = buildObserved([...present, ...absent]);
    const warnings = detectDrift(CURATED, observed);
    expect(warnings.some((w) => w.kind === "presence-low")).toBe(true);
  });

  it("flags type-shift when inferred type contradicts curated filter kind", () => {
    // usesPremiumApi declared as boolean — feed string values.
    const records = Array.from({ length: 30 }, () => ({
      properties: { usesPremiumApi: "yes" },
    }));
    const observed = buildObserved(records);
    const warnings = detectDrift(CURATED, observed);
    const typeShift = warnings.find(
      (w) => w.kind === "type-shift" && w.property.id === "usesPremiumApi"
    );
    expect(typeShift).toBeDefined();
    expect(typeShift?.observedInferredType).toBe("string");
  });
});
