/**
 * Unit tests for the feature-flag storage layer.
 *
 * The storage layer is intentionally tiny — read / write / key — but
 * it's also the only thing standing between a private-browsing
 * exception and a broken Settings page, so we pin the fallback path
 * explicitly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getStorageKey, readFlag, writeFlag } from "./storage";

describe("getStorageKey", () => {
  it("prefixes the key with the well-known namespace", () => {
    expect(getStorageKey("zones")).toBe("ppcoe.featureFlag.zones");
    expect(getStorageKey("copilotStudioAssistant")).toBe(
      "ppcoe.featureFlag.copilotStudioAssistant",
    );
  });
});

describe("readFlag / writeFlag — happy path", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default when nothing is stored", () => {
    expect(readFlag("zones", false)).toBe(false);
    expect(readFlag("zones", true)).toBe(true);
  });

  it("round-trips `true` and `false` through localStorage", () => {
    writeFlag("zones", true);
    expect(readFlag("zones", false)).toBe(true);
    writeFlag("zones", false);
    expect(readFlag("zones", true)).toBe(false);
  });

  it("treats any stored value that isn't `'true'` as `false`", () => {
    // A user could conceivably hand-edit localStorage; the layer should
    // not crash and should treat unknown blobs as falsy.
    localStorage.setItem(getStorageKey("zones"), "yes");
    expect(readFlag("zones", true)).toBe(false);
  });
});

describe("readFlag / writeFlag — error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the default when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readFlag("zones", true)).toBe(true);
    expect(readFlag("zones", false)).toBe(false);
  });

  it("swallows errors from localStorage.setItem", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeFlag("zones", true)).not.toThrow();
  });
});
