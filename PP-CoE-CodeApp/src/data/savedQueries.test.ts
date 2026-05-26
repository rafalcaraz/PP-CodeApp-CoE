/**
 * Unit tests for the saved-queries localStorage CRUD layer.
 *
 * The persistence boundary is small, but it's load-bearing for the
 * Queries view, so we pin the sort, the source-discriminated `spec`
 * field, and the empty-name fallback.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createSavedQuery,
  deleteSavedQuery,
  getSavedQuery,
  listSavedQueries,
  updateSavedQuery,
  type SavedQueryInput,
} from "./savedQueries";
import type { Clause } from "../generated/models/PowerPlatformforAdminsV2Model";
import { ResourceType, type QuerySpec } from "./inventory";

function baseInput(overrides: Partial<SavedQueryInput> = {}): SavedQueryInput {
  return {
    name: "All canvas apps",
    description: "Every canvas app in the tenant",
    source: "builder",
    spec: {
      resourceTypes: [ResourceType.CanvasApp],
      filters: [],
      orderField: "",
      orderDirection: "desc",
      limit: 500,
    } as QuerySpec,
    clauses: [{ $type: "where" } as unknown as Clause],
    ...overrides,
  };
}

describe("saved queries CRUD", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty", () => {
    expect(listSavedQueries()).toEqual([]);
  });

  it("creates a row and exposes it via list / get", () => {
    const q = createSavedQuery(baseInput());
    expect(q.id).toMatch(/^q_/);
    expect(q.createdAt).toBeTruthy();
    expect(q.updatedAt).toBeTruthy();
    expect(listSavedQueries()).toHaveLength(1);
    expect(getSavedQuery(q.id)).toEqual(q);
  });

  it("trims the name and falls back to 'Untitled query'", () => {
    const named = createSavedQuery(baseInput({ name: "  Hello  " }));
    expect(named.name).toBe("Hello");
    const blank = createSavedQuery(baseInput({ name: "   " }));
    expect(blank.name).toBe("Untitled query");
  });

  it("retains `spec` for builder source and drops it for raw source", () => {
    const builder = createSavedQuery(baseInput({ source: "builder" }));
    expect(builder.spec).toBeDefined();
    const raw = createSavedQuery(baseInput({ source: "raw" }));
    expect(raw.spec).toBeUndefined();
  });

  it("sorts list by `updatedAt` descending", async () => {
    // We need millisecond-distinct timestamps for the sort to be
    // observable; tiny awaits make the test deterministic without
    // dragging in fake timers.
    const a = createSavedQuery(baseInput({ name: "first" }));
    await new Promise((r) => setTimeout(r, 5));
    const b = createSavedQuery(baseInput({ name: "second" }));
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateSavedQuery(a.id, { description: "tweaked" });
    expect(updated).not.toBeNull();
    const order = listSavedQueries().map((q) => q.id);
    expect(order[0]).toBe(a.id); // a was updated last
    expect(order[1]).toBe(b.id);
  });

  it("updateSavedQuery returns null for unknown ids", () => {
    expect(updateSavedQuery("nope", { name: "x" })).toBeNull();
  });

  it("update preserves existing name when patch is empty/whitespace", () => {
    const q = createSavedQuery(baseInput({ name: "Original" }));
    const patched = updateSavedQuery(q.id, { name: "   " });
    expect(patched?.name).toBe("Original");
  });

  it("delete removes only the targeted row", () => {
    const a = createSavedQuery(baseInput({ name: "a" }));
    const b = createSavedQuery(baseInput({ name: "b" }));
    deleteSavedQuery(a.id);
    expect(listSavedQueries().map((q) => q.id)).toEqual([b.id]);
  });
});

describe("saved queries — corrupt storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when the blob is non-JSON", () => {
    localStorage.setItem("ppcoe.savedQueries.v1", "{not json");
    expect(listSavedQueries()).toEqual([]);
  });

  it("returns an empty list when the blob is not an array", () => {
    localStorage.setItem("ppcoe.savedQueries.v1", '{"foo":"bar"}');
    expect(listSavedQueries()).toEqual([]);
  });
});
