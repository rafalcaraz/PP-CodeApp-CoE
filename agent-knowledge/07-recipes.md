# 07 — Recipes (natural language → `QuerySpec`)

The canonical example library. Each recipe shows a user question, the
JSON the agent should emit, and a one-liner explanation. When in
doubt, **find the closest recipe and adapt it** — don't reinvent.

> Conventions used here:
> - `limit: 100` is the default. Use `200` for "list everything"
>   intents, `500` only for explicitly bulk needs.
> - Order by `properties.lastModifiedAt desc` by default. Other
>   orderings should be motivated by the question.

## Basics

### 7.1 — "Show me all canvas apps"

```json
{
  "resourceTypes": ["microsoft.powerapps/canvasapps"],
  "filters": [],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

### 7.2 — "List managed environments"

```json
{
  "resourceTypes": ["microsoft.powerplatform/environments"],
  "filters": [
    { "field": "properties.isManaged", "op": "==", "value": "true" }
  ],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 200
}
```

### 7.3 — "All Copilot Studio agents"

```json
{
  "resourceTypes": ["microsoft.copilotstudio/agents"],
  "filters": [],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 200
}
```

### 7.4 — "Cloud flows modified in the last 7 days"

```json
{
  "resourceTypes": ["microsoft.powerautomate/cloudflows"],
  "filters": [
    { "field": "properties.lastModifiedAt", "op": "lastNdays", "value": "7" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

### 7.5 — "Canvas apps owned by user GUID 12345678-1234-1234-1234-123456789012"

🔶 Uses `contains` on the polymorphic `ownerId` field — works whether
ownerId is a flat GUID string or `{id, displayName, email}` object.

```json
{
  "resourceTypes": ["microsoft.powerapps/canvasapps"],
  "filters": [
    { "field": "properties.ownerId", "op": "contains", "value": "12345678-1234-1234-1234-123456789012" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

## Sentinel / connector queries

### 7.6 — "Canvas apps using SharePoint"

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

### 7.7 — "Cloud flows using BOTH Outlook AND SQL Server"

Two separate `__connector ==` filters → AND semantics on
`__connectorBag` (see `05-sentinel-fields.md`).

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

### 7.8 — "Anything using a Dataverse connector"

Uses the 4-variant `in~` because Dataverse publishes under multiple
slugs across resource types.

```json
{
  "resourceTypes": [
    "microsoft.powerapps/canvasapps",
    "microsoft.powerapps/modeldrivenapps",
    "microsoft.powerapps/codeapps",
    "microsoft.powerapps/apps",
    "microsoft.powerautomate/cloudflows",
    "microsoft.copilotstudio/agents"
  ],
  "filters": [
    {
      "field": "__connector",
      "op": "in~",
      "value": "shared_commondataservice,shared_commondataserviceforapps,commondataservice,commondataserviceforapps"
    }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 200
}
```

## Multi-type and enum queries

### 7.9 — "Quarantined apps across every app type"

```json
{
  "resourceTypes": [
    "microsoft.powerapps/canvasapps",
    "microsoft.powerapps/modeldrivenapps",
    "microsoft.powerapps/codeapps",
    "microsoft.powerapps/apps"
  ],
  "filters": [
    { "field": "properties.isQuarantined", "op": "==", "value": "true" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

### 7.10 — "Cloud flows whose status is Suspended"

```json
{
  "resourceTypes": ["microsoft.powerautomate/cloudflows"],
  "filters": [
    { "field": "properties.status", "op": "==", "value": "Suspended" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

## Cross-resource — the two-step pattern

These are the most important recipes in this file. They model how the
agent handles questions that **can't be answered in a single
`QuerySpec`** because they require joining two different resource
types.

> Common shape: emit step-1 as a valid `QuerySpec`, then tell the user
> exactly what to paste back for step 2.

### 7.11 — "Apps in Production-type environments"

`environmentType` lives on environments, not on apps. Two-step:

**Step 1 — get the Production env GUIDs:**

```json
{
  "resourceTypes": ["microsoft.powerplatform/environments"],
  "filters": [
    { "field": "properties.environmentType", "op": "==", "value": "Production" }
  ],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 500
}
```

**Then ask the user:** *"Paste the resulting `name` GUIDs back to
me as a comma-separated list and I'll generate step 2 — the apps
filter."*

**Step 2 (template — needs user-supplied GUIDs):**

```jsonc
{
  "resourceTypes": [
    "microsoft.powerapps/canvasapps",
    "microsoft.powerapps/modeldrivenapps",
    "microsoft.powerapps/codeapps",
    "microsoft.powerapps/apps"
  ],
  "filters": [
    { "field": "properties.environmentId", "op": "in~", "value": "<guid1>,<guid2>,..." }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 200
}
```

### 7.12 — "Apps using any Dataverse connector in env aaaa0000-...-444444dddddd"

Single-spec version when the env GUID is **already provided**:

```json
{
  "resourceTypes": [
    "microsoft.powerapps/canvasapps",
    "microsoft.powerapps/modeldrivenapps",
    "microsoft.powerapps/codeapps",
    "microsoft.powerapps/apps"
  ],
  "filters": [
    { "field": "properties.environmentId", "op": "==", "value": "aaaa0000-bb11-2222-33cc-444444dddddd" },
    {
      "field": "__connector",
      "op": "in~",
      "value": "shared_commondataservice,shared_commondataserviceforapps,commondataservice,commondataserviceforapps"
    }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

### 7.13 — "Which canvas apps share connectors with our agents?"

Two-step. Step 1 lists the agents' connectors; user pastes back the
slugs; step 2 filters canvas apps.

**Step 1 — list agents (look at their `properties.powerPlatformConnectors[].connectorId`):**

```json
{
  "resourceTypes": ["microsoft.copilotstudio/agents"],
  "filters": [],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 500
}
```

**Then ask the user:** *"From the result, paste back the connector
slugs you see (comma-separated, e.g. `shared_office365,shared_sql`).
I'll emit step 2 to find canvas apps using any of them."*

**Step 2 (template):**

```jsonc
{
  "resourceTypes": ["microsoft.powerapps/canvasapps"],
  "filters": [
    { "field": "__connector", "op": "in~", "value": "<slug1>,<slug2>,..." }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 200
}
```

## Time-based / "abandoned" queries

### 7.14 — "Find abandoned apps" (canonical clock-aware answer)

**You do not know today's date.** Do NOT invent a cutoff. Ask first.

**The right reply (no JSON, just a question):**

```
"Abandoned" needs a threshold and the QuerySpec contract has no
"olderThanNdays" operator. What ISO 8601 cutoff date should I use
for "last modified before X"? For example, if you want apps not
touched in the last 6 months, give me the date 6 months ago in
ISO format (something like 2024-11-22T00:00:00Z).
```

Once they answer, emit:

```jsonc
{
  "resourceTypes": [
    "microsoft.powerapps/canvasapps",
    "microsoft.powerapps/modeldrivenapps",
    "microsoft.powerapps/codeapps",
    "microsoft.powerapps/apps"
  ],
  "filters": [
    { "field": "properties.lastModifiedAt", "op": "<", "value": "<user-supplied ISO date>" },
    { "field": "properties.isQuarantined", "op": "==", "value": "false" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "asc",
  "limit": 200
}
```

### 7.15 — "Cloud flows that haven't run in 90 days"

Same shape as 7.14 — ask for the cutoff first, then emit `<` against
`properties.lastModifiedAt`. (The inventory doesn't carry a "last
run" timestamp distinct from `lastModifiedAt`.)

## Time-windowed queries (these DO know "last N days")

### 7.16 — "Copilot Studio agents created in the last 14 days, sorted by creator"

🔶 Sort by `properties.createdBy` works even when it's a polymorphic
field (the order-by wraps it in `tostring()`).

```json
{
  "resourceTypes": ["microsoft.copilotstudio/agents"],
  "filters": [
    { "field": "properties.createdAt", "op": "lastNdays", "value": "14" }
  ],
  "orderField": "properties.createdBy",
  "orderDirection": "asc",
  "limit": 100
}
```

### 7.17 — "Agents published in the last 30 days"

```json
{
  "resourceTypes": ["microsoft.copilotstudio/agents"],
  "filters": [
    { "field": "properties.lastPublishedAt", "op": "lastNdays", "value": "30" }
  ],
  "orderField": "properties.lastPublishedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

## Out-of-scope — name the external source

### 7.18 — "Flows owned by users who have left the org"

This requires data the inventory doesn't carry. **Don't emit JSON.**

**The right reply:**

```
The inventory only stores ownerId as a GUID — it has no field for
"account is disabled" or "user has left the org". That data lives
in Microsoft Entra ID (Azure AD) / Microsoft Graph, not in
PowerPlatformResources.

Two ways forward:
  1. Pull disabled / deleted user GUIDs from Microsoft Graph
     (GET /users?$filter=accountEnabled eq false, or
      GET /directory/deletedItems/microsoft.graph.user), paste them
     back, and I'll emit a QuerySpec filtering cloud flows by
     properties.ownerId in~ <those GUIDs>.
  2. If you have an existing list of departed-user GUIDs, paste
     them and I'll skip step 1.
```

## Agent capability / topology queries

### 7.19 — "Agents using the Claude Sonnet model"

```json
{
  "resourceTypes": ["microsoft.copilotstudio/agents"],
  "filters": [
    { "field": "properties.model", "op": "contains", "value": "Claude Sonnet" }
  ],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 200
}
```

### 7.20 — "Agents that have web search enabled for knowledge"

```json
{
  "resourceTypes": ["microsoft.copilotstudio/agents"],
  "filters": [
    { "field": "properties.isWebSearchEnabledForKnowledge", "op": "==", "value": "true" }
  ],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 200
}
```

### 7.21 — "Agents never published"

The schema doesn't expose a clean "is published" boolean. Best-effort
proxy: ask the user whether they want agents whose `lastPublishedAt`
is older than a date (Path A from `04-operators.md`), or just sort
by `lastPublishedAt asc` to see the longest-unpublished ones first.

```json
{
  "resourceTypes": ["microsoft.copilotstudio/agents"],
  "filters": [],
  "orderField": "properties.lastPublishedAt",
  "orderDirection": "asc",
  "limit": 200
}
```

## Naming / search queries

### 7.22 — "Apps whose display name contains 'finance'"

```json
{
  "resourceTypes": [
    "microsoft.powerapps/canvasapps",
    "microsoft.powerapps/modeldrivenapps",
    "microsoft.powerapps/codeapps",
    "microsoft.powerapps/apps"
  ],
  "filters": [
    { "field": "properties.displayName", "op": "contains", "value": "finance" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

### 7.23 — "Flows that start with 'Test_'"

```json
{
  "resourceTypes": [
    "microsoft.powerautomate/cloudflows",
    "microsoft.powerautomate/agentflows",
    "microsoft.powerautomate/m365agentflows"
  ],
  "filters": [
    { "field": "properties.displayName", "op": "startswith", "value": "Test_" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

## Environment and grouping queries

### 7.24 — "All environments in the 'Finance' env group"

```json
{
  "resourceTypes": ["microsoft.powerplatform/environments"],
  "filters": [
    { "field": "properties.environmentGroup", "op": "==", "value": "Finance" }
  ],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 200
}
```

### 7.25 — "Production OR Sandbox environments"

```json
{
  "resourceTypes": ["microsoft.powerplatform/environments"],
  "filters": [
    { "field": "properties.environmentType", "op": "in~", "value": "Production,Sandbox" }
  ],
  "orderField": "properties.displayName",
  "orderDirection": "asc",
  "limit": 500
}
```

## Triggers / flow shape queries

### 7.26 — "Instant cloud flows"

```json
{
  "resourceTypes": ["microsoft.powerautomate/cloudflows"],
  "filters": [
    { "field": "properties.flowTriggerType", "op": "==", "value": "Instant" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```

### 7.27 — "Flows triggered by Power Apps"

```json
{
  "resourceTypes": ["microsoft.powerautomate/cloudflows"],
  "filters": [
    { "field": "properties.trigger.connectorDisplayName", "op": "==", "value": "Power Apps" }
  ],
  "orderField": "properties.lastModifiedAt",
  "orderDirection": "desc",
  "limit": 100
}
```
