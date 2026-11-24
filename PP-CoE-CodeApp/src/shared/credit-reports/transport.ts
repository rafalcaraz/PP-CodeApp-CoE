import { PowerPlatformforAdminsV2Service } from "../../generated/services/PowerPlatformforAdminsV2Service";
import { PP_Request_Credit_Licensing_ReportService } from "../../generated/services/PP_Request_Credit_Licensing_ReportService";
import { PP_Download_Credit_Licensing_ReportService } from "../../generated/services/PP_Download_Credit_Licensing_ReportService";
import { exposedResponseHeaders } from "../api-explorer/responseHeaders";
import { formatApiError, isJsonObject } from "../api-explorer/schema";
import { executePowerPlatformRequest } from "../power-platform-api";
import type { ReportName, ReportRange } from "./types";

const API_VERSION = "2024-10-01";

export type ReportTransportResult =
  | { ok: true; data: { body: unknown; headers?: unknown; status?: number } }
  | { ok: false; error: string; data?: { body: unknown; headers?: unknown; status?: number } };

export interface CreditReportTransport {
  source: "power-platform-api" | "connector";
  pollIntervalMs?: number;
  submit(name: ReportName, range: ReportRange): Promise<ReportTransportResult>;
  poll(name: ReportName, operationId: string): Promise<ReportTransportResult>;
  download(name: ReportName, fileName: string): Promise<ReportTransportResult>;
}

export interface ReportSubmission {
  location: string;
}

export const powerPlatformApiReportTransport: CreditReportTransport = {
  source: "power-platform-api",
  submit: (name, range) => executePowerPlatformRequest({
    method: "POST",
    url: reportUrl(name),
    body: JSON.stringify({ ...range, granularity: "Daily" }),
  }, true),
  poll: (name, id) => executePowerPlatformRequest({
    method: "GET", url: reportUrl(name, `/operations/${encodeURIComponent(id)}`), body: "",
  }),
  download: (name, fileName) => executePowerPlatformRequest({
    method: "GET", url: reportUrl(name, `/files/${encodeURIComponent(fileName)}`), body: "",
  }),
};

function reportUrl(name: ReportName, suffix = ""): string {
  return `https://api.powerplatform.com/copilotstudio/licensing/reports/${name}${suffix}?api-version=${API_VERSION}`;
}

function responseShape(data: unknown) {
  const object = isJsonObject(data) ? data : undefined;
  return {
    kind: data === null ? "null" : data instanceof Blob ? "Blob"
      : data instanceof ArrayBuffer ? "ArrayBuffer" : ArrayBuffer.isView(data) ? "typed-array"
        : Array.isArray(data) ? "array" : typeof data,
    stringLength: typeof data === "string" ? data.length : undefined,
    status: object && ["Running", "Succeeded", "Failed"].includes(String(object.status)) ? object.status : undefined,
    hasFileName: typeof object?.fileName === "string",
    hasBase64Content: typeof object?.$content === "string",
    hasReportLocation: typeof object?.reportlocation === "string",
  };
}

async function connectorCall(
  action: "GetLicensingReportOperation" | "PP-Download-Credit-Licensing-Report",
  invoke: () => Promise<{ success: boolean; data?: unknown; error?: unknown }>,
): Promise<ReportTransportResult> {
  console.info("[credit-reports] connector request", { action });
  try {
    const result = await invoke();
    console.info("[credit-reports] connector response", { action, success: result.success, ...responseShape(result.data) });
    if (!result.success) return { ok: false, error: `${action}: ${formatApiError(result.error)}` };
    return { ok: true, data: { body: result.data, headers: exposedResponseHeaders(result) } };
  } catch (error) {
    return { ok: false, error: `${action}: ${formatApiError(error)}` };
  }
}

export function createConnectorReportTransport(
  generate: (name: ReportName, range: ReportRange) => Promise<ReportSubmission>,
): CreditReportTransport {
  return {
    source: "connector",
    pollIntervalMs: 30_000,
    async submit(name, range) {
      try {
        const submission = await generate(name, range);
        return {
          ok: true,
          data: { body: null, headers: { Location: submission.location } },
        };
      } catch (error) {
        return { ok: false, error: formatApiError(error) };
      }
    },
    poll: (name, id) => connectorCall("GetLicensingReportOperation", () =>
      PowerPlatformforAdminsV2Service.GetLicensingReportOperation(name, id, API_VERSION)),
    download: (name, fileName) => connectorCall("PP-Download-Credit-Licensing-Report", async () => {
      const result = await PP_Download_Credit_Licensing_ReportService.Run({ text: name, text_1: fileName });
      if (!result.success) return result;
      const content = result.data?.result;
      if (typeof content !== "string" || !content.trim()) {
        return { success: false, error: "The download flow did not return CSV text in its result output. Resume the existing file; do not generate another report." };
      }
      return { success: true, data: content };
    }),
  };
}

export const connectorReportTransport = createConnectorReportTransport(async (name, range) => {
  console.info("[credit-reports] generation request", { report: name, granularity: "Daily" });
  const result = await PP_Request_Credit_Licensing_ReportService.Run({
    text: name, text_1: range.endDate, text_2: range.startDate, text_3: "Daily",
  });
  console.info("[credit-reports] generation response", { success: result.success, ...responseShape(result.data) });
  if (!result.success) throw new Error(formatApiError(result.error));
  const location = result.data?.reportlocation?.trim();
  if (!location) throw new Error("PP-Request-Credit-Licensing-Report returned no reportlocation. The report may already be generating; do not resubmit it.");
  if (!/^https:\/\//i.test(location)) throw new Error(`Report generation flow returned: ${location}`);
  return { location };
});
