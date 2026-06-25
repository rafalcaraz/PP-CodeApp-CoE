/**
 * Public types for the generic Dataverse passthrough.
 *
 * Background
 * ----------
 * A Power Automate flow acts as a passthrough to a Dataverse environment's
 * Web API. The flow takes an environment id + the **plural schema name** of a
 * Dataverse table (the entity set name, e.g. `"solutions"`) and returns the
 * matching records as JSON — or an error envelope when the underlying call
 * fails.
 *
 * This module mirrors the spirit of `src/shared/licensing/*`, which wraps a
 * similar wrapper flow. We don't reuse `DataResult` from `src/data/inventory`
 * because that module lives in `shared-legacy` and `src/shared/*` may only
 * import from `shared` + `generated` (enforced by eslint-plugin-boundaries).
 */

/** Discriminated result type for every passthrough call. */
export type DataverseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** A single Dataverse record. Columns vary per table, so this stays open. */
export type DataverseRecord = Record<string, unknown>;

/**
 * The Dataverse Web API returns collections as `{ value: [...] }` (OData).
 * The passthrough flow forwards that body verbatim, so this is the shape we
 * expect inside the parsed `response` for a successful retrieve.
 */
export interface DataverseCollectionResponse<
  T extends DataverseRecord = DataverseRecord,
> {
  value: T[];
  /** OData paging token, present when the result set is truncated. */
  "@odata.nextLink"?: string;
}

/** Ergonomic request for a single retrieve. */
export interface DataverseRetrieveRequest {
  /** Target environment GUID. */
  environmentId: string;
  /** Plural schema / entity-set name of the table (e.g. `"solutions"`). */
  pluralName: string;
  /**
   * FetchXML query (the flow's required `filterXMLQuery` input). Specifies the
   * entity, columns, and any filter conditions. Build it with `buildFetchXml`.
   *
   * The flow requires this on every call, so it's mandatory here. For a simple
   * "all rows" retrieve, pass a FetchXML with `<all-attributes/>` and no filter.
   */
  fetchXml: string;
}
