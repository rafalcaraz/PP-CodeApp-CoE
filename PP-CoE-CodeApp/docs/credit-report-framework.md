# Reusable Power Platform credit-report framework

This is the implementation guide for **Dashboards > Consumption & Value**
and **Cost Controls > Power Platform credit usage** (`#/cost-controls/power-platform`).
The framework lives in `src/shared/credit-reports/`; consumers must import its
public `index.ts` barrel, **not** the Cost Controls feature or individual
generated services.

The current implementation acquires and imports Daily reports, retains multiple
captures in session memory, reconciles overlapping reported days, exposes pure
selectors, and exports the collection. **Consumption & Value** uses the reconciled
collection for interactive overview/exploration and separate funding analysis.
Optional browser retention preserves originals and capture provenance across
reloads. It does **not** schedule collection, persist to Dataverse, or synchronize
between devices.

## Architecture and ownership

| Module | Responsibility |
|---|---|
| `types.ts` | Report names, column-to-metric schemas, capture/row types, derived views, jobs and result types |
| `transport.ts` | Registered generation/download flows and Admins V2 polling; explicit alternate API transport |
| `client.ts` | Submission, operation validation, polling, timeout, cancellation, resume and parsing |
| `files.ts` | Complete-UTC-day presets, request-window validation, CSV/gzip parsing, file limits and capture creation |
| `store.ts` | Retained captures, compatibility latest-per-type snapshots, subscriptions and resumable jobs |
| `collection.ts` | Reported tenant scopes, requested-period matches and deterministic daily reconciliation |
| `selectors.ts` | Local row filtering and schema-neutral aggregation |
| `archive.ts` | Original-file ZIP, derived CSVs and provenance manifest |
| `persistence.ts` | Opt-in IndexedDB originals/provenance, validated restoration, visible storage failures |
| `consumption.ts` | Shared signed-credit projections, identity matching, local filters, grouped totals, coverage-aware timelines and funding snapshots |
| `index.ts` | Public consumer API |

`features/cost-controls/PowerPlatformCredits.tsx` owns user interactions:
confirmation, request/upload controls, capture/scope selection and downloads.
`CreditReportAnalysis.tsx` retains the individual-capture diagnostic view.
`features/dashboards/DashboardDetail.tsx` provides the native editable reporting
canvas. `data/dashboardCreditReports.ts` defines its template and persisted tile
configuration; `components/credit-reports/` owns report controls, the dashboard-local
source, report tile editor and renderers. `data/dashboardCreditInventory.ts` is
the explicit current-inventory read adapter. `ConsumptionDashboard.tsx` remains
the compact compatibility experience in Cost Controls. Both entry points reuse
shared projections and charts; neither defines capture reconciliation policy or
imports from a sibling feature.

The store uses module-level immutable array replacements and
`useSyncExternalStore`. Snapshot getters return the same array until a write;
do not make a getter reconstruct an array on each read. There is no additional
app-wide React context.

## Acquisition lifecycle and flow contracts

```mermaid
sequenceDiagram
    participant UI as Cost Controls / future caller
    participant Client as acquireCreditReport
    participant Generate as Generation flow
    participant V2 as Admins V2
    participant Download as Download flow
    participant Store as Session collection
    UI->>Client: Confirmed name + inclusive UTC range
    Client->>Generate: Report name, end date, start date, Daily
    Generate-->>Client: reportlocation
    loop At least 30 seconds between checks
        Client->>V2: GetLicensingReportOperation(name, operationId)
        V2-->>Client: Running / Succeeded + fileName / Failed
    end
    Client->>Download: Report name + generated file name
    Download-->>Client: result: CSV string
    Client->>Client: Decode / validate / normalize
    Client-->>UI: ReportResult(CreditReport)
    UI->>Store: retainCreditReport(capture)
```

The default path is **Power Platform for Admins V2 reporting**, through two
registered Power Automate adapters where SDK response handling requires them.
It does not use MAC/Graph or the generic HTTP wrapper.

### Generation: `PP-Request-Credit-Licensing-Report`

