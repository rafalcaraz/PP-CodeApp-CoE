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

## Standard for future connectors

New connector playgrounds must reuse `shared/api-explorer/playgroundStyles.ts`,
`SchemaField`, and `ResponseViewer` rather than introduce a separate interface.
Keep request inputs and the last response in distinct responsive panels, with
highlighted response search, match counts, next/previous navigation, and line
wrapping. Group these pages under **Playgrounds** in the left navigation.

Use the connector's registered SDK or generated service contract, require
explicit execution, and retain per-request write confirmation. Do not introduce
automatic calls or persist response data. Connector-specific fields and
transport limitations should remain visible.

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
24 actions: all 22 documented operations and both read-only `$ref` list variants.
Every action has an explicit, typed generated-service dispatch; missing
registration/dispatch is shown as unavailable rather than bypassed with a raw
SDK/HTTP call. Power Apps supplies `connectionId` and authorization.

Category, name/route search and read-only filters do not execute requests.
Request inputs reuse `SchemaField`; previews show the Graph URL, query, headers
and JSON body passed to the connector. Optional blank fields are omitted;
`false` and `0` remain literal values. The ten existing-policy mutations expose
a required parent `If-Match` header, including service creation, alert creation
and reference edits. Policy creation itself has no `If-Match`. Copy the current
parent ETag verbatim, not a child ETag or `*`; the page never fetches a token
automatically. Request/schema checks include limited/unlimited quantities and
percentage/absolute threshold rules. The service still validates supported
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
snapshots/governance, not rated currency, history or per-agent costs.

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

Open **Cost Controls** > **Credit reporting** (`#/cost-controls/reporting`) or
**Policy management** (`#/cost-controls/management`). Both use the registered
`CostControsl_CustomConnService` directly, with no passthrough flow or raw HTTP
client. The playground remains available independently.

Reporting reads the tenant credit snapshot on entry and explicit refresh.
Consumed and remaining credits are charted per billing method, with exact values,
units and source freshness in an accessible table. Missing quantities are not
zero, and remaining credits are never inferred by subtraction. Known-user
diagnostics run only after submitting an Entra object ID: current-month service
consumption, configured limits, effective capacity, selected policy and access
decisions are shown alongside partial-evaluation and continuation notices.
Reporting has no mutations, user-directory scan, stored history or currency,
per-agent or per-environment attribution.

Management reads the policy list on entry. Select a policy or open a known ID
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

Graph beta, delegated-consent/runtime-role requirements, one-page collections,
and the SDK's void creation responses/header limitations still apply. Creation
does not manufacture a returned policy ID; inspect the refreshed list or open
the known ID. No deployment or real-tenant mutation is implied by local tests.
