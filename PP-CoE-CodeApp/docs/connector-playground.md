# Connector playground

Open **Playgrounds** > **Connector playground** in the left navigation (`#/connector-playground`)
to run individual **Power Platform for Admins V2** actions. This is a live
connector explorer, not a simulator or dry run. The existing app admin gate,
Power Apps connection, and connector-side permissions still apply.

Search for an action by its name, operation ID, description, or category.
Use **Action category** to narrow the list and **Clear filters** to start over.
The read-only filter hides write-capable operations. Select an action, fill
in its required inputs, and click **Run action** or **Review and run**.
API versions start with the defaults declared for that specific operation.
Optional blank inputs are omitted. `connectionId` is supplied by the Power
Apps runtime, not entered manually.

Body inputs accept JSON. **Insert JSON template** creates a required-only
starting point; replace its placeholders before submitting. Expand the
request schema to see available properties and referenced schema names.
Basic schema validation catches invalid JSON, missing required properties,
incorrect types, enum values, and declared bounds. The connector remains
authoritative for business rules, permissions, and dynamic schemas.

GET operations and the known read-only `QueryResources` POST run directly.
All other operations, including general-purpose MCP actions, require a
separate dialog showing the exact request and typing the operation ID.
Confirmation applies only to that request; it is never remembered. Actions
can affect permissions, billing, availability, or delete resources. There is
no automatic undo, retry, polling, or pagination.

The last result shows its operation ID, duration, SDK response envelope
(including the raw data), or connector error, plus the submitted request.
Inputs and results live only in page memory and are not written to local
storage. Navigating away clears them. Treat results as potentially sensitive.
Attempted writes invalidate the inventory query cache, including ambiguous
failures where the server may already have applied a change.

The request and response panels remain separate, with the response staying
visible on wider screens while you edit inputs. **Search response** highlights
literal, case-insensitive matches without filtering or changing the output.
Use the next/previous buttons or Enter/Shift+Enter to jump between matches;
Escape clears the search. **Wrap lines** controls long-line display. The last
response remains searchable even when the action filters have no matches.

All three playgrounds share **Copy response**, which copies the complete text
of the selected response tab, unaffected by search highlights or line wrapping.
Expand **Response headers** to inspect and copy exposed headers, including
`Location`, `Retry-After`, and `ETag`. A separate **Copy submitted request**
button inside the submitted-request section copies the exact saved invocation,
not the inputs currently being edited. Copying is explicit and reports success
or a visible clipboard-permission error with a manual-copy alternative.

Headers and submitted requests start collapsed. The inspector does not invent
headers: it explicitly says when none were exposed by the SDK or flow. Direct
SDK headers, nested HTTP envelopes with numeric status, and exposed error
response headers are supported; arbitrary business payload fields named
`headers` are not treated as HTTP metadata. Failed Admins V2 calls retain their
SDK envelope for inspection too. The viewer cannot recover a `Location` header
that a connector or deployed flow omitted, and never follows it automatically.
Copied content can contain sensitive tenant data; share it carefully.

## Standard for future connectors

New connector playgrounds must reuse `shared/api-explorer/playgroundStyles.ts`,
`SchemaField`, and `ResponseViewer` rather than introduce a separate interface.
Keep request inputs and the last response in distinct responsive panels, with
highlighted response search, match counts, next/previous navigation, and line
wrapping. Group these pages under **Playgrounds** in the left navigation.
Reuse its expandable header/submitted-request sections and explicit copy
controls too; pass only headers actually exposed by the transport and keep
the submitted request associated with its original result.

Use the connector's registered SDK or generated service contract, require
explicit execution, and retain per-request write confirmation. Do not introduce
automatic calls or persist response data. Connector-specific fields and
transport limitations should remain visible.

## Licensing report payload examples