| Registered input | Meaning |
|---|---|
| `text` | `BillingDetailsPerEnvironment` or `FeatureDetailsPerResource` |
| `text_1` | Inclusive UTC end date, `YYYY-MM-DD` |
| `text_2` | Inclusive UTC start date, `YYYY-MM-DD` |
| `text_3` | `Daily` |

Output: **`reportlocation`**, a text initial operation URL, or failure text.
The flow must return the initial asynchronous location, not wait and return
only final `status`/`fileName`. An unsuccessful SDK result, blank output or
non-URL failure message is surfaced. Submission is never automatically retried:
an uncertain response may already have created a server job.

`client.ts` accepts validated operations on `api.powerplatform.com`, or the
Admins V2 `*.azure-apihub.net/apim/powerplatformadminv2/<connection>/...` route.
The report name must match and the operation ID must be safe. **Only the
operation ID is extracted**. The app never fetches the returned URL or changes
connections based on its contents.

### Polling: direct Admins V2

`GetLicensingReportOperation(name, operationId, "2024-10-01")` returns
`Running`, `Succeeded` or `Failed`. Success must include a file name.

The connector transport waits at least **30 seconds** before the first poll
and between running results. A longer exposed `Retry-After` is respected;
absent retry headers are allowed on this transport. Invalid exposed retry
metadata stops acquisition. The local timeout is two hours.

### Download: `PP-Download-Credit-Licensing-Report`

| Registered input | Meaning |
|---|---|
| `text` | Report name |
| `text_1` | Generated file name, including its server suffix |

Output: **`result`**, the CSV body as a JSON text output, not the HTTP envelope.
The SDK already decodes JSON string escapes. Do not blindly replace escaped
characters in the CSV; they can be legitimate field values.

The installed Code App SDK attempted to parse the direct action's `text/csv`
response as JSON and returned `Invalid response format` with no usable data.
The flow preserves the CSV in a JSON output so parsing can happen in the app.
A server name ending in `.gz` does not prove its returned body is compressed.
Gzip detection is by magic bytes; an uncompressed downloaded CSV loses the
misleading `.gz` suffix when saved.

The generation flow similarly preserves the operation location which the
direct generation SDK path did not expose reliably. These are runtime adapter
decisions, not a claim that the underlying connector cannot generate/download.
Reevaluate both adapters when the SDK or reporting API changes, with actual
response verification. Never hand-edit generated clients or installed SDK code.

### Results, cancellation and resume

`acquireCreditReport` returns `ReportResult<CreditReport>`: an explicit success
or an error with resumable job information and, where appropriate, diagnostics.
It **does not** insert its result into the store. Only retain successful results.

Use an `AbortSignal` and save `onJob` updates. Stopping or navigating away stops
local waiting; it does not cancel server generation. An in-flight SDK call is
not cancellable, so late results are discarded.

Resume with the original report type/range and saved operation ID or completed
file name. Resume never submits another generation request and may reference
historical dates outside the current new-request window. Terminal failed
operations cannot be resumed. Jobs are held separately, one per report type,
and disappear on reload; exporting captures does not export resumable jobs.

`createConnectorReportTransport(generate)` supplies the same polling/download
implementation with an injected generation function returning `{ location }`.
The explicit API transport remains an alternate internal adapter for typed
callers/tests, never an automatic fallback. Its retry-header requirements
differ from the connector's fixed minimum polling interval.

## Capture model, source and dates

A `CreditReport` is one **immutable captured file**:

| Field | Meaning |
|---|---|
| `id` | New capture UUID; importing the same file again creates another capture |
| `schemaVersion` | Capture model version, currently `1`; not the service API version |
| `name`, `granularity` | One supported report type and `Daily` |
| `source` | `connector`, `power-platform-api` or `upload` |
| `loadedAt` | Client retrieval/import timestamp, not service generation time |
| `requestedRange` | Original request bounds when known; generally absent on uploads |
| `tenantAssignment` | Optional explicit operator-provided tenant GUID + assignment time, separate from original CSV cells |
| `observedRange` | Minimum/maximum dates actually present; `null` for header-only files |
| `columns`, `rows` | Original column names plus normalized rows with original `cells` |
| `fileName`, `original` | Saved name and exact received/imported `Blob` |

