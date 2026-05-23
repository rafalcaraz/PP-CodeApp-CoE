# 05 — Sentinel fields (`__connector`, `__operation`)

Two special "field" values in `QuerySpec` that the clause builder
expands into smart cross-shape filters. **You should almost always
prefer these over the raw `properties.*` paths for connector / op
filtering.**

## Why they exist

Connector usage is published in **three different shapes** across
resource types:

| Shape | Where | Field path |
|---|---|---|
| Array of `{connectorId, operations[]}` with bare slugs | Canvas apps, flows, agents | `properties.powerPlatformConnectors[].connectorId` |
| Array of `{connectorId, connectionType}` with **ARM path** slugs | App-builder apps | `properties.connectors[].connectorId` |
| Nested object | Cloud flow trigger | `properties.trigger.connectorId` |

KQL `==` against any of these directly fails (they're dynamic arrays
or nested objects), and `mv-expand` isn't available in the
`QuerySpec` clause set. The sentinels do the right thing
automatically.

## The sentinels

### `__connector`

> Use when you want to filter "resources that reference connector X
> (anywhere)" — regardless of resource type or where the connector
> reference lives in that type's schema.

Behavior:

- Emits a one-time `extend` shim that builds a single string column
  (`__connectorBag`) concatenating all three connector locations
- Then translates your filter op against `__connectorBag`:
  - `==` → `has` (tokenised match — respects word boundaries)
  - `!=` → `!has`
  - `in~` → `has_any` (comma-separated values)
  - `contains` → stays `contains` (substring)
  - others → pass-through
- The `extend` is emitted **at most once per query**, so multiple
  `__connector` filters compose cleanly (e.g. "uses both X and Y").

### `__operation`

Same machinery, same `__connectorBag`. Use for **operation IDs** like
`"ListRecords"`, `"SendEmailV2"`, `"GetRow"`, etc.

## Always prefer the sentinel for connector-name filters

These are wrong (or only partially right):

❌ `{ "field": "properties.powerPlatformConnectors", "op": "contains", "value": "..." }`
— misses app-builder apps (they use `properties.connectors`)
— misses flows whose connector is in `trigger`

❌ `{ "field": "properties.connectors", "op": "contains", "value": "..." }`
— only matches app-builder apps; misses everything else

This is correct:

✅ `{ "field": "__connector", "op": "==", "value": "shared_sharepointonline" }`

## Connector ID variants you may need to OR together

Bare slug vs `shared_` prefix vs ARM path are **all** flattened into
`__connectorBag` as strings, so `has` against a bare slug will match
the ARM-path form too (substring tokenisation). But for **Dataverse
specifically**, the same connector has multiple legit slugs:

| User says | Add ALL of these via `in~` |
|---|---|
| "Dataverse" / "CDS" / "Common Data Service" | `shared_commondataservice,shared_commondataserviceforapps,commondataservice,commondataserviceforapps` |
| "Office 365" / "Outlook" (enterprise) | `shared_office365` |
| "Outlook.com" (personal) | `shared_outlook` |
| "SharePoint" | `shared_sharepointonline` |

When the user just says "Dataverse", default to the full 4-variant
`in~` list above. The substring tokenisation of `has` covers
prefix variants too, but being explicit avoids any ambiguity.

## Worked example — "Canvas apps using SharePoint"

```json
{
  "resourceTypes": ["microsoft.powerapps/canvasapps"],
  "filters": [
    { "field": "__connector", "op": "==", "value": "shared_sharepointonline" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

## Worked example — "Resources using Office 365 OR SQL"

```json
{
  "resourceTypes": [
    "microsoft.powerapps/canvasapps",
    "microsoft.powerautomate/cloudflows",
    "microsoft.copilotstudio/agents"
  ],
  "filters": [
    { "field": "__connector", "op": "in~", "value": "shared_office365,shared_sql" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 200
}
```

## Worked example — "Flows using BOTH Outlook AND SQL"

```json
{
  "resourceTypes": ["microsoft.powerautomate/cloudflows"],
  "filters": [
    { "field": "__connector", "op": "==", "value": "shared_office365" },
    { "field": "__connector", "op": "==", "value": "shared_sql" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

Two separate `__connector ==` filters → two `has` checks against the
same `__connectorBag` → AND semantics → exactly "uses both".
