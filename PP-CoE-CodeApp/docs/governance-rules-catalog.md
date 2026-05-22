# Governance rules catalog

> **Schema reference** for the rules and parameter buckets that govern
> Power Platform environment groups. Sibling to:
>
> - [`admin-payload-samples.md`](./admin-payload-samples.md) — raw
>   captured payloads
> - [`admin-connector-inventory.md`](./admin-connector-inventory.md) —
>   connector-op surface
>
> Use this when:
>
> - Adding a friendly renderer for a new rule id (the renderer code
>   lives in `src/components/ruleRenderers/`)
> - Designing a future "compare two groups" diff view
> - Cross-referencing what a tenant admin sees in the PPAC "Add rules"
>   picker vs. what the API returns

## The two-model recap

The Power Platform governance surface ships **two parallel governance
APIs that both use the word "ruleSet"**, co-existing by design (each
owns a different slice of the picture). See
[`admin-payload-samples.md`](./admin-payload-samples.md) for the live
samples and the corrected framing.

| | Model A — parameter buckets | Model B — rule-based policies |
| --- | --- | --- |
| Returned by | `GetRuleSetListForTenant`, `GetRuleSet` | `GetRuleBasedPolicyByID`, `ListRuleBasedPolicies` |
| Connector return type | `MgGovODataResponse` → `RuleSetDto[]` | `Policy`, `ListPolicyResponse` |
| Atomic unit | `{ type, resourceType, value: [{ id, value: string }] }` | `{ id, version, inputs: Record<string, unknown> }` |
| Value typing | Always string (booleans serialized as `"true"`/`"false"`) | Structured per rule id (booleans real, lists real) |
| Renderer | `src/components/ruleRenderers/ModelARulesetRenderer.tsx` → `RulesetBucketsAccordion` | `src/components/ruleRenderers/RuleSetRenderer.tsx` → `PolicyRuleSetsAccordion` |
| Registry key | `${type}/${resourceType}` (bucket) + `${type}/${resourceType}/${id}` (setting) | `${ruleId}` |
| Status | Both render as accordions of items with PPAC display names + status summaries | |

## How to read each entry

Every entry below documents one **stable identifier** in one of the two
models:

- **Model B entries** are keyed by `rule.id` (e.g. `CopilotTranscripts`).
- **Model A entries** are keyed by `(type, resourceType)` — the bucket
  — with the per-setting `id`s nested inside.

Each entry carries:

- **PPAC display name** — the human-readable label Microsoft shows in
  the "Add rules to this group" picker. Inferred from screenshots in
  this session; treat as best-effort until Microsoft documents the
  mapping.
- **Inputs schema** — the structured shape of `inputs` (Model B) or the
  list of known `id` values (Model A). Includes value types and any
  enum domains observed.
- **Live sample** — a real value captured from a real tenant; see the
  samples doc for context.
- **Renderer status** — ✅ implemented, 🛠 partial, or ❌ not yet.

When Microsoft ships a new rule id we don't recognize, the accordion
falls through to a generic "Unknown rule id" badge + raw JSON viewer
in the panel. **No data is silently dropped** — adding a typed
renderer is purely additive.

---

# Model B catalog (rule-based policies)

## Known rule ids (typed renderers shipped)

### `CopilotTranscripts`

| | |
| --- | --- |
| **PPAC display name** | Accessing transcripts from conversations in Copilot Studio agents |
| **Latest version observed** | 1.0 |
| **Renderer** | ✅ `RULE_METADATA.CopilotTranscripts` in `RuleSetRenderer.tsx` |
| **Status summary** | `"Access {allowed\|blocked} · Recording {allowed\|blocked}"` |

```ts
inputs: {
  BlockAccessToSessionTranscriptsForCopilotStudio: boolean;  // truthy = blocked
  BlockTranscriptRecordingForCopilotStudio: boolean;          // truthy = blocked
}
```

```json
{
  "BlockAccessToSessionTranscriptsForCopilotStudio": false,
  "BlockTranscriptRecordingForCopilotStudio": false
}
```

Rendering inverts the `Block*` semantics so the "good / open" answer
shows a green check.

---

### `ConnectorManagement`