Normalized rows expose `date`, lowercased `environmentId`, `environmentName`,
numeric `first`/`second`, and all original string `cells`. Newline/quote-bearing
names and additional report columns survive ingestion.

**Three different concepts must stay distinct:**

- **Requested period:** which dates were asked for. It does not prove every
  environment/resource/date was returned.
- **Observed period/days:** which dates have rows. Min/max endpoints do not
  imply continuous coverage. Missing dates are unknown, not zero.
- **Retrieval time:** when this client loaded the file. Reports may lag by
  about a day; a newer import can contain older service data.

`defaultReportRange(now)` returns the previous 30 complete UTC days.
`reportRangePreset(30 | 7 | 1, now)` supports the editable request shortcuts.
**Last 24 hours means the last complete UTC day**, not rolling hourly data.
New requests are restricted to the previous 30 complete UTC days; all bounds
are inclusive. Manual edits switch the UI preset to Custom.

Report cells may use `YYYY-MM-DD` or midnight timestamps, including
`2026-11-01 00:00:00.0000000`. Normalize only valid midnight values. Request
dates remain strict `YYYY-MM-DD`; invalid calendar dates, non-midnight times
and nonzero fractional seconds are rejected rather than rounded.

## Retention and compatibility APIs

| API | Contract |
|---|---|
| `retainCreditReport(capture)` | Retain a capture and its original. An existing ID is updated in its existing position; new IDs append |
| `getCreditReportCaptures()` / `useCreditReportCaptures()` | Every retained capture in collection order |
| `removeCreditReportCapture(id)` | Remove one capture; reconciliation can reveal its older daily rows again |
| `clearCreditReports(name?)` | Remove all captures of a type, or all types when omitted |
| `getCreditReports()` / `useCreditReports()` | Compatibility view: newest loaded individual capture per type, **not** holistic data |
| `replaceCreditReport(capture)` | Legacy alias for `retainCreditReport`; updates the compatibility view without discarding history |
| `saveReportJob` / `useReportJobs` | Separate resumable acquisition state |

Storage defaults to **this running app's memory**. Navigation/remount preserves
it; reload/closing the player loses it unless browser retention is enabled.
**Browser history and privacy** offers explicit consent to IndexedDB retention
on this app origin in this browser profile. It is not app-encrypted or shared
across devices; do not enable it in a shared browser profile. Browser cleanup,
quota limits or eviction can remove it. ZIP backups remain important.

`initializeCreditReportRetention()` restores the opted-in collection once per
app lifetime. Originals are reparsed and validated before any saved capture is
hydrated; original IDs, load timestamps, request bounds and tenant assignments
are preserved. Existing in-memory captures take precedence on ID collisions and
load-time ties. Only originals and metadata are saved, not trusted parsed rows.
`setCreditReportRetention(true)` saves current captures and subsequent collection
changes; `false` deletes the saved collection without clearing session memory.
Writes are serialized and transactional, with a 100 MiB original-byte limit;
quota/corruption/blocked-storage failures are visible and do not discard session
data. Failed writes leave the previous saved collection intact. A failed
deletion must be retried before claiming saved data is gone.

There is no cross-tab synchronization or Dataverse persistence. Use a single
app tab for retained history; concurrent tabs are not a shared warehouse.
Resumable jobs and current inventory matches remain session-only.
Keeping the app open does not itself run daily collection.

Captures accumulate until explicitly removed or the session ends. The UI shows
the number of captures and total original-byte size, not total browser heap:
parsed strings, objects, derived views and ZIP buffers use additional memory.
There is no collection-wide eviction policy. For large collections, export and
remove older captures; this is not yet a durable data warehouse.

`findCoveringCreditReport(captures, name, range)` finds the newest non-upload
capture whose **requested** period includes the selected bounds. It powers
the duplicate-request notice and a View loaded action. It neither claims
verified coverage/freshness nor silently skips a new request. An explicitly
confirmed request can always ask the service again. Uploads are not treated as
evidence that a requested period has already been acquired.

## Reconciliation: newest loaded capture wins per reported UTC day

