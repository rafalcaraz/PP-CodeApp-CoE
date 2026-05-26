/**
 * Unit tests for Standard custom groups.
 *
 * Type purity is critical here: a Managed env going into a Standard
 * custom group would lose the "this should be in an MS env group"
 * actionable signal. These tests pin the rejection path plus
 * exclusive env membership and the pruneIneligibleEnvs reconciler.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addEnvToStandardGroup,
  createStandardGroup,
  deleteStandardGroup,
  findStandardGroupForEnv,
  getStandardGroup,
  listStandardGroups,
  pruneIneligibleEnvs,
  removeEnvFromStandardGroup,
  updateStandardGroup,
} from "./standardGroups";

beforeEach(() => {
  localStorage.clear();
});

describe("standardGroups CRUD", () => {
  it("starts empty", () => {
    expect(listStandardGroups()).toEqual([]);
  });

  it("creates a group with defaults applied", () => {
    const g = createStandardGroup({
      displayName: "  My Group  ",
      color: "#ff0000",
      icon: "",
    });
    expect(g.id).toMatch(/^sgrp_/);
    expect(g.displayName).toBe("My Group");
    expect(g.color).toBe("#ff0000");
    expect(g.icon).toBe("📦"); // fallback when blank
    expect(g.envIds).toEqual([]);
  });

  it("createStandardGroup falls back to 'Untitled' for blank names", () => {
    const g = createStandardGroup({
      displayName: "  ",
      color: "#000",
      icon: "🎯",
    });
    expect(g.displayName).toBe("Untitled custom group");
  });

  it("updateStandardGroup patches only provided fields", () => {
    const g = createStandardGroup({
      displayName: "Original",
      color: "#000",
      icon: "🎯",
    });
    const patched = updateStandardGroup(g.id, { color: "#fff" });
    expect(patched?.color).toBe("#fff");
    expect(patched?.displayName).toBe("Original");
  });

  it("update returns null for unknown ids", () => {
    expect(updateStandardGroup("nope", { color: "#fff" })).toBeNull();
  });

  it("delete removes the group", () => {
    const g = createStandardGroup({
      displayName: "G",
      color: "#000",
      icon: "🎯",
    });
    deleteStandardGroup(g.id);
    expect(getStandardGroup(g.id)).toBeNull();
  });
});

describe("env membership rules", () => {
  function newGroup() {
    return createStandardGroup({
      displayName: "G",
      color: "#000",
      icon: "🎯",
    });
  }

  it("rejects Managed envs with a descriptive reason", () => {
    const g = newGroup();
    const result = addEnvToStandardGroup(g.id, {
      id: "env-1",
      isManaged: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Managed/);
    }
    expect(getStandardGroup(g.id)?.envIds).toEqual([]);
  });

  it("rejects an add to a missing group", () => {
    const result = addEnvToStandardGroup("nope", {
      id: "env-1",
      isManaged: false,
    });
    expect(result.ok).toBe(false);
  });

  it("adds a Standard env to the target group", () => {
    const g = newGroup();
    const result = addEnvToStandardGroup(g.id, {
      id: "env-1",
      isManaged: false,
    });
    expect(result.ok).toBe(true);
    expect(getStandardGroup(g.id)?.envIds).toEqual(["env-1"]);
    expect(findStandardGroupForEnv("env-1")?.id).toBe(g.id);
  });

  it("is idempotent — adding the same env twice doesn't duplicate it", () => {
    const g = newGroup();
    addEnvToStandardGroup(g.id, { id: "env-1", isManaged: false });
    addEnvToStandardGroup(g.id, { id: "env-1", isManaged: false });
    expect(getStandardGroup(g.id)?.envIds).toEqual(["env-1"]);
  });

  it("enforces exclusive membership across custom groups", () => {
    const g1 = newGroup();
    const g2 = newGroup();
    addEnvToStandardGroup(g1.id, { id: "env-1", isManaged: false });
    expect(getStandardGroup(g1.id)?.envIds).toEqual(["env-1"]);

    addEnvToStandardGroup(g2.id, { id: "env-1", isManaged: false });
    expect(getStandardGroup(g1.id)?.envIds).toEqual([]); // removed from g1
    expect(getStandardGroup(g2.id)?.envIds).toEqual(["env-1"]);
  });

  it("removeEnvFromStandardGroup drops the env wherever it lives", () => {
    const g = newGroup();
    addEnvToStandardGroup(g.id, { id: "env-1", isManaged: false });
    removeEnvFromStandardGroup("env-1");
    expect(getStandardGroup(g.id)?.envIds).toEqual([]);
  });
});

describe("pruneIneligibleEnvs", () => {
  it("drops envs that no longer exist in the tenant", () => {
    const g = createStandardGroup({
      displayName: "G",
      color: "#000",
      icon: "🎯",
    });
    addEnvToStandardGroup(g.id, { id: "env-still-here", isManaged: false });
    addEnvToStandardGroup(g.id, { id: "env-deleted", isManaged: false });

    pruneIneligibleEnvs(
      new Map([
        ["env-still-here", { id: "env-still-here", isManaged: false }],
        // env-deleted intentionally missing
      ]),
    );
    expect(getStandardGroup(g.id)?.envIds).toEqual(["env-still-here"]);
  });

  it("drops envs that have been upgraded to Managed", () => {
    const g = createStandardGroup({
      displayName: "G",
      color: "#000",
      icon: "🎯",
    });
    addEnvToStandardGroup(g.id, { id: "env-1", isManaged: false });
    addEnvToStandardGroup(g.id, { id: "env-2", isManaged: false });

    pruneIneligibleEnvs(
      new Map([
        ["env-1", { id: "env-1", isManaged: false }],
        ["env-2", { id: "env-2", isManaged: true }], // now Managed
      ]),
    );
    expect(getStandardGroup(g.id)?.envIds).toEqual(["env-1"]);
  });
});

describe("standardGroups — backwards compat", () => {
  it("defaults envIds to [] when reading legacy v2 payloads", () => {
    localStorage.setItem(
      "ppcoe.standardGroups.v1",
      JSON.stringify([
        {
          id: "legacy-1",
          displayName: "Legacy",
          color: "#000",
          icon: "🎯",
          // no envIds, no description, no timestamps
        },
      ]),
    );
    const groups = listStandardGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].envIds).toEqual([]);
    expect(groups[0].description).toBe("");
  });

  it("returns [] when the blob is non-JSON", () => {
    localStorage.setItem("ppcoe.standardGroups.v1", "{not json");
    expect(listStandardGroups()).toEqual([]);
  });
});