| | |
| --- | --- |
| **PPAC display name** | Advanced connector policies (preview) |
| **Latest version observed** | 1.0 |
| **Renderer** | ✅ `RULE_METADATA.ConnectorManagement` in `RuleSetRenderer.tsx` |
| **Status summary** | `"N allowed connectors"` |

```ts
inputs: {
  AllowedConnectorList: Array<{
    AllowedConnector: string;                  // ARM path: /providers/Microsoft.PowerApps/apis/shared_<slug>
    AllowedActions?: string[];                 // operation IDs (only when AllowedActionsMode === "SomeAllowed")
    AllowedActionsMode: "AllAllowed" | "SomeAllowed";
    AllowedConnectionTypesMode: "AllAllowed" | "SomeAllowed";
    // AllowedConnectionTypes?: string[];      // expected sibling for SomeAllowed; not captured yet
  }>;
}
```

```json
{
  "AllowedConnectorList": [
    {
      "AllowedConnector": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
      "AllowedActionsMode": "AllAllowed",
      "AllowedConnectionTypesMode": "AllAllowed"
    },
    {
      "AllowedConnector": "/providers/Microsoft.PowerApps/apis/shared_sql",
      "AllowedActions": [
        "DeleteItem", "GetItem", "GetItems_V2", "PatchItem", "PostItem",
        "ExecuteProcedure", "TestConnection"
      ],
      "AllowedActionsMode": "SomeAllowed",
      "AllowedConnectionTypesMode": "AllAllowed"
    }
  ]
}
```

Rendering strips the ARM-style prefix and runs each `<slug>` through
`friendlyConnectorName(...)` from `src/data/inventory.ts`. Unknown
slugs fall back to a kebab-prettified label.

**Consumed by:** `summarizeAcpStatus()` in `src/data/dlpPolicies.ts` —
sums `AllowedConnectorList.length` across all `ConnectorManagement`
rules to feed the env-detail "DLP coverage" card's
`allowedConnectorCount`. The per-connector action lists
(`AllowedActions[]`) and `AllowedActionsMode` are **not yet diffed
or rendered**; surfacing them is the next step for the upcoming ACP
Comparator (see roadmap).

---

### `AdvancedConnectorPoliciesOnly`

| | |
| --- | --- |
| **PPAC display name** | Advanced connector policies only (preview) |
| **Latest version observed** | 1.0 |
| **Renderer** | ❌ (status-only — `summarizeAcpStatus` checks the flag; no detail renderer yet) |
| **Status summary** | `"Enabled"` / `"Disabled"` |

```ts
inputs: {
  EnableAdvancedConnectorPoliciesOnly: boolean;
}
```

```json
{ "EnableAdvancedConnectorPoliciesOnly": true }
```

When this rule is present **and** `EnableAdvancedConnectorPoliciesOnly`
is `true`, the env group is in **ACP-only mode**: any DLP policies that
would otherwise scope to environments in this group are ignored, and
only the `ConnectorManagement` allow-list enforces. The rule can be
attached but disabled — always require the flag to be truthy.

**Consumed by:** `summarizeAcpStatus()` in `src/data/dlpPolicies.ts`.
Flips `acp.only = true` on the env-detail DLP-coverage card, which
swaps the "Both DLP and ACP apply" info banner for a "DLPs are
overridden by ACP-only mode" warning and tags each DLP row.

---

### `CopilotChannelPublishSettings`

| | |
| --- | --- |
| **PPAC display name** | Agent access channels (preview) |
| **Latest version observed** | 1.0 |
| **Renderer** | ✅ `RULE_METADATA.CopilotChannelPublishSettings` in `RuleSetRenderer.tsx` |
| **Status summary** | `"N of 6 channels allowed"` |

```ts
inputs: {
  AllowAgentPublishToTeams: boolean;
  AllowAgentPublishToDirectLines: boolean;
  AllowAgentPublishToOmniChannel: boolean;
  AllowAgentPublishToSharePoint: boolean;
  AllowAgentPublishToFacebook: boolean;
  AllowAgentPublishToWhatsApp: boolean;
}
```

```json
{
  "AllowAgentPublishToFacebook": false,
  "AllowAgentPublishToTeams": true,
  "AllowAgentPublishToDirectLines": true,
  "AllowAgentPublishToOmniChannel": true,
  "AllowAgentPublishToSharePoint": true,
  "AllowAgentPublishToWhatsApp": false
}
```

