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
