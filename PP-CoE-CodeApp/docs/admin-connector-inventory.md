# Admin connector inventory — supplemental enrichments

> **Why this file exists.** The app's inventory layer
> (`src/data/inventory.ts`) currently calls exactly one admin operation —
> `PowerPlatformforAdminsV2Service.QueryResources` — to build the resource
> graph. The
> [Power Platform for Admins V2 connector](https://learn.microsoft.com/connectors/powerplatformadminv2/)
> exposes **~70 read-only operations** beyond that, plus there are sibling
> admin connectors (PowerApps for Admins, Power Automate for Admins, Power
> Automate Management) that fill in the per-record gaps.
>
> This file is the **parking lot** of every read-only admin call we could
> wire as a *supplemental* enrichment, so future Copilot sessions (or
> humans) can pick one off and build it without re-deriving the connector
> surface.
>
> **Maintain this file.** When a new admin op is added, deprecated, or
> shipped, update the relevant section. When an op moves from "parking
> lot" to "shipped", strike it through and link to the view that uses it.

## The supplemental-only rule

These enrichments are **strictly on-demand, user-initiated**. They are
never:

- part of the bulk inventory load in `src/data/inventory.ts`
- prefetched on detail-page mount
- batched across many records
- triggered by a passive viewport / hover

They are only fired when a user clicks an explicit action button (e.g.
*"Load role assignments"*, *"Show capacity details"*, *"Fetch admin
metadata"*) on a detail page or admin tools page. Results live in
component-local state (or a small per-id cache scoped to the page), not
in the main inventory store.

**Why the rule.**

- Admin connectors are throttled per-tenant; bulk fanout (one call ×
  thousands of inventory rows) is the fastest way to get rate-limited.
- Most enrichment data is only interesting when an admin is investigating
  one specific resource.
- Keeps the inventory load fast and the connector quota predictable.
- Lets us add new admin connectors (consent prompts, governance review)
  one at a time, only when there's a concrete user-facing reason.

## Current connector wiring

| Connector | Connection ref id | Status | Methods used today |
| --- | --- | --- | --- |
| **Power Platform for Admins V2** (`powerplatformadminv2`) | `aaedf328-30da-4325-8925-c2d33cce2d38` | ✅ Wired in `power.config.json` | `QueryResources` (bulk inventory via `src/data/inventory.ts`); `GetEnvironmentByIdForUser` + `Get_AdminApp` (supplemental enrichments via `src/data/adminEnrichment.ts`) |
| PowerApps for Admins (`shared_powerappsforadmins`) | — | ❌ Not yet added | — |
| Power Automate for Admins (`shared_powerautomateforadmins`) | — | ❌ Not yet added | — |
| Power Automate Management (`shared_flowmanagement`) | — | ❌ Not yet added | — |

Adding a new connector = adding a connection reference in
`power.config.json` and re-running the Code App tooling so the generated
service appears under `src/generated/services/`. Don't add a connector
until at least one supplemental action is queued to consume it.

---

## Power Platform for Admins V2 — read-only operations

Everything below is **already reachable** from the app via
`PowerPlatformforAdminsV2Service.*` in
`src/generated/services/PowerPlatformforAdminsV2Service.ts`. No new
connection consent required.

Signatures are simplified; consult the generated service for the exact
TypeScript shape and return types. All ops also take an `api_version`
string parameter — omitted below for brevity.

### 🌍 Environments

| Op | Signature (env-scoped unless noted) | Notes |
| --- | --- | --- |
| `ListEnvironmentsForUser` | `()` | Environments visible to the caller. |
| `GetEnvironmentByIdForUser` ✅ | `(environmentId)` | Single environment, admin scope. Shipped as the **"Admin details (supplemental)"** card on `views/EnvironmentDetail.tsx`; wrapper in `src/data/adminEnrichment.ts#getEnvironmentAdminDetails`. |
| `GetEnvironmentCopyCandidates` | `(sourceEnvironmentId, ValidateOnly?, ValidateProperties?)` | What you could copy *from*. |
| `GetEnvironmentBackups` | `(environmentId)` | Backup posture. |
| `GetRestoreCandidates` | `(sourceEnvironmentId, …)` | Restorable points. |
| `ListEnvironmentManagementSettings` | `(environmentId, $top?, $select?)` | Managed-env settings bag. |
| `GetFinOpsMaintenanceSettings` | `(environmentId)` | Maintenance windows. |
| `GetBusinessContinuityStateFullSnapshot` | `(environmentId)` | DR / BCDR snapshot. |
| `GetOperationsForEnvironment` | `(environmentId, limit?, continuationToken?)` | Async ops history. |
| `GetOperationByID` | `(operationId)` | Single async op detail. |

### 👥 Environment groups

| Op | Signature | Notes |
| --- | --- | --- |
| `ListEnvironmentGroups` | `()` | Tenant-wide list. |
| `GetEnvironmentGroup` | `(groupId)` | Single group detail. |
| `GetEnvironmentGroupOperation` | `(operationId)` | Async op status for a group change. |
| `ListEnvironmentGroupRoleAssignments` | `(environmentGroupId)` | Who can manage the group. |

### 📜 Rules / rulesets / rule-based policies

| Op | Signature | Notes |
| --- | --- | --- |
| `GetRuleSetListForTenant` | `($select?, $filter?, $expand?, $skiptoken?, $top?)` | Every ruleset in the tenant. |
| `GetRuleSet` | `(environmentId, groupId)` | Single ruleset detail. |
| `ListRuleBasedPolicies` | `()` | Tenant-wide policy list. |
| `GetRuleBasedPolicyByID` | `(policyId)` | Single policy detail. |
| `ListRuleAssignments` | `(includeRuleSetCounts)` | Tenant-wide assignments. |
| `ListRuleAssignmentsByEnvironmentGroupId` | `(environmentGroupId, includeRuleSetCounts)` | What rules a group has. |
| `ListRuleAssignmentsByEnvironmentId` | `(environmentId, includeRuleSetCounts)` | What rules an env has. |
| `ListRuleAssignmentsByPolicyId` | `(policyId, includeRuleSetCounts)` | Where a policy is applied. |

### 🛡️ Roles & role assignments

| Op | Signature | Notes |
| --- | --- | --- |
| `ListRoleDefinitions` | `()` | All built-in / custom role defs. |
| `ListRoleAssignments` | `()` | Tenant-scope assignments. |
| `ListEnvironmentRoleAssignments` | `(environmentId)` | Env admins / makers. |
| `ListEnvironmentGroupRoleAssignments` | `(environmentGroupId)` | Group managers (also in env groups section). |

### 📱 Apps (admin scope)

| Op | Signature | Notes |
| --- | --- | --- |
| `Get_AdminApps` | `(environmentId, $top?, $skiptoken?)` | Admin-scope app list in an env. |
| `Get_AdminApp` ✅ | `(environmentId, app)` | **The original "Get App As Admin"** — owner, sharing, ASP, suspension reason, last-modified-by, launch URL, document URI, device targeting tags, Siena/publisher versions. Shipped as the "Admin details (supplemental)" card on `views/AppDetail.tsx` for canvas / code / app-builder apps (model-driven is gated out via `isAppAdminDetailsSupported`); wrapper in `src/data/adminEnrichment.ts#getAppAdminDetails`. |

> **Gap.** Per-app **role assignments** (`GetAppRoleAssignmentAsAdmin`)
> live on the separate `shared_powerappsforadmins` connector — not on
> this V2 connector. See the "Sibling connectors" section.

### 🔁 Flows — admin scope

| Op | Signature | Notes |
| --- | --- | --- |
| `GetFlows` | `(continuationToken?)` | Tenant-wide flows (DSR-paged). |
| `ListCloudFlows` | `(environmentId, workflowId?, resourceId?, createdBy?, ownerId?, createdOnStartDate?, createdOnEndDate?, modifiedOnStartDate?, modifiedOnEndDate?)` | Env-scoped, filterable. |
| `GetFlowRunsSingleton` | `(flowId, continuationToken?)` | Runs for a singleton flow. |
| `GetFlowRunsNonSingleton` | `(environmentId, flowId, continuationToken?)` | Runs for an env-scoped flow. |
| `ListFlowRuns` | `(environmentId, workflowId)` | Run list (non-paginated wrapper). |
| `ListFlowActions` | `(environmentId, workflowId?, parentProcessStageId?, connector?, isTrigger?, parameterName?, parameterValue?, exact?)` | Action-level search across flows. |
| `GetRunHistoryData` | `(flowId, runId, continuationToken?)` | Per-run history. |

> **Gap.** The classic **"Get Flow As Admin"** payload (owner roles,
> environment, etc.) is on the separate `shared_powerautomateforadmins`
> and `shared_flowmanagement` connectors. See the "Sibling connectors"
> section.

### 💰 Capacity, currency & tenant limits

| Op | Signature | Notes |
| --- | --- | --- |
| `GetTenantCapacityDetails` | `()` | **Tenant-wide capacity numbers.** |
| `RetrieveTemporaryCurrencyEntitlementCount` | `(currencyType)` | **Temp currency count + limit by type.** `currencyType` enum covers AI, AppPass, MCSSessions, PerFlowPlan, PortalAddOns, PowerAutomatePerProcess, etc. (17 values). |
| `GetCurrencyAllocationByEnvironment` | `(environmentId)` | Per-env allocations. |
| `ListCurrencyReports` | `(includeAllocations?, includeConsumptions?)` | Reporting roll-up. |
| `ListStorageWarnings` | `()` | Active storage warnings. |
| `GetStorageWarningByCategory` | `(storageCategory)` | Per-category warnings. |
| `GetStorageWarningByCategoryAndEntity` | `(storageCategory, entityName)` | Per-category-per-entity warnings. |

### 📈 Flow capacity sources

All take `(startDate, endDate?, …)`. These power the **per-flow
capacity** view (who is consuming what license bucket).

| Op | Extra params | Notes |
| --- | --- | --- |
| `GetUserPerFlowCapacitySource` | `pageNumber?, pageSize?, userId?, flowContext?, flowLicenseCategorization?, resourceId?, environmentId?` | Raw records. |
| `GetUserPerFlowCapacitySourceFlowContextSummary` | `pageNumber?, pageSize?, environmentId?` | Roll-up by flow context. |
| `GetUserPerFlowCapacitySourceFlowContextSummaryForUserId` | scoped to one user | |
| `GetUserPerFlowCapacitySourceTenantContextSummary` | `environmentId?` | Tenant-context summary. |
| `GetUserPerFlowCapacitySourceUserContextSummary` | `pageNumber?, pageSize?, environmentId?` | User-context summary. |
| `GetUserPerFlowCapacitySourceUserContextSummaryForUserId` | scoped to one user | |

### 🤖 Copilot agents / prompts

| Op | Signature | Notes |
| --- | --- | --- |
| `GetPrompts` | `(continuationToken?)` | Tenant-wide prompts. |
| `GetBotQuarantineStatus` | `(EnvironmentId, BotId)` | Per-bot quarantine state. |

### 🌐 Power Pages

| Op | Signature | Notes |
| --- | --- | --- |
| `GetWebsites` | `(environmentId, skip?)` | Sites in an env. |
| `GetWebsiteById` | `(environmentId, id)` | Site detail. |
| `GetWAFRules` | `(environmentId, id, ruleType? = managed \| custom)` | WAF rules for a site. |
| `GetWAFStatus` | `(environmentId, id)` | WAF status. |
| `GetSecurityScanReport` | `(environmentId, id)` | Site security scan. |
| `GetSecurityScanScore` | `(environmentId, id)` | Scan score. |

### 💳 Billing

| Op | Signature | Notes |
| --- | --- | --- |
| `ListBillingPolicies` | `($top?)` | Tenant policies. |
| `GetBillingPolicy` | `(billingPolicyId)` | Single policy. |
| `ListBillingPolicyEnvironments` | `(billingPolicyId)` | Envs attached to a policy. |
| `GetBillingPolicyEnvironment` | `(billingPolicyId, environmentId)` | Single attachment. |
| `GetEnvironmentBillingPolicy` | `(environmentId)` | Which policy an env is on. |

### 📦 Application packages

| Op | Signature | Notes |
| --- | --- | --- |
| `GetTenantApplicationPackage` | `()` | Tenant-scope app catalog. |
| `GetEnvironmentApplicationPackage` | `(environmentId, appInstallState? = All \| Installed \| NotInstalled, lcid?)` | Installable app catalog per env. |
| `GetApplicationPackageInstallStatus` | `(environmentId, operationId)` | Poll a package install op. |

### 🧠 Advisor / Recommendations

| Op | Signature | Notes |
| --- | --- | --- |
| `GetRecommendationScenarios` | `()` | Scenario catalog. |
| `GetRecommendations` | `($skipToken?)` | Active recommendations. |
| `GetRecommendationResources` | `(scenario, $skipToken?)` | Resources flagged by a scenario. |
| `GetScenarioActions` | `(scenario)` | Available actions for a scenario. |
| `GetActionSchema` | `(scenario, actionName)` | Input schema for one action. |

### 🔌 Connections / connectors

| Op | Signature | Notes |
| --- | --- | --- |
| `GetConnections` | `(continuationToken?)` | Tenant-wide (DSR-paged). |
| `ListConnections` | `(environmentId)` | Env-scoped. |
| `ListConnectors` | `(environmentId, $filter)` | Available connectors in env. |
| `GetConnectorById` | `(environmentId, connectorId, $filter)` | One connector. |
| `ListCrossTenantConnectionReports` | `()` | Cross-tenant report list. |
| `GetCrossTenantConnectionReport` | `(reportId)` | Single report. |

### 🛡️ ISV contracts & misc.

| Op | Signature | Notes |
| --- | --- | --- |
| `ListISVContracts` | `($top?)` | ISV contracts in tenant. |
| `GetISVContract` | `(isvContractId)` | Single contract. |
| `GetApprovals` | `(continuationToken?)` | Approval requests visible to admin. |

---

## Sibling admin connectors (not yet wired)

These cover gaps the V2 connector doesn't fill. Wire one **only when** a
concrete supplemental action needs it — don't add the connection refs
proactively (every consent prompt is friction).

### PowerApps for Admins (`shared_powerappsforadmins`)

- `GetAppRoleAssignmentAsAdmin` — **per-app role assignments** (owner +
  shared-with users/groups), the canonical missing piece next to
  `Get_AdminApp` on the V2 connector.
- `GetAppAsAdmin` — overlaps with V2's `Get_AdminApp`; prefer V2.
- `SetPowerAppRoleAssignment`, `RemovePowerApp` — **mutating**, not in
  scope for this doc.

### Power Automate for Admins (`shared_powerautomateforadmins`)

- `ListFlowsAsAdmin` — tenant-wide flow inventory (overlaps with V2's
  `GetFlows`).
- `GetFlowAsAdmin` — admin-scope flow detail (definition, owner GUID,
  trigger type).
- `GetFlowOwnerRoleAsAdmin` — **owner role of a flow** (the piece you
  called out).
- `ListFlowOwnerRolesAsAdmin` — all owner roles for a flow.

### Power Automate Management (`shared_flowmanagement`)

- `GetFlow`, `ListFlows` (non-admin scope but useful for makers).
- `ListWorkflows`, `GetWorkflow` — workflow-level metadata.
- `GetUserRoleAssignment` — per-flow user role assignments.
- Run/history endpoints overlap with V2; prefer V2 for admin scope.

---

## Shortlist — highest-value first picks

When the time comes to build one, these are the supplemental actions
that buy the most user value per unit of complexity. All are scoped to
the *existing* V2 connector (no new consent), except where noted.

0. ✅ **Shipped — `GetEnvironmentByIdForUser` on environment detail page.**
   "Admin details (supplemental)" card on `views/EnvironmentDetail.tsx`,
   wired via `src/data/adminEnrichment.ts`. First reference implementation
   of the pattern documented below.

1. ✅ **Shipped — `Get_AdminApp` on app detail page.**
   "Admin details (supplemental)" card on `views/AppDetail.tsx`. Gated
   via `isAppAdminDetailsSupported(row.type)` so the card is hidden
   entirely for model-driven apps (which live in Dataverse and have no
   equivalent admin endpoint on this connector). Surfaces app version,
   launch URL, document URI, hero/featured posture, device targeting
   (form factor, supported orientations, capabilities, primary device
   width/height), and Siena/publisher versions — fields the inventory
   row doesn't carry.

2. **`ListEnvironmentRoleAssignments` on environment detail page.**
   "Who are the env admins / makers right now?" — frequent operator
   question, single call, single env id. Natural follow-up to #0 — could
   live as a second action button inside the same "Admin details" card.

3. **`GetEnvironmentGroup` + `ListEnvironmentGroupRoleAssignments` +
   `ListRuleAssignmentsByEnvironmentGroupId` on env-group detail page.**
   Three on-demand calls behind a single "Load admin details" button →
   complete "what does this group actually enforce" view.

4. **Rulesets as a new entity surface.**
   `GetRuleSetListForTenant` for a list view, `GetRuleSet` +
   `ListRuleAssignmentsByPolicyId` on a detail. Today the app has no
   ruleset surface at all.

5. **Tenant capacity / currency admin page.**
   `GetTenantCapacityDetails` + `ListCurrencyReports` +
   `RetrieveTemporaryCurrencyEntitlementCount` (one call per currency
   type the user expands) on a dedicated `/admin/capacity` page. Pure
   tenant scope, no per-record fanout.

6. **`GetAppRoleAssignmentAsAdmin` (requires new connector).**
   Once 1–5 prove the on-demand pattern, this is the first call that
   justifies onboarding `shared_powerappsforadmins`.

---

## Implementation pattern (as shipped in #0)

The first reference implementation lives in:

- `src/data/adminEnrichment.ts` — `getEnvironmentAdminDetails(envId)`.
- `src/views/EnvironmentDetail.tsx` — the `ReadyView` component owns an
  `AdminSlot` discriminated union and an `AdminDetailsBody` sub-component.

Copy this shape for new enrichments until we have ≥2 instances and
extract a shared component:

- **Data layer.** One small async function per enrichment in
  `adminEnrichment.ts` (or a sibling module per connector if we add
  more). Returns `Promise<DataResult<T>>` matching `inventory.ts`.
  Wrap the generated service call in `try`/`catch`, surface
  `result.success === false` as `{ ok: false, error }`, and reuse the
  local `formatError` helper. **No caching, no throttling** unless the
  call actually fans out — keep the wrapper boring.
- **State machine.** Local `useState<AdminSlot>` inside the detail
  page's `ReadyView`:
  ```ts
  type AdminSlot =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; details: T };
  ```
  Starts in `idle`. Transitions: idle → loading → ready | error.
  Click "Refresh" while in `ready` → loading → ready|error. Scoped to
  the component; remount on entity-id change is enough to clear state.
- **Trigger.** Primary `<Button>` labeled `"Load <thing>"` in the idle
  state. Secondary "Refresh" `<Link>` in the card header description
  (only visible when `kind === 'ready'`). Secondary `<Button>` "Retry"
  in the error state.
- **Render.**
  - **idle** → centered CTA (`adminCta` class): short help text +
    primary button.
  - **loading** → `<LoadingPane label="Loading <thing>…" />` inside
    `cardBody`.
  - **error** → `<ErrorPane>` + retry button (`adminReady` class).
  - **ready** → `metaGridTwo` of *only* the fields not already shown
    by the basic inventory card (deduplicate to avoid noise) +
    `<RawJsonAccordion title="Raw admin payload" data={raw} />`
    inside the same card so the full payload is one click away.
- **Placement.** New `<Card className={styles.colFull}>` between the
  basic inventory cards and the resource roll-up section, marked with a
  `(supplemental)` suffix in the title so it's visually distinct from
  data that loaded automatically.
- **Telemetry / cache / consent.** Nothing wired today. If a future
  enrichment justifies any of these, add them at this layer (cache key
  = call name + record id; consent prompt only when adding a new
  connection ref to `power.config.json`).
