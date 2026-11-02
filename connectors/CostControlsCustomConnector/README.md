# CostControlsCustomConnector

Standalone Power Platform custom connector for **Microsoft Graph beta Copilot
Cost Management**, not the Power Platform API connector or a passthrough flow.
Its exact display name is **CostControlsCustomConnector**.

**Beta: Microsoft does not support these APIs in production applications.**
Contracts were checked against the Microsoft Learn operation and resource
pages on 2026-11-02. Commercial Microsoft Graph only.

## Files and import route

| File | Purpose |
|---|---|
| [apiDefinition.swagger.json](./apiDefinition.swagger.json) | Import this Swagger/OpenAPI **2.0** definition in the custom connector designer. Includes all 22 overview operations plus both documented read-only `$ref` list variants (24 actions). |
| [apiProperties.json](./apiProperties.json) | Companion metadata for CLI-based import; derived from `pac connector init --connection-template OAuthAAD`. Contains only explicit non-secret placeholders. **Not** the file to upload in the designer's OpenAPI import. |
| [validate.mjs](./validate.mjs) | Offline, dependency-free contract and connector-compatibility checks: `node connectors\CostControlsCustomConnector\validate.mjs` from the repository root. |

These files are standalone connector sources, not a managed solution ZIP.
Import and connection creation below are steps for **you** to perform in your
environment; importing this definition alone does not deploy or wire the app.