---

### `CopilotEnablePrompts`

| | |
| --- | --- |
| **PPAC display name** | AI prompts |
| **Latest version observed** | 1.0 |
| **Renderer** | ✅ `RULE_METADATA.CopilotEnablePrompts` in `RuleSetRenderer.tsx` |
| **Status summary** | `"Enabled"` / `"Disabled"` |

```ts
inputs: {
  AiPromptsEnabled: boolean;
}
```

```json
{ "AiPromptsEnabled": true }
```

---

### `CopilotFeaturesForMakers`

| | |
| --- | --- |
| **PPAC display name** | AI-powered Copilot features (preview) |
| **Latest version observed** | 1.0 |
| **Renderer** | ✅ `RULE_METADATA.CopilotFeaturesForMakers` in `RuleSetRenderer.tsx` |
| **Status summary** | `"Maker bot enabled"` / `"Maker bot disabled"` |

```ts
inputs: {
  PowerAppsMakerBotEnabled: boolean;
}
```

```json
{ "PowerAppsMakerBotEnabled": true }
```

---

### `MakerOnboardingContent`

| | |
| --- | --- |
| **PPAC display name** | Maker welcome content |
| **Latest version observed** | 1.0 |
| **Renderer** | ✅ `RULE_METADATA.MakerOnboardingContent` in `RuleSetRenderer.tsx` |
| **Status summary** | `"Markdown set · URL set · Consent required"` |

```ts
inputs: {
  makerOnboardingUrl: string;            // arbitrary URL shown to makers
  makerOnboardingMarkdown: string;       // welcome content (Markdown source)
  makerOnboardingPortals: string;        // comma-separated portal list, often ""
  makerOnboardingTimestamp: string;      // free-form RFC-1123-ish, e.g. "Tue, 03 Feb 2026 21:59:34 GMT"
  makerOnboardingConsentRequired: boolean;
}
```

```json
{
  "makerOnboardingUrl": "https://www.google.com",
  "makerOnboardingMarkdown": "## Welcome\n\nThis is the group for <Insert Name>\n\nIf you have questions reach out\n\n",
  "makerOnboardingPortals": "",
  "makerOnboardingTimestamp": "Tue, 03 Feb 2026 21:59:34 GMT",
  "makerOnboardingConsentRequired": true
}
```

Rendering displays the markdown as a preview pane (raw source — no
MD-to-HTML conversion to keep dep footprint flat). Linked back to the
Model A `MakerOnboarding/NotSpecified/MakerContentRuleBasedPolicy`
parameter, which is a `MakerContentRuleBasedPolicy-<guid>` pointer to
the Model B policy holding this rule.

---

## Pending (visible in PPAC picker, no live payload yet)

Microsoft's "Add rules" picker shows ~26 rules per env group; the
following are the ones we don't yet have a Model B `id` mapping or
schema for. When you click one and see the live `inputs` shape, capture
it here and into `admin-payload-samples.md`.

