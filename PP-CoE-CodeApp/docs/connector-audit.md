# Connector audit — what we ship and what we actually call

> **Snapshot date:** 2026-05-28
> **Purpose.** Backward-looking inventory of every connector wired into
> this Code App and every action our code actually invokes today. Use
> this to decide whether a connector is earning its keep, to spot
> unused surface area, and to keep the per-action sample call shapes
> in one place (especially for the `HTTP with Microsoft Entra ID`
> connector, where the connector itself only exposes a generic
> `InvokeHttp` and the interesting part is the URL/headers/body we
> hand it).
>
> **Companion doc.** `admin-connector-inventory.md` is the
> forward-looking "supplemental admin ops we *could* wire" parking
> lot. This file is its mirror: the **`actually wired today`** view.
>
> **How to refresh this doc.** Run the audit script in the
> [Maintenance](#maintenance) section at the bottom and reconcile the
> tables against current code. Update the snapshot date at the top.

## TL;DR — coverage matrix

| Connector | Connection ref kind | Status in code | Actions available | Actions we call | Utilization |
|---|---|---|---|---|---|
| **Power Platform for Admins V2** (`shared_powerplatformadminv2`) | OAuth (`oauth2-auth`) | ✅ In active use | 159 | 12 | 7.5 % |
| **Power Platform for Admins** (legacy, `shared_powerplatformforadmins`) | Default | ✅ In active use (DLP only) | 33 | 3 | 9.1 % |
| **Microsoft Copilot Studio** (`shared_microsoftcopilotstudio`) | OAuth (`oauthDefault`) | ✅ In active use | 22 | 1 | 4.5 % |
| **HTTP with Microsoft Entra ID (preauthorized)** (`shared_webcontents`) | EntraAuth (shared connection) | ✅ In active use (Graph proxy) | 2 | 1 | 50 % |
| **Dataverse virtual table** — `aadusers` (`microsoftentraids`) | Dataverse | ✅ In active use | 6 CRUD | 1 (`get`) | n/a |

**No connectors are currently candidates for removal.** Every
connection reference in `power.config.json` is reached by at least
one production code path. See [Removal-candidate analysis](#removal-candidate-analysis)
for the per-connector reasoning.

---

## 1. Power Platform for Admins V2 — `shared_powerplatformadminv2`

- **Connection reference:** `shared_powerplatformadminv2` (OAuth, per-user)
- **Generated service:** `src/generated/services/PowerPlatformforAdminsV2Service.ts` (145 KB, **159 methods**)
- **API version pinned in app code:** `2024-10-01`
  (`const API_VERSION = "2024-10-01";` in the four files below)

This is the workhorse connector. `QueryResources` alone backs every
inventory page in the app; the other 11 actions are on-demand
enrichments (detail-page cards) and the deep-inventory fanout.

### Actions we call

| Action | Call site(s) | Purpose |
|---|---|---|
| `QueryResources` | `src/data/inventory.ts:320` (`__invokeQueryOnce`) | The core tenant-inventory call. Every Resources page, every dashboard tile that resolves through a clause builder, every owner-scan controller. Hits the throttled `runQuery` wrapper with LRU cache + 429 retry. |
| `ListConnectors` | `src/shared/connector-catalog/catalog.ts:232` (`fetchCatalogFromEnv`) | Build the per-env connector catalog (slug → display name / tier / publisher) for the Connectors page and the DLP comparator's connector picker. |
| `ListEnvironmentsForUser` | `src/shared/connector-catalog/catalog.ts:288` (`doLoad`) | List envs the calling admin can reach, so the catalog can try each until one returns non-empty. Called from `shared/` because the boundary rule forbids importing `data/inventory`. |
| `Get_AdminApps` | `src/shared/deep-inventory/sources/adminApps.ts:131` (`fetchPageWithRetry`) | Tenant-scan fanout. Pages 50-at-a-time across every env in scope, with 4-env concurrency and exponential-backoff on 429. The only fan-out admin call in the app (exception to the "no fan-out" rule in `admin-connector-inventory.md`). |
| `GetEnvironmentByIdForUser` | `src/data/adminEnrichment.ts:93` (`getEnvironmentAdminDetails`) | Environment detail card — admin-scope env metadata that QueryResources doesn't carry. |
| `Get_AdminApp` | `src/data/adminEnrichment.ts:153` (`getAppAdminDetails`) | Per-app admin enrichment card (canvas / code / app-builder only; model-driven gated out via `isAppAdminDetailsSupported`). |
| `GetEnvironmentGroup` | `src/data/adminEnrichment.ts:240` (`getEnvironmentGroupDetails`) | Env-group detail card. |
| `ListEnvironmentGroupRoleAssignments` | `src/data/adminEnrichment.ts:261` (`getEnvironmentGroupRoleAssignments`) | RBAC card on the env-group detail page. |
| `GetRuleSetListForTenant` | `src/data/adminEnrichment.ts:296` (`getEnvironmentGroupRulesets`) | Model A governance (parameters-bucket rulesets). Filtered client-side because the env-scoped URL the connector builds for `GetRuleSet` returns 404 — see the inline comment. |
| `ListRuleAssignmentsByEnvironmentGroupId` | `src/data/adminEnrichment.ts:357` (`getEnvironmentGroupEffectivePolicies`) | Model B rule assignments for an env group. |
| `GetRuleBasedPolicyByID` | `src/data/adminEnrichment.ts:381` (`getEnvironmentGroupEffectivePolicies`) | Per-policy fetch fanned out from the assignments list (typically 1–3 per group). |

### Actions available but never called (147)

The generated service ships **159 methods**; we use **12** (7.5 %).
The remaining 147 cover environment lifecycle (create/delete/disable),
billing policies, backups, BCDR, WAF, Power Pages websites,
disaster-recovery drills, recommendation engine, app-package
installs, evaluations, MCP wiring, cross-tenant connection reports,
storage warnings, currency allocation, BCS snapshots, security-scan
reports, and many more. None of these are wired today.

See the `admin-connector-inventory.md` "parking lot" for the curated
subset we have an opinion on adding next.

---

## 2. Power Platform for Admins (legacy) — `shared_powerplatformforadmins`

- **Connection reference:** `shared_powerplatformforadmins` (default auth — not OAuth-per-user)
- **Generated service:** `src/generated/services/PowerPlatformforAdminsService.ts` (25 KB, **33 methods**)
- **Why we still keep the legacy connector wired:** the V2 connector
  does **not** carry the `PolicyV2` (DLP) shape. Every DLP read/write
  in the app routes through this connector.

### Actions we call

| Action | Call site | Purpose |
|---|---|---|
| `GetPolicyV2` | `src/data/dlpPolicies.ts:122` (`getDlpPolicy`) | Fetch a single DLP policy by id. Backs the DLP detail / comparator side. |
| `ListPoliciesV2` | `src/data/dlpPolicies.ts:152` (`listDlpPolicies`) | Drain all DLP policies the caller can see (loop until `nextLink` is empty). Backs the DLP comparator picker and DLP inventory views. |
| `CreatePolicyV2` | `src/data/dlpPolicies.ts:191` (`createDlpPolicy`) | Create a new DLP policy. Used by the DLP Duplicator page (via `buildDuplicatePolicyBody`). |

### Actions available but never called (30)

The legacy connector exposes 30 other operations (`Get_AdminEnvironment`,
`Get_AdminDlpPolicies`, `Get_AdminEnvironmentRoleAssignment`,
`NewAdminEnvironment`, `Edit_AdminDlpPolicy`, `Remove_AdminEnvironment`,
`ListSupportedLocations`, `ListUnblockableConnectors`, etc.).

For most of those, the V2 connector has a superset replacement
(`GetEnvironmentByIdForUser` instead of `Get_AdminEnvironment`, etc.).
**The only reason we keep this connector wired is the V2 surface's
missing `PolicyV2` shape.** If the V2 connector ever publishes
equivalent DLP operations, this connector can be retired and the
`dlpPolicies.ts` calls migrated.

---

## 3. Microsoft Copilot Studio — `shared_microsoftcopilotstudio`

- **Connection reference:** `shared_microsoftcopilotstudio` (OAuth, `oauthDefault`)
- **Generated service:** `src/generated/services/MicrosoftCopilotStudioService.ts` (21 KB, **22 methods**)

### Actions we call

| Action | Call site | Purpose |
|---|---|---|
| `ExecuteCopilotAsyncV2` | `src/services/copilotStudio.ts:143` (`sendMessage`) | Single-turn chat against the floating MCS assistant (the `CopilotChat` panel mounted globally). Configured agent: `msftcsa_PPCoEAgent`. Multi-turn state preserved by threading `conversationId` between calls. |

The connector schema is positional (`Copilot`, `body`,
`x_ms_conversation_id?`, `environmentId?`), not the object-shaped
signature the public learn doc shows. The wrapper in
`services/copilotStudio.ts` hides that and also normalizes the three
documented `conversationId` casings (`conversationId` /
`ConversationId` / `conversationID`).

### Actions available but never called (21)

All Dataverse-Copilot variants, all `FirstPartyCopilot` variants,
`ListCopilots`, evaluation harness ops (`AgentMakerEvaluation*`),
trigger / callback invocation, and connection-binding. None wired.

The relevant background on the Copilot Studio integration (setup,
agent naming, troubleshooting) lives in
`docs/copilot-studio-integration.md` — this audit just records the
single live call site.

---

## 4. HTTP with Microsoft Entra ID (preauthorized) — `shared_webcontents`

- **Connection reference:** `shared_webcontents` (auth type `EntraAuth`, **shared connection**)
- **Generated service:** `src/generated/services/HTTPwithMicrosoftEntraID_preauthorized_Service.ts` (1.8 KB, **2 methods**)
- **Resource pre-authorized on this connection:** Microsoft Graph
  (`https://graph.microsoft.com`)
- **Why this connector exists in the app:** acts as a generic Graph
  proxy. The connector itself only knows about `InvokeHttp` /
  `GetFileContent` — all the interesting protocol detail lives in the
  caller (the URLs we build, the headers we set, the bodies we POST).

### Actions we call

| Action | Call site | Purpose |
|---|---|---|
| `InvokeHttp` | `src/data/spnEnrichment.ts:234` (`callGraph` helper) | Sole entry point. Wraps every Graph call in a typed envelope (`{ statusCode, headers, body }`) because the connector's OpenAPI types `data` as `void` and the SDK casts the real envelope through `unknown`. |
| `GetFileContent` | **unused** | Available on the generated service but never imported anywhere in `src/`. |

### Sample HTTP requests we issue (the part you actually care about)

All requests originate from `src/data/spnEnrichment.ts`. Common
shape:

```ts
const request: HttpRequest = {
  method: "GET" | "POST",
  url: `https://graph.microsoft.com/v1.0${path}`,
  headers: {
    "Accept": "application/json",
    // Only present when body is sent:
    "Content-Type": "application/json",
  },
  body: jsonBody ? JSON.stringify(jsonBody) : undefined,
};
await HTTPwithMicrosoftEntraID_preauthorized_Service.InvokeHttp(request);
```

The connector framework adds the Entra access token for the
pre-authorized resource (Graph) automatically — we never set
`Authorization` ourselves.

#### Call 1 — single service-principal lookup

- **When:** `resolveServicePrincipal(id)` — falls through from
  `resolveUser` when an `aaduser` lookup misses.
- **Method:** `GET`
- **URL template:**
  ```
  https://graph.microsoft.com/v1.0/servicePrincipals/{id}?$select=id,displayName,appId,servicePrincipalType,appOwnerOrganizationId,accountEnabled&$expand=owners($select=id)
  ```
- **Headers:** `Accept: application/json`
- **Body:** none
- **Expected response shape:** the slim `servicePrincipal` projection
  defined by `SP_SELECT_FIELDS`. Owners array is inline.

#### Call 2 — bulk service-principal lookup (batch)

- **When:** `resolveServicePrincipals(ids)` — used by the owner-scan
  controller when fanning out N candidate GUIDs at once.
- **Method:** `POST`
- **URL template:**
  ```
  https://graph.microsoft.com/v1.0/directoryObjects/getByIds
    ?$select=id,microsoft.graph.servicePrincipal/displayName,microsoft.graph.servicePrincipal/appId,microsoft.graph.servicePrincipal/servicePrincipalType,microsoft.graph.servicePrincipal/appOwnerOrganizationId,microsoft.graph.servicePrincipal/accountEnabled
    &$expand=microsoft.graph.servicePrincipal/owners($select=id)
  ```
  > **Type-cast on `$select` is required.** `getByIds` returns the
  > base `directoryObject` type, so SP-specific fields must be
  > prefixed with `microsoft.graph.servicePrincipal/`. Without the
  > cast, Graph silently returns `value: []` for the whole batch
  > (observed in this codebase on 2026-05-28).
- **Headers:** `Accept: application/json`, `Content-Type: application/json`
- **Body:**
  ```json
  {
    "ids": ["<guid1>", "<guid2>", "..."],
    "types": ["servicePrincipal"]
  }
  ```
- **Batch size cap:** 1000 ids per call (`BATCH_LIMIT` — Graph's
  documented limit). Larger inputs are chunked into parallel
  batches.

#### Call 3 — per-SP owner-count fallback

- **When:** `fetchOwnerCount(id)` — runs in parallel after a batch
  response if Graph didn't return inline `owners` for an SP (Call 2's
  `$expand` is flaky in some tenants).
- **Method:** `GET`
- **URL template:**
  ```
  https://graph.microsoft.com/v1.0/servicePrincipals/{id}/owners?$select=id
  ```
- **Headers:** `Accept: application/json`
- **Body:** none
- **Note:** we deliberately don't use `$count` to avoid the
  `ConsistencyLevel: eventual` advanced-query-capability gate.

#### Call 4 — per-SP owners drill-in (rich projection)

- **When:** `fetchServicePrincipalOwners(id)` — fires when the user
  clicks to expand an SP row on the SP detail surface.
- **Method:** `GET`
- **URL template:**
  ```
  https://graph.microsoft.com/v1.0/servicePrincipals/{id}
    ?$select=id,displayName,appId,servicePrincipalType,appOwnerOrganizationId,accountEnabled
    &$expand=owners($select=id,accountEnabled,deletedDateTime,displayName,mail)
  ```
- **Headers:** `Accept: application/json`
- **Body:** none

### Response handling contract

- `callGraph` always returns `{ ok: true, data }` or `{ ok: false, error }` (`DataResult<T | null>`).
- **404 → `{ ok: true, data: null }`** — "looked up, not present" is a successful resolution, not an error. Negative-cached so re-renders don't re-fetch.
- The connector flips between `success:false` (transport-level error) and `success:true` with an embedded 4xx `statusCode`; both branches are handled.

---

## 5. Dataverse virtual table — `aaduser` (via `microsoftentraids`)

- **Database reference:** `default.cds` → `microsoftentraids` data source → entity `aadusers` (logical name `aaduser`).
- **Generated service:** `src/generated/services/AadusersService.ts` (2.5 KB, **6 CRUD methods**).
- **Not a connector** in the `connectionReferences` sense — it's a
  Dataverse virtual table, but worth recording here because it's an
  externally-served data dependency.

### Methods we call

| Method | Call site | Purpose |
|---|---|---|
| `AadusersService.get(id, { select: SELECT_FIELDS })` | `src/data/userEnrichment.ts:265` (`resolveSingle`) | The **only** call to this service. Resolves an owner / creator / maker GUID to a `UserRef`. Per-id, never bulk — the `aaduser` virtual-table plugin doesn't honor `or`-style multi-id filters. |

### Methods available but never called

`create`, `update`, `delete`, `getAll`, `getMetadata`. We deliberately
**never** call `getAll()` — see the warning in `userEnrichment.ts:40`:
without a filter it would page through the entire tenant directory.

When `aaduser.get` returns "not found", `resolveSingle` falls through
to the service-principal resolver in §4. An owner GUID that misses on
**both** is treated as truly unresolved (genuine deleted account).
See `docs/inventory-schema-samples.md#owner--creator-guid-resolution`
for the full taxonomy.

---

## Removal-candidate analysis

| Connector | Keep? | Reason |
|---|---|---|
| Power Platform for Admins V2 | ✅ Keep | Core; backs every inventory page. Removal not even hypothetical. |
| Power Platform for Admins (legacy) | ✅ Keep, for now | Only used for DLP (`PolicyV2`). Retire-able only when V2 publishes equivalent DLP operations. Worth re-checking on each connector schema refresh. |
| Microsoft Copilot Studio | ✅ Keep | Sole consumer is the floating assistant — but it's a real, shipping feature. Would only retire if the assistant feature is removed. |
| HTTP with Microsoft Entra ID (preauthorized) | ✅ Keep | Sole consumer is `spnEnrichment.ts` (SP resolution via Graph) — but that fills a gap nothing else can fill (Graph is the only source-of-truth for service principals). |
| Dataverse `aadusers` (`microsoftentraids`) | ✅ Keep | Sole consumer is `userEnrichment.ts:resolveUser` — owner / creator / maker resolution underpins half the detail pages. |

**No retire-now candidates.** The next time this audit runs:

1. If a feature has been deleted (e.g., the DLP Duplicator), re-check
   whether its connector(s) still have other live consumers.
2. If the V2 admin connector schema has added `PolicyV2` operations,
   plan the legacy-connector retirement.
3. If `GetFileContent` is still unused on the HTTP connector, that's
   fine — both methods ship together; no action needed.

---

## Maintenance

### How to re-derive this audit

From the repo root, run (PowerShell):

```powershell
# 1) List every connection reference + its connector arm
Get-Content PP-CoE-CodeApp/power.config.json | ConvertFrom-Json |
  Select-Object -ExpandProperty connectionReferences |
  Get-Member -MemberType NoteProperty | ForEach-Object { $_.Name }

# 2) For each generated service, count its public static methods
Get-ChildItem PP-CoE-CodeApp/src/generated/services/*.ts | ForEach-Object {
  $count = (Select-String -Path $_.FullName -Pattern 'public static (async )?\w+').Count
  "{0,-60} {1} methods" -f $_.Name, $count
}

# 3) Find every call site for each generated service from app code
#    (use the `grep` tool with glob exclusion of **/generated/**):
#       pattern: PowerPlatformforAdminsV2Service\.\w+
#       paths:   PP-CoE-CodeApp/src
#       glob:    !**/generated/**
#    Repeat for each *Service. The diff vs the tables in §§1–4 is the
#    new actions to add or remove.
```

### When to refresh

- After every PR that adds a new feature touching a connector.
- After every `npm install` that bumps `@microsoft/power-apps` (the
  generator may emit new methods on existing services — usually fine
  to leave them unused, but worth re-checking the "actions available
  but never called" counts).
- After any change to `power.config.json` (new connector, removed
  connector, changed auth type).
- Whenever someone asks "do we still need this connector?" — refresh
  this doc first, then answer.

### Cross-references

- `docs/admin-connector-inventory.md` — forward-looking parking lot of supplemental admin ops we *could* wire.
- `docs/inventory-schema-samples.md` — how `QueryResources` is shaped and owner-GUID resolution flow.
- `docs/copilot-studio-integration.md` — full Copilot Studio setup walkthrough (this audit only records the live call site).
- `docs/connector-generator-fixup.md` — why the generated services are auto-healed on `npm install` and what NOT to hand-edit.
- `src/data/spnEnrichment.ts` — single source of truth for every Graph request shape in §4.
