import { describe, it, expect, vi, beforeEach } from "vitest";

const { getEnvironmentAdminDetails } = vi.hoisted(() => ({
  getEnvironmentAdminDetails: vi.fn(),
}));
vi.mock("./data", () => ({ getEnvironmentAdminDetails }));

import { resolveEnvironmentOrgUrl, clearOrgUrlCache } from "./orgUrl";

beforeEach(() => {
  clearOrgUrlCache();
  getEnvironmentAdminDetails.mockReset();
});

describe("resolveEnvironmentOrgUrl", () => {
  it("returns null for an empty environment id without calling the admin API", async () => {
    expect(await resolveEnvironmentOrgUrl("  ")).toBeNull();
    expect(getEnvironmentAdminDetails).not.toHaveBeenCalled();
  });

  it("resolves the org URL from the admin environment payload", async () => {
    getEnvironmentAdminDetails.mockResolvedValue({
      ok: true,
      data: { data: { url: "https://contoso.crm.dynamics.com" }, raw: {} },
    });
    expect(await resolveEnvironmentOrgUrl("env-1")).toBe(
      "https://contoso.crm.dynamics.com",
    );
  });

  it("returns null when the admin call fails", async () => {
    getEnvironmentAdminDetails.mockResolvedValue({ ok: false, error: "boom" });
    expect(await resolveEnvironmentOrgUrl("env-1")).toBeNull();
  });

  it("returns null when the payload has no url", async () => {
    getEnvironmentAdminDetails.mockResolvedValue({
      ok: true,
      data: { data: {}, raw: {} },
    });
    expect(await resolveEnvironmentOrgUrl("env-1")).toBeNull();
  });

  it("memoizes per environment id (only one admin call)", async () => {
    getEnvironmentAdminDetails.mockResolvedValue({
      ok: true,
      data: { data: { url: "https://x.crm.dynamics.com" }, raw: {} },
    });
    const [a, b] = await Promise.all([
      resolveEnvironmentOrgUrl("env-1"),
      resolveEnvironmentOrgUrl("env-1"),
    ]);
    expect(a).toBe("https://x.crm.dynamics.com");
    expect(b).toBe("https://x.crm.dynamics.com");
    expect(getEnvironmentAdminDetails).toHaveBeenCalledOnce();
  });
});
