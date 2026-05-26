/**
 * Unit tests for the `admin-apps` source — focused on the skiptoken
 * extraction (the one piece of logic with non-trivial branching) and
 * the page iteration contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAdminAppsMock } = vi.hoisted(() => ({
  getAdminAppsMock: vi.fn(),
}));

vi.mock("../../../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    Get_AdminApps: getAdminAppsMock,
  },
}));

import { adminAppsSource, __test } from "./adminApps";
import type { ScopeUnit } from "./types";

beforeEach(() => {
  getAdminAppsMock.mockReset();
});

describe("extractSkipToken", () => {
  it("returns undefined for missing / blank links", () => {
    expect(__test.extractSkipToken(undefined)).toBeUndefined();
    expect(__test.extractSkipToken("")).toBeUndefined();
  });

  it("extracts a $skiptoken parameter regardless of casing", () => {
    expect(
      __test.extractSkipToken(
        "https://api.example.com/apps?$top=250&$skiptoken=abc123"
      )
    ).toBe("abc123");
    expect(
      __test.extractSkipToken("https://api.example.com/apps?$skipToken=DEF456")
    ).toBe("DEF456");
  });

  it("returns undefined when no skiptoken is present", () => {
    expect(
      __test.extractSkipToken("https://api.example.com/apps?$top=250")
    ).toBeUndefined();
  });

  it("decodes URL-encoded tokens", () => {
    expect(
      __test.extractSkipToken("https://api.example.com/apps?$skiptoken=a%2Bb%3Dc")
    ).toBe("a+b=c");
  });
});

describe("adminAppsSource.fetch", () => {
  const unit: ScopeUnit = { envId: "env-1", envName: "Env 1" };
  const signal = new AbortController().signal;

  it("yields one page when the connector returns no nextLink", async () => {
    getAdminAppsMock.mockResolvedValueOnce({
      success: true,
      data: { value: [{ name: "app-1", properties: { displayName: "App 1" } }] },
    });
    const pages = [];
    for await (const page of adminAppsSource.fetch(unit, signal)) {
      pages.push(page);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0].records).toHaveLength(1);
    expect(pages[0].isLast).toBe(true);
  });

  it("follows the nextLink across multiple pages", async () => {
    getAdminAppsMock
      .mockResolvedValueOnce({
        success: true,
        data: {
          value: [{ name: "app-1" }],
          nextLink: "https://x?$skiptoken=tok2",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { value: [{ name: "app-2" }] },
      });
    const records = [];
    for await (const page of adminAppsSource.fetch(unit, signal)) {
      records.push(...page.records);
    }
    expect(records.map((r) => (r as { name: string }).name)).toEqual([
      "app-1",
      "app-2",
    ]);
    expect(getAdminAppsMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the connector returns success=false", async () => {
    getAdminAppsMock.mockResolvedValueOnce({
      success: false,
      error: { message: "Forbidden", status: 403 },
    });
    await expect(async () => {
      for await (const _page of adminAppsSource.fetch(unit, signal)) {
        void _page;
      }
    }).rejects.toThrow(/Forbidden/);
  });

  it("stops paging when the connector returns a repeating skiptoken", async () => {
    getAdminAppsMock
      .mockResolvedValueOnce({
        success: true,
        data: { value: [{ name: "app-1" }], nextLink: "https://x?$skiptoken=stuck" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { value: [{ name: "app-2" }], nextLink: "https://x?$skiptoken=stuck" },
      });
    const records = [];
    for await (const page of adminAppsSource.fetch(unit, signal)) {
      records.push(...page.records);
    }
    expect(getAdminAppsMock).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(2);
  });
});

describe("adminAppsSource.identify", () => {
  const unit: ScopeUnit = { envId: "env-x" };

  it("returns identity using name + properties.displayName", () => {
    const id = adminAppsSource.identify(
      { name: "abc", properties: { displayName: "App ABC" } },
      unit
    );
    expect(id).toEqual({
      id: "abc",
      environmentId: "env-x",
      displayName: "App ABC",
      resourceType: "microsoft.powerapps/canvasapps",
    });
  });

  it("falls back to name when displayName is missing", () => {
    const id = adminAppsSource.identify({ name: "abc" }, unit);
    expect(id?.displayName).toBe("abc");
  });

  it("returns null when name is missing", () => {
    expect(adminAppsSource.identify({}, unit)).toBeNull();
  });
});