Call `reconcileCreditReports(captures, name, scopeKey)` for holistic analysis.
It returns a `ReconciledCreditReport`, or `undefined` if no captures of that
report type exist. An invalid scope, or omitting the scope when multiple scopes
exist, throws an actionable error.

### Reported tenant scopes

`creditReportScope(capture)` and `creditReportScopes(captures, name)` derive
scopes from the exact **`TenantID`** CSV column, trimming and lowercasing IDs.
A capture joins a reported tenant only if **every row has a nonempty ID and
all IDs match**. Unknown, partially populated, mixed-tenant and header-only
captures each receive their own `capture:<id>` scope.

Consequences:

- Different tenant claims and different report types never reconcile together.
- Two files without tenant IDs are not silently assumed to belong together.
- A header-only capture cannot erase earlier observed days or establish tenant
  identity from its request period.
- A matching uploaded `TenantID` allows reconciliation, but is a file claim,
  **not identity/completeness verification**. This mechanism is not an access
  control boundary. Do not use it as proof of which tenant the invoker owns.

### Explicit operator tenant assignment

Some actual resource exports omit `TenantID`. In **Capture analysis > Assign a
tenant to this capture**, an operator can confirm its originating tenant GUID.
`assignCreditReportTenant(capture, tenantId)` validates the GUID and rejects
every conflicting nonempty CSV `TenantID`; it never overrides mixed claims.
The assignment is separate metadata, leaving original bytes, capture ID and
`loadedAt` unchanged. The assigned capture deliberately joins that tenant's
scope for its own report type. Removing the assignment returns to CSV-derived
scope rules. This is operator-provided provenance, **not verification**, and is
included in browser retention and the ZIP manifest. Extracting/reuploading only
an original CSV cannot restore this metadata.

The UI prefers known reported-tenant scopes, exposes the scope selector in
holistic mode, and keeps unassigned unknown/mixed files selectable separately.
Tenant verification against an identity authority and additional CSV schema
aliases remain future work; neither is inferred from filenames.

### Algorithm

1. Select one report type and one scope.
2. Sort captures ascending by parsed `loadedAt`. Equal timestamps preserve
   collection order, so the later-added capture wins a tie. Updating the same
   capture ID does not change its collection position.
3. Group each capture's rows by normalized UTC date.
4. For each date actually present, replace the previous **entire row-set** of
   that day with the newer capture's row-set. Do not add overlapping captures
   and do not invent row identities for deduplication.
5. Keep older days not present in the newer capture. Sort resulting days
   ascending and record each day's winning capture ID.

Rows within a winning day's capture remain unchanged, including duplicates
already in that original file. This policy avoids cross-capture duplication;
it does not repair malformed business data or prove an uploaded day complete.

### Example: rolling 30 days plus daily collection

All captures below have the same report type and reported tenant.

| Capture | Loaded | Reported rows |
|---|---|---|
| A | Nov 2 | Oct 3 through Nov 1 |
| B | Nov 3 | Nov 2 |
| C | Nov 4 | Nov 3 |
| D | Nov 4, later | Corrected Nov 1 only |

The holistic view covers the **reported** days Oct 3 through Nov 3: A supplies
older days, D replaces all Nov 1 rows, B supplies Nov 2, C supplies Nov 3.
If A had two resources on Nov 1 and D has one, that day's second resource is
not kept as a stale extra row. If D has no Nov 2 rows, B's Nov 2 rows remain.
Deleting D restores A's Nov 1 rows. Original A/B/C/D files remain exportable.

When an older service report is imported today, today's import time can make
it win against an earlier-loaded download. Prefer individual-capture analysis
when investigating that distinction, or remove the unwanted capture. Never
label the reconciliation policy "newest server data wins".

### Derived view contract

`ReconciledCreditReport` shares analysis fields with `CreditReport`, but has
`source: "reconciled"`, `scopeKey`, `captureIds` and `daySources`.
`captureIds` includes all captures selected for that scope; `daySources`
identifies actual contributors and winners. Its `loadedAt` is the latest
selected capture's load time. `observedRange` is derived from winning rows.

