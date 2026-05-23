# 03 — Fields reference

This is the **definitive field list** for building filters. For every
field: what it is, what type it has, which resource type(s) it lives
on, and what operators are sensible.

> 🚨 **Critical:** Filtering on a field that doesn't exist on the
> targeted resource type returns **zero rows silently** — ARG does
> not error. Always check the "Lives on" column. When a question
> implies cross-resource filtering, use a **two-step pattern**
> (see `07-recipes.md`, recipes 7.11–7.13).

## Top-level (envelope) fields

These have **no `properties.` prefix** and exist on every resource.

| Field | Type | Lives on | Domain | Common ops |
|---|---|---|---|---|
| `type` | string | All 10 | one of the 10 type strings | `==`, `in~` (usually set by `resourceTypes` instead) |
| `name` | string (GUID) | All 10 | bare GUID | `==`, `contains` |
| `location` | string | All 10 | lower-case region, e.g. `"unitedstates"`, `"westus"`, `"westeurope"` | `==`, `in~` |
| `tenantId` | string (GUID) | All 10 | one value per tenant | rarely filtered |

## 🔶 Polymorphic owner / creator fields — READ CAREFULLY

**These three fields are not always GUID strings.** Sometimes
the inventory returns them as an **object** `{ id, displayName, email }`.
A naïve `==` on a GUID will silently miss the object form.

| Field | Lives on | Shapes seen | **Recommended ops** |
|---|---|---|---|
| 🔶 `properties.ownerId` | All apps, all flows, agents (not envs / env groups) | (a) GUID string `"05782d11-..."` (b) object `{id, displayName, email}` | **`contains`** with the GUID — works for both shapes. Avoid `==`. |
| 🔶 `properties.createdBy` | All 10 | same as `ownerId` | **`contains`** with the GUID |
| 🔶 `properties.lastModifiedBy` | All resources except envs / env groups | same as `ownerId`. May also be the empty string for system-managed records. | **`contains`** with the GUID, or skip the filter for system records |

**Filter pattern for "owned by user GUID X":**

```jsonc
{
  "field": "properties.ownerId",
  "op": "contains",
  "value": "12345678-1234-1234-1234-123456789012"
}
```

`contains` translates to KQL `contains` which is a substring match on
the stringified value — it catches both the bare GUID and the
serialized object (which embeds the GUID under `id`).

## Universal `properties.*` fields

Present on every resource type with the same meaning.

| Field | Type | Domain | Common ops |
|---|---|---|---|
| `properties.displayName` | string | free text | `contains`, `startswith`, `endswith`, `==` |
| `properties.environmentId` | string (GUID) | bare GUID | `==`, `in~` |
| `properties.createdAt` | datetime (ISO 8601) | e.g. `"2026-05-19T17:53:19Z"` | `lastNdays`, `>`, `<` |
| `properties.lastModifiedAt` | datetime (ISO 8601) | same | `lastNdays`, `>`, `<` |
| `properties.isQuarantined` | boolean (as `"true"`/`"false"` string) | `"true"` / `"false"` | `==` |

## App-type fields

### Common to all 4 app types

| Field | Lives on | Domain | Common ops |
|---|---|---|---|
| `properties.subType` | code apps, app-builder apps | `"byocApp"`, `"appBuilderApp"`, others possible | `==` |
| `properties.appType` | canvas apps (when present) | varies | `==` |

### Canvas-specific

| Field | Type | Domain | Common ops |
|---|---|---|---|
| `properties.powerPlatformConnectors` | array of `{connectorId, operations[]}` | dynamic — see `05-sentinel-fields.md` | **DO NOT filter directly — use `__connector` / `__operation` sentinels** |
| `properties.lastLaunchedTime` | datetime (ISO 8601, when present) | not on every canvas app | `lastNdays`, `>`, `<`. **Not available on model-driven / code / app-builder apps.** |
| `properties.sharedUsersCount` | number | non-negative integer | `>`, `<`, `==` |
| `properties.sharedGroupsCount` | number | non-negative integer | `>`, `<`, `==` |
| `properties.isFeaturedApp` | boolean | `"true"` / `"false"` | `==` |
| `properties.bypassConsent` | boolean | `"true"` / `"false"` | `==` |

### Model-driven specific

| Field | Type | Domain |
|---|---|---|
| `properties.logicalName` | string | Dataverse logical name |
| `properties.appModuleId` | string (GUID) | Dataverse module ID |

### App-builder specific

| Field | Type | Domain | Common ops |
|---|---|---|---|
| `properties.connectors` | array of `{connectorId, connectionType}` | `connectorId` is an **ARM path** (`/providers/Microsoft.PowerApps/apis/shared_...`) | **DO NOT filter directly — use `__connector` sentinel; it handles ARM path slugs.** |

