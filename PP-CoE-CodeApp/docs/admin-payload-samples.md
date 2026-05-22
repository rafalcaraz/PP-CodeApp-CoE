# Admin payload samples — governance / rules / policies

> **Why this file exists.** Sibling to
> [`inventory-schema-samples.md`](./inventory-schema-samples.md), but for
> the **admin-connector-enrichment** payloads (per-record `Get_*` / `List_*`
> calls documented in
> [`admin-connector-inventory.md`](./admin-connector-inventory.md))
> rather than the bulk `QueryResources` inventory graph.
>
> Every sample below was captured live from a real tenant. Tenant DNS
> prefixes have been redacted to `XXXXXXXX…tenant.api.powerplatform.com`;
> GUIDs inside payload bodies are preserved per the same convention as
> the inventory samples file (they're not identifying on their own).
>
> **Maintain this file.** Each time we wire a new enrichment, capture
> one redacted sample of the live response here before we commit to a
> rendering. The connector's typed model is sometimes incomplete or
> open-ended (`Record<string, unknown>`), so a real payload is the only
> reliable source of truth for what we'll actually need to render.

---

## ⚠️ Plot twist before you read further — "ruleSet" means two things

The Power Platform governance surface ships **two parallel governance
models that both use the word "ruleSet"** and both apply to the same
env group at the same time. They are structurally different and need
different rendering:

### Model A — legacy "parameter rule sets"

- **Where it lives.** Returned by the connector's `GetRuleSet`
  operation (return type `MgGovODataResponse` → `value: RuleSetDto[]`,
  where `RuleSetDto.parameters: RuleSetParameters[]`).
- **Shape.** Each ruleset is a flat collection of
  `parameters: [{ type, resourceType, value: [{id, value}] }]` triples
  keyed by `(type, resourceType)` buckets like
  `(Copilot, App)`, `(Sharing, AuthoringBot)`,
  `(CopilotAuth, NotSpecified)`.
- **Mental model.** The classic PPAC tenant-settings / env-group
  settings buckets — string id → string value, grouped by feature
  family.
- **UI implication.** Render as a flat table grouped by
  `(type, resourceType)`. Open enum on both axes; new bucket types
  appear over time without warning.

### Model B — new "rule-based policy"

- **Where it lives.** Returned by `GetRuleBasedPolicyByID` (single)
  and `ListRuleBasedPolicies` (tenant-wide list) — return types
  `Policy` and `ListPolicyResponse`. Each `Policy` carries
  `ruleSets: RuleSet[]` where `RuleSet.inputs: Record<string, unknown>`.
- **Shape.** Each rule set is a **named, versioned rule** with
  structured `inputs`. The connector model types `inputs` as an
  open `Record<string, unknown>`, but in practice **each `id` has a
  well-known input schema** that's stable per `version`.
- **Mental model.** The newer converged governance bundle — think of
  it as a small set of well-defined policy modules (Copilot publish
  channels, allowed connectors, maker onboarding, …) that an
  administrator composes into a policy and assigns to env groups.
- **UI implication.** Render with one small per-id renderer component.
  Generic fallback for unknown ids = raw JSON viewer.

**The same env group is governed by BOTH at once.** Any "Governance"
surface for env groups needs both sections.

---

## Sample 1 — Legacy rulesets for an env group (Model A)

```http
GET https://XXXXXXXX.tenant.api.powerplatform.com/governance/environmentGroups/687c6d74-38dc-45a7-a655-e1c846dcbbc7/ruleSets?api-version=2021-10-01-preview
```

**Likely connector op:** `GetRuleSet(environmentId, groupId, api_version)`
returning `MgGovODataResponse`. The connector's name is misleading
("Get" → returns a single `value[]` collection, not a single ruleset).
The `environmentId` parameter's exact semantics when targeting a
group-scoped ruleset still needs verification — possibly the group id
goes in both positions, or `environmentId` is empty / null.

```json
{
  "value": [
    {
      "parameters": [
        {
          "type": "Copilot",
          "resourceType": "App",
          "value": [
            { "id": "DisableAiGeneratedDescriptions", "value": "false" }
          ]
        },
        {
          "type": "CopilotAuth",
          "resourceType": "NotSpecified",
          "value": [
            { "id": "allowchatswithoutentraauth", "value": "false" }
          ]
        },
        {
          "type": "Sharing",
          "resourceType": "AuthoringBot",
          "value": [
            { "id": "CanShareWithSecurityGroups", "value": "noLimit" }
          ]
        },
        {
          "type": "Sharing",
          "resourceType": "UsersBot",
          "value": [
            { "id": "CanShareWithSecurityGroups", "value": "excludeSharingToSecurityGroups" },
            { "id": "MaximumShareLimit", "value": "99" }
          ]
        }
      ],
      "id": "d8b0e2ec-097e-43d5-aaa4-b0856a7abb85",
      "lastModified": "2026-02-03T21:59:58.4215366Z",
      "environmentFilter": {
        "type": "Include",
        "values": [
          { "id": "687c6d74-38dc-45a7-a655-e1c846dcbbc7", "type": "EnvironmentGroup" }
        ]
      }
    }
  ]
}
```

### Observed `(type, resourceType)` buckets

Not exhaustive — these are just what this one tenant happens to have set.

| `type` | `resourceType` | Observed `id`s | Value shape |
| --- | --- | --- | --- |
| `Copilot` | `App` | `DisableAiGeneratedDescriptions` | `"true"` / `"false"` (string-typed boolean) |
| `CopilotAuth` | `NotSpecified` | `allowchatswithoutentraauth` | `"true"` / `"false"` |
| `Sharing` | `AuthoringBot` | `CanShareWithSecurityGroups` | `"noLimit"` \| `"excludeSharingToSecurityGroups"` \| (others) |
| `Sharing` | `UsersBot` | `CanShareWithSecurityGroups`, `MaximumShareLimit` | string enum + numeric-string |

### Notes

- `value` is always `string`, even when semantically boolean or numeric.
  The rendering layer needs to coerce per known id.
- `environmentFilter.type` is `Include` here; expect `Exclude` /
  combinations to exist elsewhere.
- `environmentFilter.values[].type` includes `EnvironmentGroup` here;
  individual `Environment` scoping is also possible per the connector's
  `MgGovEnvironmentValues` shape.
- New `(type, resourceType, id)` triples appear as Microsoft ships new
  features. UI must not blow up on unknown buckets — render them
  verbatim.

---

## Sample 2 — Rule-based policies effective on an env group (Model B, list)

```http
GET https://XXXXXXXX.tenant.api.powerplatform.com/governance/environmentGroups/687c6d74-38dc-45a7-a655-e1c846dcbbc7/ruleBasedPolicies?api-version=2021-10-01-preview&includeCustomerContent=true
```

**Likely connector op:** **No direct wrap exists** for the env-group-scoped
list. Closest options:

1. `ListRuleBasedPolicies(api_version)` → returns *all* tenant policies;
   filter client-side by cross-referencing `ListRuleAssignmentsByEnvironmentGroupId`.
2. `ListRuleAssignmentsByEnvironmentGroupId(envGroupId, includeRuleSetCounts: true, api_version)`
   → returns the join-table rows (`{ policyId, resourceId, resourceType, ruleSetCount }`),
   then drill `GetRuleBasedPolicyByID(policyId)` per match.

Option 2 is the more honest fit (matches the URL's group-scope
semantics) and gives us the same data structure with one extra hop.

```json
{
  "value": [
    {
      "id": "3dcc163c-3119-4a93-8ffe-1ca70b9db850",
      "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
      "name": "Default Policy Name",
      "lastModifiedOffset": "2026-02-03T21:59:58+00:00",
      "lastModified": "2026-02-03T21:59:58Z",
      "ruleSets": [
        // same shape as Sample 3 below
      ],
      "ruleSetCount": 6
    }
  ]
}
```

The list payload contains the **full** `ruleSets` body (not just
counts), so for read-only display purposes the list call is sufficient.
The single-policy GET (Sample 3) is the same payload at the
`value[0]` level.

---

## Sample 3 — Single rule-based policy (Model B, detail)

```http
GET https://XXXXXXXX.tenant.api.powerplatform.com/governance/ruleBasedPolicies/3dcc163c-3119-4a93-8ffe-1ca70b9db850?api-version=2021-10-01-preview
```

**Connector op:** **`GetRuleBasedPolicyByID(policyId, api_version)` → `Policy`** ✅
clean, direct match.

```json
{
  "id": "3dcc163c-3119-4a93-8ffe-1ca70b9db850",
  "tenantId": "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
  "name": "Default Policy Name",
  "lastModifiedOffset": "2026-02-03T21:59:58+00:00",
  "lastModified": "2026-02-03T21:59:58Z",
  "ruleSets": [
    {
      "id": "CopilotTranscripts",
      "version": "1.0",
      "inputs": {
        "BlockAccessToSessionTranscriptsForCopilotStudio": false,
        "BlockTranscriptRecordingForCopilotStudio": false
      }
    },
    {
      "id": "ConnectorManagement",
      "version": "1.0",
      "inputs": {
        "AllowedConnectorList": [
          {
            "AllowedConnector": "/providers/Microsoft.PowerApps/apis/shared_office365users",
            "AllowedActionsMode": "AllAllowed"
          },
          {
            "AllowedConnector": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
            "AllowedActionsMode": "AllAllowed"
          }
        ]
      }
    },
    {
      "id": "CopilotChannelPublishSettings",
      "version": "1.0",
      "inputs": {
        "AllowAgentPublishToFacebook": false,
        "AllowAgentPublishToTeams": true,
        "AllowAgentPublishToDirectLines": true,
        "AllowAgentPublishToOmniChannel": true,
        "AllowAgentPublishToSharePoint": true,
        "AllowAgentPublishToWhatsApp": false
      }
    },
    {
      "id": "CopilotEnablePrompts",
      "version": "1.0",
      "inputs": { "AiPromptsEnabled": true }
    },
    {
      "id": "CopilotFeaturesForMakers",
      "version": "1.0",
      "inputs": { "PowerAppsMakerBotEnabled": true }
    },
    {
      "id": "MakerOnboardingContent",
      "version": "1.0",
      "inputs": {
        "makerOnboardingUrl": "https://www.google.com",
        "makerOnboardingMarkdown": "## Welcome\n\nThis is the group for <Insert Name>\n\nIf you have questions reach out\n\n",
        "makerOnboardingPortals": "",
        "makerOnboardingTimestamp": "Tue, 03 Feb 2026 21:59:34 GMT",
        "makerOnboardingConsentRequired": true
      }
    }
  ],
  "ruleSetCount": 6
}
```

### Observed `ruleSet.id` catalog

Not exhaustive — Microsoft adds new rule ids over time. UI must
gracefully fall through to a generic JSON renderer for unknown ids.

| `id` | v | `inputs` schema | Suggested rendering |
| --- | --- | --- | --- |
| `CopilotTranscripts` | 1.0 | `BlockAccessToSessionTranscriptsForCopilotStudio: bool`, `BlockTranscriptRecordingForCopilotStudio: bool` | Two toggles, "blocked" / "allowed" badges. |
| `ConnectorManagement` | 1.0 | `AllowedConnectorList: [{ AllowedConnector: string, AllowedActionsMode: 'AllAllowed' \| (others?) }]` | List of connector chips with friendly names (reuse the `friendlyConnectorName` helper used elsewhere). |
| `CopilotChannelPublishSettings` | 1.0 | `AllowAgentPublishTo{Facebook,Teams,DirectLines,OmniChannel,SharePoint,WhatsApp}: bool` | Checklist of channels with allow/deny icons. |
| `CopilotEnablePrompts` | 1.0 | `AiPromptsEnabled: bool` | Single on/off badge. |
| `CopilotFeaturesForMakers` | 1.0 | `PowerAppsMakerBotEnabled: bool` | Single on/off badge. |
| `MakerOnboardingContent` | 1.0 | `makerOnboardingUrl: string`, `makerOnboardingMarkdown: string`, `makerOnboardingPortals: string`, `makerOnboardingTimestamp: string`, `makerOnboardingConsentRequired: bool` | Render the markdown as a preview (small MD renderer dep or escape + display in `<pre>`); link the URL; show timestamp; show consent badge. |

### Notes

- `tenantId` GUID matches the URL's tenant DNS prefix component — they
  are the same value.
- `lastModifiedOffset` and `lastModified` differ only by timezone
  serialization (`+00:00` vs `Z`). One is sufficient.
- The `inputs` field is `Record<string, unknown>` at the connector
  model level. The per-id schemas above are observed, not contracted —
  if Microsoft revs a `version`, the schema can change.
- `AllowedActionsMode` is enum-shaped; this tenant only shows
  `AllAllowed`. Expect `AllowedActions: [actionId, ...]` variants for
  more granular control.

---

## Cross-reference: connector return types in our generated model

For each sample above, the matching TypeScript interfaces live in
`src/generated/models/PowerPlatformforAdminsV2Model.ts`:

```ts
// Sample 1 (Model A)
interface MgGovODataResponse {
  value?: RuleSetDto[];
  "@odata.nextLink"?: string;
}
interface RuleSetDto {
  id?: string;
  lastModified?: string;
  environmentFilter?: MgGovPolicyEnvironmentFilter;
  parameters?: RuleSetParameters[];
}
interface RuleSetParameters {
  type: MgGovRuleSetType;
  resourceType: MgGovResourceType;
  value?: MgGovRule[];
}

// Samples 2 + 3 (Model B)
interface ListPolicyResponse { value?: Policy[]; }
interface Policy {
  id?: string;
  tenantId?: string;
  name?: string;
  lastModified?: string;
  ruleSets?: RuleSet[];
  ruleSetCount?: number;
}
interface RuleSet {
  id?: string;
  version?: string;
  inputs?: Record<string, unknown>;  // open at type level; well-known per id
}

// The join table (not in the samples above but relevant for env-group scoping)
interface RuleAssignmentsResponse { value?: RuleAssignment[]; }
interface RuleAssignment {
  ruleSetCount?: number;
  policyId?: string;
  tenantId?: string;
  resourceId?: string;
  resourceType?: 'NotSpecified' | 'EnvironmentGroup' | 'Environment';
}
```

---

## Implications for the env-group "Governance" surface (shortlist #3)

When that surface gets built (see
[`admin-connector-inventory.md`](./admin-connector-inventory.md) shortlist
item #3), the right v1 scope is:

| Call (on-demand) | What it tells us | Connector op |
| --- | --- | --- |
| Group basics | Display name, type, ids | `GetEnvironmentGroup(groupId)` |
| Group managers | Role assignments on the group | `ListEnvironmentGroupRoleAssignments(groupId)` |
| **Legacy rulesets (Model A)** | `(type, resourceType, id, value)` buckets | `GetRuleSet(envId, groupId)` — verify env-param semantic on first call |
| **Effective rule-based policies (Model B)** | Per-id policy bundles with typed inputs | `ListRuleAssignmentsByEnvironmentGroupId(groupId, true)` → `GetRuleBasedPolicyByID(policyId)` per match |
| Member environments | Which envs are in this group | already in inventory (`environmentGroupId` on env rows) |

All on-demand, behind one or more "Load…" buttons. **The two governance
models render in two separate sections / cards** — don't try to merge
them.
