/**
 * Generic Dataverse passthrough client.
 *
 * Wraps the swappable flow runner (`./flowContract`) and turns its raw
 * envelope into a typed `DataverseResult`. Modeled on
 * `src/shared/licensing/client.ts`:
 *
 *  1. The flow returns `{ response: stringifiedJson }` — we `JSON.parse` it
 *     so callers get typed records.
 *  2. The flow can fail in several ways (rejected promise, `success:false`,
 *     `success:true` with non-JSON / empty body, or a JSON error envelope).
 *     All collapse into a single `{ ok: false, error }` shape.
 *  3. In-flight dedupe — two simultaneous identical retrieves collapse into
 *     one flow invocation.
 */

import { runDataverseFlow } from "./flowContract";
import type {
  DataverseRecord,
  DataverseResult,
  DataverseRetrieveRequest,
} from "./types";

/** Module-level in-flight map. Keyed by env + table to merge dupes. */
const inflight = new Map<string, Promise<DataverseResult<DataverseRecord[]>>>();

/** Reset hook for tests and for an eventual "Refresh" UI affordance. */
export function clearDataverseInflight(): void {
  inflight.clear();
}

/**
 * Retrieve all records of a Dataverse table in an environment.
 *
 * @returns `{ ok: true, data: records }` on success, otherwise
 *          `{ ok: false, error }` with a human-readable message.
 */
export async function retrieveRecords(
  req: DataverseRetrieveRequest,
): Promise<DataverseResult<DataverseRecord[]>> {
  const key = `${req.environmentId}::${req.pluralName}::${req.fetchXml}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = invokeOnce(req).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

async function invokeOnce(
  req: DataverseRetrieveRequest,
): Promise<DataverseResult<DataverseRecord[]>> {
  let raw: { success: boolean; data?: { response?: string }; error?: unknown };
  try {
    raw = await runDataverseFlow({
      environmentId: req.environmentId,
      pluralName: req.pluralName,
      fetchXml: req.fetchXml,
    });
  } catch (e) {
    return { ok: false, error: formatError(e) };
  }

  if (!raw.success) {
    return {
      ok: false,
      error: formatError(raw.error) || "Dataverse flow returned success=false",
    };
  }

  const responseText = raw.data?.response;
  if (typeof responseText !== "string" || responseText.length === 0) {
    return { ok: false, error: "Empty response from Dataverse flow" };
  }

  // The flow returns the literal string "ERROR" (in its `result` output) when
  // something went wrong retrieving from Dataverse.
  if (responseText.trim().toUpperCase() === "ERROR") {
    return { ok: false, error: "Dataverse retrieval failed (flow returned ERROR)" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // A 4xx/5xx from Dataverse can come back as an HTML error page rather
    // than JSON. Surface a short preview so the user can tell what failed.
    const preview = responseText.slice(0, 200).replace(/\s+/g, " ").trim();
    return { ok: false, error: `Non-JSON response from Dataverse: ${preview}` };
  }

  const errEnvelope = detectErrorEnvelope(parsed);
  if (errEnvelope) return { ok: false, error: errEnvelope };

  const records = extractRecords(parsed);
  if (!records) {
    return {
      ok: false,
      error: "Unexpected Dataverse response shape (could not find a records array)",
    };
  }

  return { ok: true, data: records };
}

/**
 * Coerce a parsed flow body into an array of records.
 *
 * The flow can hand us the records in a few shapes, so we accept all of them:
 *  - a bare array: `[{...}, {...}]`
 *  - an OData collection: `{ value: [{...}] }`
 *  - a double-encoded collection: `{ value: "[{...}]" }` (value is a JSON
 *    string) — Power Automate sometimes stringifies the array before placing
 *    it in the output
 *  - any of the above wrapped one level deeper under `result`
 *  - the whole thing handed to us as a JSON string
 *
 * Returns `null` only when no array can be recovered.
 */
function extractRecords(parsed: unknown, depth = 0): DataverseRecord[] | null {
  // Guard against pathological self-referential strings.
  if (depth > 4) return null;

  if (Array.isArray(parsed)) return parsed as DataverseRecord[];

  if (typeof parsed === "string") {
    try {
      return extractRecords(JSON.parse(parsed), depth + 1);
    } catch {
      return null;
    }
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["value", "result"]) {
      if (key in obj) {
        const inner = extractRecords(obj[key], depth + 1);
        if (inner) return inner;
      }
    }
  }

  return null;
}

/** Detect common JSON error shapes Dataverse / its host might return. */
function detectErrorEnvelope(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const status = obj.statusCode;
  const isHttpError = typeof status === "number" && status >= 400;
  const errorField = obj.error;
  if (errorField && typeof errorField === "object") {
    const msg = (errorField as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
    const code = (errorField as { code?: unknown }).code;
    if (typeof code === "string") return `Dataverse error: ${code}`;
  }
  if (typeof obj.message === "string" && isHttpError) {
    return `HTTP ${status}: ${obj.message}`;
  }
  if (isHttpError) return `HTTP ${status} from Dataverse`;
  return null;
}

function formatError(e: unknown): string {
  if (!e) return "";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const obj = e as { message?: unknown };
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
