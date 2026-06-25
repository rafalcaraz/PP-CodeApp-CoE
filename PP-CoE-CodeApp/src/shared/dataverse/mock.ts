/**
 * In-memory mock runner + fixtures for the Dataverse passthrough.
 *
 * No longer the default runner (the live `realDataverseRunner` now backs the
 * slice) — kept for unit tests and for local development without a live
 * connection. Inject it with `setDataverseRunner(mockDataverseRunner)`. It
 * returns flow-shaped envelopes (`{ success, data: { response } }`) so the
 * client's parsing/normalization path is exercised exactly as in production.
 *
 * The fixtures model real Dataverse `solution` records, including a couple of
 * invisible/system solutions so the feature's filtering logic has something to
 * exclude.
 */

import type {
  DataverseFlowInput,
  DataverseFlowRawResult,
  DataverseRunner,
} from "./flowContract";
import type { DataverseRecord } from "./types";

/**
 * A small, realistic set of Dataverse `solution` rows.
 *
 * `Default` and `Active` are the built-in invisible solutions every
 * environment carries (`isvisible: false`) — they should be filtered out of
 * any user-facing solutions list.
 */
export const MOCK_SOLUTIONS: DataverseRecord[] = [
  {
    solutionid: "1b2c3d4e-0000-0000-0000-000000000001",
    uniquename: "Default",
    friendlyname: "Default Solution",
    version: "1.0.0.0",
    ismanaged: false,
    isvisible: false,
    installedon: "2023-01-01T00:00:00Z",
    modifiedon: "2024-05-01T12:00:00Z",
    _publisherid_value: "aaaa1111-0000-0000-0000-000000000001",
  },
  {
    solutionid: "1b2c3d4e-0000-0000-0000-000000000002",
    uniquename: "Active",
    friendlyname: "Common Data Services Default Solution",
    version: "1.0",
    ismanaged: false,
    isvisible: false,
    installedon: "2023-01-01T00:00:00Z",
    modifiedon: "2023-01-01T00:00:00Z",
    _publisherid_value: "aaaa1111-0000-0000-0000-000000000001",
  },
  {
    solutionid: "1b2c3d4e-0000-0000-0000-000000000003",
    uniquename: "PPCoECodeApp",
    friendlyname: "PP CoE Code App",
    version: "1.4.2.0",
    ismanaged: true,
    isvisible: true,
    installedon: "2024-09-12T08:30:00Z",
    modifiedon: "2025-02-03T16:45:00Z",
    _publisherid_value: "bbbb2222-0000-0000-0000-000000000002",
  },
  {
    solutionid: "1b2c3d4e-0000-0000-0000-000000000004",
    uniquename: "msdynce_AppProfileManager",
    friendlyname: "App Profile Manager",
    version: "10.1.2.3",
    ismanaged: true,
    isvisible: true,
    installedon: "2024-06-01T00:00:00Z",
    modifiedon: "2024-11-20T09:10:00Z",
    _publisherid_value: "cccc3333-0000-0000-0000-000000000003",
  },
  {
    solutionid: "1b2c3d4e-0000-0000-0000-000000000005",
    uniquename: "ContosoFieldService",
    friendlyname: "Contoso Field Service",
    version: "2.0.0.1",
    ismanaged: false,
    isvisible: true,
    installedon: "2025-01-15T14:00:00Z",
    modifiedon: "2025-03-22T11:25:00Z",
    _publisherid_value: "dddd4444-0000-0000-0000-000000000004",
  },
];

const FIXTURES: Record<string, DataverseRecord[]> = {
  solutions: MOCK_SOLUTIONS,
};

/** Build a flow-shaped success envelope wrapping the given records. */
function successEnvelope(records: DataverseRecord[]): DataverseFlowRawResult {
  return {
    success: true,
    data: { response: JSON.stringify({ value: records }) },
  };
}

/**
 * Default mock runner. Resolves fixtures by plural name; an unknown table
 * resolves to an empty collection (not an error) so the UI shows an empty
 * state rather than a failure.
 */
export const mockDataverseRunner: DataverseRunner = async (
  input: DataverseFlowInput,
): Promise<DataverseFlowRawResult> => {
  const records = FIXTURES[input.pluralName] ?? [];
  return successEnvelope(records);
};
