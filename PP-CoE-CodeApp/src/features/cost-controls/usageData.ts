import { CostControsl_CustomConnService as service } from "../../generated/services/CostControsl_CustomConnService";
import type {
  FundingUsageRecordCollection, UserUsageDetail, UserUsageServiceDetailCollection, UserUsageSessionDetailCollection,
} from "../../generated/models/CostControsl_CustomConnModel";
import { dailyWindow, dayAfter, detailWindow, validateWave2Parameters } from "../../shared/cost-controls/wave2";
import { formatApiError } from "../../shared/api-explorer/schema";
import { call, type Result } from "./data";

export type UsageDimension = "services" | "users" | "groups";
export interface UsageRow { entityId?: string; consumedQuantity?: number; unit?: string; sessionCount?: number }
export interface UsagePage { value: UsageRow[]; nextLink?: string; count?: number; dimension: UsageDimension; day: string }

function collection<T extends { value?: unknown[] }>(result: Result<T>): Result<T> {
  if (result.ok && !Array.isArray(result.data.value)) return {
    ok: false, error: "The connector omitted the collection's value array. This is unavailable data, not an empty report.", raw: result.raw,
  };
  return result;
}

export async function getDailyUsage(dimension: UsageDimension, day: string): Promise<Result<UsagePage>> {
  try {
    const end = dayAfter(day);
    dailyWindow(day, end);
    const read = dimension === "users"
      ? await call(() => service.ListUserUsageRecords(day, end, undefined, true, 100, "consumedQuantity desc"), true)
      : dimension === "groups"
        ? await call(() => service.ListGroupUsageRecords(day, end, undefined, true, 100, "consumedQuantity desc"), true)
        : await call(() => service.ListServiceUsageRecords(day, end, undefined, true, 100, "consumedQuantity desc"), true);
    if (!read.ok) return read;
    if (!Array.isArray(read.data.value)) return { ok: false, error: "The connector omitted the usage rows. This is not zero usage.", raw: read.raw };
    const rows: { userId?: string; groupId?: string; serviceId?: string; consumedQuantity?: number; unit?: string; sessionCount?: number }[] = read.data.value;
    return { ok: true, raw: read.raw, data: {
      value: rows.map((row) => ({ entityId: dimension === "users" ? row.userId : dimension === "groups" ? row.groupId : row.serviceId, consumedQuantity: row.consumedQuantity, unit: row.unit, sessionCount: row.sessionCount })),
      nextLink: read.data["@odata.nextLink"], count: read.data["@odata.count"], dimension, day,
    } };
  } catch (error) { return { ok: false, error: formatApiError(error) }; }
}

export async function getFundingUsage(month: string): Promise<Result<FundingUsageRecordCollection>> {
  try {
    validateWave2Parameters("ListFundingUsageRecords", { month });
    return collection(await call(() => service.ListFundingUsageRecords(month, undefined, true, "consumedQuantity desc"), true));
  } catch (error) { return { ok: false, error: formatApiError(error) }; }
}

export interface UserInvestigation {
  detail: Result<UserUsageDetail>;
  services: Result<UserUsageServiceDetailCollection>;
  sessions: Result<UserUsageSessionDetailCollection>;
}

export async function investigateUser(userId: string, start: string, end: string): Promise<Result<UserInvestigation>> {
  try {
    if (!userId.trim()) throw new Error("Enter a directory user ID.");
    detailWindow(start, end);
    const [detail, services, sessions] = await Promise.all([
      call(() => service.GetUserUsageDetail(userId.trim(), start, end), true),
      call(() => service.ListUserUsageServiceDetails(userId.trim(), start, end), true),
      call(() => service.ListUserUsageSessionDetails(userId.trim(), start, end, undefined, 100), true),
    ]);
    return { ok: true, data: { detail, services: collection(services), sessions: collection(sessions) }, raw: { detail: detail.raw, services: services.raw, sessions: sessions.raw } };
  } catch (error) { return { ok: false, error: formatApiError(error) }; }
}
