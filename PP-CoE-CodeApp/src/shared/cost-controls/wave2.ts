import { isJsonObject } from "../api-explorer/schema";
import type {
  CreditRequest, CreditRequestUpdateItem, CreditRequestUpdateResponse,
} from "../../generated/models/CostControsl_CustomConnModel";

const dayMs = 86_400_000;

function utcDay(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a UTC date as YYYY-MM-DD.");
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error("Enter a valid UTC calendar date.");
  return parsed;
}

export function dailyWindow(startDate: string, endDate: string, now = Date.now()): void {
  const start = utcDay(startDate);
  const end = utcDay(endDate);
  if (end - start !== dayMs || end > now) throw new Error("Daily reports require exactly one completed UTC day, with exclusive endDate the next midnight.");
}

export function dayAfter(day: string): string {
  return new Date(utcDay(day) + dayMs).toISOString().slice(0, 10);
}

export function previousUtcDay(now = Date.now()): string {
  return new Date(utcDay(new Date(now).toISOString().slice(0, 10)) - dayMs).toISOString().slice(0, 10);
}

function utcTicks(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?Z$/.exec(value);
  if (!match) throw new Error("Use UTC timestamps ending in Z, with at most seven fractional digits.");
  const parsed = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== match[1]) throw new Error("Enter a valid UTC timestamp.");
  // Graph accepts 100 ns precision; Date alone would silently truncate it.
  return BigInt(parsed) * 10_000n + BigInt((match[2] ?? "").padEnd(7, "0"));
}

export function detailWindow(start: string, end: string, now = Date.now()): void {
  const from = utcTicks(start);
  const to = utcTicks(end);
  if (from >= to || to > BigInt(now) * 10_000n || to - from > BigInt(dayMs) * 10_000n) {
    throw new Error("Raw detail needs start before end, a nonfuture end, and a window of at most 24 hours.");
  }
  const boundary = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  boundary.setUTCMonth(boundary.getUTCMonth() + 1, 1);
  if (start.slice(0, 7) !== end.slice(0, 7) && to !== BigInt(boundary.getTime()) * 10_000n) {
    throw new Error("Raw detail cannot cross a UTC month except for an exclusive end at the next month's midnight.");
  }
}

export function strongRequestEtag(value: unknown): value is string {
  return typeof value === "string" && /^"[^"\r\n]*"(?![\s\S])/.test(value);
}

export type RequestDecision = "approved" | "rejected";
export type ReviewedDecision = CreditRequestUpdateItem;

export function reviewDecision(request: CreditRequest, state: RequestDecision): ReviewedDecision {
  if (!request.id?.trim()) throw new Error("The request has no usable ID.");
  if (request.state !== "pending") throw new Error(`Only pending requests can be reviewed here; current state: ${request.state ?? "not reported"}.`);
  const etag = request["@odata.etag"];
  if (!strongRequestEtag(etag)) throw new Error("Read the request again: a quoted strong request ETag is required, not a policy ETag or wildcard.");
  return { requestId: request.id, state, etag };
}

export function validateDecisions(value: unknown): asserts value is ReviewedDecision[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error("Review between 1 and 100 unique credit requests.");
  const ids = new Set<string>();
  for (const item of value) {
    if (!isJsonObject(item) || typeof item.requestId !== "string" || !item.requestId.trim() || !strongRequestEtag(item.etag) ||
      !["pending", "approved", "rejected", "cancelled"].includes(String(item.state))) throw new Error("Each decision needs an ID, a recognized state and a strong request ETag.");
    const key = item.requestId.toLowerCase();
    if (ids.has(key)) throw new Error("Each request ID must be unique within a batch.");
    ids.add(key);
  }
}

export function validateBatchResponse(data: CreditRequestUpdateResponse, requests: ReviewedDecision[]): void {
  if (!Array.isArray(data.responses) || data.responses.length !== requests.length ||
    data.responses.some((row, i) => row.requestId !== requests[i].requestId || !row.status) ||
    data.succeededCount !== data.responses.filter((row) => row.status === "succeeded").length ||
    data.failedCount !== data.responses.filter((row) => row.status !== "succeeded").length) {
    throw new Error("The batch response is incomplete or inconsistent. Some decisions may have succeeded. Reread affected requests before any new review; never replay the batch.");
  }
}

export function validateWave2Parameters(id: string, p: Record<string, unknown>, now = Date.now()): void {
  const daily = /^(List|Get)(User|Group|Service)UsageRecord(s)?$/.exec(id);
  if (daily) {
    dailyWindow(String(p.startDate ?? ""), String(p.endDate ?? ""), now);
    if (p.$orderby !== undefined && !/^consumedQuantity(?: (?:asc|desc))?$/.test(String(p.$orderby))) throw new Error("Usage reports order only by consumedQuantity.");
    if (p.$filter !== undefined) {
      const key = `${daily[2].toLowerCase()}Id`;
      if (!new RegExp(`^${key} eq '(?:[^']|'')*'$`).test(String(p.$filter))) throw new Error(`Use one ${key} eq string literal for this report.`);
    }
  }
  if (id === "ListFundingUsageRecords") {
    if (typeof p.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)) throw new Error("Funding reports require a calendar month as YYYY-MM.");
    if (p.$orderby !== undefined && !/^consumedQuantity(?: (?:asc|desc))?$/.test(String(p.$orderby))) throw new Error("Funding reports order only by consumedQuantity.");
  }
  if (["GetUserUsageDetail", "ListUserUsageServiceDetails", "ListUserUsageSessionDetails"].includes(id)) {
    detailWindow(String(p.startDateTime ?? ""), String(p.endDateTime ?? ""), now);
    if (p.$expand !== undefined && !["services", "sessions", "services,sessions", "sessions,services"].includes(String(p.$expand))) throw new Error("Expand only services and/or sessions.");
  }
  if (id === "UpdateCreditRequest" && !strongRequestEtag(p["If-Match"])) throw new Error("If-Match must be the current quoted strong request ETag, not a weak policy ETag or wildcard.");
  if (id === "BatchRecordCreditRequestDecisions") validateDecisions(isJsonObject(p.body) ? p.body.requests : undefined);
  if (id === "ListCreditRequests" && p.$filter !== undefined) {
    let remaining = String(p.$filter);
    const seen = new Set<string>();
    while (remaining) {
      const match = /^\s*(state|serviceId)\s+eq\s+'((?:[^']|'')*)'\s*(?:$|and\s+)/i.exec(remaining);
      if (!match || seen.has(match[1].toLowerCase())) throw new Error("Use at most one state eq and one serviceId eq string clause, joined with and.");
      seen.add(match[1].toLowerCase());
      remaining = remaining.slice(match[0].length);
      if (!remaining && /\band\s+$/i.test(match[0])) throw new Error("Complete the credit-request filter after and.");
    }
  }
}