| PPAC display name | Likely model | Likely id (guess) | Status |
| --- | --- | --- | --- |
| ~~Advanced connector policies only (preview)~~ | B | ✅ **Confirmed** as `AdvancedConnectorPoliciesOnly` — see entry above |
| Backup retention | B | `BackupRetention` (?) | ❌ unknown |
| Computer Use | B | `ComputerUse` (?) | ❌ unknown |
| Computer Use Access Control | B | `ComputerUseAccessControl` (?) | ❌ unknown |
| Content security policy | B | `ContentSecurityPolicy` (?) | ❌ unknown |
| Control maker credential options (preview) | B | `MakerCredentialOptions` (?) | ❌ unknown |
| Copilot GSA Settings | B | `CopilotGSASettings` (?) | ❌ unknown |
| Default deployment pipeline | B | `DefaultDeploymentPipeline` (?) | ❌ unknown |
| Dynamics 365 Implementation Project | B | `DynamicsImplementationProject` (?) | ❌ unknown |
| Enable Code Interpreter | B | `EnableCodeInterpreter` (?) | ❌ unknown |
| Enable External Models | B | `EnableExternalModels` (?) | ❌ unknown |
| Enable IP Cookie Binding | B | `EnableIpCookieBinding` (?) | ❌ unknown |
| Generative AI settings | A *or* B | overlaps with Model A `GenerativeAISettings/NotSpecified` | 🛠 see Model A entry |
| IP Firewall setting | B | `IPFirewall` (?) | ❌ unknown |
| Power Apps code apps | B | `PowerAppsCodeApps` (?) | ❌ unknown |
| Power Apps component framework for canvas | B | `PowerAppsComponentFramework` (?) | ❌ unknown |
| Preview and experimental AI models | B | `ExperimentalAiModels` (?) | ❌ unknown |
| Release channel | B | `ReleaseChannel` (?) | ❌ unknown |
| Require new environments to be in one region | B | `RequireRegionForNewEnvironments` (?) | ❌ unknown |
| Sharing Copilot Studio agent data with Viva Insights | B | `SharingWithVivaInsights` (?) | ❌ unknown |
| Showing Images And URLs | B | `ShowingImagesAndUrls` (?) | ❌ unknown |
| Solution checker enforcement | A | overlaps with Model A `SolutionChecker/NotSpecified` | 🛠 see Model A entry |
| Unmanaged customizations | B | `UnmanagedCustomizations` (?) | ❌ unknown |
| Usage insights | A | overlaps with Model A `AdminDigest/NotSpecified` | 🛠 see Model A entry |

When a tenant has any of these rules enabled, the accordion will show
the PPAC display name (when our `RULE_METADATA` has it) plus an
`Unknown rule id` warning badge plus raw JSON, so we can capture the
shape and add typed support.

---

# Model A catalog (parameter buckets)

Model A rulesets are returned as a list of `RuleSetDto`s. Each
`RuleSetDto` has an `environmentFilter` selecting which env/group it
applies to, and a `parameters` array of `(type, resourceType, value: [{id, value}])`
buckets. Below each bucket entry, the **per-setting table** documents
the known `id` values inside.

## Known parameter buckets (typed renderers shipped)

### `SolutionChecker / NotSpecified`

| | |
| --- | --- |
| **PPAC display name** | Solution checker enforcement |
| **Renderer** | ✅ `BUCKET_METADATA["SolutionChecker/NotSpecified"]` in `ModelARulesetRenderer.tsx` |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `solutionCheckerMode` | string-enum | `none` \| `warn` \| `block` | Colored badge (informative / warning / danger) |
| `suppressValidationEmails` | string-bool | `"true"` \| `"false"` | Positive indicator (true = good — suppressed) |
| `solutionCheckerRuleOverrides` | string | free-form (observed empty) | Code span or `(none)` |

---

### `GenerativeAISettings / NotSpecified`

| | |
| --- | --- |
| **PPAC display name** | Generative AI settings |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `crossGeoCopilotDataMovementEnabled` | string-bool | `"true"` \| `"false"` | Positive indicator (true = allowed) |
| `bingChatEnabled` | string-bool | `"true"` \| `"false"` | Positive indicator (true = enabled) |

---

### `Copilot / App`

| | |
| --- | --- |
| **PPAC display name** | AI-generated descriptions (preview) |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `DisableAiGeneratedDescriptions` | string-bool | `"true"` \| `"false"` | **Inverted** indicator (true = disabled, shown red) |

---

### `Lifecycle / NotSpecified`

| | |
| --- | --- |
| **PPAC display name** | Recycle bin retention |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `RetentionPeriod` | .NET TimeSpan string | e.g. `"7.00:00:00"` (7 days), `"0.04:00:00"` (4 hours) | Pretty-printed duration |

---

### `Sharing / App`

| | |
| --- | --- |
| **PPAC display name** | Sharing controls for canvas apps |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `CanShareWithSecurityGroups` | string-enum | `noLimit` \| `excludeSharingToSecurityGroups` \| `disableSharing` | Color-coded badge |
| `IsGroupSharingDisabled` | string-bool | `"true"` \| `"false"` | Inverted indicator |
| `MaximumShareLimit` | numeric string | `-1` (no limit) \| `0` (disabled) \| positive int | Badge with friendly label |

---

### `Sharing / Flow`