## Flow-type fields (cloud flows, agent flows, m365 agent flows)

| Field | Type | Domain | Common ops |
|---|---|---|---|
| `properties.status` | string | `"Activated"`, `"Suspended"`, `"Stopped"`, `"Started"`, `"NotStarted"` | `==`, `in~` |
| `properties.flowTriggerType` | string | `"Instant"`, `"Automated"`, `"Recurrence"`, `"Manual"` | `==`, `in~` |
| `properties.trigger.operationId` | string | varies per connector | `==`, `contains` |
| `properties.trigger.connectorId` | string | bare connector slug; often empty for first-party connectors | `==`, `contains` — **prefer `__connector` sentinel for "uses connector X" intent** |
| `properties.trigger.connectorDisplayName` | string | friendly name | `==`, `contains` |
| `properties.workflowEntityId` | string (GUID) | Dataverse cross-reference | `==` |
| `properties.powerPlatformConnectors` | array | bare slugs like `commondataserviceforapps` (no `shared_` prefix on flows!) | **use `__connector` sentinel** |

## Copilot Studio agent fields

| Field | Type | Domain | Common ops |
|---|---|---|---|
| `properties.model` | string | `"Claude Sonnet 4.5"`, `"GPT-4o"`, `"GPT-4.1"`, etc. | `==`, `contains` |
| `properties.orchestration` | string | `"Generative"`, others | `==` |
| `properties.lastPublishedAt` | datetime | ISO 8601 | `lastNdays`, `>`, `<` |
| `properties.schemaName` | string | e.g. `"copilots_header_msftcsa_ITServiceAgent"` | `==`, `contains` |
| `properties.entraAppId` | string (GUID) | Entra app GUID | `==` |
| `properties.authentication` | string | `"Microsoft Entra"`, others | `==` |
| `properties.instructionsCharactersCount` | number | integer | `>`, `<`, `==` |
| `properties.isWebSearchEnabledForKnowledge` | boolean | `"true"` / `"false"` | `==` |
| `properties.isManaged` | boolean | `"true"` / `"false"` | `==` (**different from the env-level `isManaged`!**) |
| `properties.channels` | string array | `"Teams"`, `"Microsoft 365 Copilot"`, `"Direct Line Channels"`, etc. — DYNAMIC | filtering this directly is unreliable; use `contains` against `tostring()` if needed |
| `properties.createdIn` | string | `"Copilot Studio"`, possibly others | `==` |

## Environment fields

> 🚨 **These fields only exist on `microsoft.powerplatform/environments`.**
> They are **NOT** present on apps / flows / agents.

| Field | Type | Domain | Common ops |
|---|---|---|---|
| `properties.environmentType` | string | `"Production"`, `"Default"`, `"Sandbox"`, `"Trial"`, `"Developer"`, `"Dataverse for Teams"` | `==`, `in~` |
| `properties.isManaged` | boolean | `"true"` / `"false"` | `==` (Managed Environments flag) |
| `properties.environmentGroup` | string | env group display name | `==`, `contains` |
| `properties.environmentGroupId` | string (GUID) | env group GUID | `==`, `in~` |

**To filter apps/flows/agents "in environments of type X":** use the
**two-step pattern** (recipes 7.11–7.13). Step 1 finds the env GUIDs;
step 2 filters by `properties.environmentId in~ <guids>`.

## Environment group fields

| Field | Type | Domain |
|---|---|---|
| `properties.displayName` | string | e.g. `"Finance"` |
| `properties.description` | string | free text |
| `properties.createdAt` | datetime | ISO 8601 |
| `properties.createdBy` | 🔶 polymorphic (GUID or object) | — |

## Fields summary by intent

| User intent | Use this field |
|---|---|
| "Recently modified" / "in the last N days" | `properties.lastModifiedAt` + `lastNdays` |
| "Recently created" / "new in the last N days" | `properties.createdAt` + `lastNdays` |
| "Owned by user X" | 🔶 `properties.ownerId` + `contains` |
| "Created by user X" | 🔶 `properties.createdBy` + `contains` |
| "Quarantined" | `properties.isQuarantined == "true"` (apps + agents) |
| "Activated/suspended/stopped" (flows) | `properties.status` |
| "Triggered manually / on-demand" | `properties.flowTriggerType == "Instant"` (or `"Manual"`) |
| "Uses connector X" | `__connector` sentinel — see `05-sentinel-fields.md` |
| "Calls operation X" | `__operation` sentinel |
| "Published agents" | `properties.lastPublishedAt > ...` (or filter to non-null somehow) |
| "Managed environments" | `properties.isManaged == "true"` on environments |
| "In env group X" | `properties.environmentGroupId == <guid>` or `properties.environmentGroup == <name>` |
| "In environment of type X" | **Two-step pattern** — see recipes 7.11–7.13 |
