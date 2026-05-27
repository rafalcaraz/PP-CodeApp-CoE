# Inventory schema samples

> **Why this file exists.** The `PowerPlatformResources` Azure Resource Graph
> table returned by the
> [Power Platform for Admins V2 connector](https://learn.microsoft.com/power-platform/admin/inventory-api)
> exposes a *dynamic* per-row `properties` bag whose shape depends on the
> resource `type`. Official docs
> ([schema](https://learn.microsoft.com/power-platform/admin/inventory-schema),
> [API](https://learn.microsoft.com/power-platform/admin/inventory-api))
> describe the high-level columns but lag the live payload. This file is the
> source of truth for **what the connector actually returns to us today**, so
> future Copilot sessions (and humans) can reason about the data layer without
> re-running ad-hoc queries.
>
> **Maintain this file.** Whenever a new resource shape appears in the wild, or
> a field is added/removed, paste the new sample under the right section and
> update the field notes. Keep samples redacted of anything sensitive (GUIDs
> are fine; specific tenant info should be replaced with `XXXX...`).

## Conventions used throughout

- All resources share a common envelope: top-level `id`, `name` (the GUID),
  `type`, `tenantId`, `location` (region), plus a dynamic `properties` bag.
- `properties.environmentId` is the environment GUID a resource lives in.
- `properties.ownerId`, `properties.createdBy`, `properties.lastModifiedBy`
  are usually GUIDs. Some resource types replace them with an object like
  `{ id, displayName, email }` — the data layer (`src/data/inventory.ts`)
  reads both shapes via `ownerDisplayName()`. **See the
  [Owner / creator GUID resolution](#owner--creator-guid-resolution)
  section below for what those GUIDs can actually point to** — it is *not*
  always a human user.
- `properties.isQuarantined`, `properties.isManaged` are booleans.

## Owner / creator GUID resolution

> **Read this before adding any "owner name lookup" UI, dashboard tile,
> or `ownerless`-style filter.** The `ownerId` / `createdBy` /
> `lastModifiedBy` GUIDs on inventory rows are **Entra object IDs**, and
> Entra object IDs are not exclusively users.

Resolved by `src/data/userEnrichment.ts` (the GUID → user resolver
backing the Cmd+K lookup dialog and the in-page owner chips —
`src/components/UserChip.tsx`, used by `useUserDisplay`) against the
Dataverse `aaduser` virtual table. **Resolution is reactive: any GUID
resolved anywhere in the app (the dialog, a chip on a detail page, a
batched list-view render) populates everywhere it's rendered, with no
re-fetch.** See `src/hooks/useUserDisplay.ts` for the subscription
plumbing.

### What an owner GUID can actually be

| Kind | Where it lives in Entra | In `aaduser`? | Typical source |
| --- | --- | --- | --- |
| **User (member)** | Users blade | ✅ | Maker built it manually. |
| **User (guest)** | Users blade (`userType=Guest`) | ✅ | B2B-invited maker. |
| **Deleted user** | Gone | ❌ (Graph 404) | Account offboarded, asset orphaned. |
| **Service principal** | **Enterprise Applications** blade | ❌ (Graph 404) | Power Platform Pipelines, ALM SPN, custom deployment identity. |
| **Managed identity / system account** | Enterprise Applications blade | ❌ (Graph 404) | First-party Microsoft components, e.g. some `00000000-0000-0000-0000-…` ids. |

### Why "not found in `aaduser`" ≠ "deleted user"

`aaduser` is a thin wrapper over Microsoft Graph's `/users` endpoint.
Service principals live at `/servicePrincipals`, not `/users`, so any
GUID owned by an SPN looks identical to a deleted user from
`aaduser`'s perspective — both return `Request_ResourceNotFound`. **Do
not label a missing lookup as "deleted user" in UI copy.** Use neutral
wording like *"Could not locate a current valid user with this GUID"*
and call out both possibilities (deleted account **or** Enterprise
Application object id). The Cmd+K lookup dialog
(`src/components/UserLookupDialog.tsx`) is the canonical example.

### How to disambiguate when it matters

When you actually need to know which kind of identity a GUID points to:

1. **Check Entra → Enterprise Applications** with the GUID as the
   Object ID filter. A hit means SPN. The most common CoE scenario is a
   Pipelines deployment SPN, which becomes the `createdBy` of every
   asset it deploys.
2. **Check Entra → Users → Deleted users**. A hit there confirms
   deletion (within the 30-day soft-delete window).
3. **(Future option)** Resolve through the Dataverse
   `serviceprincipal` virtual table (also Graph-backed, symmetric to
   `aaduser`) or `systemuser` + `applicationid`. See the roadmap entry
   for the planned `userEnrichment` chain extension.

### Implications for dashboards & filters

- **"Ownerless" / orphaned-asset tiles** that count rows where the
  owner can't be resolved will over-report if they don't subtract
  SPN-owned assets. In a tenant that uses Power Platform Pipelines this
  can be a large fraction of all artifacts.
- **"Top creators" rollups** keyed by `createdBy` will surface the
  pipelines SPN as the "top creator" if not filtered out.
- The data layer never replaces the raw GUID with a friendly name — it
  always falls through to `ownerId` in `ownerDisplayName()`. Resolution
  is a presentation concern handled per-page.

## Resource types covered

These are the **10 resource types** the inventory exposes today, per the
[official schema docs](https://learn.microsoft.com/power-platform/admin/inventory-schema).
All of them are read by this app — there are no unmodeled types as of now.

| `type` value | Friendly | Sample below? | App view |
| --- | --- | --- | --- |
| `microsoft.powerplatform/environmentgroups` | Environment groups | structural (no live capture yet) | `/environment-groups` |
| `microsoft.powerplatform/environments` | Environments | structural (no live capture yet) | `/environments` |
| `microsoft.powerapps/canvasapps` | Canvas apps | ✅ real | `/apps` |
| `microsoft.powerapps/modeldrivenapps` | Model-driven apps | ✅ real | `/apps` |
| `microsoft.powerapps/codeapps` | Code apps | ✅ real | `/apps` |
| `microsoft.powerapps/apps` | App Builder apps | ✅ real | `/apps` |
| `microsoft.powerautomate/cloudflows` | Cloud flows | ✅ real | `/flows` |
| `microsoft.powerautomate/agentflows` | Agent flows | shape matches cloud flows | `/flows` |
| `microsoft.powerautomate/m365agentflows` | Workflow agent flows | shape matches cloud flows | `/flows` |
| `microsoft.copilotstudio/agents` | Copilot Studio agents | ✅ real | `/agents` |

> Items marked **structural** are reconstructed from the official schema docs
> rather than captured from a live tenant. Update them with a real payload
> when one is available.

## KQL / clause-builder gotchas

Captured while building the data layer. Don't relearn these the hard way:

1. **`orderby` on dynamic fields requires an explicit cast.** ARG rejects
   `order by properties.displayName` with `ExpressionKeyCantBeDynamic`.
   Always wrap: `order by tostring(properties.displayName)` (or
   `tolong()` / `todouble()` as appropriate).
2. **`where ... contains` values MUST be single-quoted.** Without quotes the
   bare token is parsed as a column name and ARG fails with
   `Operator_FailedToResolveEntity`. Embed-quote escaping is KQL convention
   (double them). The clause builder handles this in
   `buildListClauses` → `nameContains`.
3. **`where ... ==` and `in~` also single-quote values**, e.g.
   `Values: ["'microsoft.powerapps/canvasapps'"]`.
4. **Connector IDs are inconsistent across resource types.** Canvas apps,
   agents, and flows publish bare `shared_xxx` or `commondataserviceforapps`,
   while **app-builder apps publish full ARM paths** like
   `/providers/Microsoft.PowerApps/apis/shared_sharepointonline`.
   `normalizeConnectorId()` in the data layer strips ARM paths down to the
   trailing slug; `friendlyConnectorName()` tries both with and without the
   `shared_` prefix when looking up display names.
5. **Pagination.** Single response capped via `Top` (we use 500). Continue
   with the returned `skipToken`. `totalRecords` is reliably populated.
6. **Errors are not `Error` instances.** The runtime throws
   `PowerDataRuntimeHttpError = { message, status, requestId, innerError }`
   where `innerError` is a stringified JSON of the ARG
   `{code, message, details[]}` payload. See `formatError()` in `inventory.ts`.
7. **Filtering on connector usage needs `has`, not `==`.** The connectors
   array is dynamic, so `where properties.powerPlatformConnectors == 'x'`
   fails. Use `has` (tokenised) or `contains` (substring). The Queries
   view exposes a `__connector` sentinel field (see `translateFilter` in
   `inventory.ts`) that emits an `extend` shim concatenating the three
   shapes (`properties.powerPlatformConnectors`, `properties.connectors`,
   `properties.trigger`) into a single string column, then a single `has`
   against it — covers canvas/flow/agent/app-builder in one clause without
   needing `mv-expand` (which isn't in the Clause whitelist).

---

## Environment groups

`type: "microsoft.powerplatform/environmentgroups"`

**Structural sample (per the official schema):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environmentGroups/aaaa0000-bb11-2222-33cc-444444dddddd",
  "name": "aaaa0000-bb11-2222-33cc-444444dddddd",
  "type": "microsoft.powerplatform/environmentgroups",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "unitedstates",
  "properties": {
    "displayName": "Finance",
    "description": "All finance team environments",
    "createdAt": "2025-06-01T08:00:00Z",
    "createdBy": "aaaa0000-bb11-2222-33cc-444444dddddd",
    "lastModifiedAt": "2026-01-15T10:30:00Z"
  }
}
```

**Notable fields (per docs):**

- `properties.displayName`, `properties.description` — shown in list/detail.
- `properties.createdAt`, `properties.createdBy`, `properties.lastModifiedAt`.
- Only top-level + shared fields beyond these.

**Currently consumed by the app:** displayName, description, createdAt,
createdBy, location. (`lastModifiedAt` is in the schema but not yet displayed.)

> **TODO:** Replace with a real captured payload to confirm shape and uncover
> any undocumented fields.

## Environments

`type: "microsoft.powerplatform/environments"`

**Structural sample (per the official schema):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environments/aaaa0000-bb11-2222-33cc-444444dddddd",
  "name": "aaaa0000-bb11-2222-33cc-444444dddddd",
  "type": "microsoft.powerplatform/environments",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "unitedstates",
  "properties": {
    "displayName": "Contoso Production",
    "environmentType": "Production",
    "isManaged": true,
    "environmentGroup": "Finance",
    "environmentGroupId": "aaaa0000-bb11-2222-33cc-444444dddddd",
    "createdAt": "2025-06-01T08:00:00Z",
    "createdBy": "aaaa0000-bb11-2222-33cc-444444dddddd",
    "lastModifiedAt": "2026-01-15T10:30:00Z"
  }
}
```

**Notable fields (per docs):**

- `properties.environmentType` — `Production`, `Default`, `Sandbox`, `Trial`,
  `Developer`, `Dataverse for Teams`.
- `properties.isManaged` — boolean for Managed Environment status.
- `properties.environmentGroup` / `properties.environmentGroupId` — the
  group the env belongs to (both name and ID, when assigned).
- `properties.lastModifiedAt`.

**Currently consumed by the app:** all of the above plus shared fields.

> **TODO:** Replace with a real captured payload to confirm shape and uncover
> any undocumented fields (e.g. lifecycle state, security group bindings).

## Canvas apps

`type: "microsoft.powerapps/canvasapps"`

**Sample payload (real):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environments/205e47a9-7271-ef0b-9bea-a2043340d801/providers/Microsoft.PowerApps/canvasApps/7313ce98-9cbc-43cb-8558-b5575895f1f7",
  "name": "7313ce98-9cbc-43cb-8558-b5575895f1f7",
  "type": "microsoft.powerapps/canvasapps",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "unitedstates",
  "properties": {
    "lastModifiedAt": "2026-05-19T18:38:50.8429161Z",
    "displayName": "FaceFinder",
    "createdBy": "05782d11-e48a-4a54-97a1-ba40039a058d",
    "createdAt": "2026-05-19T17:53:19.7795382Z",
    "environmentId": "205e47a9-7271-ef0b-9bea-a2043340d801",
    "powerPlatformConnectors": [
      {
        "connectorId": "shared_logicflows",
        "operations": [{ "operationId": "Run" }]
      },
      {
        "connectorId": "shared_office365users",
        "operations": [
          { "operationId": "SearchUserV2" },
          { "operationId": "UserProfile_V2" },
          { "operationId": "UserPhoto_V2" }
        ]
      },
      { "connectorId": "shared_office365" }
    ],
    "ownerId": "05782d11-e48a-4a54-97a1-ba40039a058d",
    "isQuarantined": false,
    "lastModifiedBy": "05782d11-e48a-4a54-97a1-ba40039a058d"
  }
}
```

**Notable fields:**

- `properties.powerPlatformConnectors` — array of `{ connectorId, operations[] }`.
  `operations` items are objects with `operationId`. Sometimes a connector is
  referenced with no `operations` array at all (e.g. `shared_office365` above).
- Canvas apps additionally publish (when present) `sharedUsersCount`,
  `sharedGroupsCount`, `lastLaunchedTime`, `appType`, `isFeaturedApp`,
  `bypassConsent`.

## Model-driven apps

`type: "microsoft.powerapps/modeldrivenapps"`

**Sample payload (real):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environments/1aa337f4-6e46-ee58-9a43-64ca3c359b0f/providers/Microsoft.PowerApps/modelDrivenApps/84eafd43-7bf1-6e81-357b-81a2805064ae",
  "name": "84eafd43-7bf1-6e81-357b-81a2805064ae",
  "type": "microsoft.powerapps/modeldrivenapps",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "unitedstates",
  "properties": {
    "lastModifiedAt": "2026-05-21T02:21:30.7875392Z",
    "displayName": "Customer Service Hub",
    "createdBy": "00000000-0000-0000-0000-5157eaa02fcd",
    "createdAt": "2022-06-07T20:08:39.0840913Z",
    "environmentId": "1aa337f4-6e46-ee58-9a43-64ca3c359b0f",
    "ownerId": "00000000-0000-0000-0000-5157eaa02fcd",
    "isQuarantined": false,
    "lastModifiedBy": "00000000-0000-0000-0000-5157eaa02fcd",
    "logicalName": "Customerservicehub",
    "appModuleId": "29cf5b12-8de2-ec11-bb3d-000d3a378dee"
  }
}
```

**Notable fields:**

- Sparse compared to Canvas apps. No `powerPlatformConnectors`, no
  `sharedUsersCount`.
- **Dataverse-specific extras:** `logicalName`, `appModuleId`.

## Code apps

`type: "microsoft.powerapps/codeapps"`

**Sample payload (real):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environments/eb2d8ba3-28a6-efa4-8878-509c60c9fe1a/providers/Microsoft.PowerApps/codeApps/7c8ebb07-1732-47d6-8ce9-0b4de06f2dba",
  "name": "7c8ebb07-1732-47d6-8ce9-0b4de06f2dba",
  "type": "microsoft.powerapps/codeapps",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "unitedstates",
  "properties": {
    "lastModifiedAt": "2026-05-21T02:31:53.3341819Z",
    "displayName": "Agent Evaluations Viewer",
    "createdBy": "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
    "createdAt": "2026-05-21T02:31:53.1814107Z",
    "environmentId": "eb2d8ba3-28a6-efa4-8878-509c60c9fe1a",
    "ownerId": "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
    "isQuarantined": false,
    "lastModifiedBy": "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
    "subType": "byocApp"
  }
}
```

**Notable fields:**

- The sparsest of all app types. Don't expect connector metadata or share
  counts — they're not in the inventory schema for code apps today.
- `properties.subType` distinguishes flavors (e.g. `"byocApp"` — bring-your-own-code).

## App-builder apps

`type: "microsoft.powerapps/apps"`

**Sample payload (real):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environments/c8cf736f-0219-e6f4-8dc6-1dac5dc4400a/providers/Microsoft.PowerApps/apps/c79bf7f9-01e1-4f30-b333-ae8f3c1520b4",
  "name": "c79bf7f9-01e1-4f30-b333-ae8f3c1520b4",
  "type": "microsoft.powerapps/apps",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "unitedstates",
  "properties": {
    "lastModifiedAt": "2026-01-28T18:22:08.3341625Z",
    "displayName": "RecipeMate",
    "createdBy": "4523ed17-b9e7-4dc8-9882-93beb22d691f",
    "createdAt": "2026-01-15T19:12:17.3191716Z",
    "environmentId": "c8cf736f-0219-e6f4-8dc6-1dac5dc4400a",
    "ownerId": "4523ed17-b9e7-4dc8-9882-93beb22d691f",
    "isQuarantined": false,
    "lastModifiedBy": "4523ed17-b9e7-4dc8-9882-93beb22d691f",
    "connectors": [
      {
        "connectorId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
        "connectionType": "invoker"
      }
    ],
    "subType": "appBuilderApp"
  }
}
```

**Notable fields:**

- **Connector shape is different.** Uses `properties.connectors`
  (not `powerPlatformConnectors`), each entry is
  `{ connectorId, connectionType }` — **no `operations`**.
- `connectorId` is a full ARM path. The data layer normalizes it to the
  trailing slug (`shared_sharepointonline`).
- `connectionType` values seen: `"invoker"`.
- `subType: "appBuilderApp"`.

## Cloud flows

`type: "microsoft.powerautomate/cloudflows"`

Also applies (similar shape) to `microsoft.powerautomate/agentflows` and
`microsoft.powerautomate/m365agentflows`.

**Sample payload (real):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environments/fb203903-e611-e7a3-bdac-22470f743517/providers/Microsoft.PowerAutomate/cloudFlows/43a6b8f7-6242-65c2-23fa-76a2c07021fa",
  "name": "43a6b8f7-6242-65c2-23fa-76a2c07021fa",
  "type": "microsoft.powerautomate/cloudflows",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "westus",
  "properties": {
    "lastModifiedAt": "2026-05-20T19:24:41.2950729Z",
    "displayName": "Setup Wizard | Get Solution Environment Variable Definitions Details",
    "createdBy": "4523ed17-b9e7-4dc8-9882-93beb22d691f",
    "createdAt": "2026-05-18T21:55:31Z",
    "environmentId": "fb203903-e611-e7a3-bdac-22470f743517",
    "ownerId": "4523ed17-b9e7-4dc8-9882-93beb22d691f",
    "powerPlatformConnectors": [
      {
        "connectorId": "commondataserviceforapps",
        "operations": [{ "operationId": "ListRecords" }]
      }
    ],
    "lastModifiedBy": "",
    "workflowEntityId": "d8a8c388-8a25-f011-8c4e-00224808dbf5",
    "flowTriggerType": "Instant",
    "trigger": {
      "operationId": "RequestPowerAppV2",
      "connectorId": "",
      "connectorDisplayName": "Power Apps",
      "operationDisplayName": "When Power Apps calls a flow (V2)"
    },
    "status": "Activated"
  }
}
```

**Notable fields:**

- `properties.status` — **the canonical run-state field for flows.**
  Values observed: `"Activated"`, `"Suspended"`, `"Stopped"`, `"Started"`,
  `"NotStarted"`. (Older or alternate names `state` / `flowState` may show
  up; the data layer falls back to those.)
- `properties.flowTriggerType` — `"Instant"`, `"Automated"`, `"Recurrence"`,
  `"Manual"`.
- `properties.trigger` — object describing what fires the flow:
  `{ operationId, connectorId, connectorDisplayName, operationDisplayName }`.
  `connectorId` is often empty for first-party connectors (e.g. Power Apps).
- `properties.workflowEntityId` — Dataverse-side ID for cross-referencing.
- `properties.powerPlatformConnectors` uses bare connector IDs like
  `commondataserviceforapps` (no `shared_` prefix).

## Copilot Studio agents

`type: "microsoft.copilotstudio/agents"`

**Sample payload (real):**

```json
{
  "id": "/providers/Microsoft.PowerPlatform/environments/eb2d8ba3-28a6-efa4-8878-509c60c9fe1a/providers/Microsoft.CopilotStudio/agents/18fdcde8-4e1b-f111-8341-0022480a5972",
  "name": "18fdcde8-4e1b-f111-8341-0022480a5972",
  "type": "microsoft.copilotstudio/agents",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "location": "unitedstates",
  "properties": {
    "displayName": "ITSNowAgent",
    "createdBy": "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
    "createdAt": "2026-03-09T00:28:36Z",
    "isManaged": false,
    "isWebSearchEnabledForKnowledge": false,
    "environmentId": "eb2d8ba3-28a6-efa4-8878-509c60c9fe1a",
    "sharedWithViewers": { "groupCount": 0, "userCount": 0, "entireTenant": false },
    "instructionsCharactersCount": 300,
    "authentication": "Microsoft Entra",
    "powerPlatformConnectors": [
      {
        "connectorId": "shared_service-now",
        "operations": [
          {
            "createdBy": "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
            "requiresEndUserConsent": false,
            "connectionProvider": "Maker",
            "operationId": "CreateRecord",
            "isEnabled": true,
            "usedAs": "Tool",
            "whenCanBeUsed": "Anytime",
            "connectionIdSharedByMaker": "c38aa8deb7cc42e08ece17d575a5cc51"
          },
          {
            "createdBy": "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
            "requiresEndUserConsent": false,
            "connectionProvider": "End user",
            "isEnabled": true,
            "usedAs": "Knowledge",
            "whenCanBeUsed": "Anytime"
          }
        ]
      }
    ],
    "ownerId": "f89e1b16-63fb-4b09-b8e8-0a859966a74c",
    "orchestration": "Generative",
    "isQuarantined": false,
    "sharedWithEditors": { "groupCount": 0, "userCount": 0 },
    "lastPublishedAt": "2026-05-16T02:02:30Z",
    "schemaName": "copilots_header_msftcsa_ITServiceAgent",
    "capabilitiesCounts": {
      "distinctPowerPlatformConnectorsOperations": 4,
      "distinctPowerPlatformConnectors": 1
    },
    "createdIn": "Copilot Studio",
    "channels": ["Teams", "Microsoft 365 Copilot", "Direct Line Channels"],
    "model": "Claude Sonnet 4.5",
    "entraAppId": "0b749073-a170-4fd1-a761-529a68008630",
    "titleId": "T_d3647816-c660-e5b3-4f9e-760f94b5f91e"
  }
}
```

**Notable fields:**

- **Richest schema of any resource type.** Major buckets:
  - **Identity / wiring:** `schemaName`, `entraAppId`, `titleId`, `createdIn`
    (`"Copilot Studio"`), `authentication` (`"Microsoft Entra"`, …),
    `isCLIAgent` (bool — true for CLI-authored agents).
  - **Behavior:** `model` (e.g. `"Claude Sonnet 4.5"`), `orchestration`
    (`"Generative"`, …), `instructionsCharactersCount`,
    `isWebSearchEnabledForKnowledge`.
  - **Composition (arrays — empty for most agents):**
    - `triggers` — **non-empty ⇒ autonomous (event-driven) agent.**
      Empty array on classic conversational agents.
    - `flows` — Power Automate flows wired in as tools. Non-empty means
      the agent invokes flows. Distinct from `powerPlatformConnectors`,
      which are connector references; this is the resolved flow list.
  - **Distribution:** `channels` (string array — e.g. `"Teams"`,
    `"Microsoft 365 Copilot"`, `"Direct Line Channels"`),
    `sharedWithEditors` (`{userCount, groupCount}`), `sharedWithViewers`
    (`{userCount, groupCount, entireTenant}`).
  - **Roll-ups (`capabilitiesCounts`):**
    `distinctPowerPlatformConnectors`,
    `distinctPowerPlatformConnectorsOperations`, **`distinctFlows`**
    (server-side count of the `flows` array — prefer this to
    `array_length(flows)` for filtering since it's a flat scalar).
  - **Lifecycle:** `lastPublishedAt`, `publishState`/`state`,
    `isManaged`, `isQuarantined`.
- **Connector operations are RICH for agents** (vs. apps/flows which often
  only give `operationId`). Per-op fields:
  - `usedAs` — `"Tool"`, `"Knowledge"`, `"Topic Tool"`.
  - `connectionProvider` — `"Maker"`, `"End user"`.
  - `requiresEndUserConsent` (bool), `isEnabled` (bool),
    `whenCanBeUsed` (`"Anytime"`, …), `connectionIdSharedByMaker`,
    `createdBy`.
  - Some operations have **no `operationId`** at all — e.g. when a connector
    is used as a Knowledge source without invoking a specific op. The
    UI renders these as `(no operation — connector only)`.
- **Top-level ARM fields are present but empty** for Power Platform
  resources: `kind`, `resourceGroup`, `subscriptionId`, `managedBy`,
  `sku`, `plan`, `tags`, `identity`, `zones`, `extendedLocation`. Don't
  add these to picker suggestions — they're inherited from the generic
  ARM resource envelope and carry no PP-specific signal.

---

## When in doubt

- Read `src/data/inventory.ts` — every field this app actually consumes is
  in the row converters (`toAppRow`, `toFlowRow`, `toAgentRow`, etc.).
- The raw payload is always available in the detail page's
  `Raw inventory payload` accordion. Use it to discover fields not yet
  modeled here.
