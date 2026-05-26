/**
 * Unit tests for the Zones localStorage layer.
 *
 * Zones are user-defined containers over MS env groups AND Standard
 * custom groups. The non-obvious bits worth pinning are:
 *
 *  - GroupRef ↔ key helpers (and the legacy bare-key migration)
 *  - Zone CRUD + order management + reorderZones contract
 *  - Section CRUD with section-delete → assignment fallback
 *  - Assignment CRUD: set / clear / replaceAll
 *  - deleteZone cascading to assignments
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addSection,
  clearAssignmentsFor,
  createZone,
  customRef,
  deleteSection,
  deleteZone,
  getZone,
  keyToRef,
  listAssignments,
  listZones,
  msRef,
  refToKey,
  renameSection,
  reorderZones,
  replaceAllAssignments,
  setAssignment,
  updateZone,
} from "./zones";

beforeEach(() => {
  localStorage.clear();
});

describe("GroupRef helpers", () => {
  it("msRef / customRef construct typed refs", () => {
    expect(msRef("abc")).toEqual({ kind: "ms", id: "abc" });
    expect(customRef("xyz")).toEqual({ kind: "custom", id: "xyz" });
  });

  it("refToKey round-trips with keyToRef", () => {
    const ref = customRef("xyz");
    expect(keyToRef(refToKey(ref))).toEqual(ref);
  });

  it("keyToRef treats bare keys as legacy MS refs", () => {
    expect(keyToRef("just-a-guid")).toEqual({ kind: "ms", id: "just-a-guid" });
  });
});

describe("Zone CRUD", () => {
  it("createZone increments order for each new zone", () => {
    const z1 = createZone({ name: "A", color: "#000", icon: "🌎" });
    const z2 = createZone({ name: "B", color: "#000", icon: "🌎" });
    const z3 = createZone({ name: "C", color: "#000", icon: "🌎" });
    expect(z1.order).toBe(0);
    expect(z2.order).toBe(1);
    expect(z3.order).toBe(2);
  });

  it("listZones returns rows sorted by `order` ascending", () => {
    createZone({ name: "first", color: "#000", icon: "🌎" });
    createZone({ name: "second", color: "#000", icon: "🌎" });
    const names = listZones().map((z) => z.name);
    expect(names).toEqual(["first", "second"]);
  });

  it("updateZone patches only provided fields and refreshes updatedAt", async () => {
    const z = createZone({ name: "A", color: "#000", icon: "🌎" });
    // Tiny delay so updatedAt comparison is meaningful.
    await new Promise((r) => setTimeout(r, 5));
    const patched = updateZone(z.id, { color: "#fff" });
    expect(patched?.color).toBe("#fff");
    expect(patched?.name).toBe("A");
    expect(patched?.updatedAt).not.toBe(z.updatedAt);
  });

  it("update returns null for unknown ids", () => {
    expect(updateZone("nope", { color: "#fff" })).toBeNull();
  });

  it("createZone trims names and falls back to 'Untitled zone'", () => {
    expect(createZone({ name: "  A  ", color: "#0", icon: "x" }).name).toBe(
      "A",
    );
    expect(createZone({ name: "   ", color: "#0", icon: "x" }).name).toBe(
      "Untitled zone",
    );
  });

  it("deleteZone clears any assignments that pointed at it", () => {
    const z = createZone({ name: "A", color: "#000", icon: "🌎" });
    setAssignment(msRef("env-grp-1"), { zoneId: z.id });
    setAssignment(customRef("custom-grp-1"), { zoneId: z.id });
    expect(Object.keys(listAssignments())).toHaveLength(2);

    deleteZone(z.id);
    expect(getZone(z.id)).toBeNull();
    expect(listAssignments()).toEqual({});
  });
});

describe("reorderZones", () => {
  it("renumbers `order` to match the provided id sequence", () => {
    const a = createZone({ name: "A", color: "#0", icon: "x" });
    const b = createZone({ name: "B", color: "#0", icon: "x" });
    const c = createZone({ name: "C", color: "#0", icon: "x" });
    reorderZones([c.id, a.id, b.id]);
    const order = listZones().map((z) => z.name);
    expect(order).toEqual(["C", "A", "B"]);
  });

  it("appends any zones missing from `orderedIds` at the end", () => {
    createZone({ name: "A", color: "#0", icon: "x" });
    const b = createZone({ name: "B", color: "#0", icon: "x" });
    createZone({ name: "C", color: "#0", icon: "x" });
    reorderZones([b.id]); // c and a are missing
    const order = listZones().map((z) => z.name);
    expect(order[0]).toBe("B");
    expect(order.slice(1).sort()).toEqual(["A", "C"]);
  });
});

describe("Section CRUD", () => {
  it("addSection appends to the zone's sections list", () => {
    const z = createZone({ name: "A", color: "#0", icon: "x" });
    const s = addSection(z.id, "Pillar 1");
    expect(s).not.toBeNull();
    expect(getZone(z.id)?.sections).toHaveLength(1);
    expect(getZone(z.id)?.sections[0].name).toBe("Pillar 1");
  });

  it("addSection returns null for unknown zone", () => {
    expect(addSection("nope", "x")).toBeNull();
  });

  it("renameSection updates the section name", () => {
    const z = createZone({ name: "A", color: "#0", icon: "x" });
    const s = addSection(z.id, "Old");
    renameSection(z.id, s!.id, "New");
    expect(getZone(z.id)?.sections[0].name).toBe("New");
  });

  it("renameSection ignores blank input (keeps current name)", () => {
    const z = createZone({ name: "A", color: "#0", icon: "x" });
    const s = addSection(z.id, "Keep");
    renameSection(z.id, s!.id, "   ");
    expect(getZone(z.id)?.sections[0].name).toBe("Keep");
  });

  it("deleteSection drops the section AND falls assignments back to default lane", () => {
    const z = createZone({ name: "A", color: "#0", icon: "x" });
    const s = addSection(z.id, "Pillar");
    setAssignment(msRef("env-grp-1"), {
      zoneId: z.id,
      sectionId: s!.id,
    });
    expect(listAssignments()["ms:env-grp-1"].sectionId).toBe(s!.id);

    deleteSection(z.id, s!.id);
    expect(getZone(z.id)?.sections).toEqual([]);
    // Assignment is preserved but section is cleared (group remains in zone).
    expect(listAssignments()["ms:env-grp-1"]).toEqual({ zoneId: z.id });
  });
});

describe("Assignment CRUD", () => {
  it("setAssignment writes the keyed entry", () => {
    const z = createZone({ name: "A", color: "#0", icon: "x" });
    setAssignment(msRef("env-grp-1"), { zoneId: z.id });
    expect(listAssignments()).toEqual({
      "ms:env-grp-1": { zoneId: z.id },
    });
  });

  it("setAssignment with null clears the assignment", () => {
    const z = createZone({ name: "A", color: "#0", icon: "x" });
    setAssignment(msRef("env-grp-1"), { zoneId: z.id });
    setAssignment(msRef("env-grp-1"), null);
    expect(listAssignments()).toEqual({});
  });

  it("clearAssignmentsFor removes only the targeted ref", () => {
    const z = createZone({ name: "A", color: "#0", icon: "x" });
    setAssignment(msRef("env-grp-1"), { zoneId: z.id });
    setAssignment(customRef("custom-1"), { zoneId: z.id });
    clearAssignmentsFor(msRef("env-grp-1"));
    expect(listAssignments()).toEqual({
      "custom:custom-1": { zoneId: z.id },
    });
  });

  it("replaceAllAssignments wholesale-swaps the map", () => {
    setAssignment(msRef("a"), { zoneId: "z1" });
    replaceAllAssignments({ "ms:b": { zoneId: "z2" } });
    expect(listAssignments()).toEqual({ "ms:b": { zoneId: "z2" } });
  });
});

describe("legacy bare-key migration", () => {
  it("rewrites bare-id assignment keys to `ms:` prefixed keys on first read", () => {
    localStorage.setItem(
      "ppcoe.zoneAssignments.v1",
      JSON.stringify({
        "legacy-bare-id": { zoneId: "z-legacy" },
        "ms:already-namespaced": { zoneId: "z-new" },
      }),
    );
    const out = listAssignments();
    expect(out).toEqual({
      "ms:legacy-bare-id": { zoneId: "z-legacy" },
      "ms:already-namespaced": { zoneId: "z-new" },
    });
    // The migration also persists, so a second read should be identical.
    expect(listAssignments()).toEqual(out);
  });

  it("returns {} when the assignments blob is non-JSON or wrong shape", () => {
    localStorage.setItem("ppcoe.zoneAssignments.v1", "{not json");
    expect(listAssignments()).toEqual({});
    localStorage.setItem("ppcoe.zoneAssignments.v1", "[]");
    expect(listAssignments()).toEqual({});
  });
});
