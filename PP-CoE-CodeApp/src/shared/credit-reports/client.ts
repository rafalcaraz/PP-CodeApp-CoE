import { executePowerPlatformRequest, type ApiResult, type FlowHttpRequest } from "../power-platform-api";
import { exposedResponseHeaders } from "../api-explorer/responseHeaders";
import { formatApiError, isJsonObject } from "../api-explorer/schema";
import { connectorReportBlob, readCreditReport, utcDay, validateReportRange } from "./files";
import type { CreditReport, ReportJob, ReportName, ReportRange, ReportResult } from "./types";

const API_VERSION = "2024-10-01";
const TIMEOUT_MS = 2 * 60 * 60 * 1000;

function header(raw: unknown, name: string): string | undefined {
  const headers = exposedResponseHeaders(raw);
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (!isJsonObject(headers)) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return typeof entry === "string" || typeof entry === "number" ? String(entry) : undefined;
}

export function reportRetryAt(raw: unknown, now = Date.now()): number {
  const value = header(raw, "Retry-After")?.trim();
  if (!value || !/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error("The Power Platform API response did not expose a valid positive Retry-After interval. Automatic polling stopped; inspect the response before resuming. No replacement report was submitted.");
  }
  const at = now + Number(value) * 1000;
  if (!Number.isSafeInteger(at) || !Number.isFinite(new Date(at).getTime())) throw new Error("The report polling interval exceeds the supported date range.");
  return at;
}

function operationId(raw: unknown, name: ReportName): string {
  const location = header(raw, "Location");
  if (!location) throw new Error("The Power Platform API response did not expose the initial Location header. The report may already be generating. Do not resubmit it; resume with its known operation ID or import a downloaded report. Check that PP-API-Wrapper-Flow returns the HTTP status, headers and body.");
  const path = new URL(location, "https://api.powerplatform.com").pathname;
  const match = /^\/copilotstudio\/licensing\/reports\/([^/]+)\/operations\/([^/]+)\/?$/.exec(path);
  if (!match || decodeURIComponent(match[1]) !== name) throw new Error("The returned Location is not an operation for the requested report.");
  const id = decodeURIComponent(match[2]);
  if (!/^[\w.~-]+$/.test(id)) throw new Error("The returned report operation ID is invalid.");
  return id;
}

function reportRequest(name: ReportName, suffix = "", range?: ReportRange): FlowHttpRequest {
  return {
    method: range ? "POST" : "GET",
    url: `https://api.powerplatform.com/copilotstudio/licensing/reports/${name}${suffix}?api-version=${API_VERSION}`,
    body: range ? JSON.stringify({ ...range, granularity: "Daily" }) : "",
  };
}

function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { reject(signal.reason); };
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function acquireCreditReport(options: {
  name: ReportName;
  range: ReportRange;
  signal: AbortSignal;
  onJob: (job: ReportJob) => void;
  resume?: ReportJob;
}): Promise<ReportResult<CreditReport>> {
  let job: ReportJob = options.resume
    ? { ...options.resume }
    : { name: options.name, range: { ...options.range }, phase: "submitting" };
  let diagnostic: unknown;
  const deadline = Date.now() + TIMEOUT_MS;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error("Report acquisition timed out after two hours. Resume the existing operation; do not generate a replacement.")), TIMEOUT_MS);
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  function update(patch: Partial<ReportJob>) {
    job = { ...job, ...patch };
    options.onJob(job);
  }
  async function call(invoke: () => Promise<ApiResult>) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("Report acquisition timed out after two hours. Resume the existing operation; do not generate a replacement.");
    const result = await until(invoke(), signal);
    diagnostic = result.data ?? result;
    signal.throwIfAborted();
    if (!result.ok) {
      if (result.data?.status === 200 && isJsonObject(result.data.body) && result.data.body.status === "Failed") update({ phase: "failed" });
      throw new Error(result.error);
    }
    return result.data.body;
  }
  try {
    signal.throwIfAborted();
    if (!options.resume) {
      validateReportRange(options.range);
      update({ phase: "submitting" });
      await call(() => executePowerPlatformRequest(reportRequest(job.name, "", job.range), true));
      update({ operationId: operationId(diagnostic, job.name) });
      update({ nextPollAt: reportRetryAt(diagnostic), phase: "waiting" });
    } else {
      if (job.name !== options.name || (!job.operationId && !job.fileName)) throw new Error("Resuming requires an operation ID or generated file name for the selected report.");
      if (job.phase === "failed") throw new Error("A failed report generation cannot be resumed.");
      if (utcDay(job.range.startDate) > utcDay(job.range.endDate)) throw new Error("The original report start date must be on or before its end date.");
      if (job.operationId && !/^[\w.~-]+$/.test(job.operationId)) throw new Error("Enter only the operation ID, not its URL.");
      if (job.fileName && /[\\/:]/.test(job.fileName)) throw new Error("Enter only the generated file name, not a path or URL.");
    }

    while (!job.fileName) {
      if (!job.operationId) throw new Error("The report operation ID is unavailable. Do not submit a duplicate report.");
      if (job.nextPollAt) {
        update({ phase: "waiting" });
        await delay(Math.min(TIMEOUT_MS, Math.max(0, job.nextPollAt - Date.now())), signal);
      }
      update({ phase: "polling" });
      const status = await call(() => executePowerPlatformRequest(reportRequest(job.name, `/operations/${encodeURIComponent(job.operationId!)}`)));
      if (!isJsonObject(status)) throw new Error("The Power Platform API did not return a report status body.");
      if (status.status === "Failed") {
        update({ phase: "failed" });
        throw new Error(`Report generation failed: ${formatApiError(status.error)}. This operation cannot be resumed.`);
      }
      if (status.status === "Succeeded") {
        if (typeof status.fileName !== "string" || !status.fileName.trim()) throw new Error("Report generation succeeded without a file name; downloading is unavailable.");
        update({ fileName: status.fileName, nextPollAt: undefined });
      } else if (status.status === "Running") {
        update({ nextPollAt: reportRetryAt(diagnostic), phase: "waiting" });
      } else throw new Error(`Unexpected report status: ${formatApiError(status.status)}. Polling stopped.`);
    }
    update({ phase: "downloading" });
    const body = await call(() => executePowerPlatformRequest(reportRequest(job.name, `/files/${encodeURIComponent(job.fileName!)}`)));
    const data = await until(readCreditReport(connectorReportBlob(body), job.fileName, {
      source: "power-platform-api", expected: job.name, requestedRange: job.range,
    }), signal);
    signal.throwIfAborted();
    update({ phase: "ready" });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false, error: formatApiError(error), job,
      cancelled: options.signal.aborted,
      // Don't retain a potentially large binary body after parsing failures.
      diagnostic: job.phase === "downloading" ? undefined : diagnostic,
    };
  } finally { clearTimeout(timer); }
}
