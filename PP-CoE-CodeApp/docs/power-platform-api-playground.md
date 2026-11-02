# Power Platform API playground

Open **Playgrounds** > **Power Platform API** in the left navigation (`#/power-platform-api`).
This is separate from **Connector playground**, which explores the registered
Power Platform for Admins V2 connector. The API playground targets
`https://api.powerplatform.com` and executes exclusively through the generated
`PP_API_Wrapper_FlowService.Run` method for **PP-API-Wrapper-Flow**.

## Explore and run

Browse an API section, resource group, and operation, or search names,
descriptions, and paths. Each operation links to its Microsoft Learn page.
The inventory-schema article describes inventory payloads; the REST API
reference supplies the operation catalog.

The initial selection is **Licensing / Resource Threshold / Get All Resource
Thresholds**. Enter an entitlement ID, such as `MCSMessages`, to preview:

```http
GET https://api.powerplatform.com/licensing/entitlements/MCSMessages/resourceThresholds?api-version=2024-10-01
```

Path and query fields show documented requirements and defaults. JSON bodies
offer a template including writable optional properties, plus expandable
schemas. Templates are starting points, not safe production defaults; replace
IDs and review all settings before submitting. Local validation covers JSON,
required values, types, enums, and documented bounds. The API remains
authoritative for authorization, business rules, and constraints not expressed
in the documentation.

**Delete Waf Custom Rules** requires a top-level string array, such as
`["rule-to-remove"]`, not an object containing a `body` property. Its generated
template is `[]`; replace it with the rule names you intend to remove.

GET and HEAD requests require an explicit click. All other methods require
reviewing the exact method, URL, and body and typing the operation title.
Nothing runs on selection or page load. There are no automatic retries,
pagination, or long-running-operation polls. Writes can be irreversible and
invalidate the inventory cache even when a failure leaves their outcome
ambiguous.

The last result retains parsed JSON or text, raw flow output, the submitted
request, and elapsed time. Inputs and results stay in page memory only and
clear on navigation. Treat them as sensitive.

**Search response** highlights literal, case-insensitive matches in the active
response tab without hiding any output. Jump between matches with the arrow
buttons or Enter/Shift+Enter; Escape clears the search. Switch between
**Response body** and **Raw flow response** to inspect either representation;
the search carries over between tabs. **Wrap lines** controls long-line
display. On wider screens, the response panel stays visible while you edit
request inputs; smaller screens stack the panels.

## Flow contract and limitations

The app maps the three required trigger strings exactly:

| Trigger field | Generated property | Value |
|---|---|---|
| Method | `text` | Documented HTTP method |
| URL | `text_1` | Fully encoded URL on `api.powerplatform.com` |
| Body | `text_2` | JSON text, or an empty string for a bodyless request |

The flow returns `response?: string`. The app parses JSON when possible and
preserves plain text and empty output. A missing output is an explicit error.
Standard API error objects are shown as failures. If the flow returns an
envelope containing `statusCode`, `body`, and optionally `headers`, those are
also displayed and non-2xx statuses are failures. Body-only responses cannot
prove the HTTP status; the app never invents one.

The generated contract does not establish that the flow's HTTP action has
the correct body mapping, audience, permissions, or error-handling branches.
Configure its HTTP connection for the Power Platform API and ensure failures
also return useful response text. The existing Graph and licensing wrappers
are not used or repointed.

The checked-in HTTP `sharedConnectionId` uses a `<connection-id>` placeholder.
Register the flow and its dedicated connection locally with
`pa app add flow --flow-id <flow-id>` from `PP-CoE-CodeApp`; do not commit the
resulting environment-specific connection ID. The solution source also includes
the wrapper flow definition, but not a deployed HTTP connection.

**Portable source is not publish-ready connection configuration.** A build and
CI tests do not need resolved bindings, but `pa app push` does. Keep your resolved
working `power.config.json` locally; sanitize the staged copy before committing
instead of replacing a working binding with a placeholder. Do not blindly stage
raw connection metadata or exported credential defaults. After a fresh checkout,
resolve and verify every required connection before publishing.

