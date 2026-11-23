import { describe, expect, it } from "vitest";
import { exposedResponseHeaders } from "./responseHeaders";

describe("exposedResponseHeaders", () => {
  it("preserves header names and values from SDK, HTTP and error envelopes", () => {
    const headers = { Location: "/operations/example", "Retry-After": "15", ETag: 'W/"7"' };
    for (const result of [
      { headers },
      { success: true, data: { statusCode: 202, headers, body: null } },
      { success: true, data: { status: 202, headers } },
      { response: { headers } },
      { success: false, error: { response: { headers } } },
      { success: false, error: { headers } },
    ]) expect(exposedResponseHeaders(result)).toBe(headers);
    expect(exposedResponseHeaders({ headers: {} })).toEqual({});
  });

  it("does not mistake business payload fields, request headers or nested rows for HTTP headers", () => {
    for (const result of [
      undefined, null, [], "text", { success: true, data: { value: [] } },
      { success: true, data: { headers: { business: "data" } } },
      { request: { headers: { Authorization: "not-a-response-header" } } },
      { data: { value: [{ statusCode: 200, headers: { row: "data" } }] } },
    ]) expect(exposedResponseHeaders(result)).toBeUndefined();
  });
});