It intentionally has **no `original`, `fileName` or requested period**.
It is a projection, not a newly captured file. Do not retain it in the capture
store or pass it off as an original. Its columns are the union of selected
capture columns, retaining their encountered order; absent optional cell values
export as empty strings, not invented zeros.

## Analysis and safe consumption math

| Report | `first` | `second` |
|---|---|---|
| `BillingDetailsPerEnvironment` | `CapacityPackCreditsConsumed` | `PayGoConsumedQuantity` |
| `FeatureDetailsPerResource` | `BilledCredits` | `NonBilledCredits` |

Environment billing is the first tab, default empty-state dataset and first
report acquired when requesting both. With existing captures the initial
selection prefers billing when available.

`selectReportRows(view, filter)` applies inclusive local date bounds,
environment ID and case-insensitive search across returned cell values.
`aggregateReportRows(rows, dimension)` groups by `date`, `environment`,
`resource`, `Feature` or `Product`. Resource keys include the environment ID:
the same solution bot ID can occur in multiple environments.

The same selectors accept individual captures and reconciled views. The UI's
date/environment/search filters affect charts, totals, rankings and inspected
rows, not acquisition, retention or exports. Clearing filters restores all
loaded dates. Grouped tables and raw rows are paginated.

**Do not change these invariants:**

- Never add the two report types together; they are different perspectives on
  usage, not independent piles of credits.
- `AllocatedCapacityPackCredits` is a daily snapshot, not consumption. Keep it
  in raw cells; do not sum it over dates as usage.
- Credits are not currency and no unit-price conversion is inferred.
- Missing dates, resources, reports and identities do not mean zero/deleted.
- Resource rankings can contain non-agent types. Inspect/filter `ResourceType`
  before claiming a ranking is "top agents".
- Preserve negative adjustments and finite decimal values. Aggregation uses
  JavaScript numbers, not an exact-decimal financial ledger; original numeric
  strings and bytes remain available. Overflow is surfaced as an error.

## Reusing data in another feature

Import from `../../shared/credit-reports` (adjust the relative prefix to your
feature), not from `features/cost-controls`. No new acquisition is needed to
read the session collection.

An imperative consumer can select a tenant scope and project environment usage:

```ts
import {
  aggregateReportRows, getCreditReportCaptures,
  reconcileCreditReports, selectReportRows,
} from "../../shared/credit-reports";

// scopeKey must come from an explicit creditReportScopes(...) selection.
export function billingByEnvironment(scopeKey: string, startDate: string, endDate: string) {
  const view = reconcileCreditReports(
    getCreditReportCaptures(), "BillingDetailsPerEnvironment", scopeKey,
  );
  if (!view) return { state: "not-loaded" as const };
  const rows = selectReportRows(view, { startDate, endDate });
  return {
    state: "ready" as const,
    groups: aggregateReportRows(rows, "environment"),
    observedRange: view.observedRange,
    daySources: view.daySources,
  };
}
```

A reactive dashboard/detail component can use `useCreditReportCaptures()` and
memoize reconciliation by `[captures, reportName, scopeKey]`, then filtering
by the local filter object. Render a not-loaded/choose-scope state explicitly.
Do not call acquisition in an effect just because a panel mounts, and do not
sum `getCreditReports()` or all captures to obtain holistic usage.

For environment groups/zones, join normalized environment IDs against the
appropriate shared inventory membership data **after** reconciliation. For a
resource detail, join by environment ID plus resource ID, not display name or
bot ID alone. Group membership is not embedded in these CSVs, and historical
membership cannot be inferred from today's inventory. Consumption & Value
implements an explicit current-inventory match; wiring this data into other
feature detail pages and configurable dashboard tiles remains future work.

## Consumption & Value

### Editable Dashboard template

Open **Dashboards > New dashboard menu > From template: Consumption & Value**.
The template creates a saved dashboard with **Overview**, **Nonbilled consumption**,
**Billed consumption**, **Agent families** and **Funding** tabs. The data-management
page also provides **Create editable Consumption & Value dashboard**.

