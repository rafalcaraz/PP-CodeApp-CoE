import { gzipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireCreditReport } from "./client";
import type { ReportJob } from "./types";

const { runFlow, generateV2 } = vi.hoisted(() => ({ runFlow: vi.fn(), generateV2: vi.fn() }));
const { Blob: NodeBlob } = await vi.importActual<{ Blob: typeof Blob }>("node:buffer");
vi.mock("../../generated/services/PP_API_Wrapper_FlowService", () => ({
  PP_API_Wrapper_FlowService: { Run: runFlow },
}));
vi.mock("../../generated/services/PowerPlatformforAdminsV2Service", () => ({
  PowerPlatformforAdminsV2Service: { GenerateLicensingReport: generateV2 },
}));
const name = "FeatureDetailsPerResource";
const range = { startDate: "2026-11-01", endDate: "2026-11-02" };
const base = `https://api.powerplatform.com/copilotstudio/licensing/reports/${name}`;
const location = `${base}/operations/op-1`;
const csv = "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,10,2";
const bytes = gzipSync(strToU8(csv), { mtime: 0 });
const onJob = vi.fn<(job: ReportJob) => void>();
const response = (body: unknown, headers = {}, statusCode = 200) => ({
  success: true, data: { response: JSON.stringify({ statusCode, headers, body }) },
});
const submitted = () => response(null, { Location: location, "Retry-After": "5" }, 202);
const succeeded = () => response({ status: "Succeeded", fileName: "report.csv.gz" });
const file = () => response({
  "$content-type": "application/gzip", $content: btoa(String.fromCharCode(...bytes)),
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
  vi.stubGlobal("Blob", NodeBlob);
  vi.resetAllMocks();
  runFlow.mockResolvedValueOnce(submitted()).mockResolvedValueOnce(succeeded()).mockResolvedValue(file());
});
afterEach(() => {
  expect(generateV2).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
const options = () => ({ name, range, signal: new AbortController().signal, onJob } as const);
const request = (suffix = "") => ({
  text: "GET", text_1: `${base}${suffix}?api-version=2024-10-01`, text_2: "",
});

describe("Power Platform API report lifecycle through the existing flow", () => {
  it("submits once, honors each Retry-After and preserves the gzip file only after Succeeded", async () => {
    runFlow.mockReset().mockResolvedValueOnce(submitted())
      .mockResolvedValueOnce(response({ status: "Running" }, { "retry-after": "9" }))
      .mockResolvedValueOnce(succeeded()).mockResolvedValue(file());
    const pending = acquireCreditReport(options());
    await vi.advanceTimersByTimeAsync(4999);
    expect(runFlow).toHaveBeenCalledExactlyOnceWith({
      text: "POST", text_1: `${base}?api-version=2024-10-01`,
      text_2: JSON.stringify({ ...range, granularity: "Daily" }),
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(runFlow).toHaveBeenNthCalledWith(2, request("/operations/op-1"));
    await vi.advanceTimersByTimeAsync(8999);
    expect(runFlow).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ name, granularity: "Daily", source: "power-platform-api", rows: [{ first: 10, second: 2 }] });
      expect(new Uint8Array(await result.data.original.arrayBuffer())).toEqual(bytes);
    }
    expect(runFlow).toHaveBeenNthCalledWith(4, request("/files/report.csv.gz"));
    expect(runFlow).toHaveBeenCalledTimes(4);
  });
  it("does not invent an operation or fall back to V2 when initial Location is missing", async () => {
    runFlow.mockReset().mockResolvedValue(response(null, { "Retry-After": "5" }, 202));
    const result = await acquireCreditReport(options());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Do not resubmit"), diagnostic: { status: 202 } });
    expect(runFlow).toHaveBeenCalledOnce();
  });
  it("retains a known operation when Retry-After is missing, instead of polling aggressively", async () => {
    runFlow.mockReset().mockResolvedValue(response(null, { location }, 202));
    expect(await acquireCreditReport(options())).toMatchObject({
      ok: false, job: { operationId: "op-1" }, error: expect.stringContaining("Retry-After"),
    });
    expect(runFlow).toHaveBeenCalledOnce();
  });
  it("stops a Running operation with missing retry metadata, keeping its ID for explicit recovery", async () => {
    runFlow.mockReset().mockResolvedValueOnce(submitted()).mockResolvedValue(response({ status: "Running" }));
    const pending = acquireCreditReport(options());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ ok: false, job: { operationId: "op-1" }, error: expect.stringContaining("Retry-After") });
    expect(runFlow).toHaveBeenCalledTimes(2);
  });
  it.each([
    [{ status: "Failed", error: "Generation denied" }, /Generation denied/],
    [{ status: "Succeeded" }, /without a file name/],
    [{ status: "Unknown" }, /Unexpected report status/],
  ])("stops on an invalid/terminal status body %j", async (body, message) => {
    runFlow.mockReset().mockResolvedValueOnce(submitted()).mockResolvedValue(response(body));
    const pending = acquireCreditReport(options());
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
    if (body.status === "Failed") {
      expect(result).toMatchObject({ job: { phase: "failed" } });
      if (!result.ok && result.job) {
        expect(await acquireCreditReport({ ...options(), resume: result.job })).toMatchObject({
          ok: false, error: expect.stringContaining("cannot be resumed"),
        });
      }
    }
    expect(runFlow).toHaveBeenCalledTimes(2);
  });
  it("never automatically retries a rejected/throttled submission", async () => {
    runFlow.mockReset().mockResolvedValue(response("Too many requests", { "Retry-After": "300" }, 429));
    expect(await acquireCreditReport(options())).toMatchObject({ ok: false, error: expect.stringContaining("429") });
    expect(runFlow).toHaveBeenCalledOnce();
  });
  it("surfaces authentication failures without resubmitting or switching transports", async () => {
    runFlow.mockReset().mockResolvedValue({
      success: false, error: { message: "The provided Authorization header is invalid: MISE12034" },
    });
    expect(await acquireCreditReport(options())).toMatchObject({
      ok: false, error: expect.stringContaining("MISE12034"), diagnostic: { ok: false },
    });
    expect(runFlow).toHaveBeenCalledOnce();
  });
  it("can resume a known operation without generating another report and respects saved next-poll time", async () => {
    runFlow.mockReset().mockResolvedValueOnce(succeeded()).mockResolvedValue(file());
    const pending = acquireCreditReport({
      ...options(), resume: { name, range, phase: "waiting", operationId: "existing", nextPollAt: Date.now() + 10_000 },
    });
    await vi.advanceTimersByTimeAsync(9999);
    expect(runFlow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).ok).toBe(true);
    expect(runFlow).toHaveBeenNthCalledWith(1, request("/operations/existing"));
    expect(runFlow.mock.calls.every(([call]) => call.text === "GET")).toBe(true);
  });
  it("stops polling locally when cancelled and can download a known file without submission or status calls", async () => {
    const controller = new AbortController();
    const pending = acquireCreditReport({ ...options(), signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(new Error("Stopped locally"));
    expect(await pending).toMatchObject({ ok: false, cancelled: true, job: { operationId: "op-1" } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runFlow).toHaveBeenCalledOnce();
    runFlow.mockReset().mockResolvedValue(file());
    const resumed = await acquireCreditReport({
      ...options(), resume: { name, range, phase: "downloading", fileName: "known report.csv.gz" },
    });
    expect(resumed.ok).toBe(true);
    expect(runFlow).toHaveBeenCalledExactlyOnceWith(request("/files/known%20report.csv.gz"));
  });
  it("returns promptly if cancelled during an SDK call and does not continue after a late response", async () => {
    let resolve!: (value: unknown) => void;
    runFlow.mockReset().mockImplementation(() => new Promise((finish) => { resolve = finish; }));
    const controller = new AbortController();
    const pending = acquireCreditReport({ ...options(), signal: controller.signal });
    controller.abort(new Error("Stopped"));
    expect(await pending).toMatchObject({ ok: false, cancelled: true });
    resolve(submitted());
    await vi.advanceTimersByTimeAsync(5000);
    expect(runFlow).toHaveBeenCalledOnce();
  });
  it("retains the file name on parse failure for retrying download, without retaining its binary body", async () => {
    runFlow.mockReset().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(succeeded())
      .mockResolvedValue(response("not a report"));
    const pending = acquireCreditReport(options());
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ ok: false, job: { fileName: "report.csv.gz" }, diagnostic: undefined });
  });
  it("surfaces a flow that returns body-only output without fabricating headers", async () => {
    runFlow.mockReset().mockResolvedValue({ success: true, data: { response: '{"success":true}' } });
    expect(await acquireCreditReport(options())).toMatchObject({ ok: false, error: expect.stringContaining("Location") });
    expect(runFlow).toHaveBeenCalledOnce();
  });
  it("times out without polling earlier than a service interval or submitting another report", async () => {
    runFlow.mockReset().mockResolvedValue(response(null, { location, "Retry-After": "3000000" }, 202));
    const pending = acquireCreditReport(options());
    await vi.advanceTimersByTimeAsync(7_200_000);
    expect(await pending).toMatchObject({ ok: false, job: { operationId: "op-1" }, error: expect.stringContaining("timed out") });
    expect(runFlow).toHaveBeenCalledOnce();
  });
});
