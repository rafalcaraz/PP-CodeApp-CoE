/**
 * Tests for `userEnrichment.ts` — the GUID → user resolver against the
 * Dataverse `aaduser` virtual table.
 *
 * Mocks `AadusersService.get` directly. The five owner-resolution
 * outcomes from `docs/inventory-schema-samples.md` map onto this
 * suite as follows:
 *
 *   1. Member user      → success with `usertype: "Member"`
 *   2. Guest user       → success with `usertype: "Guest"`
 *   3. Deleted user     → 404 `Request_ResourceNotFound` → cache as null
 *   4. Service principal → 404 `Request_ResourceNotFound` → cache as null
 *   5. Managed identity  → 404 `Request_ResourceNotFound` → cache as null
 *
 * Outcomes 3/4/5 are indistinguishable from this layer — they all
 * come back as the same "no aaduser record" miss. The resolver's
 * documented contract is to surface that as `null`, NOT as an error,
 * so the UI can display neutral wording instead of guessing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { aadGetMock } = vi.hoisted(() => ({ aadGetMock: vi.fn() }));

vi.mock("../generated", () => ({
  AadusersService: { get: aadGetMock },
}));

import {
  clearUserCache,
  lookupUser,
  peekUser,
  resolveUser,
  resolveUsers,
  subscribeUser,
  userCacheStats,
} from "./userEnrichment";

const MEMBER_GUID = "11111111-2222-3333-4444-555555555551";
const GUEST_GUID = "11111111-2222-3333-4444-555555555552";
const MISSING_GUID = "11111111-2222-3333-4444-55555555555f";

function memberRow(id = MEMBER_GUID) {
  return {
    aaduserid: id,
    displayname: "Alice Maker",
    userprincipalname: "alice@contoso.example",
    mail: "alice@contoso.example",
    accountenabled: true,
    jobtitle: "Senior Engineer",
    usertype: "Member",
  };
}

function guestRow(id = GUEST_GUID) {
  return {
    aaduserid: id,
    displayname: "Bob Partner",
    userprincipalname: "bob_partner.com#EXT#@contoso.onmicrosoft.com",
    mail: "bob@partner.com",
    accountenabled: true,
    jobtitle: "Consultant",
    usertype: "Guest",
  };
}

function notFoundError() {
  return {
    message:
      "An unexpected error occurred from the ISV code. (ErrorType = ClientError). " +
      "Detail: Microsoft.Crm.CrmException: Request_ResourceNotFound: " +
      "Resource '11111111-...' does not exist or one of its queried " +
      "reference-property objects are not present.",
  };
}

beforeEach(() => {
  aadGetMock.mockReset();
  clearUserCache();
});

// ---------------------------------------------------------------------------
// Input validation — never hits the network for garbage input
// ---------------------------------------------------------------------------

describe("resolveUser — input validation", () => {
  it("returns null for empty / undefined / null without any network call", async () => {
    expect(await resolveUser("")).toBeNull();
    expect(await resolveUser(undefined)).toBeNull();
    expect(await resolveUser(null)).toBeNull();
    expect(aadGetMock).not.toHaveBeenCalled();
  });

  it("returns null for non-GUID-shaped input without a network call", async () => {
    expect(await resolveUser("not-a-guid")).toBeNull();
    expect(await resolveUser("123")).toBeNull();
    expect(aadGetMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Outcome 1 + 2 — Member / Guest users
// ---------------------------------------------------------------------------

describe("resolveUser — Member user (outcome 1)", () => {
  it("returns a typed UserRef and caches it", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    const ref = await resolveUser(MEMBER_GUID);
    expect(ref).not.toBeNull();
    expect(ref?.id).toBe(MEMBER_GUID);
    expect(ref?.displayName).toBe("Alice Maker");
    expect(ref?.userType).toBe("Member");
    expect(ref?.enabled).toBe(true);
  });

  it("returns the same cached value on a second call without re-querying", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    await resolveUser(MEMBER_GUID);
    await resolveUser(MEMBER_GUID);
    expect(aadGetMock).toHaveBeenCalledTimes(1);
  });

  it("treats GUID input with braces / uppercase as the same cache key", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    await resolveUser(MEMBER_GUID);
    await resolveUser(`{${MEMBER_GUID.toUpperCase()}}`);
    expect(aadGetMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveUser — Guest user (outcome 2)", () => {
  it("returns the guest's UserRef with userType=Guest preserved", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: guestRow() });
    const ref = await resolveUser(GUEST_GUID);
    expect(ref?.userType).toBe("Guest");
  });
});

// ---------------------------------------------------------------------------
// Outcome 3/4/5 — Deleted / SPN / Managed identity (all "not found")
// ---------------------------------------------------------------------------

describe("resolveUser — `aaduser` miss (outcomes 3/4/5)", () => {
  it("returns null when the connector reports `Request_ResourceNotFound`", async () => {
    aadGetMock.mockResolvedValue({ success: false, error: notFoundError() });
    expect(await resolveUser(MISSING_GUID)).toBeNull();
  });

  it("caches the null (negative caching) — second call doesn't re-query", async () => {
    aadGetMock.mockResolvedValue({ success: false, error: notFoundError() });
    await resolveUser(MISSING_GUID);
    await resolveUser(MISSING_GUID);
    expect(aadGetMock).toHaveBeenCalledTimes(1);
  });

  it("detects 404 wrappers thrown as exceptions, not just success:false", async () => {
    aadGetMock.mockRejectedValue(
      new Error("HTTP 404 (Not Found) — Request_ResourceNotFound"),
    );
    expect(await resolveUser(MISSING_GUID)).toBeNull();
  });

  it("treats `success:true` with no `data` as a miss (cached null)", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: undefined });
    expect(await resolveUser(MISSING_GUID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Other errors — rejected, NOT cached
// ---------------------------------------------------------------------------

describe("resolveUser — transport errors", () => {
  it("rejects (does not cache) on non-404 errors", async () => {
    aadGetMock.mockResolvedValue({
      success: false,
      error: { message: "Service unavailable" },
    });
    await expect(resolveUser(MISSING_GUID)).rejects.toThrow(
      /Service unavailable/,
    );
  });
});

// ---------------------------------------------------------------------------
// resolveUsers — bulk
// ---------------------------------------------------------------------------

describe("resolveUsers — bulk", () => {
  it("returns a map keyed by the ORIGINAL ids the caller passed in", async () => {
    aadGetMock.mockImplementation(async (g: string) => {
      if (g.toLowerCase() === MEMBER_GUID) {
        return { success: true, data: memberRow() };
      }
      return { success: false, error: notFoundError() };
    });

    const out = await resolveUsers([
      `{${MEMBER_GUID.toUpperCase()}}`, // braces + uppercase
      MISSING_GUID,
      "not-a-guid",
    ]);
    // Original-input keys preserved (no normalization on the map keys).
    expect(out.get(`{${MEMBER_GUID.toUpperCase()}}`)?.displayName).toBe(
      "Alice Maker",
    );
    expect(out.get(MISSING_GUID)).toBeNull();
    expect(out.get("not-a-guid")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lookupUser — DataResult wrapper
// ---------------------------------------------------------------------------

describe("lookupUser — DataResult wrapper", () => {
  it("returns ok:false for empty / whitespace input", async () => {
    const r = await lookupUser("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Enter a GUID/);
  });

  it("returns ok:false for non-GUID input (no network call)", async () => {
    const r = await lookupUser("not-a-guid");
    expect(r.ok).toBe(false);
    expect(aadGetMock).not.toHaveBeenCalled();
  });

  it("returns ok:true + data on success", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    const r = await lookupUser(MEMBER_GUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data?.displayName).toBe("Alice Maker");
  });

  it("returns ok:true + data:null for a 404", async () => {
    aadGetMock.mockResolvedValue({ success: false, error: notFoundError() });
    const r = await lookupUser(MISSING_GUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// peekUser — synchronous cache read for hooks
// ---------------------------------------------------------------------------

describe("peekUser — synchronous cache read", () => {
  it("returns `unknown` for never-seen GUIDs and for garbage input", () => {
    expect(peekUser(undefined).status).toBe("unknown");
    expect(peekUser("not-a-guid").status).toBe("unknown");
    expect(peekUser(MEMBER_GUID).status).toBe("unknown");
  });

  it("returns `resolved` after a successful resolve", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    await resolveUser(MEMBER_GUID);
    const entry = peekUser(MEMBER_GUID);
    expect(entry.status).toBe("resolved");
    if (entry.status !== "resolved") return;
    expect(entry.user.displayName).toBe("Alice Maker");
  });

  it("returns `missing` after a 404", async () => {
    aadGetMock.mockResolvedValue({ success: false, error: notFoundError() });
    await resolveUser(MISSING_GUID);
    expect(peekUser(MISSING_GUID).status).toBe("missing");
  });

  it("returns the same object reference across calls when the underlying state is unchanged", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    await resolveUser(MEMBER_GUID);
    const a = peekUser(MEMBER_GUID);
    const b = peekUser(MEMBER_GUID);
    expect(a).toBe(b); // identity-stable — required by useSyncExternalStore
  });
});

// ---------------------------------------------------------------------------
// subscribeUser — per-id reactivity
// ---------------------------------------------------------------------------

describe("subscribeUser — per-id reactivity", () => {
  it("fires the callback when the cache entry for that GUID lands", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    const cb = vi.fn();
    const unsubscribe = subscribeUser(MEMBER_GUID, cb);
    await resolveUser(MEMBER_GUID);
    expect(cb).toHaveBeenCalled();
    unsubscribe();
  });

  it("returns a no-op unsubscribe for invalid input", () => {
    expect(() => subscribeUser("", () => {})()).not.toThrow();
    expect(() => subscribeUser("not-a-guid", () => {})()).not.toThrow();
  });

  it("does NOT fire callbacks for OTHER GUIDs' cache writes", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    const cb = vi.fn();
    const unsubscribe = subscribeUser(GUEST_GUID, cb);
    await resolveUser(MEMBER_GUID); // resolves a different GUID
    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// userCacheStats + clearUserCache
// ---------------------------------------------------------------------------

describe("userCacheStats + clearUserCache", () => {
  it("counts resolved vs missing", async () => {
    aadGetMock
      .mockResolvedValueOnce({ success: true, data: memberRow() })
      .mockResolvedValueOnce({ success: false, error: notFoundError() });
    await resolveUser(MEMBER_GUID);
    await resolveUser(MISSING_GUID);
    expect(userCacheStats()).toEqual({ resolved: 1, missing: 1 });
  });

  it("clearUserCache empties everything and lets a re-query happen", async () => {
    aadGetMock.mockResolvedValue({ success: true, data: memberRow() });
    await resolveUser(MEMBER_GUID);
    expect(aadGetMock).toHaveBeenCalledTimes(1);

    clearUserCache();
    expect(userCacheStats()).toEqual({ resolved: 0, missing: 0 });

    await resolveUser(MEMBER_GUID);
    expect(aadGetMock).toHaveBeenCalledTimes(2);
  });
});
