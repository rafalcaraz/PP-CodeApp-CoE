/**
 * Environments feature — Solutions data layer.
 *
 * Retrieves the Dataverse `solution` records for an environment via the
 * generic passthrough (`shared/dataverse`) and maps them into feature-shaped
 * `SolutionRow`s. Views in this feature import from here (or `./data`), never
 * directly from `shared/dataverse`, so the raw-record shape stays contained.
 */

import {
  buildFetchXml,
  retrieveRecords,
  type DataverseRecord,
  type DataverseResult,
} from "../../shared/dataverse";

/** The Dataverse entity-set (plural schema) name for solutions. */
export const SOLUTIONS_PLURAL_NAME = "solutions";

/** The Dataverse logical (singular) entity name for solutions. */
export const SOLUTION_ENTITY_NAME = "solution";

/** Base URL for the Power Apps maker portal. */
const POWER_APPS_BASE = "https://make.powerapps.com";

/**
 * Build a deep-link that opens a solution's overview in the Power Apps maker
 * portal, e.g. `…/environments/{env}/solutions/{solutionId}/overview`.
 */
export function solutionOverviewUrl(
  environmentId: string,
  solutionId: string,
): string {
  const env = encodeURIComponent(environmentId);
  const sol = encodeURIComponent(solutionId);
  return `${POWER_APPS_BASE}/environments/${env}/solutions/${sol}/overview`;
}

/** A feature-shaped solution row for the Environment detail Solutions list. */
export interface SolutionRow {
  /** `solutionid` — unique within the environment; safe as a React key. */
  id: string;
  /** `uniquename` — the immutable schema name. */
  uniqueName: string;
  /** `friendlyname` — the display name (falls back to uniqueName). */
  friendlyName: string;
  /** `version` string, if present. */
  version: string;
  /** `ismanaged` — managed vs unmanaged solution. */
  isManaged: boolean;
  /** `installedon` ISO timestamp, if present. */
  installedOn?: string;
  /** `modifiedon` ISO timestamp, if present. */
  modifiedOn?: string;
  /** Publisher GUID (`_publisherid_value`), if present. */
  publisherId?: string;
  /** The untouched Dataverse record, for the raw-JSON accordion. */
  raw: DataverseRecord;
}

function str(rec: DataverseRecord, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function bool(rec: DataverseRecord, key: string): boolean {
  return rec[key] === true;
}

/** Map one raw Dataverse `solution` record to a `SolutionRow`. */
function toSolutionRow(rec: DataverseRecord): SolutionRow {
  const uniqueName = str(rec, "uniquename") ?? "";
  return {
    id: str(rec, "solutionid") ?? uniqueName,
    uniqueName,
    friendlyName: str(rec, "friendlyname") ?? uniqueName,
    version: str(rec, "version") ?? "",
    isManaged: bool(rec, "ismanaged"),
    installedOn: str(rec, "installedon"),
    modifiedOn: str(rec, "modifiedon"),
    publisherId: str(rec, "_publisherid_value"),
    raw: rec,
  };
}

/**
 * Built-in invisible solutions every environment carries. They're excluded
 * from the user-facing list so it reads like the PPAC "Solutions" view.
 */
const SYSTEM_SOLUTION_NAMES = new Set(["Default", "Active"]);

/**
 * Should a raw record appear in the user-facing solutions list?
 * Drops `isvisible: false` rows and the built-in system solutions.
 */
function isUserVisibleSolution(rec: DataverseRecord): boolean {
  if (rec.isvisible === false) return false;
  const uniqueName = str(rec, "uniquename");
  if (uniqueName && SYSTEM_SOLUTION_NAMES.has(uniqueName)) return false;
  return true;
}

/**
 * List the user-visible solutions installed in an environment.
 *
 * Sorted by friendly name (case-insensitive) for a stable, scannable list.
 */
export async function listSolutions(
  environmentId: string,
): Promise<DataverseResult<SolutionRow[]>> {
  // Request the columns we surface (plus `isvisible` for client-side
  // filtering). FetchXML is required by the flow's `filterXMLQuery` input.
  const fetchXml = buildFetchXml({
    entity: SOLUTION_ENTITY_NAME,
    attributes: [
      "solutionid",
      "uniquename",
      "friendlyname",
      "version",
      "ismanaged",
      "isvisible",
      "installedon",
      "modifiedon",
      "publisherid",
    ],
    order: { attribute: "friendlyname" },
  });
  const res = await retrieveRecords({
    environmentId,
    pluralName: SOLUTIONS_PLURAL_NAME,
    fetchXml,
  });
  if (!res.ok) return res;

  const rows = res.data
    .filter(isUserVisibleSolution)
    .map(toSolutionRow)
    .sort((a, b) =>
      a.friendlyName.localeCompare(b.friendlyName, undefined, {
        sensitivity: "base",
      }),
    );

  return { ok: true, data: rows };
}
