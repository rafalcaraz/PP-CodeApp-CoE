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
resulting environment-specific connection ID. The repository includes the app's flow
contract, not the flow definition or a deployed HTTP connection. A local
`InvokerConnectionOverrideFailed` error still requires checking player
authorization and the flow's run-only connection binding; UI changes do not
resolve that binding.

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
