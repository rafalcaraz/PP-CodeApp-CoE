/**
 * Unit tests for the payload flattener.
 *
 * Two big invariants we care about:
 *  1. Every leaf in the payload appears exactly once at its dotted path.
 *  2. Excluded prefixes don't appear at all.
 */
import { describe, it, expect } from "vitest";
import { flatten, getPath, readPath } from "./flatten";

describe("flatten", () => {
  it("returns an empty-path entry for primitive inputs", () => {
    const flat = flatten("hello");
    expect(flat.size).toBe(1);
    const root = flat.get("");
    expect(root?.value).toBe("hello");
    expect(root?.kind).toBe("string");
  });

  it("flattens nested objects to dotted paths", () => {
    const flat = flatten({
      properties: {
        embeddedApp: { type: "SharepointFormApp", siteId: "abc" },
        usesPremiumApi: false,
      },
    });
    expect(flat.get("properties.embeddedApp.type")?.value).toBe(
      "SharepointFormApp"
    );
    expect(flat.get("properties.embeddedApp.siteId")?.value).toBe("abc");
    expect(flat.get("properties.usesPremiumApi")?.value).toBe(false);
  });

  it("emits null entries for null and undefined values", () => {
    const flat = flatten({ a: null, b: undefined, c: 1 });
    expect(flat.get("a")?.kind).toBe("null");
    expect(flat.get("a")?.value).toBe(null);
    expect(flat.get("b")?.kind).toBe("null");
    expect(flat.get("c")?.kind).toBe("number");
  });

  it("keeps arrays whole with a length annotation", () => {
    const flat = flatten({ tags: ["a", "b", "c"] });
    const leaf = flat.get("tags");
    expect(leaf?.kind).toBe("array");
    expect(leaf?.length).toBe(3);
    expect(Array.isArray(leaf?.value)).toBe(true);
  });

  it("respects the depth cap by emitting the deeper subtree as JSON", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    const flat = flatten(deep, { maxDepth: 3 });
    // a.b.c is at depth 3; one more level should serialize.
    const entry = flat.get("a.b.c");
    expect(entry?.kind).toBe("object");
    expect(typeof entry?.value).toBe("string");
    expect(entry?.value as string).toContain('"d"');
    // No deeper entries should exist.
    expect(flat.has("a.b.c.d")).toBe(false);
    expect(flat.has("a.b.c.d.e")).toBe(false);
  });

  it("excludes entire subtrees when prefixes match", () => {
    const flat = flatten(
      {
        properties: {
          appUris: { documentUri: { value: "sas://signed" } },
          appPlanClassification: "Standard",
        },
        tags: { sienaVersion: "1.2", primaryFormFactor: "Web" },
      },
      {
        excludePrefixes: ["properties.appUris", "tags.sienaVersion"],
      }
    );
    expect(flat.has("properties.appUris.documentUri.value")).toBe(false);
    expect(flat.has("properties.appUris")).toBe(false);
    expect(flat.has("tags.sienaVersion")).toBe(false);
    expect(flat.has("properties.appPlanClassification")).toBe(true);
    expect(flat.has("tags.primaryFormFactor")).toBe(true);
  });

  it("emits empty-object placeholder for {}", () => {
    const flat = flatten({ empty: {}, leaf: 1 });
    const empty = flat.get("empty");
    expect(empty?.kind).toBe("object");
    expect(flat.get("leaf")?.value).toBe(1);
  });

  it("getPath returns undefined for missing paths", () => {
    const flat = flatten({ a: 1 });
    expect(getPath(flat, "missing")).toBeUndefined();
    expect(getPath(flat, "a")).toBe(1);
  });

  it("readPath flattens and reads in one shot", () => {
    expect(readPath({ a: { b: 7 } }, "a.b")).toBe(7);
  });
});