The repository also includes a registered-connector API playground and the
dedicated **Cost Controls** reporting/management area. They use the generated
`CostControsl_CustomConnService` directly through
`msftcsa_MACCostControlsConnRef`, not a passthrough flow. The generated spelling
matches the existing registered connector and is deliberately preserved.
See the [app usage guide](../../PP-CoE-CodeApp/docs/connector-playground.md#dedicated-cost-controls).
The exported connector and connection-reference components are under
`solution/src/`; configure their client settings and connection in your own
environment.

## 1. Register your Microsoft Entra application

1. In the directory that holds the target tenant, open **Microsoft Entra admin
   center > App registrations > New registration**. Use a single-tenant app
   (accounts in this organizational directory only) unless your organization has
   explicitly designed a multitenant deployment. Personal accounts are unsupported.
2. Record your **Application (client) ID** and **Directory (tenant) ID** locally.
   A client ID and tenant ID are not secrets, but this repository intentionally
   supplies neither.
3. Under **Certificates & secrets**, create a client secret using your
   organization's lifetime/rotation policy. Put its **value**, not its secret ID,
   only into the connector Security setup. Do not send it to an agent, put it in
   a flow body, or commit it to these files. Do not enable public-client flows or
   use client-credentials authentication for this connector.
4. Under **API permissions > Add a permission > Microsoft Graph >
   Delegated permissions**, select the cost-management permissions needed below.
   An authorized tenant administrator must grant admin consent. Existing
   Power Platform connector permissions do **not** grant these Graph permissions.
   If a beta permission is not available in your tenant, stop and check rollout
   and documentation; do not substitute a similarly named permission or manually
   invent a permission GUID.

For **all 24 actions**, the smallest permission families that cover the surface
are the following four delegated grants:

- `CopilotCostManagement.Read.All`
- `CopilotCostManagement-Policy.ReadWrite.All`
- `CopilotCostManagement-Assignment.ReadWrite.All`
- `CopilotCostManagement-UserData.Read.All`

For read-only use, substitute `CopilotCostManagement-Policy.Read.All` and
`CopilotCostManagement-Assignment.Read.All` for their corresponding ReadWrite
grants. ReadWrite is explicitly documented as the higher-privileged alternative
on policy/assignment read operations; both read and write variants need not be
granted together. Restrict granted permissions to your intended actions. The
Swagger does not add authentication input fields or solicit bearer tokens.

### Permissions and runtime roles per action

All grants below are **delegated work/school account** permissions. Admin consent
does not replace the signed-in user's qualifying directory role or resource
scope. The operation pages explicitly state an additional runtime role only for
**CreateSpendingPolicy**. For the other actions, the overview supplies persona
guidance, not an exhaustive per-operation role matrix; that gap must not be
mistaken for either "no role required" or a verified allow-list.

| Actions | Least privileged Graph permission | Runtime role documented / overview guidance |
|---|---|---|
| `GetTenantCreditBalance` | `CopilotCostManagement.Read.All` | Per-operation qualifying role not enumerated; overview read personas include Global Reader and Billing Administrator (FinOps is a persona, not a directory-role name). |
| `ListSpendingPolicies`, `GetSpendingPolicy` | `CopilotCostManagement-Policy.Read.All` | Per-operation role not enumerated; overview read guidance as above. |
| `CreateSpendingPolicy` | `CopilotCostManagement-Policy.ReadWrite.All` | **Billing Administrator or Global Administrator is additionally required at runtime.** A nonempty initial audience also requires `CopilotCostManagement-Assignment.ReadWrite.All`. |
| `UpdateSpendingPolicy`, `DeleteSpendingPolicy` | `CopilotCostManagement-Policy.ReadWrite.All` | Per-operation role not enumerated; overview policy-management personas include AI Administrator and License Administrator. Do not assume those roles satisfy the separate create requirement. |
| `ListAssignedGroups`, `ListAssignedGroupReferences` | `CopilotCostManagement-Assignment.Read.All` | Per-operation role not enumerated; overview read guidance. |
| `AddAssignedGroup`, `RemoveAssignedGroup` | `CopilotCostManagement-Assignment.ReadWrite.All` | Per-operation role not enumerated; overview policy-management guidance. |
| `ListServiceSettings`, `GetServiceSetting` | `CopilotCostManagement-Policy.Read.All` | Per-operation role not enumerated; overview read guidance. |
| `CreateServiceSetting`, `UpdateServiceSetting` | `CopilotCostManagement-Policy.ReadWrite.All` | Per-operation role not enumerated; overview policy-management guidance. |
| `GetAlertSetting`, `ListRecipients`, `ListRecipientReferences` | `CopilotCostManagement-Policy.Read.All` | Per-operation role not enumerated; overview read guidance. |
| `UpdateAlertSetting`, `DeleteAlertSetting`, `AddRecipient`, `RemoveRecipient` | `CopilotCostManagement-Policy.ReadWrite.All` | Per-operation role not enumerated; overview policy-management guidance. |
| `GetUserBalance`, `ListUserServiceBalances`, `GetUserServiceBalance` | `CopilotCostManagement-UserData.Read.All` | Per-operation role not enumerated; overview user-diagnostics personas include Support/Helpdesk administrators. |

Only the tenant credit balance operation additionally documents application
permission support. **This connector deliberately does not use it:** all actions
use a user's delegated sign-in. A 403 can mean a missing permission **or** runtime
role. Row-level authorization precedes lookup, so an out-of-scope tenant resource
can return 404 rather than 403.

## 2. Import in Power Apps or Power Automate (recommended)

1. Select the intended Power Platform environment. Open **Custom connectors >
   New custom connector > Import an OpenAPI file** (navigation labels vary).
   Name it exactly **CostControlsCustomConnector** and upload
   `apiDefinition.swagger.json`.
2. Confirm General uses HTTPS, host `graph.microsoft.com`, and base URL
   `/beta/copilot/costManagement`. Do not replace these with the Power Platform
   API host or your environment URL. No on-premises gateway is needed.
3. In **Security**, choose **OAuth 2.0 > Microsoft Entra ID** (called **Azure
   Active Directory** in some designers). Fill in the following:

   | Setting | Value |
   |---|---|
   | Client ID | Your own app registration's Application (client) ID |
   | Client secret | Your own secret **value**, entered only in the designer |
   | Login URL | `https://login.microsoftonline.com` |
   | Tenant ID | Your Directory (tenant) ID, not `common` for the recommended single-tenant setup |
   | Resource URL / resource ID / audience | `https://graph.microsoft.com` |
   | Scope (legacy Entra/AAD resource-based configuration) | Leave blank; delegated grants are configured and consented on the app registration |
   | Enable on-behalf-of login | Off; use an ordinary connector-owned delegated connection |

   The Swagger's `/common/oauth2/authorize` and `/common/oauth2/token` values
   declare the **v1 resource-based authorization-code** security scheme for
   import. The Entra security provider's tenant/resource fields configure the
   actual sign-in. Do not mix v2 `/oauth2/v2.0` endpoints and v1 `resource`
   settings. If using a generic OAuth provider instead, its endpoint, scope and
   resource handling must be configured separately; that is not this template.
4. Save/create the connector. Copy the **redirect URI actually displayed by this
   connector** in Security. If the designer offers a unique/per-connector redirect
   option, use it and copy its generated value. Do not invent a redirect URI.
5. In Entra **Authentication > Add a platform > Web**, register that exact
   generated redirect URI, including casing and any path. It is an HTTPS Web
   redirect, not a SPA redirect. Do not enable implicit grants. The companion CLI
   template's global redirect is a documented template default, **not** a promise
   that your designer/region will issue that URI; the displayed URI wins.
6. Save/update the connector again if necessary. Under **Test**, create a **New
   connection**, sign in as a work/school user with the necessary permissions
   and directory role, and complete your organization's consent/MFA process.
   The connection holds tokens; the JSON files do not. Re-create the connection
   after changing permission grants or authentication configuration if the old
   consent/token is still in use.
7. Start with the intended read-only action, not a policy mutation. Check that the
   environment's DLP policies permit this custom connector and that your license
   includes custom connector usage. These checks and live API tests are left to
   you; no API call or import has been performed by this change.

### Optional CLI import

`apiProperties.json` uses the official PAC OAuthAAD companion format, including
`connectionParameters.token.oAuthSettings` and the hidden `token:TenantId`.
Only `REPLACE_ME_CLIENT_ID` and `REPLACE_ME_TENANT_ID` are placeholders. Work on
a **private local copy outside the repository** and replace these two values.
No client secret is included. The Graph resource URI is intentionally already
set in `customParameters.resourceUri`. Legacy on-behalf-of extras emitted by
some PAC versions are omitted to conform to the published companion schema;
no on-behalf-of login is configured.

With an existing authorized PAC profile, you can import the definition and the
private companion copy using:

```powershell
pac connector create `
  --api-definition-file .\connectors\CostControlsCustomConnector\apiDefinition.swagger.json `
  --api-properties-file C:\Private\CostControlsCustomConnector.apiProperties.json
```

This command **creates a connector in the selected environment**; it is not an
offline validation command and has not been run here. Verify the target profile
and your installed CLI's `pac connector create help` before using it. Complete
client-secret configuration and verify the actual redirect URI in the designer,
then create a connection as above. A CLI-imported connector is not automatically
added to the app or the repository's managed solution. Do not commit exported
properties containing a client secret, connection IDs or tenant-specific values.

## Contracts and safe usage

### Policy concurrency and lifecycle

- Every mutation beneath an **existing** policy requires **`If-Match` containing
  the parent policy ETag**, including service creation and alert creation, group
  references and recipient references. All 10 such mutations expose it as a
  required header. Policy creation is the only mutation without it.
- Read a fresh policy before a mutation. Copy the weak prefix/quotes exactly
  (for example `W/"7"`); never fabricate the value or use `*`. Inspect successful
  action response **headers**, not just the body. The definition declares
  `ETag`/`Location` wherever the operation page documents them and also declares
  the optional policy GET ETag. It does not transform or strip response headers.
- **Documentation gap:** the overview requires fresh policy ETags, but the
  policy GET page's response/example does not show an ETag header. Verify this
  after import; a service setting's documented **`parentEtag`** is an additional
  source of the same parent token (read without a restrictive `$select`).
  There is no independent child ETag. If neither source yields the current
  token, stop rather than inventing one. After mutation, use the advanced ETag
  when returned, or read the parent again. Handle 412 by re-reading and reviewing
  the intended change, not by blindly replaying a write.
- A new policy is `disabled`. Selected-group policies can be created without an
  audience and linked afterward; the service handles enabling when requirements
  are satisfied. `status` and audit fields are read-only, not writable switches.
  At least one service must remain enabled. Do not PATCH during noneditable
  provisioning/failure/subscription states. The audience type is immutable;
  delete/recreate yields a new ID and resets that new policy's accounting.
- The optional inline `assignedGroups` relationship on create is documented, but
  its precise create-payload serialization is not illustrated. The schema exposes
  directory group objects without inventing required members. Prefer the
  unambiguous disabled-create plus `AddAssignedGroup` `$ref` sequence.
- Reference actions keep literal **`$ref`** and
  **`microsoft.graph.selectedGroupsSpendingPolicy`** route segments. Group/user
  reference bodies contain `@odata.id` with the full documented
  `https://graph.microsoft.com/beta/groups/{id}` or `/users/{id}` URL.
  Removing a reference must not delete the directory object.
- Service settings have **no DELETE** operation. `UpdateServiceSetting` with
  `{"state":"disabled"}` excludes the service while retaining the entry.
  `cowork` and `workIQ` are service-category examples, not an exhaustive catalog
  and not individual agent identifiers.

### Quantities, alerts and diagnostics

Limited quantities use
`{"@odata.type":"#microsoft.graph.limitedCostManagementQuantity","value":500,"unit":"copilotCredit"}`.
Unlimited quantities use
`{"@odata.type":"#microsoft.graph.unlimitedCostManagementQuantity","unit":"copilotCredit"}`,
**without `value`**. Zero is a finite limit that permits no consumption, not
unlimited. The period is the current UTC calendar month, resetting at 00:00 UTC
on its first day. Missing purchased/remaining tenant quantities are legitimate
when no finite pool exists; never default them to zero or calculate authoritative
remaining credits by subtracting consumption from purchases.

Billing methods are a **flags string**, including
`prepaidCredits,payAsYouGo`; the schema deliberately does not constrain them to a
single enum member. Current policy states are `enabled`, `disabled`,
`provisioning`, `provisioningFailed`, `unknownFutureValue`; service-setting states
are `enabled`, `disabled`, `unknownFutureValue`. Treat `unknownFutureValue` as a
sentinel, not an ordinary choice for writes.

Alerts are **notify-only**, not authorization to consume or an increased limit.
Percentage thresholds require integer values **1-100** and no `unit`. Absolute
thresholds require a **positive** value and a unit matching the policy limit.
First configure alerting disabled, link recipients, then enable it, obtaining a
fresh parent ETag for every step. Explicit null values are invalid. An existing
configuration accepts merge PATCH `{}`; omit fields to preserve them and use
`thresholds: []` to clear thresholds. Recipients are managed only through
separate `$ref` actions. Deleting the alert setting turns alerting off without
deleting recipient references.

Swagger 2.0 has no `oneOf` or conditional required properties. Quantity and
threshold polymorphism is represented as flattened objects with concrete
`@odata.type` choices. The conditional value/unit rules above are intentionally
documented rather than incorrectly requiring a numeric value for unlimited
quantities or a unit for percentage thresholds. No undocumented quantity minimum,
service enumeration or page-size maximum is invented. Confirm conditional
constraints in the calling logic; the API remains authoritative. Nullable audit
identity details and source timestamps may be returned by Graph; Swagger 2.0
cannot fully express nullable referenced objects.

User balances are addressed by a **known user ID**; `/userBalances` is not
listable. Only `GetUserBalance` supports `$expand=serviceBalances`. Inspect
`unevaluatedServices` and source freshness even on HTTP 200: omitted services
can mean `upstreamFailure` or `noApplicablePolicy`, not zero consumption.
All-services evaluation failure is 503 `sourceUnavailable`.

### Query options and paging

| Operation | Exposed query options |
|---|---|
| `ListSpendingPolicies` | `$select`, `$top`, `$count`, `$orderby` on displayName/createdDateTime; `$filter` eq/ne on status/displayName/createdDateTime, with and/or. Qualified status literals are required; createdDateTime comparisons use whole-second precision. |
| `GetSpendingPolicy`, `ListServiceSettings`, `GetServiceSetting`, `GetAlertSetting`, `GetUserServiceBalance` | `$select` only; no policy child expansion. |
| `GetUserBalance` | `$select`, `$expand=serviceBalances` only. |
| `ListUserServiceBalances` | `$select`, `$top`, `$count`, `$orderby` on serviceId; `$filter` serviceId eq/in and isConsumptionAllowed eq, with and only. Comparisons are case-sensitive for serviceId. |
| Other reads and all writes | No OData query options exposed. |

Collections retain the OData envelope (`value`, `@odata.context`,
`@odata.nextLink`, and `@odata.count` where supported). **Each list action
returns one page**; it does not claim that a page is the whole tenant. No
undocumented `$skip`, `$skiptoken`, URL-rewrite policy, arbitrary-URL action, or
automatic paging is added. `$top` is only an upper bound.

If Graph returns a next link, the consumer must follow the **complete URL
unchanged** using an appropriately authorized Graph-capable client after checking
that it belongs to `https://graph.microsoft.com/beta/copilot/costManagement/`.
This connector intentionally has no continuation action for an opaque URL:
Power Platform custom-connector automatic paging and a currently undocumented
continuation parameter cannot be assumed. It is suitable for the documented
first-page calls; **exhaustive multi-page scans require separate consumer wiring**
and are not delivered by these files. Do not rebuild an offset from the number
of received rows or silently drop a nonempty next link.

Failures preserve the standard Graph `error`/`innerError` envelope and diagnostic
headers when supplied. Relevant conflicts include `lastAssignedGroup`,
`allUsersServiceConflict`, `groupServiceConflict`, `atLeastOneServiceRequired`,
`invalidTransition`, and `alertRecipientsRequired`; 429 uses server retry guidance
when supplied. No connector policy retries writes or converts failures into
success-shaped data.

**These APIs provide credit snapshots and policy governance, not rated currency
costs, invoices, prices, forecasts, consumption history, or per-agent attribution.**
Do not label the balance rows as those missing capabilities.

## Validation and remaining import/runtime checks

Run the local contract checks from the repository root:

```powershell
node .\connectors\CostControlsCustomConnector\validate.mjs
```

For independent Swagger 2.0 structural and reference validation, use an available
Swagger validator. The implementation was checked with:

```powershell
npx --yes --package @apidevtools/swagger-cli swagger-cli validate `
  .\connectors\CostControlsCustomConnector\apiDefinition.swagger.json
```

`swagger-cli` is a deprecated standalone validator; it is not a new app dependency.
Both JSON artifacts were also checked against Microsoft's published
[connector Swagger schema](https://raw.githubusercontent.com/microsoft/PowerPlatformConnectors/dev/schemas/apiDefinition.swagger.schema.json)
and [companion properties schema](https://raw.githubusercontent.com/microsoft/PowerPlatformConnectors/dev/schemas/paconn-apiProperties.schema.json).
The upstream Swagger schema contains JSON comments and a trailing comma, so it
was parsed as JSON5 for that check; the delivered artifacts are strict JSON.
The local contract checks also verify exact method/path/action coverage, all
parent concurrency headers, documented query surfaces, ETag declarations, no
service DELETE, companion OAuth fields, and absence of embedded credentials.
They do **not** certify tenant import, consent, runtime roles or API rollout.

The designer must still validate/save the connector in your environment. No live
import, connection, OAuth exchange, Graph request or mutation was performed.
Confirm after import: literal `$ref`/cast route preservation, v1 Entra security
configuration, generated redirect registration, runtime exposure of response
headers, fresh policy ETags, optional inline group creation (if used), and your
tenant's role/permission availability. There is no claim of production readiness.

## Authoritative references

- [Cost Management overview and all 22 operation links](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/overview)
- Each Swagger operation's `externalDocs.url` points to its verified operation page;
  the two additional GET actions reuse the corresponding list page's documented
  `$ref` variant.
- Resource schemas under the same documentation root:
  [spendingPolicy](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/spendingpolicy),
  [service setting](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/spendingpolicyservicesetting),
  [quantity](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementquantity),
  [limited](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/limitedcostmanagementquantity),
  [unlimited](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/unlimitedcostmanagementquantity),
  [alert setting](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementalertsetting),
  [percentage threshold](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/percentagecostmanagementalertthreshold),
  [absolute threshold](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/absolutecostmanagementalertthreshold),
  [tenant credit balance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementtenantcreditbalance),
  [billing-method balance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementbillingmethodbalance),
  [user balance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementuserbalance),
  [user service balance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementuserservicebalance),
  [unevaluated service](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementunevaluatedservice),
  [data status](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/costmanagementdatastatus),
  [selection data status](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/resources/selectiondatastatus).
- [Create a custom connector from OpenAPI](https://learn.microsoft.com/en-us/connectors/custom-connectors/define-openapi-definition)
- [Microsoft Entra authentication for custom connectors](https://learn.microsoft.com/en-us/connectors/custom-connectors/azure-active-directory-authentication)
- [PAC connector commands](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/connector)