The canvas uses native dashboard tabs and tile placement, the same shared card
frame, centered KPI typography, table styling and edit menu as Estate tiles.
Turn on **Edit mode** to rename, resize, duplicate, move or delete report tiles.
**Add tile** defaults to a report on reporting dashboards; its menu also offers
inventory/query tiles. The report editor selects resource consumption vs environment funding,
credit total/trend/ranked bars/breakdown table/family matrix/allocation snapshots,
the metric, grouping and optional per-tile time buckets. **Add tile** still adds
ordinary inventory/query tiles through that menu; those retain their existing
behavior and do not inherit credit-report filters.

Report tiles use the explicit `source: "credit-report"` and `creditReport`
configuration, not count-oriented `computed` aggregators, raw clauses or builder
queries. Their placeholder `QuerySpec` is never executed. This separate rendering
seam preserves signed credit amounts and null activity gaps. Tile and tab edits
persist in the existing dashboard localStorage store. Reporting filters and
inventory matches are dashboard-session-local, not persisted or shared with other
dashboards.

The compact date/period/environment toolbar applies UTC dates and environment
to consumption and funding. **Data & filters** reveals scope selection,
advanced filters and a single About reports/coverage disclosure instead of
repeating setup instructions, headings and caveats in every tile. Chart values
remain available through disclosures; table tiles use the Estate-style **Show
more** flow with an initial row count selectable in the editor.
The consumption tenant scope and funding tenant scope are independently explicit.
Product, feature, search, resource, current group and schema-family filters apply
only to consumption. Selecting a named ranking/breakdown entry applies its filter
across report tiles; removable filter buttons provide the way back. Trends follow
the reporting granularity unless the tile has an explicit override. Schema family
selection exposes monthly environment comparisons; matrix cell selection bounds
the global date filter to the observed environment/month.

On schema-family/current-group tabs, an **Agent inventory** section exposes the
matching action directly. Before matching, family tiles show an actionable
not-yet-matched state rather than claiming that all schemas failed to resolve.
After matching, the section reports matched agent schemas against all reported
resource instances. Non-agent usage, missing schemas, unmatched IDs and conflicting
identities remain in totals; they are not called deleted agents. Exact joins
index both inventory `name`/`AgentRow.id` and documented `botId` as aliases, always
qualified by environment. A conflicting alias mapping stays unresolved. No
display-name, Entra application-ID or fuzzy join is performed.

### Managed app consumption

New Consumption & Value templates include an editable **Managed app consumption**
tab. Existing saved dashboards can add it with **Add managed app tab**, without
replacing or resetting their existing tiles. Each app tile persists
`creditReport.scope: "managed-apps"`; this intersects the current reporting
filters with the exact `ScenarioName: CopilotStudio_AppStudio`. App and non-app
credits are never mixed in these tiles. A report without `ScenarioName` reports
unavailable attribution rather than assuming a zero app total.

The tab provides total/billed/nonbilled credits, a daily credit line, a rolling
30-day line, current environment-group and environment rankings, an app-instance
table and feature breakdown. Selecting group, environment and app progressively
filters the same lines/totals. Names join exact environment ID + resource ID to
current managed (`microsoftApp`) inventory. App names, environment names and
group membership reuse the Managed Apps Estate reader without fetching ACP rule
assignments. Complete environment/group mappings also cover historical app IDs
no longer present in current app inventory. Unmatched AppStudio resources remain
in totals; same names or IDs in different environments are not fuzzy matched.
Current groups are not claimed as historical membership.

AppStudio is a combined scenario bucket: building versus playing is not
distinguished until the source reports a reliable classification. Credits are
not currency. The line connects adjacent reported points only, retaining null
activity gaps. Rolling values are **observed credits over the 30 UTC calendar
days ending on each plotted date**, including available lookback before From.
Date filters bound plotted endpoints, not that lookback; all other consumption
filters remain applied. Missing days are not zero-filled, windows below 30
reported days are explicitly partial, and missing resource activity remains
unknown even when report-day coverage is 30/30. Rolling values overlap and must
not be added across endpoints.

One dashboard-local source subscribes to the existing capture store. New captures
are reconciled before every projection; mounts and Refresh never generate reports
or silently request current inventory. Explicit inventory matching requires scope
confirmation and is discarded when consumption scope changes. **Manage Daily report
data** opens Capture analysis for uploads, requests, tenant assignments, originals,
exports and opt-in browser retention. Enabling retention is necessary to restore
report originals after a browser reload; saving a dashboard alone does not retain
its data.

