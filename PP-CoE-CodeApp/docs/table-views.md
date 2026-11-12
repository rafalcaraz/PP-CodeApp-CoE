# Inventory table views

Environments, Environment groups, Apps, Flows, Agents, Connectors, Queries
results, and deep-inventory results share the same table controls. Dashboard,
detail-page, and specialized reporting tables are unchanged.

## Columns and headers

**Columns** opens a searchable field chooser. Select additional fields,
reorder them with **Earlier / Later**, and adjust their widths. Drag a header
separator to resize, or focus it and use the Left/Right arrow keys. At least
one data column remains visible; inspection and evidence actions remain
available. Existing links and rich cells keep their normal behavior.

**Add custom column** lets you enter a returned property path such as
`properties.logicalName`, choose a title, and select its value type for sorting
and filtering. Leave the title empty to use the path. Custom columns can be
edited or removed in the chooser and use the same ordering, width, filter,
and export controls as built-in columns. Paths support nested objects and
array indexes (`properties.connectors.0.connectorId`); they never evaluate code
or start extra API calls. Literal returned keys are checked before dotted
traversal, so projected query aliases containing dots also work.

Inventory lists read these paths from the original returned envelope, not
only the flattened row model. Queries and deep inventory read their executed
result/raw source records. A property absent from a loaded record remains
**Not reported**; adding a column cannot fetch properties an API did not return.
Cached connector catalog rows lack the original envelope: use **Refresh** to
load raw properties when the table displays that notice.

Open a column's options to sort ascending/descending or apply a filter.
Text, numeric, date, boolean, and categorical fields have appropriate
operators. Date bounds include the selected UTC day. Column filters combine
with AND; selected categorical values within one filter combine with OR.
Missing values are distinct from false and zero. Empty/not-reported date
filters also include invalid dates. Sorting uses underlying typed values,
keeps ties stable, and puts missing values last in either direction.

Active filters appear above the table and can be removed individually.
**Clear column filters** preserves the columns and sort; **Reset view**
restores the original columns, widths, sort, and column filters. Existing
page search and server/source filters are separate and are not cleared.
Reset also removes custom column definitions.

## Loaded rows are not the full inventory

Sorting and column filters apply only to rows already fetched. The table
shows matching/loaded counts and explains the scope. It does not silently
fetch the rest of the tenant or call extra record-enrichment APIs.

Use the list's explicit loading controls to include additional pages.
Connectors transforms the entire loaded catalog before slicing local pages;
a fallback catalog remains explicitly partial. Queries can load all results
without downloading a CSV. Deep-inventory controls act on received matches;
Run/Cancel and scan-completeness reporting retain their existing meaning.
A zero-match view still exposes the controls needed to remove filters.

## Preferences

Inventory lists remember configuration per page in this browser.
Deep-inventory preferences are scoped by source. Queries preferences remain
per-tab, separate from executed clauses and saved query definitions.
Preferences do not store fetched records or result caches.
Custom definitions store only the path, title, type and ordinary view settings.
Retained raw inventory envelopes stay in memory and do not add fields to
the existing loaded/all CSV or JSON serialization.

Restored preferences are reconciled against the available columns.
Unusable preferences and failed storage writes produce a visible warning;
the current in-memory view can still be used. Malformed stored preferences
are replaced only after an explicit Reset view.

## Exports

**Export current view** exports matching loaded rows in the chosen sort and
visible column order, excluding action columns. With local paging it includes
all matches across the local pages, not only the current page. IDs and raw
values are retained rather than substituting resolved display names.

Existing loaded/all/raw CSV actions retain their original scope. They are
not implicitly narrowed by presentation-only column filters. Queries keeps
its explicit partial-export choice and stale-execution protections.
Filtering a displayed table never rewrites an executed query or starts a scan.
