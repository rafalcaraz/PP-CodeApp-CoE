import { gzipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireCreditReport } from "./client";
import { createConnectorReportTransport, powerPlatformApiReportTransport } from "./transport";
import type { ReportJob } from "./types";

const { runFlow, generateV2, pollV2, downloadV2, requestReport, downloadReport } = vi.hoisted(() => ({
  runFlow: vi.fn(), generateV2: vi.fn(), pollV2: vi.fn(), downloadV2: vi.fn(), requestReport: vi.fn(), downloadReport: vi.fn(),
}));
const { Blob: NodeBlob } = await vi.importActual<{ Blob: typeof Blob }>("node:buffer");
vi.mock("../../generated/services/PP_API_Wrapper_FlowService", () => ({
  PP_API_Wrapper_FlowService: { Run: runFlow },
}));
vi.mock("../../generated/services/PP_Request_Credit_Licensing_ReportService", () => ({
  PP_Request_Credit_Licensing_ReportService: { Run: requestReport },
}));
vi.mock("../../generated/services/PP_Download_Credit_Licensing_ReportService", () => ({
  PP_Download_Credit_Licensing_ReportService: { Run: downloadReport },
}));
vi.mock("../../generated/services/PowerPlatformforAdminsV2Service", () => ({
  PowerPlatformforAdminsV2Service: {
    GenerateLicensingReport: generateV2,
    GetLicensingReportOperation: pollV2,
    DownloadLicensingReportFile: downloadV2,
  },
}));
const name = "FeatureDetailsPerResource";
const range = { startDate: "2026-11-01", endDate: "2026-11-02" };
const base = `https://api.powerplatform.com/copilotstudio/licensing/reports/${name}`;
const location = `${base}/operations/op-1`;
const gatewayBase = "https://synthetic-env.02.common.usa002.azure-apihub.net/apim/powerplatformadminv2/synthetic-connection";
const gatewayLocation = `${gatewayBase}/copilotstudio/licensing/reports/${name}/operations/op-1?api-version=2024-10-01`;
const csv = "ConsumptionDate,BilledCredits,NonBilledCredits\n2026-11-01,10,2";
const bytes = gzipSync(strToU8(csv), { mtime: 0 });
const onJob = vi.fn<(job: ReportJob) => void>();
const response = (body: unknown, headers = {}, statusCode = 200) => ({
  success: true, data: { response: JSON.stringify({ statusCode, headers, body }) },
});