Allocation snapshot tables expose all environment/entitlement/policy rows via Show more,
including duplicate rows on the latest day. Funding does not expose resource,
feature, schema or current-group attribution unavailable in its report.

### Compact compatibility experience

The existing experience inside Power Platform credit usage offers:

- **Overview:** billed/nonbilled totals, reported resource/environment counts,
  nonbilled mix, largest-resource concentration and top environment bars.
- **Consumption explorer:** total/billed/nonbilled ranking, environment/resource/
  product/feature/channel/model/tool grouping, composable date/category/search
  filters, resource detail and feature drilldown. Current environment-group and
  schema-family grouping becomes available after inventory matching.
- **Agent families:** exact-schema candidates across environment-scoped matched
  resource IDs, monthly grouped environment columns and a paginated activity
  matrix. Selecting a cell drills into its environment/month with the existing
  date bounds respected.
- **Funding:** a separate report scope and filter state, capacity/PAYG trends,
  environment ranking and latest allocation-day rows by environment/entitlement/
  policy. Allocation duplicates on that latest day are retained, never summed.

Every view reconciles captures before filtering; it does not add capture
snapshots together. Resource/funding classifications and consumption/billing
date bases differ and totals are **not expected to reconcile**. Switching to
Funding never carries feature/model/resource filters into billing facts.

Daily, Monday-UTC weekly and monthly trends include missing periods as null,
not zero. Partial calendar periods carry an asterisk and a reported/calendar-day
table. Report-day presence is not proof of complete resource coverage. Filters
are local; report arrival updates the view without new generation calls.
Rankings use the selected metric, preserve negative adjustments and include
Other in chart totals. Percentage mix is disabled for signed adjustment rows;
zero or negative cohorts do not produce misleading concentration percentages.
Numbers are rounded for display, with very small nonzero values retained;
originals and Capture analysis retain greater numeric detail.

**Inventory matching is explicit and read-only.** The operator confirms the
report scope belongs to the connected inventory tenant. All agent pages are
drained with both offset and token through the existing inventory data layer;
errors/nonadvancing pages do not apply partial matches. Join by normalized
environment ID + resource ID. No fuzzy/display-name matching. Conflicting
schema matches remain unresolved, and unresolved usage stays in totals.
First-party agent consumption is not silently discarded.

Exact schema equality yields **family candidates**, not proof of a shared ALM
pipeline. Current group/type/schema metadata is labeled as current, not
historical. Missing monthly activity does not prove deployment absence or
deletion. Neither nonbilled credits nor a channel name proves license coverage;
these views make no currency, savings or business-ROI claims.

## Collection ZIP and restoration limitations

`exportCreditReportArchive(captures)` returns a ZIP `Blob`. The UI passes **all
retained captures**, including other report types/scopes, regardless of current
analysis filters or selected capture.

```text
originals/
  001-<safe-original-file-name>
  002-<safe-original-file-name>
reconciled/
  BillingDetailsPerEnvironment-1.csv
  FeatureDetailsPerResource-1.csv
  ...
manifest.json
```

Original paths have unique numbered prefixes and sanitized names; they cannot
traverse out of the archive. Every original's bytes are preserved, including
actual gzip compression. Download-flow originals are the exact CSV body
received from that flow, not an HTTP envelope or a reconstruction of bytes the
flow did not return.

Derived CSVs are separate per report type **and scope**, contain winning rows,
and escape CSV commas, quotes and line breaks. They preserve original cell
strings and union additional columns. The archive uses uncompressed ZIP
entries to avoid synchronously recompressing large originals. Export builds
additional in-memory buffers; it is not a streaming archival service.

The manifest records export time, policy, capture IDs/source/load time,
requested/observed ranges, original entry paths and row counts. Every derived
entry records its report name, scope, selected capture IDs and
`daySources: { "<UTC date>": "<winning capture ID>" }`.

