/**
 * Public API for the generic Dataverse passthrough.
 *
 * Consumers retrieve records of any Dataverse table in an environment via
 * `retrieveRecords({ environmentId, pluralName })`. The runner indirection
 * (`setDataverseRunner` / `resetDataverseRunner`) is exported for tests and
 * for wiring the real Power Automate flow once it's added to the project.
 */

export { retrieveRecords, clearDataverseInflight } from "./client";
export {
  downloadDataverseFile,
  clearDataverseFileInflight,
} from "./fileClient";
export type { DataverseFileDownloadRequest } from "./fileClient";
export { buildFetchXml } from "./fetchxml";
export type { FetchCondition, FetchXmlSpec } from "./fetchxml";
export {
  runDataverseFlow,
  setDataverseRunner,
  resetDataverseRunner,
  realDataverseRunner,
  runDataverseFileDownload,
  setDataverseFileRunner,
  resetDataverseFileRunner,
  realDataverseFileRunner,
} from "./flowContract";
export type {
  DataverseFlowInput,
  DataverseFlowRawResult,
  DataverseRunner,
  DataverseFileInput,
  DataverseFileRawResult,
  DataverseFileRunner,
} from "./flowContract";
export { mockDataverseRunner, MOCK_SOLUTIONS } from "./mock";
export type {
  DataverseCollectionResponse,
  DataverseRecord,
  DataverseResult,
  DataverseRetrieveRequest,
} from "./types";
