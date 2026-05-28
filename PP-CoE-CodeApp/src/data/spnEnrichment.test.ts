/**
 * Tests for `spnEnrichment.ts` — the GUID → service-principal resolver
 * against Microsoft Graph via the preauthorized HTTP connector.
 *
 * Mocks `HTTPwithMicrosoftEntraID_preauthorized_Service.InvokeHttp`
 * with response envelopes shaped like the runtime actually returns
 * (`{ statusCode, headers, body }`). Both 200/404/error paths and the
 * batch `directoryObjects/getByIds` semantics are covered.
 *
 * Coverage:
 *   - Pure `classifyServicePrincipal` rule (first-party, tenant, managed-identity, social, legacy, unknown)
 *   - Single-id success → cached
 *   - Single-id 404 → negative-cached as null
 *   - Single-id transport error → not cached
 *   - Cache hit → no network call
 *   - Bulk: classifies returned SPs + negative-caches missing ids
 *   - Bulk: respects existing cache (no re-fetch for cached ids)
 *   - Bulk: chunks above 1000 into multiple parallel calls
 *   - fetchServicePrincipalOwners: parses user vs SP owners
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeHttpMock } = vi.hoisted(() => ({
  invokeHttpMock: vi.fn(),
}));

vi.mock(
  "../generated/services/HTTPwithMicrosoftEntraID_preauthorized_Service",
  () => ({
    HTTPwithMicrosoftEntraID_preauthorized_Service: {
      InvokeHttp: invokeHttpMock,
    },
  }),
);

import {
  classifyServicePrincipal,
  clearServicePrincipalCache,
  fetchServicePrincipalOwners,
  MICROSOFT_TENANT_ID,
  peekServicePrincipal,
  resolveServicePrincipal,
  resolveServicePrincipals,
} from "./spnEnrichment";

// ─── Helpers ──────────────────────────────────────────────────────────────

const SP_ID = "ebf8f8e2-3358-49e6-980f-d2fd6e5f5317";
const SP_ID_2 = "11111111-1111-1111-1111-111111111111";
const SP_ID_MS = "22222222-2222-2222-2222-222222222222";
const SP_ID_MISSING = "33333333-3333-3333-3333-333333333333";
const TENANT_ID = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";

function okResponse<T>(body: T, statusCode = 200) {
  return {
    success: true,
    data: { statusCode, headers: {}, body },
  };
}

function notFoundResponse() {
  return {
    success: true,
    data: {
      statusCode: 404,
      headers: {},
      body: { error: { code: "Request_ResourceNotFound", message: "..." } },
    },
  };
}

function failResponse(message: string) {
  return { success: false, error: new Error(message) };
}

function rawSp(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: `SP ${id}`,
    appId: "9251fced-28ed-43b2-bd22-cb9e3924de8f",
    servicePrincipalType: "Application",
    appOwnerOrganizationId: TENANT_ID,
    accountEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  invokeHttpMock.mockReset();
  clearServicePrincipalCache();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("classifyServicePrincipal (pure rule)", () => {
  it("classifies Microsoft-owned SPs as first-party", () => {
    expect(
      classifyServicePrincipal({
        appOwnerOrganizationId: MICROSOFT_TENANT_ID,
        servicePrincipalType: "Application",
      }),
    ).toBe("first-party");
  });

  it("classifies managed identities by type, regardless of tenant", () => {
    expect(
      classifyServicePrincipal({
        appOwnerOrganizationId: TENANT_ID,
        servicePrincipalType: "ManagedIdentity",
      }),
    ).toBe("managed-identity");
  });

  it("classifies in/cross-tenant Application SPs as tenant", () => {
    expect(
      classifyServicePrincipal({
        appOwnerOrganizationId: TENANT_ID,
        servicePrincipalType: "Application",
      }),
    ).toBe("tenant");
  });

  it("classifies Legacy and SocialIdp types distinctly", () => {
    expect(
      classifyServicePrincipal({
        appOwnerOrganizationId: TENANT_ID,
        servicePrincipalType: "Legacy",
      }),
    ).toBe("legacy");
    expect(
      classifyServicePrincipal({
        appOwnerOrganizationId: null,
        servicePrincipalType: "SocialIdp",
      }),
    ).toBe("social-idp");
  });

  it("falls back to unknown when neither tenant nor type discriminates", () => {
    expect(
      classifyServicePrincipal({
        appOwnerOrganizationId: null,
        servicePrincipalType: "",
      }),
    ).toBe("unknown");
  });

  it("Microsoft-tenant check is case-insensitive", () => {
    expect(
      classifyServicePrincipal({
        appOwnerOrganizationId: MICROSOFT_TENANT_ID.toUpperCase(),
        servicePrincipalType: "Application",
      }),
    ).toBe("first-party");
  });
});

describe("resolveServicePrincipal (single)", () => {
  it("fetches, caches, and returns a typed SP ref on success", async () => {
    invokeHttpMock.mockResolvedValueOnce(okResponse(rawSp(SP_ID)));

    const result = await resolveServicePrincipal(SP_ID);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(SP_ID);
    expect(result!.displayName).toBe(`SP ${SP_ID}`);
    expect(result!.kind).toBe("tenant");

    // Second call: cache hit, no extra network call.
    const second = await resolveServicePrincipal(SP_ID);
    expect(second).toBe(result);
    expect(invokeHttpMock).toHaveBeenCalledTimes(1);
  });

  it("returns null and negative-caches on a 404 envelope", async () => {
    invokeHttpMock.mockResolvedValueOnce(notFoundResponse());

    const result = await resolveServicePrincipal(SP_ID_MISSING);
    expect(result).toBeNull();
    expect(peekServicePrincipal(SP_ID_MISSING)).toBeNull();

    // Cache hit → no second call.
    await resolveServicePrincipal(SP_ID_MISSING);
    expect(invokeHttpMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the runtime surfaces 404 as success:false with a 'not found' message", async () => {
    invokeHttpMock.mockResolvedValueOnce(
      failResponse("HTTP 404 (Not Found): Request_ResourceNotFound"),
    );

    const result = await resolveServicePrincipal(SP_ID_MISSING);
    expect(result).toBeNull();
  });

  it("rejects (doesn't cache) on a transport error so the next call can retry", async () => {
    invokeHttpMock.mockResolvedValueOnce(
      failResponse("HTTP 500 — Internal Server Error"),
    );

    await expect(resolveServicePrincipal(SP_ID)).rejects.toThrow(
      /Internal Server Error/,
    );
    // Next call retries (no cache entry, no inflight).
    invokeHttpMock.mockResolvedValueOnce(okResponse(rawSp(SP_ID)));
    const retried = await resolveServicePrincipal(SP_ID);
    expect(retried).not.toBeNull();
    expect(invokeHttpMock).toHaveBeenCalledTimes(2);
  });

  it("short-circuits empty / non-GUID input without a network call", async () => {
    expect(await resolveServicePrincipal(null)).toBeNull();
    expect(await resolveServicePrincipal("")).toBeNull();
    expect(await resolveServicePrincipal("not-a-guid")).toBeNull();
    expect(invokeHttpMock).not.toHaveBeenCalled();
  });

  it("dedupes concurrent requests for the same id into a single call", async () => {
    let release: ((v: unknown) => void) | null = null;
    invokeHttpMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(okResponse(rawSp(SP_ID)));
        }),
    );

    const p1 = resolveServicePrincipal(SP_ID);
    const p2 = resolveServicePrincipal(SP_ID);
    expect(invokeHttpMock).toHaveBeenCalledTimes(1);
    release!(null);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });
});

describe("resolveServicePrincipals (bulk)", () => {
  it("classifies returned SPs and negative-caches missing ids in one batch call", async () => {
    invokeHttpMock.mockResolvedValueOnce(
      okResponse({
        value: [
          rawSp(SP_ID),
          rawSp(SP_ID_MS, { appOwnerOrganizationId: MICROSOFT_TENANT_ID }),
        ],
      }),
    );

    const result = await resolveServicePrincipals([SP_ID, SP_ID_MS, SP_ID_MISSING]);
    expect(invokeHttpMock).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(3);
    expect(result.get(SP_ID)!.kind).toBe("tenant");
    expect(result.get(SP_ID_MS)!.kind).toBe("first-party");
    expect(result.get(SP_ID_MISSING)).toBeNull();

    // Subsequent lookups hit cache (including the missing one).
    expect(peekServicePrincipal(SP_ID_MISSING)).toBeNull();
  });

  it("calls Graph getByIds with types=['servicePrincipal'] and type-cast $select", async () => {
    invokeHttpMock.mockResolvedValueOnce(okResponse({ value: [] }));
    await resolveServicePrincipals([SP_ID]);

    const call = invokeHttpMock.mock.calls[0][0];
    expect(call.method).toBe("POST");
    expect(call.url).toContain("/directoryObjects/getByIds");
    // Type-cast $select is REQUIRED on /directoryObjects/getByIds —
    // SP-derived fields without the cast cause Graph to silently
    // return value:[] for the whole batch. Pin this contract.
    expect(call.url).toContain(
      "microsoft.graph.servicePrincipal/displayName",
    );
    expect(call.url).toContain(
      "microsoft.graph.servicePrincipal/appOwnerOrganizationId",
    );
    const body = JSON.parse(call.body);
    expect(body.types).toEqual(["servicePrincipal"]);
    expect(body.ids).toEqual([SP_ID]);
  });

  it("skips ids that are already in the cache (positive or negative)", async () => {
    // Prime the cache with one positive + one negative entry.
    invokeHttpMock.mockResolvedValueOnce(okResponse(rawSp(SP_ID)));
    await resolveServicePrincipal(SP_ID);
    invokeHttpMock.mockResolvedValueOnce(notFoundResponse());
    await resolveServicePrincipal(SP_ID_MISSING);
    invokeHttpMock.mockReset();

    // Bulk lookup of the same two ids should not hit the network.
    const result = await resolveServicePrincipals([SP_ID, SP_ID_MISSING]);
    expect(invokeHttpMock).not.toHaveBeenCalled();
    expect(result.get(SP_ID)!.id).toBe(SP_ID);
    expect(result.get(SP_ID_MISSING)).toBeNull();
  });

  it("chunks above the 1000-id limit into multiple batches", async () => {
    // 2500 ids → expect 3 batch calls (1000, 1000, 500).
    const ids: string[] = [];
    for (let i = 0; i < 2500; i++) {
      const hex = i.toString(16).padStart(12, "0");
      ids.push(`44444444-4444-4444-4444-${hex}`);
    }
    invokeHttpMock.mockResolvedValue(okResponse({ value: [] }));

    await resolveServicePrincipals(ids);
    expect(invokeHttpMock).toHaveBeenCalledTimes(3);
    const sizes = invokeHttpMock.mock.calls.map(
      (c) => JSON.parse(c[0].body).ids.length,
    );
    expect(sizes.sort((a, b) => a - b)).toEqual([500, 1000, 1000]);
  });

  it("preserves the original input id formatting in the result Map", async () => {
    // Caller passes uppercase + brace-wrapped — output Map must key by
    // the original raw strings, not normalized forms.
    invokeHttpMock.mockResolvedValueOnce(okResponse({ value: [rawSp(SP_ID)] }));

    const uppercase = SP_ID.toUpperCase();
    const braced = `{${SP_ID}}`;
    const result = await resolveServicePrincipals([uppercase, braced]);
    expect(result.get(uppercase)).not.toBeNull();
    expect(result.get(braced)).not.toBeNull();
  });
});

describe("fetchServicePrincipalOwners", () => {
  it("returns a parsed list of owner refs discriminating users from SPs", async () => {
    invokeHttpMock.mockResolvedValueOnce(
      okResponse({
        ...rawSp(SP_ID),
        owners: [
          {
            "@odata.type": "#microsoft.graph.user",
            id: "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
            displayName: "Rafael Lopez Alcaraz",
            mail: "rafael@example.com",
            accountEnabled: true,
            deletedDateTime: null,
          },
          {
            "@odata.type": "#microsoft.graph.servicePrincipal",
            id: SP_ID_2,
            displayName: "Some nested SP",
          },
        ],
      }),
    );

    const res = await fetchServicePrincipalOwners(SP_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(2);
    expect(res.data[0].type).toBe("user");
    expect(res.data[0].displayName).toBe("Rafael Lopez Alcaraz");
    expect(res.data[1].type).toBe("servicePrincipal");
  });

  it("returns an empty array when the SP has no owners", async () => {
    invokeHttpMock.mockResolvedValueOnce(
      okResponse({ ...rawSp(SP_ID), owners: [] }),
    );
    const res = await fetchServicePrincipalOwners(SP_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([]);
  });

  it("returns an empty array when the SP itself can't be fetched (404)", async () => {
    invokeHttpMock.mockResolvedValueOnce(notFoundResponse());
    const res = await fetchServicePrincipalOwners(SP_ID_MISSING);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([]);
  });

  it("rejects non-GUID input without a network call", async () => {
    const res = await fetchServicePrincipalOwners("not-a-guid");
    expect(res.ok).toBe(false);
    expect(invokeHttpMock).not.toHaveBeenCalled();
  });
});
