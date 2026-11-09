import { CostControsl_CustomConnService as service } from "../../generated/services/CostControsl_CustomConnService";
import type { CreditRequest, CreditRequestCollection, CreditRequestUpdateResponse } from "../../generated/models/CostControsl_CustomConnModel";
import { formatApiError } from "../../shared/api-explorer/schema";
import { reviewDecision, validateBatchResponse, validateDecisions, type ReviewedDecision } from "../../shared/cost-controls/wave2";
import { invalidateInventoryCache } from "../../data/inventory";
import { call, type Result } from "./data";

export async function listRequests(state = "pending", serviceId = ""): Promise<Result<CreditRequestCollection>> {
  const literal = (value: string) => value.replaceAll("'", "''");
  const filter = [state ? `state eq '${literal(state)}'` : "", serviceId.trim() ? `serviceId eq '${literal(serviceId.trim())}'` : ""].filter(Boolean).join(" and ");
  const result = await call(() => service.ListCreditRequests(undefined, true, 100, filter || undefined), true);
  if (result.ok && !Array.isArray(result.data.value)) return { ok: false, error: "The connector omitted the credit-request rows. This is not an empty queue.", raw: result.raw };
  return result;
}

export async function getRequest(id: string): Promise<Result<CreditRequest>> {
  if (!id.trim()) return { ok: false, error: "Enter a credit request ID." };
  const result = await call(() => service.GetCreditRequest(id.trim()), true);
  if (result.ok && result.data.id !== id.trim()) return { ok: false, error: "The connector did not return the requested credit-request ID.", raw: result.raw };
  return result;
}

export async function decideRequests(reviewed: ReviewedDecision[], confirmed = false): Promise<Result<CreditRequestUpdateResponse>> {
  if (!confirmed) return { ok: false, error: "Review and explicitly confirm these access decisions first." };
  let attempted = false;
  try {
    validateDecisions(reviewed);
    const fresh = await Promise.all(reviewed.map((item) => getRequest(item.requestId)));
    for (const [i, result] of fresh.entries()) {
      if (!result.ok) throw new Error(`${reviewed[i].requestId}: ${result.error}. Nothing was written.`);
      const state = reviewed[i].state;
      if (state !== "approved" && state !== "rejected") throw new Error("This workflow only approves or rejects pending requests.");
      const current = reviewDecision(result.data, state);
      if (current.etag !== reviewed[i].etag) throw new Error(`${current.requestId} changed since review. Refresh and review again; nothing was written.`);
    }
    attempted = true;
    const result = await call(() => service.BatchRecordCreditRequestDecisions({ requests: reviewed }), true);
    if (!result.ok) return result;
    try { validateBatchResponse(result.data, reviewed); }
    catch (error) { return { ok: false, error: formatApiError(error), raw: result.raw }; }
    return result;
  } catch (error) { return { ok: false, error: formatApiError(error) }; }
  finally { if (attempted) invalidateInventoryCache(); }
}
