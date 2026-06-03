import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the generated flow service before importing the client.
const runMock = vi.hoisted(() => vi.fn());
vi.mock(
  "../../generated/services/PPLicensingAPI_Wrapper_FlowService",
  () => ({
    PPLicensingAPI_Wrapper_FlowService: { Run: runMock },
  }),
);

import { callLicensing, clearLicensingInflight } from "./client";

const URL_A = "https://licensing.powerplatform.microsoft.com/v1.0/tenants/t/usageData/CopilotStudio/timeseries?x=1";

beforeEach(() => {
  runMock.mockReset();
  clearLicensingInflight();
});

afterEach(() => {
  clearLicensingInflight();
});

describe("callLicensing - input translation", () => {
  it("translates method/url to the cryptic text/text_1 trigger inputs", async () => {
    runMock.mockResolvedValueOnce({ success: true, data: { response: JSON.stringify({ ok: 1 }) } });
    await callLicensing({ method: "GET", url: URL_A });
    expect(runMock).toHaveBeenCalledOnce();
    expect(runMock).toHaveBeenCalledWith({ text: "GET", text_1: URL_A });
  });
});

describe("callLicensing - happy path", () => {
  it("parses a JSON response body and returns {ok:true, data}", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ productCategory: "CopilotStudio", points: [] }) },
    });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res).toEqual({
      ok: true,
      data: { productCategory: "CopilotStudio", points: [] },
    });
  });
});

describe("callLicensing - failure modes", () => {
  it("rejected promise -> ok:false with the error message", async () => {
    runMock.mockRejectedValueOnce(new Error("Network blew up"));
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res).toEqual({ ok: false, error: "Network blew up" });
  });

  it("success:false -> ok:false (uses error message if present)", async () => {
    runMock.mockResolvedValueOnce({ success: false, error: { message: "Connection unauthorized" } });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res).toEqual({ ok: false, error: "Connection unauthorized" });
  });

  it("success:false with no error payload -> generic message", async () => {
    runMock.mockResolvedValueOnce({ success: false });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/success=false/i);
  });

  it("success:true with no data -> empty-response error", async () => {
    runMock.mockResolvedValueOnce({ success: true });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res).toEqual({ ok: false, error: "Empty response from licensing flow" });
  });

  it("success:true with empty response string -> empty-response error", async () => {
    runMock.mockResolvedValueOnce({ success: true, data: { response: "" } });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res).toEqual({ ok: false, error: "Empty response from licensing flow" });
  });

  it("success:true with HTML body -> non-JSON error with preview", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: "<html><body>500 Internal Server Error - upstream failure</body></html>" },
    });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Non-JSON/);
      expect(res.error).toMatch(/500 Internal Server Error/);
    }
  });

  it("success:true with JSON error envelope -> ok:false with envelope message", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: {
        response: JSON.stringify({
          error: { code: "ResourceNotFound", message: "No usage data for resource" },
        }),
      },
    });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res).toEqual({ ok: false, error: "No usage data for resource" });
  });

  it("success:true with statusCode>=400 + message -> formatted HTTP error", async () => {
    runMock.mockResolvedValueOnce({
      success: true,
      data: { response: JSON.stringify({ statusCode: 403, message: "Forbidden" }) },
    });
    const res = await callLicensing({ method: "GET", url: URL_A });
    expect(res).toEqual({ ok: false, error: "HTTP 403: Forbidden" });
  });
});

describe("callLicensing - in-flight dedupe", () => {
  it("two concurrent identical requests merge into one flow invocation", async () => {
    let resolveFn!: (v: { success: boolean; data: { response: string } }) => void;
    runMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    const p1 = callLicensing({ method: "GET", url: URL_A });
    const p2 = callLicensing({ method: "GET", url: URL_A });
    resolveFn({ success: true, data: { response: JSON.stringify({ ok: true }) } });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(runMock).toHaveBeenCalledOnce();
    expect(r1).toEqual({ ok: true, data: { ok: true } });
    expect(r2).toEqual({ ok: true, data: { ok: true } });
  });

  it("different URLs do NOT merge", async () => {
    runMock.mockResolvedValue({ success: true, data: { response: "{}" } });
    await Promise.all([
      callLicensing({ method: "GET", url: URL_A }),
      callLicensing({ method: "GET", url: URL_A + "&y=2" }),
    ]);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it("after the inflight resolves, a subsequent identical call re-invokes the flow", async () => {
    runMock.mockResolvedValueOnce({ success: true, data: { response: "{}" } });
    runMock.mockResolvedValueOnce({ success: true, data: { response: "{}" } });
    await callLicensing({ method: "GET", url: URL_A });
    await callLicensing({ method: "GET", url: URL_A });
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});