Select **Licensing Reports / Generate Licensing Report** for an editable
example based on the [Copilot Credit usage reports tutorial](https://learn.microsoft.com/en-us/power-platform/admin/programmability-tutorial-download-copilot-credit-usage-reports?tabs=powershell).
Selection prefills `ReportName` with `FeatureDetailsPerResource` and the
**body (JSON request body)** textbox with actual payload values, not JSON Schema.
Dates cover the previous 14 complete UTC days, ending yesterday, and the
example explicitly requests `Summary`. Nothing is submitted on selection.

| Field | Where | Required | Values |
|---|---|---|---|
| `ReportName` | Separate path input, not in the body | Yes | `FeatureDetailsPerResource` for usage by agent/resource and feature; `BillingDetailsPerEnvironment` for environment-level capacity-pack and pay-as-you-go usage |
| `startDate` | JSON body | Yes | Inclusive UTC date, `YYYY-MM-DD`; the service enforces the available lookback window (30 days by default in the tutorial) |
| `endDate` | JSON body | Yes | Inclusive UTC date, `YYYY-MM-DD`, on or after `startDate` |
| `granularity` | JSON body | No | `Daily` (service default) or `Summary` (example choice) |

`Daily` retains a date for each report-dimension combination. `Summary` combines
the requested dates per combination and omits the date column; it is not one
tenant-wide total. Output columns such as `ResourceID` and `BilledCredits` are
not request fields. The registered body does not document environment, agent,
or resource filters.

Edit or replace the JSON directly. **Insert report example (last 14 UTC days)**
recomputes the dates and replaces only the body, preserving the selected
report name. **Reset inputs** restores the initial report name and example.
The generic **Insert JSON template** remains available for a required-only
structural starting point. The expandable **Request schema** describes
validation rules; its `type`, `properties`, and `required` keys are not the
payload to send.

The tutorial marks connector `format=json` support as an upcoming December
2026 rollout. The currently registered connector exposes only the three body
fields above, so the example does not add `format`. Its download metadata
declares gzip-compressed CSV. Do not assume the tutorial's future JSON example
is available through this connector version.

Generation still requires the existing exact-request review and typed
confirmation. Use its initial `Location` header to obtain `OperationId` for
**Get Licensing Report Operation Status**; headers are available only if the
SDK exposes them. HTTP 200 can still mean `Running`. Respect `Retry-After`
when returned and check manually. After `Succeeded`, pass `fileName` to
**Download Licensing Report File**, with the same `ReportName`. Neither
status nor download takes a request body. Missing headers are not a reason
to automatically resubmit generation. There is no automatic polling or download.

## Metadata and execution

The catalog is derived from the bundled connector Swagger at
`.power/schemas/powerplatformadminv2/powerplatformadminv2.Schema.json` and
restricted to operation IDs registered in
`.power/schemas/appschemas/dataSourcesInfo.ts`. The page shows the current
registered action count. This reflects the connector metadata checked into the app, not an
automatic claim to track Microsoft's latest upstream release.

The generated `PowerPlatformforAdminsV2Service` can expose fewer methods
than the operations registered with the SDK. With explicit
approval for this exploration surface, `features/connector-playground/data.ts`
uses the same `@microsoft/power-apps/data` client and connector operation
envelope as the generated service. This supports newer registered actions
without editing generated files, introducing an HTTP client, or hard-coding
positional method arguments. Production inventory and enrichment calls remain
unchanged. Regenerating connector metadata updates the explorer's available
actions and inputs; it does not fetch or install connector updates itself.

## Cost Management API playground

Open **Playgrounds** > **Cost Management API** (`#/cost-management-api`) to
explore the registered Cost Controls custom connector. This uses
`CostControsl_CustomConnService` directly (the exact generated name), **not**
`PP-API-Wrapper-Flow`, a passthrough flow, or a new HTTP client. Your existing
connection reference, delegated Graph consent and signed-in user's runtime roles
remain authoritative. The separate **Cost Controls** area provides task-oriented
reporting and management; this page remains an explicitly executed API playground.

The catalog comes from the registered `.power/schemas/` Swagger, resolves
reusable parameter references, and checks app operation registration. It covers
38 actions: all 36 documented operations and both read-only `$ref` list variants.
Every action has an explicit, typed generated-service dispatch; missing
registration/dispatch is shown as unavailable rather than bypassed with a raw
SDK/HTTP call. Power Apps supplies `connectionId` and authorization.

The [standalone connector definition](../../connectors/CostControlsCustomConnector/README.md),
registered catalog and regenerated SDK now include Wave 2's 14 additional
usage-report/credit-request operations. All have direct typed dispatches. A
registration refresh is not proof of permission consent or runtime access.
The checked-in registration's OAuth scope metadata still advertises the earlier
four grants; the broad Read.All grant covers usage reporting, but credit requests
need CreditReq.Read.All/ReadWrite.All and decisions require the latter. Verify the
actual connection scope and consent privately if these operations return 403;
the application does not modify authentication settings.

Complete multi-page reporting still requires verified connector-native nextLink
replay. The refreshed SDK preserves nextLink but has no continuation method.
First-page rankings and request queues are explicitly labeled, not presented as
exhaustive tenant data.

Category, name/route search and read-only filters do not execute requests.
Request inputs reuse `SchemaField`; previews show the Graph URL, query, headers
and JSON body passed to the connector. Optional blank fields are omitted;
`false` and `0` remain literal values. The ten existing-policy mutations expose
a required parent `If-Match` header, including service creation, alert creation
and reference edits. Policy creation itself has no `If-Match`. Copy the current
parent ETag verbatim, not a child ETag or `*`; the page never fetches a token
automatically. Request/schema checks include limited/unlimited quantities,
percentage/absolute threshold rules, completed UTC days, calendar months, exact
seven-digit UTC raw windows, request strong ETags and unique 1-100-item batches.
Credit-request decisions use request-specific strong ETags, not weak parent
policy tokens; the batch action has no If-Match header. HTTP 200 can contain
failed decisions: partial results are not displayed as an all-green success,
and per-item raw results remain available. The service still validates supported
query expressions, directory references, policy-unit matches and other
tenant-dependent rules.

Writes require a separate exact-request review and typing the operation ID for
**each** invocation. Inputs and filters lock during review/execution. No
automatic requests, retries, polling, writes or pagination run. Attempted writes,
including ambiguous failures, invalidate the inventory cache. The submitted
request and complete SDK result stay associated with that invocation even if you
select another action. Shared `ResponseViewer` provides highlighted search,
match navigation and wrapping; inputs/results are kept only in page memory.

**Graph beta is unsupported for production.** List actions return one page;
inspect `@odata.nextLink` rather than treating it as the full dataset. There is
no opaque-URL continuation action in the registered SDK. These APIs expose credit
snapshots, historical usage and governance, not rated currency or per-agent costs.

The generated SDK types `CreateSpendingPolicy` and `CreateServiceSetting`
responses as `void` despite documented HTTP 201 bodies; the page discloses this
and preserves any runtime envelope rather than manufacturing a body. Response
headers are not guaranteed by the generated contract either. The raw inspector
shows whatever the SDK exposes, including errors and any headers, without
claiming access to raw HTTP. Service-setting `parentEtag` is available when
returned; if no fresh parent ETag is exposed, stop instead of inventing one.
The [standalone connector setup guide](../../connectors/CostControlsCustomConnector/README.md)
documents consent, runtime-role gaps and API contract caveats.

## Dedicated Cost Controls

### Power Platform credit usage

Open **Cost Controls** > **Power Platform credit usage**
(`#/cost-controls/power-platform`). This is independent of the MAC/Graph reports
below. It submits through the registered `PP-Request-Credit-Licensing-Report`
Power Automate flow, calls the Power Platform for Admins V2 connector's
`GetLicensingReportOperation` with API version `2024-10-01`, then downloads through
`PP-Download-Credit-Licensing-Report`. The download flow calls the connector and
returns CSV as a JSON text output; the installed Code App SDK otherwise tries to
parse the direct action's `text/csv` response as JSON and discards it.
It does not use `PP-API-Wrapper-Flow`, Graph, a new HTTP client,
or Dataverse storage. There is no automatic transport fallback.

The default request is both `FeatureDetailsPerResource` and
`BillingDetailsPerEnvironment`, with **Daily** granularity for the previous 30
complete UTC days (inclusive). Review the immutable request and type
`GenerateLicensingReport` before submitting. Reports run sequentially; failure
stops later submissions. Requests are never automatically resubmitted.
The workflow requires the initial operation URL from the generation flow,
checks the operation body's `Running`, `Succeeded`, or `Failed` status, and
downloads only after success with a file name. It stops after two hours or
on invalid operation metadata instead of changing transports.
Polling waits **30 seconds** before the first check and between `Running`
responses. If the connector exposes `Retry-After`, the app also respects that
interval and never polls sooner than 30 seconds. Missing retry headers are
allowed on this connector path; no synthetic service header is fabricated.
Delegated admin permissions and preview limitations apply.
Missing operation URLs or damaged binary payloads fail visibly.
For PIM-managed access, activate the
required administrator role for the invoker connection's identity before use.
Revisit this transport and permission setup as reporting APIs gain capabilities;
see the [developer README follow-up](../README.md#credit-reporting-api-access-and-follow-up).

#### Generation flow contract

`acquireCreditReport` defaults to the generation-flow / Admins V2 transport.
Acquisition and resume share the same connector status and download-flow methods.
`createConnectorReportTransport(generate)` remains available for typed adapters
and mocked lifecycle tests; the generic API transport is not an automatic fallback.

The registered trigger takes `text` = report name (`FeatureDetailsPerResource`
or `BillingDetailsPerEnvironment`), `text_1` = end date, `text_2` = start date
(inclusive UTC dates), and `text_3` = **Daily** granularity.
Its sole text output is `reportlocation`: the absolute initial operation URL,
or a failure message. SDK failures, blank outputs, non-URL messages and URLs for
another host/report fail explicitly; no replacement report is submitted.
Accepted operation URLs are the direct `api.powerplatform.com` route or the
Admins V2 gateway route
`https://<gateway>.azure-apihub.net/apim/powerplatformadminv2/<connection>/copilotstudio/licensing/reports/<report>/operations/<operation>`.
Only the operation ID is extracted: the returned host and connection path are
never requested or used to override the app's registered connector connection.
Configure and verify the generate action so it returns the initial asynchronous
response rather than waiting for the final file result; this contract is
specifically for initial submission, not automatic waiting inside the flow.

Verify both report types against real flow/connector responses. Local mocked
tests are not evidence of successful cloud generation or cross-tenant consent.
Both flows must also be included in the solution and their exported dependency/invoker mappings verified
before distribution. If the flow returns only the final
`status`/`fileName`, its response contract must be revisited rather than pretending
those fields are an initial `Location`.

#### Download flow contract

`PP-Download-Credit-Licensing-Report` takes `text` = report name and `text_1` =
the generated file name, including its original suffix. Its `result` text output
contains the CSV body, not the complete HTTP response envelope. The SDK decodes
JSON string escapes; the app passes the resulting CSV directly to the shared
parser without blindly replacing escaped characters in field values.
SDK failures and missing, blank or non-string outputs fail explicitly; the known
file name remains available for retry without regeneration.

The original CSV text is retained for download. If the requested server filename
ends in `.gz` but the returned content is uncompressed CSV, the saved filename
drops `.gz`; filenames do not determine decompression. Daily report dates accept
`YYYY-MM-DD` and midnight timestamps such as `2026-11-01 00:00:00.0000000`.
Normalized rows use the UTC date while original cell values remain unchanged.
Invalid calendar dates and non-midnight timestamps are rejected; request date
inputs remain strict `YYYY-MM-DD`.

Stopping locally or navigating away stops local waiting, not server generation.
Known operation IDs, next-poll times and file names remain available during this
app session. Resume an existing operation, or enter a known generated file name
and its original report type/dates, without submitting another request. A failed
server operation cannot be resumed. A submission with no exposed operation ID
may already be running: inspect the API response rather than generating
duplicates. The SDK cannot cancel an in-flight call; its late result is ignored.

Upload an existing Daily CSV or gzip-compressed CSV through the same schema
validation pipeline. Required column names are case-sensitive. Summary reports,
invalid dates/amounts, malformed CSV and mismatched downloaded report types or
periods are rejected. Header-only reports are valid empty results. Both compressed
and expanded files are limited to 25 MiB, and reports to 200,000 data rows; use
smaller windows for larger tenants. Original files may contain sensitive tenant
data: download and share deliberately.

Analysis includes per-day consumption, environment/resource/feature/product
grouping where applicable, local environment/date/value filters, paged rankings
and inspection of every original column. Resource identities include the
environment ID, not just the bot ID. Resource rankings may include non-agent
resource types. Billed/nonbilled values are separate from capacity-pack/pay-as-you-go
consumption; the two reports are never added together. Daily allocated capacity
is retained as a raw column, never summed as consumption. Credits are not
currency spend. Missing reports/dates/identities are not interpreted as zero.
An uploaded file's tenant, completeness and request period cannot be verified;
its displayed dates describe observed rows.

The public barrel `src/shared/credit-reports/index.ts` provides versioned
`CreditReport` captures, acquisition/import helpers, pure selectors and a
subscribable retained collection. Billing is the first/default dataset. Request
presets offer 30/7/1 complete UTC days with editable dates. A retained download
requested for the same period triggers a notice, not an automatic claim of
freshness or a block on requesting again.

Individual-capture mode analyzes one original. Holistic mode reconciles captures
within one report type and reported tenant: the newest loaded capture replaces
each complete reported day's older rows; absent days keep older data. Unknown,
partially reported or mixed tenant captures remain separate. Matching uploaded
tenant IDs are claims, not verified identity/completeness. The compatibility
`getCreditReports`/`useCreditReports` APIs still expose only the latest individual
capture per type; holistic consumers must use the collection/reconciler.

Local filters do not change retained originals. Export all captures creates a
ZIP with every original, separate per-type/per-scope reconciled CSVs, and a
winning-day provenance manifest. Navigation preserves the collection; reload
loses it. ZIP restoration, scheduled collection, browser/Dataverse persistence,
tenant-group enrichment and dashboard wiring are not implemented.

See the [credit-report framework guide](credit-report-framework.md) for module
ownership, exact flow contracts, date/provenance semantics, reconciliation
examples, public consumer code, archive format and future persistence seams.

### MAC/Graph reporting and management

Open **Cost Controls** > **Credit reporting** (`#/cost-controls/reporting`) or
**Policies & requests** (`#/cost-controls/management`). Both use the registered
`CostControsl_CustomConnService` directly, with no passthrough flow or raw HTTP
client. The playground remains available independently.

Reporting opens on **Usage**, which loads only after choosing a completed UTC day
and submitting it. Services, Users and Groups show the returned top-100 ranking
with a first-ten-row chart and accessible table; counts, loaded rows and nextLink
warnings remain distinct, with no inferred tenant total. A user row can seed a
matching raw user/window investigation; it does not automatically execute it.
**Funding by month** is a separate unpaged report with per-class quantities and
source watermarks. Overage means unbilled consumption, not invoiced spend.

**User investigation** independently displays raw parent, service and session
results, including partial child failures. Window row IDs and nullable native
session IDs are distinct; omitted activity and independent rounding mean child
rows need not reconcile to parents or daily rankings. **Current balances** reads
the tenant snapshot when opened and on explicit refresh. Consumed and remaining
credits are charted per billing method, with exact values,
units and source freshness in an accessible table. Missing quantities are not
zero, and remaining credits are never inferred by subtraction. Known-user
diagnostics run only after submitting an Entra object ID: current-month service
consumption, configured limits, effective capacity, selected policy and access
decisions are shown alongside partial-evaluation and continuation notices.
New historical reports preserve the last successful selection after refresh
failure, label its original period, and ignore superseded or unmounted requests.
Reporting has no mutations, user-directory scan, locally collected history,
currency, per-agent or per-environment attribution. MAC/Graph coverage is explicit;
PPAC-managed Copilot Studio consumption remains a separate source, never added
to these reports. Missing or unavailable sources are not reported as zero.

Management separates **Policies** and **Credit requests**. Policies reads its list
on entry. Select a policy or open a known ID
to inspect its limits, group audience, service categories and notifications.
Guided forms support creating/deleting policies, editing limits and funding,
adding/removing group references, adding or enabling/excluding services, and
configuring alert thresholds and recipient references. Service exclusion uses
the supported state update, not deletion. Policy status and audience type are
not editable fields. New policies start disabled; a selected-group policy needs
its audience linked after creation. Notifications are notify-only; configure
disabled, add recipients, then enable.

Every write requires a separate target/value review and typing the action title.
Existing-policy writes require an observed, consistent parent ETag from the policy
response header, `@odata.etag`, or service-setting `parentEtag`. Missing, malformed,
conflicting or wildcard tokens block writes with guidance; there is no manual
bypass. Immediately before writing, policy details are read again and the
reviewed token must still match. Pending/unknown lifecycle states also block
changes. Known last-group, last-enabled-service and last-enabled-alert-recipient
constraints are checked without treating a partial page as complete.

Inputs lock during review/write. Each confirmed action dispatches once, preserves
its submitted snapshot and actual SDK result, and refreshes policy data after
success or failure. Failed/timed-out writes are not retried automatically; refresh
and re-review before trying again. Missing read bodies and Graph error payloads
are surfaced as errors, not empty successful results. State and raw diagnostics
remain in page memory only.

Credit requests default to pending, with state/service filters and known-ID
lookup. Only pending rows can be selected (up to 100). Review rereads each target,
requires its body strong ETag and names the intended decision; explicit typed
confirmation precedes another fresh token/state check and exactly one batch
write. Unknown or changed states, missing/weak tokens and stale reviewed tokens
block the change. Approval does not allocate credits. Batch outcomes are shown
per item and partial HTTP-200 results are not all-green; failed items need a new
read/review, not an automatic replay of successful decisions.

Graph beta, delegated-consent/runtime-role requirements, one-page collections,
and the SDK's void creation responses/header limitations still apply. Creation
does not manufacture a returned policy ID; inspect the refreshed list or open
the known ID. No deployment or real-tenant mutation is implied by local tests.