| | |
| --- | --- |
| **PPAC display name** | Sharing controls for solution-aware cloud flows |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `CanShareWithSecurityGroups` | string-enum | same as `Sharing/App` | Color-coded badge |
| `MaximumShareLimit` | numeric string | same as `Sharing/App` | Badge with friendly label |

---

### `Sharing / AuthoringBot`

| | |
| --- | --- |
| **PPAC display name** | Sharing agents with editor permissions |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `CanShareWithSecurityGroups` | string-enum | same as `Sharing/App` | Color-coded badge |

---

### `Sharing / UsersBot`

| | |
| --- | --- |
| **PPAC display name** | Sharing agents with viewer permissions |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `CanShareWithSecurityGroups` | string-enum | same as `Sharing/App` | Color-coded badge |
| `MaximumShareLimit` | numeric string | same as `Sharing/App` | Badge with friendly label |

---

### `CopilotAuth / NotSpecified`

| | |
| --- | --- |
| **PPAC display name** | Authentication for agents (preview) |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `allowchatswithoutentraauth` | string-bool | `"true"` \| `"false"` | Positive indicator (true = anonymous chat allowed) |

---

### `AdminDigest / NotSpecified`

| | |
| --- | --- |
| **PPAC display name** | Usage insights |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `IncludeOnHomePageInsights` | string-bool | `"true"` \| `"false"` | Positive indicator |
| `ExcludeEnvironmentFromAnalysis` | string-bool | `"true"` \| `"false"` | Positive indicator |

---

### `MakerOnboarding / NotSpecified`

| | |
| --- | --- |
| **PPAC display name** | Maker welcome content (Model A pointer) |
| **Renderer** | ✅ |

| Setting id | Value type | Domain | Renderer summary |
| --- | --- | --- | --- |
| `MakerContentRuleBasedPolicy` | string | `MakerContentRuleBasedPolicy-<guid>` — points at a Model B policy holding the actual `MakerOnboardingContent` rule | Badge + GUID |

This is the **Model A → Model B cross-link**: the actual maker welcome
content (markdown, URL, consent) lives in a separate Model B policy,
and Model A just stores a reference to it.

---

## Pending Model A buckets

None observed as unknown in the live tenant scan that produced this
catalog (32 rulesets across 32 env groups, all of their parameter
triples documented above). When new `(type, resourceType, id)` triples
appear, the renderer will show them as "Unknown setting" rows and
we can extend `PARAM_REGISTRY` to render them.

---

# How to extend the catalog

When a new rule shows up in the wild:

1. **Capture the payload.** Add a redacted live sample to
   [`admin-payload-samples.md`](./admin-payload-samples.md).
2. **Document the schema here.** Add a section under the appropriate
   model with the table format used above.
3. **Add the renderer.**
   - **Model B**: add a `RULE_METADATA[id] = { displayName, summary, render }`
     entry in
     `src/components/ruleRenderers/RuleSetRenderer.tsx`. If the inputs
     shape is non-trivial, factor a `XxxBody` component above the
     registry.
   - **Model A**: add a `PARAM_REGISTRY["${type}/${resourceType}/${id}"]`
     entry in
     `src/components/ruleRenderers/ModelARulesetRenderer.tsx`, plus a
     `BUCKET_METADATA["${type}/${resourceType}"]` entry if the bucket
     is also new.
4. **Verify.** `npm run lint && npm run build` in `PP-CoE-CodeApp/`.
   Hand-test by loading the env-group governance card on a group where
   the new rule is active.

No code change in the renderer dispatchers is needed — the registries
are the dispatch tables.

# Future Copilot session pickup checklist

If you're picking this up cold:

- Read the rendering code in `src/components/ruleRenderers/` — both
  files are small (one per model).
- Read `src/data/adminEnrichment.ts` for how the data is fetched (the
  `getEnvironmentGroupRulesets` and
  `getEnvironmentGroupEffectivePolicies` helpers).
- Read `views/EnvironmentGroupDetail.tsx` for how the renderers are
  wired into the page (`RulesetsBody`, `EffectivePoliciesBody`).
- The on-demand button → spinner → ready scaffolding lives in
  `src/components/detail/SupplementalAdminCard.tsx`; don't reinvent it
  for new cards.