**ZIP import is not implemented.** Browser retention can automatically restore
its own opted-in collection, not a ZIP. Extract and
upload individual original CSV/gzip files if needed. Reimporting creates new
IDs and import timestamps; it does not restore original priority/provenance
from the manifest. A derived CSV is also ingestible if it meets the schema,
but will be an uploaded projection, not proof of its source captures.

Original and derived files can contain sensitive tenant information and
untrusted text cells. Export/share deliberately; importing/exporting is not
anonymization or spreadsheet-formula sanitization. Never commit real tenant
captures as fixtures.

## Validation and extension seams

Parser limits are **25 MiB per compressed and expanded file** and **200,000 data
rows per file**. Header-only files are valid. Required column names are
case-sensitive. Malformed CSV, duplicate/empty headers, invalid dates, missing
or nonfinite numeric fields, mismatched downloaded type and out-of-request
rows fail explicitly. All optional original columns are retained.

Tests:

| File | Focus |
|---|---|
| `shared/credit-reports/files.test.ts` | CSV/gzip/schema/date validation, exact originals, limits and selectors |
| `shared/credit-reports/client.test.ts` | Mocked acquisition, flow contracts, operation URLs, polling, cancellation, resume and failures |
| `shared/credit-reports/collection.test.ts` | Daily replacement, disjoint/absent days, load-time ties, tenant isolation, presets, compatibility store, ZIP bytes/quoting/provenance |
| `features/cost-controls/PowerPlatformCredits.test.tsx` | Billing-first requests, confirmation, presets/manual edits, import, scope modes, local filters, cache notice and exports |
| `shared/credit-reports/persistence.test.ts` | Reparsed originals, retained priority/IDs, validated tenant assignment and atomic restoration validation |
| `shared/credit-reports/consumption.test.ts` | Environment-scoped identities, filtering, signed totals, metric ranking, Other, weekly/monthly coverage, latest funding snapshots |
| `features/cost-controls/ConsumptionDashboard.test.tsx` | Overview/resource drilldown, isolated funding, explicit inventory matching, family matrix drilldown and reactive reconciliation |
| `data/dashboardCreditInventory.test.ts` | Complete token/offset paging, nonadvancing pages, read failure and cancellation |
| `features/dashboards/DashboardDetail.test.tsx` | Native report controls, reconciliation, separate funding, persisted tile edits/duplicate/move/add, family matching and bounded drilldown, empty/errors and allocation pagination |
| `data/dashboardTemplates.test.ts` | Fresh report template tile IDs, populated tab layout, perspective isolation and persisted configuration alongside existing Estate templates |

From `PP-CoE-CodeApp`, run:

```powershell
npm run test:run -- src/shared/credit-reports src/features/cost-controls/PowerPlatformCredits.test.tsx src/features/cost-controls/ConsumptionDashboard.test.tsx src/data/dashboardCreditInventory.test.ts
npm run test:run -- src/features/dashboards/DashboardDetail.test.tsx src/data/dashboardTemplates.test.ts src/data/dashboards.test.ts
npm run lint
npx tsc --noEmit
npm run build
```

Mocked tests do not establish cloud generation, destination consent or
cross-tenant deployment. For authentication failures, verify invoker identity
and activate eligible PIM roles where required. For missing operation metadata,
inspect/resume rather than resubmitting. For missing file content, verify the
download flow's `result` output and existing filename before creating new jobs.
Safe shape/stage console diagnostics do not include report rows; avoid adding
raw CSV, tokens or connection URLs to logs.

Future Dataverse persistence should store **captures and provenance**, not only
an ever-growing summed table. Preserve schema version, tenant verification
status, capture ID/time, requested/observed periods, original-file references,
normalized rows and ordering policy. Hydrate validated captures into the shared
store and reuse the pure reconciler. Design retention, authorization, at-rest
storage, original service generation timestamps, exact-decimal requirements and
multi-user conflict rules explicitly before implementing scheduled collection.
Do not silently enable persistence or introduce a new global state provider.

Both registered flows must be included in the actual solution with their
logical references and invoker/dependency mappings intact. For authorized
publishing, follow [`solution/README.md`](../../solution/README.md); registration,
passing local tests or a successful CLI exit is not proof of a deployable
cross-tenant managed ZIP.