describe("generation-flow / Admins V2 transport", () => {
  it.each([location, gatewayLocation])("uses the registered generation flow and polls the operation from %s", async (reportlocation) => {
    requestReport.mockResolvedValue({ success: true, data: { reportlocation } });
    pollV2.mockResolvedValue({ success: true, data: { status: "Succeeded", fileName: "report.csv" } });
    downloadReport.mockResolvedValue({ success: true, data: { result: csv } });
    const pending = acquireCreditReport({ name, range, signal: new AbortController().signal, onJob });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(requestReport).toHaveBeenCalledExactlyOnceWith({
      text: name, text_1: range.endDate, text_2: range.startDate, text_3: "Daily",
    });
    expect(pollV2).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: true, data: { source: "connector" } });
    expect(pollV2).toHaveBeenCalledExactlyOnceWith(name, "op-1", "2024-10-01");
    expect(downloadReport).toHaveBeenCalledExactlyOnceWith({ text: name, text_1: "report.csv" });
    expect(runFlow).not.toHaveBeenCalled();
  });
  it.each([
    [{ success: true, data: { reportlocation: "Report generation denied" } }, "Report generation denied"],
    [{ success: true, data: {} }, "no reportlocation"],
    [{ success: false, error: { message: "Flow request failed" } }, "Flow request failed"],
  ])("surfaces the generation flow failure %j without polling or resubmitting", async (response, error) => {
    requestReport.mockResolvedValue(response);
    expect(await acquireCreditReport({
      name, range, signal: new AbortController().signal, onJob,
    })).toMatchObject({ ok: false, error: expect.stringContaining(error) });
    expect(requestReport).toHaveBeenCalledOnce();
    expect(pollV2).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });
  it.each(["FeatureDetailsPerResource", "BillingDetailsPerEnvironment"] as const)(
    "submits %s through the supplied flow, polls V2 and downloads through the registered CSV flow",
    async (reportName) => {
      const generate = vi.fn().mockResolvedValue({
        location: `${gatewayBase}/copilotstudio/licensing/reports/${reportName}/operations/flow-op?api-version=2024-10-01`,
      });
      pollV2.mockResolvedValueOnce({
        success: true, data: { status: "Running" }, headers: { "retry-after": "45" },
      }).mockResolvedValue({
        success: true, data: { status: "Succeeded", fileName: "report.csv" },
      });
      downloadReport.mockResolvedValue({
        success: true, data: { result: reportName === name ? csv
          : "BilledDate,CapacityPackCreditsConsumed,PayGoConsumedQuantity\r\n2026-11-01 00:00:00.0000000,10,2" },
      });
      const pending = acquireCreditReport({
        ...options(), name: reportName, transport: createConnectorReportTransport(generate),
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(generate).toHaveBeenCalledExactlyOnceWith(reportName, range);
      expect(pollV2).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(pollV2).toHaveBeenCalledExactlyOnceWith(reportName, "flow-op", "2024-10-01");
      await vi.advanceTimersByTimeAsync(44_999);
      expect(pollV2).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(result).toMatchObject({
        ok: true, data: { name: reportName, source: "connector", rows: [{ first: 10, second: 2 }] },
      });
      expect(downloadReport).toHaveBeenCalledExactlyOnceWith({ text: reportName, text_1: "report.csv" });
      expect(runFlow).not.toHaveBeenCalled();
    },
  );
  it("preserves base64 gzip bytes returned as flow text when resuming a file", async () => {
    const generate = vi.fn();
    downloadReport.mockResolvedValue({
      success: true, data: { result: btoa(String.fromCharCode(...bytes)) },
    });
    const result = await acquireCreditReport({
      ...options(), transport: createConnectorReportTransport(generate),
      resume: { name, range, phase: "downloading", fileName: "report.csv.gz" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(new Uint8Array(await result.data.original.arrayBuffer())).toEqual(bytes);
    expect(generate).not.toHaveBeenCalled();
    expect(pollV2).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });
  it("waits 30 seconds between Running responses even when V2 omits headers", async () => {
    const generate = vi.fn().mockResolvedValue({ location });
    pollV2.mockResolvedValueOnce({ success: true, data: { status: "Running" } })
      .mockResolvedValue({ success: true, data: { status: "Succeeded", fileName: "report.csv" } });
    downloadReport.mockResolvedValue({ success: true, data: { result: csv } });
    const pending = acquireCreditReport({ ...options(), transport: createConnectorReportTransport(generate) });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(pollV2).toHaveBeenCalledOnce();
    expect(downloadReport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: true });
    expect(generate).toHaveBeenCalledOnce();
    expect(pollV2).toHaveBeenCalledTimes(2);
    expect(runFlow).not.toHaveBeenCalled();
  });
  it("surfaces connector failure without retrying or falling back to the API", async () => {
    pollV2.mockResolvedValue({ success: false, error: { message: "Access denied" } });
    const result = await acquireCreditReport({
      ...options(), transport: createConnectorReportTransport(vi.fn()),
      resume: { name, range, phase: "polling", operationId: "op-1" },
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Access denied") });
    expect(pollV2).toHaveBeenCalledOnce();
    expect(downloadReport).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });
  it("identifies download-flow failures and logs the stage without file contents", async () => {
    requestReport.mockResolvedValue({ success: true, data: { reportlocation: gatewayLocation } });
    pollV2.mockResolvedValue({ success: true, data: { status: "Succeeded", fileName: "report.csv.gz" } });
    downloadReport.mockResolvedValue({ success: false, error: new Error("Flow download failed") });
    const pending = acquireCreditReport({ name, range, signal: new AbortController().signal, onJob });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toMatchObject({
      ok: false, error: "PP-Download-Credit-Licensing-Report: Flow download failed",
      job: { phase: "downloading", fileName: "report.csv.gz" },
    });
    expect(console.info).toHaveBeenCalledWith("[credit-reports] connector response", expect.objectContaining({
      action: "PP-Download-Credit-Licensing-Report", success: false, kind: "undefined",
    }));
    expect(console.error).toHaveBeenCalledWith("[credit-reports] acquisition stopped", {
      report: name, phase: "downloading", error: "PP-Download-Credit-Licensing-Report: Flow download failed",
      hasOperationId: true, hasFileName: true,
    });
    expect(console.info).not.toHaveBeenCalledWith("[credit-reports] parsing downloaded report", expect.anything());
  });
  it("processes a large CSV flow result, retains its exact text, and removes a misleading gzip suffix", async () => {
    const text = `ConsumptionDate,BilledCredits,NonBilledCredits,ResourceName\r\n${
      '2026-11-01 00:00:00.0000000,1.25,0,"Agent, ""Example"""\r\n'.repeat(2500)}`;
    downloadReport.mockResolvedValue({ success: true, data: { result: text } });
    const result = await acquireCreditReport({
      name, range, signal: new AbortController().signal, onJob,
      resume: { name, range, phase: "downloading", fileName: "report.csv.gz" },
    });
    expect(result).toMatchObject({ ok: true, data: { fileName: "report.csv" } });
    if (result.ok) {
      expect(result.data.rows).toHaveLength(2500);
      expect(result.data.rows[0]).toMatchObject({ date: "2026-11-01", first: 1.25 });
      expect(await result.data.original.text()).toBe(text);
    }
    expect(downloadReport).toHaveBeenCalledExactlyOnceWith({ text: name, text_1: "report.csv.gz" });
    expect(requestReport).not.toHaveBeenCalled();
    expect(pollV2).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('Agent,');
  });
  it.each([undefined, null, "", "   ", 42])("rejects a missing/invalid CSV result %j without generating or switching transports", async (result) => {
    downloadReport.mockResolvedValue({ success: true, data: { result } });
    expect(await acquireCreditReport({
      name, range, signal: new AbortController().signal, onJob,
      resume: { name, range, phase: "downloading", fileName: "report.csv.gz" },
    })).toMatchObject({
      ok: false, error: expect.stringContaining("result output"), job: { fileName: "report.csv.gz" },
    });
    expect(downloadReport).toHaveBeenCalledOnce();
    expect(requestReport).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain generation-flow failure", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Flow timed out; submission uncertain"));
    expect(await acquireCreditReport({
      ...options(), transport: createConnectorReportTransport(generate),
    })).toMatchObject({ ok: false, error: expect.stringContaining("submission uncertain") });
    expect(generate).toHaveBeenCalledOnce();
    expect(pollV2).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });
  it.each([
    `https://example.invalid/copilotstudio/licensing/reports/${name}/operations/op-1`,
    gatewayLocation.replace(".azure-apihub.net", ".azure-apihub.net.example.invalid"),
    gatewayLocation.replace("/powerplatformadminv2/", "/anotherconnector/"),
    gatewayLocation.replace("https:", "http:"),
    gatewayLocation.replace("https://", "https://user:password@"),
    gatewayLocation.replace(name, "BillingDetailsPerEnvironment"),
    gatewayLocation.replace("/operations/op-1", "/operations/op%2Fbad"),
  ])("rejects an unrelated or malformed Location %s before polling", async (location) => {
    const generate = vi.fn().mockResolvedValue({ location });
    expect(await acquireCreditReport({
      ...options(), transport: createConnectorReportTransport(generate),
    })).toMatchObject({ ok: false });
    expect(generate).toHaveBeenCalledOnce();
    expect(pollV2).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });
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
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  runFlow.mockResolvedValueOnce(submitted()).mockResolvedValueOnce(succeeded()).mockResolvedValue(file());
});
afterEach(() => {
  expect(generateV2).not.toHaveBeenCalled();
  expect(downloadV2).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const options = () => ({
  name, range, signal: new AbortController().signal, onJob, transport: powerPlatformApiReportTransport,
} as const);
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