**Re-adding does not necessarily replace a stale dependency.** In the inspected
`pa` 1.3.0 implementation, flow registration retrieves the current invoker
connection, then matches an existing app dependency by connector ID and connection
reference logical name. When it finds a match, it retains the existing
`sharedConnectionId` and authentication fields; only gateway fields are updated.
The flow's `workflowName` can therefore refresh successfully while a previously
committed `<connection-id>` remains unchanged. The repository's connector fixup
scripts only repair generated TypeScript; they do not sanitize `power.config.json`.

A valid solution reference and a malformed local shared-connection hint can
coexist. Inspect the dependency reached through
`workflowDetails.dependencies.shared_webcontents`, rather than another direct
HTTP connection or a similarly named licensing wrapper. Do not copy the Graph
HTTP connection ID or change the flow's run-only access model to work around it.
The current solution source declares the PP-API HTTP dependency as an invoker
connection; a maker's valid bound connection alone does not prove player consent.

For a stale placeholder or an outdated connection ID after rebinding, obtain
fresh CLI-generated dependency metadata without
the stale matching entry (preferably in a separate local diagnostic copy), then
reconcile only that dependency into the working app configuration. Preserve the
flow registration, logical reference name and other connections; never guess the
connection ID. Simply repeating `add flow` against the unchanged configuration
hits the same reuse branch. `pa connection list-references --json` lists solution
component names/descriptions, not the bound `connectionid`, and requires
`--solution-id` in non-interactive mode. The precise read-only Dataverse lookup
for the binding is `connectionreferences` filtered by
`connectionreferencelogicalname`, selecting `connectionid` and
`connectionreferencelogicalname`. Resolve it in the app's actual environment;
do not request credentials or commit the returned connection ID.

The inspected `pa` 1.3.0 publish mapper also sends `sharedConnectionId` without
the local `xrmConnectionReferenceLogicalName`. Two references bound to the same
HTTP connection can therefore leave the published app associated with the
unintended reference. Use a distinct, correctly configured PP-API connection
for `msftcsa_HTTPWithEntraPPAPI`, reconcile its local dependency after rebinding,
and verify the published app's reference and solution dependencies after pushing.
Do not delete a reference based only on its display name or edit an export
manifest to conceal a dependency.

This corrects local registration evidence, not a proven tenant/runtime fix.
An ambiguous HTTP consent warning cannot identify which wrapper failed; use the
player's failing dependency/request details to distinguish PP-API from licensing.
No UI change or offline build proves that consent now succeeds.

Custom headers cannot be forwarded by this three-field flow. Required-header
operations are visible but blocked with an explanation; optional headers are
shown disabled. Extending the flow requires regenerating its service contract
and wiring a Headers input before these can be supplied. The app does not
silently drop required headers or fall back to another connector.

The HTTP action must send `Content-Type: application/json` when forwarding
a JSON body. Certificate upload requires multipart/file transport and is
listed but cannot run through this JSON-only contract.

## Catalog coverage and refresh

The checked-in snapshot contains all **217 operations across 16 sections**
listed in the published reference table of contents when generated, including
both Resource Threshold operations. It is not limited to operations exposed
by the Admins V2 connector. Routes load this catalog lazily.

From `PP-CoE-CodeApp`, refresh the snapshot with:

```powershell
node scripts\refresh-power-platform-api.mjs --fresh
```

The generator reads `https://learn.microsoft.com/en-us/rest/api/toc.json`,
then downloads every listed Power Platform operation as Microsoft Learn
Markdown. Without `--fresh`, it reuses a temporary download cache so failed
refreshes can resume. It extracts the hierarchy, HTTP route, version defaults,
parameter/body tables, response schemas, enums, and documented constraints.
It fails rather than publishing an incomplete catalog when a page cannot be
downloaded or an unrecognized schema shape appears.

The snapshot records the table-of-contents URL, per-operation Microsoft
source revisions, generation time, and content hash. It retains API interface
metadata rather than reproducing the explanatory documentation. The linked
source documentation is subject to
[Microsoft Learn terms](https://learn.microsoft.com/en-us/legal/termsofuse).

Some published pages reference types without defining them (for example
`Clause`, `Geo`, and `ActionEvent`). These known source gaps are retained as
explicit warnings, not replaced with invented schemas or endpoint behavior.
Those values must be checked against the linked documentation; local
validation does not assert an undocumented type.
