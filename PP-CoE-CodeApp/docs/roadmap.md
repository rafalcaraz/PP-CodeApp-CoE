# Roadmap

Parking lot for ideas not yet built. Each entry has enough context for a
future Copilot session (or human) to pick it up cold — schema sketches,
integration touchpoints, and references back into the existing codebase.

When you build one, move the section into the changelog / plan.md and prune
or update it here.

---

## Saved queries in a Dataverse table

> **User goal.** The Queries playground (`src/views/QueriesView.tsx`) now
> persists saved queries to **localStorage** (see `src/data/savedQueries.ts`)
> and supports a paste-clauses lane for sharing complex queries by copy/paste.
> The next evolution is moving the store from localStorage to **Dataverse**
> so favorites survive browser wipes, follow the user across machines, and
> can be shared org-wide without manual JSON ferrying.

### What already shipped (localStorage tier)

- `src/data/savedQueries.ts` — `SavedQuery` type, CRUD wrappers, storage
  key `ppcoe.savedQueries.v1`. Stores both `spec` (when source = builder)
  and `clauses` (always) so the durable contract is preserved even if the
  builder shape evolves.
- Queries view: a "Saved queries" card above Templates, a Basic/Advanced
  tab toggle in the Builder (Advanced = a live-parsed clauses textarea),
  Save / Edit / Delete actions, and a "Source: Basic / Advanced" badge.
- **Tile editor** (`src/components/TileEditorDialog.tsx`): a "Start from"
  picker lists every saved query. Picking a **Basic** saved query prefills
  the visual builder (still fully editable). Picking an **Advanced** saved
  query switches the tile into raw-clauses mode — Resource types / Filters
  / Sort hide, only KPI and Table viz types remain available, and the
  clauses JSON is shown read-only. `DashboardTile.source` / `clauses` /
  `savedQueryId` carry the raw payload through to render time;
  `TileView.tsx` runs raw tiles directly via `runRawQuery`.
- Sharing today = copy JSON out, paste JSON in. No backend, no link
  shortener, no auth surface — but also no discovery or org-wide sharing.

Moving to Dataverse keeps every public function in `savedQueries.ts`
intact at the call site; only the storage implementation swaps. Tiles
that reference a saved query via `savedQueryId` will need a small
migration to point at Dataverse row IDs.

### Prerequisites the user will set up

1. **Create the table in Dataverse** (in the same environment the app is
   published to). Suggested logical name: `coe_savedquery`.
2. **Add the Dataverse connector** to the code app via:

   ```pwsh
   npx power-apps add-data-source
   ```

   Pick *Microsoft Dataverse*, then select the `coe_savedquery` table.
   This generates a typed client under `src/generated/` and adds the
   connection reference to `power.config.json` — same flow we did for
   `shared_powerplatformadminv2`.
3. Decide on ownership/sharing model — see notes below.

### Suggested table schema

| Logical name | Display name | Type | Notes |
| --- | --- | --- | --- |
| `coe_name` | Name | Text (100) | Primary column. |
| `coe_description` | Description | Multiline text (500) | Optional. |
| `coe_clausesjson` | Clauses JSON | Multiline text (~16 KB) | Serialized `Clause[]` payload — what `runRawQuery` consumes. Source of truth so the saved query keeps working even if the visual builder shape changes. |
| `coe_specjson` | Builder spec JSON | Multiline text (~4 KB) | Serialized `QuerySpec` — what the visual builder needs to round-trip a save. |
| `coe_resourcetypes` | Resource types | Multiline text | Semicolon-joined `type` values; lets us filter/group in the saved-queries UI without parsing the spec. |
| `coe_visibility` | Visibility | Choice | `Private` (creator only), `Shared` (whole tenant), `LinkOnly` (anyone with the GUID) — optional, depends on sharing model below. |
| `coe_pagesize` | Page size | Whole number | Optional default for the run. |
| `coe_tags` | Tags | Multiline text | Optional `tag1;tag2`. |
| Audit fields | — | — | Dataverse provides `createdon`, `createdby`, `modifiedon`, `modifiedby`, `ownerid` automatically. |

> **Why store both `coe_clausesjson` and `coe_specjson`?** The clauses are
> what the connector actually consumes — they're the contract. The spec is
> what the visual builder needs to repopulate its UI. Storing both means
> opening a saved query both runs correctly *and* shows the same controls
> the original author saw, even if we evolve the builder later.

### Ownership / sharing model — two reasonable paths

- **User-owned rows.** Simplest. Each user sees only what they created
  (Dataverse's default user/team security). Add a "Share with…" button later
  that calls the Dataverse `GrantAccess` action.
- **Org-owned rows + `coe_visibility` field.** Rows visible to everyone in
  the env, but the app filters/respects the `Private`/`Shared`/`LinkOnly`
  flag. Use `_createdby_value` to enforce "Private" client-side. Easier to
  bootstrap but trusts the client.

Recommendation: **start with user-owned rows + an optional org-shared role
for power users**. Defer per-row visibility until needed.

### Data layer changes

Add a new module — e.g. `src/data/savedQueries.ts` — that wraps the
generated Dataverse client and exposes:

```ts
export interface SavedQuery {
  id: string;            // Dataverse row id
  name: string;
  description: string;
  spec: QuerySpec;       // parsed from coe_specjson
  clauses: Clause[];     // parsed from coe_clausesjson
  resourceTypes: ResourceTypeValue[];
  pageSize: number;
  tags: string[];
  createdBy: string;
  createdOn: string;
  modifiedOn: string;
  isOwnedByMe: boolean;
}

export async function listSavedQueries(): Promise<DataResult<SavedQuery[]>>;
export async function getSavedQuery(id: string): Promise<DataResult<SavedQuery | null>>;
export async function createSavedQuery(input: { name; description; spec; clauses; pageSize?; tags? }): Promise<DataResult<SavedQuery>>;
export async function updateSavedQuery(id: string, patch: Partial<...>): Promise<DataResult<SavedQuery>>;
export async function deleteSavedQuery(id: string): Promise<DataResult<void>>;
```

Use the same `DataResult<T>` discriminated union we already have in
`inventory.ts` (and the `formatError` helper) so error UX is consistent.

### View changes (`src/views/QueriesView.tsx`)

- **New "Save query" button** next to **Run query**. Opens a dialog asking
  for Name, Description, Tags, Visibility (if we go that route). Persists
  the current `spec` + the generated `clauses` (`buildClausesFromSpec(spec)`).
- **New section above Templates: "Saved queries (N)"** — same card pattern.
  Each card shows name + description + a small chip strip of resource
  types + tags. Click → load the spec into the builder (just like
  `applyTemplate`). Long-press / hover button to **Run directly without
  loading into builder** (nice future ergonomic).
- Each saved card has **Edit** (rename, retag), **Duplicate**, and
  **Delete** (with confirm) actions.
- When the user runs a saved query and tweaks it, show an
  "Unsaved changes — Update saved query?" hint at the top.
- Optional: **Run on schedule** field (datetime + frequency) — saved
  rows become candidates for a future scheduled-export feature.

### Optional follow-up ideas this unlocks

- **Saved queries → scheduled CSV exports.** A Power Automate flow that
  runs nightly, reads all saved queries with `coe_schedule != null`,
  calls the inventory API with each clauses payload, and dumps the CSV
  into SharePoint / OneDrive / blob.
- **Saved queries → alerts.** Add a `coe_alertcondition` field
  ("rowCount > X", "any row matches Y"). A daily flow fires Teams
  notifications when a condition trips.
- **Shareable links.** `/queries?savedId=<guid>` deep-link that hydrates
  the builder from a saved row. Requires HashRouter to honor query
  strings — check current routing config.
- **Org templates.** Promote a saved query to a "Tenant template" that
  all users see — extends the existing static `QUERY_TEMPLATES` with a
  Dataverse-backed list.

### File touchpoints when this is built

- New: `src/data/savedQueries.ts` (Dataverse CRUD wrapper).
- Edit: `src/views/QueriesView.tsx` (Saved Queries section + Save dialog).
- Edit: `src/data/inventory.ts` — re-export `Clause` if not already, since
  the saved-queries module needs the type. (Currently only exported via
  `import type { Clause } from "../generated/models/..."`.)
- Add: `power.config.json` gains a new connection ref for Dataverse.
- Add: `src/generated/...` will grow with the new Dataverse client.

### Things to verify before building

- Confirm the code-app host actually allows opening multiple connectors
  in one app (we've only used one so far). The
  [add-flows docs](https://learn.microsoft.com/power-apps/developer/code-apps/how-to/add-flows)
  suggest yes, but worth a quick smoke test.
- Confirm the user identity flows through cleanly so `createdby` is the
  actual user (not a service principal).
- Decide whether to also expose this in non-Queries views (e.g. save a
  filter state from `/apps` as a "saved view"). Probably out of scope for
  v1, but the table is generic enough.

---

## Quarantine ("block") an agent from the agent detail view

> **User goal.** Today `AgentDetail.tsx` only *displays* a red
> "Quarantined" badge when `row.isQuarantined` is true (lines ~214–217).
> Admins can't actually flip the state from this app — they have to go to
> the Power Platform admin center. Add a button that quarantines /
> unquarantines an agent in place, using the same
> `shared_powerplatformadminv2` connector we already ship with.

### Connector plumbing — already in place ✅

The generated `PowerPlatformforAdminsV2Service` (auto-generated, do not
edit) already exposes all three operations we need:

```ts
// src/generated/services/PowerPlatformforAdminsV2Service.ts
PowerPlatformforAdminsV2Service.GetBotQuarantineStatus(EnvironmentId, BotId, apiVersion)
  // → IOperationResult<BotQuarantineStatus>  // { isBotQuarantined?: boolean }
PowerPlatformforAdminsV2Service.SetBotAsQuarantined(EnvironmentId, BotId, apiVersion)
PowerPlatformforAdminsV2Service.SetBotAsUnquarantined(EnvironmentId, BotId, apiVersion)
```

`BotQuarantineStatus` is in
`src/generated/models/PowerPlatformforAdminsV2Model.ts`. No
`add-data-source` step needed — the connector is already wired and we
use it elsewhere in `inventory.ts`.

### UX sketch

- Add a primary action group at the top of `AgentDetail.tsx` (next to
  the existing badges) with a single split button:
  - **Quarantine agent** when `row.isQuarantined === false`
  - **Release from quarantine** when `row.isQuarantined === true`
- Click → confirmation dialog ("This will block the agent from running.
  Continue?") → call the matching service action.
- On success: optimistic-flip the badge, toast "Agent quarantined" /
  "Quarantine released", and invalidate the inventory cache so
  `AgentsList` reflects the new state on next visit.
- On failure: keep the badge as-is, toast the error via `formatError`.

### Data layer changes

Add a tiny wrapper next to where the other agent helpers live (likely
new file `src/data/agentActions.ts` to keep `inventory.ts` from
ballooning):

```ts
export async function setAgentQuarantined(
  envId: string,
  botId: string,
  quarantined: boolean,
): Promise<DataResult<{ isBotQuarantined: boolean }>>;
```

Internally calls `SetBotAsQuarantined` or `SetBotAsUnquarantined`,
re-uses the `DataResult<T>` + `formatError` pattern from `inventory.ts`,
and pins `api-version` to the same value the rest of the app already
uses (grep `api-version` in `inventory.ts` to confirm).

### Things to verify before building

- Confirm `BotId` from the inventory row maps cleanly to what the
  connector expects (it's the bot's Dataverse row ID, not the
  schema-name `coe_*`).
- The connector action probably needs the **admin** permission scope —
  test with a non-admin sign-in and decide whether to hide the button or
  show a "You need Power Platform Admin to use this" tooltip.
- Quarantine status is cached in inventory — after the action succeeds,
  either bust the cache for that env or patch the in-memory row so the
  badge updates without a hard refresh.

### File touchpoints when this is built

- New: `src/data/agentActions.ts` (or wherever feels right — see above).
- Edit: `src/views/AgentDetail.tsx` (action button + confirm dialog +
  toast).
- Edit: `src/data/inventory.ts` — small helper to patch a single
  agent row's `isQuarantined` post-action.
- No changes to `power.config.json` or generated/ — connector already
  wired.

### Optional follow-ups this unlocks

- **Bulk quarantine** from `AgentsList.tsx` (multi-select + action menu).
- **Quarantine audit log** — write a Dataverse row each time the action
  is invoked (who, when, which agent, before/after state) so CoE
  admins have an audit trail.
- **Auto-quarantine rules** — saved queries that, when their row count
  is > 0, auto-quarantine the matching agents (probably a flow, not the
  app, but the app would surface the rule).

---

## Zone-based governance experiments (the new twist on CoE)

> **The big idea.** Microsoft has slowly converged on a governance model
> built around **environment groups** — but they explicitly call out that
> "zones" as a concept (security tiers, ALM stages, persona segregation,
> geo separation) are something users *assemble themselves* from groups +
> naming conventions + DLP. We can fill that gap with live, interactive
> zone tooling that no existing product (including the CoE Starter Kit)
> provides.
>
> **The killer quote** (from `learn.microsoft.com/en-us/power-platform/guidance/adoption/environment-strategy`):
> > "Although you can't configure the group hierarchy yet, you can use a
> > combination of naming conventions and rule configuration to implement
> > your conceptual design."
>
> Translation: Microsoft openly admits zones are a design pattern users
> have to assemble themselves. The whole point of this section is to give
> users a tool that makes that assembly visible and enforceable.
>
> **The DLP gap quote** (same source):
> > "Environment groups don't have a rule to apply a data policy to an
> > environment. However, you can align your data policy strategy with
> > your environment groups. For example, you could create a data policy
> > with the same or a similar name as an environment group and apply it
> > to environments in that group."
>
> i.e. **DLP is not zone-aware natively** — alignment is by *naming
> convention*. This is the biggest visible gap we can fill.
>
> Full research synthesis (read before building any of these) lives at
> `~/.copilot/workspaces/<workspace_id>/artifacts/governance-research-brief.md`
> in the project author's home. Covers the 4 zone archetypes, 3 security
> tiers, 4-stage ALM model, 9 maturity dimensions, agent risk axes, and
> verbatim Microsoft quotes for each. Don't lose that brief.

### Foundational facts we can rely on

- **`QueryResources` returns `parentGroupId` on environment rows.**
  Confirmed by project owner. So zone membership is already in the data
  we pull — no extra round-trip required to know which env belongs to
  which group.
- **Published group rules are LOCKED** at the environment level
  (read-only). Local admins literally can't override centrally-defined
  rules. This makes "zone compliance" a *real, enforceable* concept, not
  just a label.
- **Three reusable zone models** Microsoft already documents:
  - **4 zone archetypes** (Personal Productivity, AI Feature Management,
    Global/Geo, Dev-vs-Prod)
  - **3 security tiers** (Normal, Medium, High) — each with a different
    feature set (basic DLP → IP firewall + Lockbox → CMK + Managed Env
    required)
  - **4-stage ALM topology** (Dev → Shared Dev → UAT → Prod) — the
    Contoso reference
- **22+ environment group rules** are configurable via
  `Get Rule Set for Environment Group` / `Create or update Rule Set` in
  the Admin V2 connector. This is where the "policy per zone" data lives.

### LocalStorage vs Dataverse persistence pattern

Mirror what we did with saved queries (`ppcoe.savedQueries.v1`):

- **localStorage (`ppcoe.zones.v1`, `ppcoe.tags.v1`, etc.)** — personal,
  exploratory, opinionated. Things that don't need to be shared yet:
  - Zone tier assignments per env group (`{ groupId, tier: 'normal' | 'medium' | 'high' }`)
  - Expected rule profiles per tier (the "what Production zones SHOULD
    have" template the Drift Detector compares against)
  - Custom resource tags (business owner, criticality, BU, dept)
  - Watchlist of resources I personally care about
  - Dismissed/snoozed governance findings
  - Per-zone dashboard prefs / view state
- **Dataverse (when saved-queries Dataverse migration lands, piggy-back
  more tables)** — org-shared, durable, auditable:
  - Org-shared zone definitions and tier profiles (promote personal →
    shared)
  - Shared resource metadata table (`coe_resourcemetadata`) — team-agreed
    business owner, criticality, justification, last-reviewed
  - Audit trail of mutating actions (quarantine, transfer, retire)

Same migration pattern as saved queries: prove the shape locally first,
then promote to Dataverse for the bits that demand it.

---

### Microsoft's product gaps we fill (the receipts)

> These are the explicit-or-implicit gaps in the Power Platform
> governance surface where Microsoft either admits the limitation
> outright or quietly ships a feature with no programmatic enforcement
> path. Each one justifies a category of features in this app. Quote the
> relevant one in feature pitches, demos, and exec briefings — these are
> the *receipts* for why this app exists.

#### The receipts (9 quotes from Microsoft Learn + the governance whitepapers)

**1. Zone hierarchy doesn't exist — naming-convention only**
> "Although you can't configure the group hierarchy yet, you can use a
> combination of naming conventions and rule configuration to implement
> your conceptual design."
> — *Environment Strategy documentation,
>   learn.microsoft.com/en-us/power-platform/guidance/adoption/environment-strategy*

The gap: no nested zones, no parent/child groups. Want
APAC > Finance > Prod as a hierarchy? You build it via prefixed names.
Our Zone Map / Drift Detector can surface naming-convention adherence
as a first-class signal.

**2. DLP isn't zone-aware — naming-convention only**
> "Environment groups don't have a rule to apply a data policy to an
> environment. However, you can align your data policy strategy with
> your environment groups. For example, you could create a data policy
> with the same or a similar name as an environment group and apply it
> to environments in that group."
> — *Environment Strategy documentation*

The gap: DLP and env groups are two parallel universes. Microsoft's
recommended fix is *"name them the same and pray."* The Cross-Zone DLP
Visualizer feature exists precisely to bridge this.

**3. CoE Starter Kit only *reacts* — Managed Env *enforces***
> "The CoE can only react after the limit is exceeded, possibly
> resulting in noncompliant assets. On the other hand, Managed
> Environments uses private APIs, built into the product, that enforce
> sharing limits before they're passed."
> — *Reactive Governance / Managed Environments comparison documentation*

The gap: Microsoft openly admits the traditional CoE model is
*reactive only*. Anything you build outside Managed Env private APIs is
post-hoc cleanup, not prevention. Strong justification for **why this
app focuses on Managed Env signals + proactive drift detection** — we
align with the model Microsoft says is "the right one," instead of
shipping yet another reactive-only nightly-sync Starter Kit.

**4. Agent security scan only *warns* — never blocks publish**
> "By default, agents are secure. However, you can modify the default
> security settings for valid scenarios without knowing the risk.
> Copilot Studio automatically runs a security scan and warns makers
> before publishing. Makers see risks when: Set the authentication mode
> to No authentication; The maker selects Maker-provided credentials;
> The maker shares an agent with everyone in the organization."
> — *Security Scan documentation*

The gap: warns, doesn't enforce. Risky agents publish anyway. So an
admin needs a tenant-wide retrospective audit of "agents that ignored
the warning" — Microsoft doesn't provide one. Direct feature: list
agents currently violating any of those 3 warning conditions.

**5. Maker-provided credentials → pre-publish warning only**
| Agent Risk Axis | DLP Enforcement? |
| --- | --- |
| **Credential Mode** (end-user vs maker-provided shared identity) | ❌ (pre-publish security warning only) |
> Source: *Copilot Studio Security and Governance documentation +
> Security Scan documentation*

The gap: a maker can check "use my credentials for all users" (massive
shared-service-identity risk) and there's literally no DLP control. You
only know post-fact by inspecting each agent. Direct feature: tenant
report of agents using maker-provided credentials, grouped by zone.

**6. Agent Protection Status = monitoring signal, no enforcement**
| Agent Risk Axis | DLP Enforcement? |
| --- | --- |
| **Protection Status** (Protected / Needs Review / Unknown) | ❌ (monitoring signal, not enforcement) |
> Source: *Agent Runtime Protection Status documentation*

The gap: Microsoft surfaces the status in the Copilot Studio UI but
provides no admin API to query at scale *and* no way to enforce a
minimum status. Want "all production agents must be Protected"? You
compute and enforce that yourself. **This is exactly Research Item 2
in this section.**

**7. Content moderation level is UI-only**
| Governance Lever | API in Admin V2? |
| --- | --- |
| **Content Safety** (per-agent moderation level 0–100 slider) | ❌ Only in Copilot Studio UI |
> Source: *Connector spec for shared_powerplatformadminv2 + Copilot
> Studio admin documentation*

The gap: no admin API. The 0–100 moderation level can't be inspected at
scale. You can't write a CoE policy that says "all agents in this zone
must have moderation ≥ 75" and verify it programmatically.

**8. Overshared / inactive resources = your problem to find and fix**
> "Overshared resources, Inactive resources: Resources not used within
> a specified time frame require review and potential deletion to free
> resources and maintain a clean environment."
> — *Reactive Governance documentation*

The gap: Microsoft tells you *what* to look for ("overshared,"
"inactive") but doesn't provide tooling to find and act on them across
the tenant. The CoE Starter Kit fills this with delay due to nightly
sync. Our live-inventory approach beats that natively. Direct feature:
Orphan & Risk Command Center (already in the brief, expand here later).

**9. Most agent risk data isn't in the admin connector at all**

From the brief's "Governance Signals" table for agents (Section 3.3):

| Signal | API Support |
| --- | --- |
| Protection Status | ❌ Not yet in Admin V2 |
| Authentication Mode | ❌ (indirectly via DLP compliance) |
| Published channels | ❌ Indirectly via DLP |
| # of knowledge sources | ❌ |
| # of tools/connectors | ✅ (via `row.connectors` in QueryResources) |
| Blocked messages | ❌ No admin API |
| Last activity | ❌ |
| DLP compliance state | ❌ Indirectly via cross-ref |
| Sharing scope | ❌ Not directly in Admin V2 |

The gap: Microsoft tells admins these are the signals to monitor, then
ships a connector that exposes almost none of them. Anyone wanting
tenant-wide agent governance has to either (a) call Copilot Studio API
directly per-agent (slow, may be permissioned), (b) infer state from
DLP policies + sharing data, or (c) accept blind spots. **This is the
single biggest reason Research Item 3 (probe `QueryResources` agent
schema) matters — anything we DO get back from the connector is a
governance signal that was previously inaccessible without per-agent
calls.**

---

#### The 3 recurring gap patterns

Across all 9 receipts, **three patterns** keep showing up. They justify
entire categories of features:

| Pattern | Examples from above | What our app does about it |
| --- | --- | --- |
| **"Use a naming convention"** | #1 zone hierarchy, #2 DLP↔group alignment | Surface convention adherence as a first-class signal; let the user define a convention regex per tier (localStorage) and flag deviations |
| **"This is a warning, not an enforcement"** | #3 CoE reactive vs MgdEnv proactive, #4 agent security scan, #5 maker-provided creds | Tenant-wide retrospective audit ("who ignored the warning?") + per-zone policy enforcement layer we define ourselves (Zone Drift Detector + Agent Risk Radar do exactly this) |
| **"This isn't in the admin API yet"** | #6 protection status, #7 content moderation, #9 most agent signals | Either compute equivalents from observable signals, call Copilot Studio API per-agent and cache locally, or flag known blind spots in the UI so users understand the gap |

These three patterns are the **strategic moat** of the app vs. the
CoE Starter Kit. The Starter Kit fights pattern #2 ("react after the
fact") and ignores the other two. Our app addresses all three.

---

### Research / open questions to chase

These aren't features yet — they're things we need to know before we can
scope the features that depend on them. Park them in this section, knock
them off one by one in a Copilot session (each takes 30–60 min of
investigation).

#### Research 1 — Maturity Model Level 500: what does it really look like?

The maturity model goes 100 → 500 across 9 governance dimensions. Level
500 ("Efficient") is the most interesting / least understood:

> "Further automation takes place through agents embedded in Teams.
> Tasks are autoapproved or routed through multi-step approval processes
> based on **clear risk profiles** (for example, line manager,
> information security department, environment, or tenant admin)."
> — *Maturity Model Details, Governance dimension, Level 500*

Things to dig into:
- What does a "risk profile" actually look like at Level 500? Is there
  a Microsoft reference implementation (sample Power Automate approval
  flow + dimensions)?
- Which dimensions reach Level 500 first in mature tenants? (probably
  Security + Governance; later: RAI + Automation)
- Read the **Adoption Maturity Model details** page in full
  (`learn.microsoft.com/en-us/power-platform/guidance/adoption/maturity-model-details`)
  and pull every Level 500 callout into a reference doc.
- How would our app *visualize* a tenant's maturity level? Radar
  chart with 9 axes + target overlay (Feature 9 in the brief).
- Can we *infer* a tenant's score from observable inventory? E.g.
  "DLP configured AND env groups in use AND >70% Managed → likely
  Level 300+ for Governance dimension."

Output: a short writeup we can paste back into this section, plus a
decision on whether to build the Maturity Score Dashboard feature.

#### Research 2 — Agent Protection Status (Protected / Needs Review / Unknown): what is it, how do we get it?

This is a **brand-new first-class signal** Microsoft surfaces in the
Copilot Studio Agents page but, as far as our research can tell, does
NOT expose via the Admin V2 connector.

> "The protection profile of your agent is broken into three categories:
> Authentication, Policies, and Content moderation. Each of these
> categories has a possible status of **Protected**, **Needs review**,
> or **Unknown**. Additionally, this dialog displays the number of
> blocked messages due to potential threats, policy violations, and
> violations of content moderation settings."
> — *Agent Runtime Protection Status documentation*

Things to investigate:
- Read the Agent Runtime Protection Status documentation in full
  (`learn.microsoft.com` search: "agent protection status Copilot
  Studio").
- What are the rules for each status? E.g., does "Protected" require
  Entra ID auth + no-skill + high content moderation, etc.?
- Is there ANY API/connector that returns this status at scale? Check:
  - The Copilot Studio public preview API surface
  - The `shared_powerplatformadminv2` connector spec for a hidden
    `GetBotProtectionStatus`-like action
  - Whether `QueryResources` for `type='bot'` returns a
    `protectionStatus` field (it might — the project owner thinks
    `parentGroupId` is there for envs, so it's worth probing the bot
    schema too)
- If no admin API exists, can we *compute* an equivalent status
  client-side from the signals we DO have (auth mode, sharing scope,
  channel set, etc.)?

Output: a clear answer on "do we surface Microsoft's status or compute
our own equivalent," which directly affects Feature 6 (Agent Risk
Radar) and Feature 7 (Zone-Based Agent Policy Enforcer).

#### Research 3 — QueryResources schema for bots: what fields come back?

We confirmed envs return `parentGroupId`. Do agents return their:
- `authenticationMode` (Entra / Manual / None)?
- `sharingScope` or sharing list?
- Published channels?
- Knowledge source count or types?
- Tools/connector list (already known — `row.connectors`)?
- `protectionStatus` (see Research 2)?

If yes → most of the Agent Risk Radar can run on data we already have.
If no → we need either Copilot Studio API calls or to settle for
weaker computed risk scoring.

Quick way to answer: add a one-shot `console.log` in `AgentsList.tsx`
of the first row's full payload and inspect in browser devtools.

#### Research 4 — Dev/Test/Prod inference: how do we know what stage an env is in?

The "Zone Map" + "ALM Journey Tracker" features hinge on knowing each
env's lifecycle role. Microsoft's data model has:
- `environment.type` field (Default, Production, Sandbox, Trial, Developer)
- `environment.parentGroupId` → group name (might encode "Dev", "Prod",
  etc. by convention)
- Solution pipeline assignments (if Default deployment pipeline rule is
  used)

Investigate which of these is the most reliable signal in real
tenants, and whether the app should let the user override by tagging
envs manually (→ localStorage).

---

### Feature ideas — Zone visualizations (the differences)

We have **five candidate visualizations** that all start from "envs +
their group + the group's rules." Each shows a different *facet* of the
same data — pick based on the question you're answering. Don't build
them all; pick 1–2 to start.

| # | Feature | Answers the question | Shape | Best for |
| --- | --- | --- | --- | --- |
| 1 | **Zone Map** | "What does my tenant *look like* as a topology?" | 2D spatial canvas; groups as bordered regions, envs as nodes inside | First-time overview; exec briefings; spotting weird shapes |
| 2 | **Zone Health Card** | "How is *this one zone* doing right now?" | Per-zone scorecard tile with KPIs + traffic light | Drill-down from a list; embedded in dashboards |
| 3 | **Zone Compliance Heatmap** | "Which zones have which levers configured?" | 2D grid: Zones × Levers, cells colored green/yellow/red | Spotting gaps; comparing zones side-by-side |
| 4 | **Zone Drift Detector** | "Which zones *deviate* from what they should be?" | Sorted list of drift findings ("Prod zone X missing Y") | Daily/weekly admin triage |
| 5 | **Ungrouped Environment Radar** | "Which envs have no zone at all?" | Filtered list/badge: envs with `parentGroupId == null` | Quick win, fastest to build |

How they differ at a glance:

- **Zone Map = pretty picture, exploratory.** Lots of visual real estate;
  great for screenshots and showing leadership. Low actionability per
  pixel.
- **Zone Health Card = compact summary, one zone at a time.** Fits in
  dashboards as a tile. Lives next to the existing KPI/Chart tiles.
- **Zone Compliance Heatmap = comparative grid.** The grid layout is
  where this beats everything else — you can *see* which lever is
  missing from a whole row of zones in one glance.
- **Zone Drift Detector = actionable to-do list.** Computed from "what
  this zone tier SHOULD have" (template from localStorage) vs. "what it
  actually has." Output is text findings, not graphics.
- **Ungrouped Environment Radar = single critical question, single
  filter.** Lowest effort, highest immediate value — most tenants have
  ungrouped envs they forgot about.

#### Zone Map (interactive tenant topology canvas)

**Pitch.** An interactive spatial canvas showing the entire tenant as a
governance topology: environment groups as bordered "zones," envs as
nodes inside each zone, pipelines (if accessible) as directed edges
between groups, DLP policies as color overlays. Click a zone to drill
into Zone Health Card. Click an env to drill into env detail. Color-code
by security tier (green/yellow/red) using locally-stored tier
assignments.

**Complexity.** L. Needs a canvas/graph library decision (recharts
doesn't do this — likely react-flow, dagre, or cytoscape).

**Data needed.** All available via Admin V2:
- Environment list with `parentGroupId`, `type`, `isManaged`, `region`
- Environment groups with `displayName`, `rules`
- (Optional) Pipeline definitions if accessible via connector

**Local storage.** Tier assignment per group (`{ groupId, tier }`),
saved viewport position, expanded/collapsed groups.

**Open questions.** Library choice; mobile / small-screen fallback;
how to render >50 envs in a single zone gracefully.

#### Zone Health Card (per-zone scorecard tile)

**Pitch.** A reusable tile that summarizes one zone: # environments,
% managed, # active rules vs. available rules, # resources by type
(apps/flows/agents), # compliance issues, # orphans, # agents needing
review. Single glance, traffic-light status. Embeddable in dashboards
just like existing KPI tiles.

**Complexity.** M. Mostly aggregation over data we already query.

**Data needed.** Env group + rule set + filtered `QueryResources` per
group.

**Local storage.** Tier label (drives the "expected rules" comparison),
custom thresholds for traffic light (what counts as "green" for
% managed).

#### Zone Compliance Heatmap (Zone × Lever grid)

**Pitch.** A grid view: Zones on the Y axis, Governance Levers on the
X axis (SharingLimits, SolutionChecker, UsageInsights, MakerWelcome,
Backup, AIFeatures, AdvancedConnectorPolicy, AgentSharingEditor,
AgentSharingViewer, etc.). Each cell shows configured / partial /
absent for that lever in that zone. Click a red cell → see what's
missing and (eventually) jump to configure it in the admin center.

**Complexity.** M. The grid is straightforward Fluent
DataGrid/`<table>`; the hard part is mapping each rule's "configured
state" reliably (which is partly Research 4 territory).

**Data needed.** `Get Rule Set for Environment Group` per group +
managed env state per env.

**Local storage.** Which levers to show columns for (some tenants
won't care about all 22 rules); collapsed-row state.

#### Zone Drift Detector (expected vs. actual rule profile per tier)

**Pitch.** Define an "expected rule profile" per zone tier (e.g.,
Production zones SHOULD have SolutionChecker=Block, IPFirewall=enabled,
SharingLimits configured, AgentSharing limited to specific groups).
Detect zones that deviate. Surface human-readable findings:
"Production zone 'APAC Finance Prod' is missing IP firewall — 3
environments unprotected." Sortable by severity. Action: snooze a
finding (saved to localStorage) or jump to fix.

**Complexity.** M. Diff logic is straightforward once tier + expected
profiles are defined.

**Data needed.** Same as Heatmap + zone tier assignments + expected
profiles.

**Local storage.** Expected rule profiles per tier (the seed data is
opinionated and personal), snoozed/dismissed findings (`{ findingId,
snoozeUntil }`), tier assignments.

**Why this might be the most valuable.** It's the only one of the five
that *tells the user what to do next*. Map, Card, Heatmap, Radar all
inform; this one prescribes.

#### Ungrouped Environment Radar

**Pitch.** Surface every environment that is not in any environment
group, with extra weight on those that are also Managed. These are
"ungoverned" envs that exist outside the zone framework. Tiny view —
basically a filtered list with badges: "7 Managed Environments have no
zone. Click to see them and assign each to a zone."

**Complexity.** S. One filter on env list (`parentGroupId == null`),
sorted by `isManaged DESC`, rendered as a list.

**Data needed.** Env list (already pulled).

**Local storage.** Dismissed/snoozed envs (someone may have intentional
ungrouped envs).

---

### Feature ideas — Agent governance

#### Agent Risk Radar (spider chart per agent)

**Pitch.** Per-agent, a spider/radar chart with 6 axes:
- **Authentication** (0=Entra ID, 1=Manual, 2=None)
- **Sharing scope** (0=Specific individuals, 1=Security groups,
  2=Everyone)
- **Knowledge sources** (count + type-weighted: public web > docs >
  SharePoint)
- **Tools** (connector risk score; HTTP / premium / external skills
  weighted high)
- **Channels** (0=Teams only, 1=multiple internal, 2=external like
  WhatsApp / Direct Line)
- **Event triggers** (0=none, 1=present — autonomous agents have higher
  blast radius)

Aggregate to a per-zone Agent Risk Score (avg or worst-case across all
agents in the zone). Use it to populate Zone Health Cards.

**Why interesting.** Microsoft surfaces threat-block stats (reactive)
but no pre-emptive configuration risk score. This is novel.

**Complexity.** M. Depends heavily on Research 3 (how much of the
needed agent metadata is in `QueryResources`).

**Data needed.** Per-agent: auth mode, sharing scope, knowledge sources,
tools, channels, event triggers. Some of these likely require fields
beyond what `QueryResources` returns — see Research 3.

**Local storage.** Risk-score weighting tweaks (some orgs care more
about channel exposure than knowledge sources), dismissed agents.

#### Agent Zone Promotion Workflow (the big one — elaborate later)

**Pitch.** A guided workflow for "promoting" a Copilot Studio agent
from a Dev zone to a Production zone, gated by a pre-flight checklist:
- Authentication = Entra ID ✅
- DLP compliance (no blocked connectors) ✅
- Sharing scope appropriate for prod zone ✅
- Content moderation level meets prod tier minimum ✅
- Quarantine status = not quarantined ✅
- Knowledge sources reviewed ✅
- Agent owner is current employee (not orphaned) ✅

Only allows promotion if all checks pass. Logs the promotion event
(eventually to Dataverse for audit trail).

**Why interesting.** Microsoft's pipeline feature handles ALM for apps
and flows but **agent ALM is much less well-defined**. This makes the
governance gate for agent production deployment explicit and visible —
neither the CoE Starter Kit nor any other admin tool provides this.

**Requirements to elaborate (TODO before building).**
1. Define what "promoting" actually does mechanically — is it:
   (a) a copy/clone of the agent into the target env via pipeline?
   (b) a re-deploy with new env-aware connection refs?
   (c) just a metadata flag we track ("this agent has been promoted")?
   → Decision affects whether we need pipeline API access at all.
2. Define the pre-flight checklist as a structured config, not
   hard-coded. Per zone tier — a Tier 3 (high security) zone has
   stricter checks than Tier 1.
3. Decide UI: dialog with steps? Wizard? Inline checklist on the agent
   detail page with a "Promote" button at the bottom?
4. Decide what happens on failure: block promotion entirely vs. allow
   with override + justification (stored to Dataverse for audit).
5. Permission model: who can promote? Tenant admin only? Env admin of
   target env? Maker if all checks auto-pass?
6. Audit log: every promotion attempt (success + failure + override)
   should be logged. localStorage for v1, Dataverse for v2.
7. What about *demotion* / rollback? Out of scope for v1 but design
   shouldn't preclude it.
8. Integrate with quarantine — promoting an agent that was previously
   quarantined should require explicit re-approval.
9. Cross-env data: most checks are agent-local, but "is the owner
   still an employee?" requires Entra ID lookup (Office365Users
   connector — adds a new dependency).
10. Reuse the same pre-flight checklist for an **apps** version later
    (Feature 13 in the research brief was agent-only, but the same
    pattern fits canvas apps).

**Local storage.** Per-tier checklist definitions (the opinionated
seed data), draft promotion-in-progress state.

**Dataverse (later).** Audit log of promotion events.

---

### Feature ideas — ALM / lifecycle

#### ALM Journey Tracker (Dev → Test → Prod funnel)

**What this is** (since the term is non-obvious): a view that tracks
where resources are in the **Application Lifecycle Management**
pipeline — Microsoft's ideal flow is that an app/flow/agent is built
in a **Dev** environment, promoted to a **Test/UAT** environment,
then promoted to **Production**. The "funnel" visualization shows
resources at each stage and how many move (or don't) between stages.

Example questions it answers:
- "How many apps are stuck in Dev for >30 days?" (suggests makers
  build but never promote — possibly because Test environments are too
  hard to access)
- "How many apps are in Test but never made it to Prod?" (suggests
  testing bottleneck or abandoned features)
- "Which apps live ONLY in Prod with no Dev twin?" (anti-pattern —
  someone built directly in prod, can't safely change anymore)
- "Which envs have no resources at all?" (candidates for cleanup)

Visually: a horizontal funnel or Sankey-style chart with three
columns (Dev / Test / Prod), each showing resource counts. Resources
shown as connected flows where they exist in multiple stages of the
same logical project. Hover/click a resource to see its full journey.

**Complexity.** L-M. Hardest part is *correlating* resources across
envs — "is `App X (id=...)` in Dev the same as `App X` in Prod, or
unrelated apps that just share a name?" Solution-aware imports give us
solution IDs to correlate by; non-solution apps require fuzzier
matching.

**Data needed.** All resources across all envs (already pulled);
env-type inference per env (see Research 4); solution membership.

**Local storage.** "Project" groupings (a user can manually say
"these 3 apps are the same project across envs") for cases where
auto-correlation can't tell.

**Why interesting.** Microsoft's pipeline docs describe the *desired*
flow but no existing tool visualizes actual in-flight progress
against it. The CoE Starter Kit shows inventory; this shows movement.

---

### How these all fit together

A user opening the app in the future might:

1. Glance at the **Zone Map** to orient ("what does my tenant look like").
2. Spot a red zone, click into its **Zone Health Card** for the summary.
3. Open the **Zone Compliance Heatmap** to compare across zones.
4. Run the **Zone Drift Detector** to get an actionable to-do list.
5. Triage at-risk agents via the **Agent Risk Radar** in that zone.
6. Use the **Agent Zone Promotion Workflow** to safely move a mature
   agent from Dev to Prod.
7. Periodically check the **ALM Journey Tracker** to see what's stuck.
8. Catch leaks with the **Ungrouped Environment Radar**.

Each feature is independently valuable, but they reinforce each other.
Build incrementally — Ungrouped Radar + Zone Drift Detector are the
fastest wins; Zone Map is the most photogenic; Agent Zone Promotion
Workflow is the most distinctive.

---

## "Search gap" — live admin search across properties not in inventory

> **User goal.** Today, search lives entirely inside the inventory graph
> (the `PowerPlatformResources` table behind `QueryResources` in
> `src/data/inventory.ts`). That graph projects a *curated* slice of each
> resource's `properties` bag — the columns we read in
> `docs/inventory-schema-samples.md`. Anything not in that projection is
> invisible to search.
>
> Concrete questions admins want to answer that inventory cannot:
>
> - "I have the URL `https://acme-finops.crm.dynamics.com/`. Which
>   environment is that?"
> - "Which environment is wired to Dataverse instance ID `<guid>`?"
> - "Which canvas apps were built from a SharePoint list form
>   (`appType == 'SharePointForm'`)?"
> - "Which apps have `bypassConsent == true` AND a launch URL on a
>   specific domain?"
> - "Find the flow whose definition triggers off a particular SQL table"
>   (definition isn't in inventory at all).
>
> The shared shape: *enumerate via an admin connector, filter
> client-side, surface matches with their record IDs so the user can
> click through to the existing detail page.*

### Why it doesn't belong on a detail page

The supplemental-enrichment pattern documented in
[`admin-connector-inventory.md`](./admin-connector-inventory.md) is
*per-record* — one record, one click, one call. This is different:
**one search, N calls** where N is the number of records of that kind
in the tenant. The cost shape is multi-second to multi-minute, and the
right home is its own dedicated surface where progress, cancellation,
and result accumulation are first-class.

### Proposed UX — `/admin/search`

- New top-level route, hidden under an "Admin" section in the side nav.
- A pick-the-search-mode dropdown (one mode per supported predicate
  bundle, see below), a small inputs form, and a results table.
- **Before scan starts**, show the cost estimate up front: *"This will
  fan out across ~134 environments. Estimated 30–90 seconds. Continue?"*
  with explicit confirm/cancel buttons.
- During the scan: progress bar (`X of N envs scanned`), in-flight call
  count, partial results streaming in as each call completes, a Cancel
  button that stops the queue immediately.
- Results table: matched record + the field that matched + a link to
  the existing detail page.
- Session-scoped result cache keyed on `{mode, predicate}` so the user
  can refine the predicate against cached enumeration data without
  re-running the fan-out.

### Search modes (first cut)

Map of `searchMode → enumeration primitive + per-record predicate`.
All enumerations are read-only Get/List ops already documented in
`admin-connector-inventory.md`.

| Mode | Enumeration | Filter on | Fan-out cost |
| --- | --- | --- | --- |
| **Environment by URL / domain name / Dataverse ID** | `ListEnvironmentsForUser` (1 call, paginated) → optional `GetEnvironmentByIdForUser` per env if list payload doesn't carry `url` | `url`, `domainName`, `dataverseId` | 1 + N calls if drill needed (N = env count). |
| **Canvas app by `appType` / launch URL / document URI / form factor / hero status** | iterate envs via `ListEnvironmentsForUser`, call `Get_AdminApps(envId)` per env, optionally drill `Get_AdminApp(envId, appId)` for fields only on the single-record payload | `properties.appType`, `properties.appOpenUri`, `properties.appUris.documentUri.value`, `tags.primaryFormFactor`, `properties.isHeroApp` | 1 + N + (matches × 1) — N = env count. Drill is per match, not per app. |
| **Flow by trigger / connector / definition snippet** | `GetFlows` (tenant-wide DSR-paged) + `ListFlowActions(envId, …)` filtered by connector/parameter | trigger type, connector, parameter contains | One DSR sweep plus per-env action queries; this one is genuinely expensive — keep behind a "I know what I'm doing" affordance. |
| **App / flow by owner** | inventory already has `ownerId` and we surface display name; this should be a saved-query template, **not** a fan-out search. Note it here so we don't accidentally build the expensive path. | — | 0 (inventory-only). |

### Implementation sketch

- **Where the calls go.** Extend `src/data/adminEnrichment.ts` (or
  branch off a new `src/data/adminSearch.ts` if it grows large) with
  small functions per enumeration primitive: `listAllEnvironments()`,
  `listAdminAppsInEnv(envId)`, etc. Each returns `DataResult<T[]>` and
  handles continuation tokens.
- **Concurrency + throttling.** Reuse the slot-limiter +
  TTL-cache + 429-retry machinery already in `src/data/inventory.ts`
  (`__acquireQuerySlot` / `__cacheGet` / `__isRateLimit`). Best path:
  extract those into `src/data/connectorLimiter.ts` so both inventory
  and search share one tenant-wide rate budget — otherwise we'll
  throttle ourselves. **Sized for admin connector limit**, not for
  inventory's `~6 req/s` — confirm before rolling out.
- **Cancellation.** Each enumeration takes an `AbortSignal`. The
  outer scan installs a `new AbortController()` and the Cancel button
  calls `.abort()`. Limiter callers `throw` on abort and the queue
  unwinds.
- **Result store.** Per-session `Map<searchKey, { records, scannedAt, fromCache }>`.
  Wire the existing `invalidateInventoryCache()` to also drop these so
  one Refresh button clears everything.
- **Telemetry.** Once we have telemetry generally (we don't today), log
  scan mode + record-count + duration so we can see which gaps are
  actually used. Until then, leave hooks but no implementation.

### Open questions before building

1. **Side-nav placement.** Is "Admin search" a peer of Dashboards /
   Apps / Flows? Or does it live under a new "Admin" group with the
   capacity / rules pages from the shortlist?
2. **Multi-tenant scope.** All current calls are tenant-implicit. Do
   we ever want cross-tenant search? (Probably no — out of scope.)
3. **Result actions.** Match → click → detail page is the minimum.
   Do we want bulk actions on results (export CSV, send to a dashboard
   tile)? Defer until users actually ask.
4. **Auth model.** Some search paths might surface envs the caller
   can't see in inventory (rare but possible if inventory filtering and
   admin enumeration diverge). UI should fall back to "limited info"
   rather than crashing the detail page.
5. **Is there an actual API for some of these?** Worth checking:
   PowerApps admin endpoints sometimes expose `$filter` server-side, in
   which case a search mode collapses to one call. Look before building
   the per-env fanout.

### Why not just expand inventory's projection

Tempting, but the resource-graph projection is shared across every
QueryResources caller (KPI tiles, dashboards, lists, detail pages). Each
extra column makes every query heavier. The right move is to keep the
projection lean for the high-frequency paths and run fan-out enrichment
for the rare "find by uncommon property" path.

---



- **Connector inventory rollup** — top-level view that fans out across all
  apps/flows/agents and rolls up which connectors are most used, which
  envs use SQL, etc. The data is already in our existing detail-row
  payload (`row.connectors`). The server-side primitive now exists
  (see the connector sentinel filter shipped in the Queries view) —
  `runAggregateCount` could group by the connector bag with a custom
  `extend`/`mv-expand` shim, though `mv-expand` isn't in the Clause
  builder today so a flattened-string `summarize` is the path of least
  resistance.
- **Bundle splitting** — see the **Bundle optimization** section below for the full plan.
- **Lazy route loading** — covered in the **Bundle optimization** section.
- **Env picker → Combobox with typeahead** — the current Dropdown shows
  only the first 500 envs. Replace with a Combobox that types-down to
  the server when a tenant has more.
- **Saved CSV export presets** — let the user pick which columns to include
  in a CSV (instead of always flattening everything).
- **Sticky filters via URL params** — push current filter state into the URL
  so links are shareable and back/forward works.

---

## Env-group "Governance rules" UX polish

> **What shipped.** A single "View all rules" button on
> `views/EnvironmentGroupDetail.tsx` (commit `c61e192` and earlier in
> the same series) loads both governance models in parallel and
> renders every rule expanded by default through
> `src/components/ruleRenderers/{RuleSetRenderer,ModelARulesetRenderer}.tsx`.
> Schema reference at `docs/governance-rules-catalog.md`.
>
> **What's still rough.** The rendering reuses the accordion shell from
> the original collapsed-by-default design, which leaves visual cruft
> when everything's expanded. Specific issues the user called out
> after first use:
>
> - **Chevron noise.** Accordion items keep their disclosure chevrons
>   even when they start expanded. With ~6+ rule items per policy and
>   ~5 buckets per ruleset, the column of chevrons reads as "click me"
>   when there's nothing further to reveal.
> - **Redundant version badges.** Every rule today is `v1.0`, so the
>   `v1.0` badge on every header is pure chart junk. We should only
>   show the badge when version differs from the policy default (or
>   from a sibling rule with the same id), or hide entirely until we
>   see a non-1.0 in the wild.
> - **Schema-name redundancy.** Each header shows the friendly
>   display name AND the raw rule id (`CopilotTranscripts`,
>   `Sharing/AuthoringBot/CanShareWithSecurityGroups`, etc.) right next
>   to it. The raw id is useful for debugging and for the catalog
>   cross-reference, but at the primary surface it's noise; should be
>   tucked behind a hover tooltip or shown only in a "developer mode"
>   toggle.
> - **Status summary placement.** Right-aligned status summaries in
>   the accordion header are great for the collapsed state, but when
>   the panel is open the same info appears again inside (e.g.
>   "Enabled" badge in header + "✓ AI prompts: Enabled" in body).
>   Either deduplicate or only show the summary on collapse.
> - **Card hierarchy.** Inside the combined "Governance rules" card,
>   the two section headers ("Rule-based policies", "Parameter
>   rulesets") + per-policy headers + per-rule headers + per-bucket
>   headers create 4 levels of heading hierarchy. Either flatten or
>   add visual separation (alternating background, subtle dividers,
>   tighter typography ladder).
> - **Density.** Each rule body has its own padding plus the accordion
>   panel padding plus the section padding. The whole card scrolls a
>   long way for content that could be tighter — especially for
>   single-setting rules like `CopilotEnablePrompts` whose body is one
>   line of text.

### Suggested next pass

Probably the right thing is to **stop using `<Accordion>` entirely for
the default-expanded mode** and render each rule as a flat
`<Card appearance="outline">` with the friendly body always visible.
The collapsed/accordion behavior can come back as an opt-in "compact
view" toggle at the top of the card if many-rules-per-group tenants
ask for it. Concrete changes that would unblock that:

1. Split each renderer into `RuleSummaryRow` + `RuleBody` primitives
   (currently fused inside the AccordionItem). Pages compose them
   however they want.
2. Move the friendly display-name + raw-id pair behind a Fluent
   `<Tooltip>`: friendly name in the heading, raw id surfaced on hover
   (and copyable). The catalog doc remains the canonical id source.
3. Build a "Developer mode" toggle in the card header (or a project-
   wide settings drawer) that flips raw ids back on for power users
   and removes the version badge filter so everything's visible.
4. Replace right-aligned status summaries with **inline-trailing**
   pills that sit next to the title (e.g. `Maker bot enabled` directly
   after "AI-powered Copilot features (preview)") so the eye doesn't
   have to skip to the far right of the row.
5. Add subtle visual separation between Section 1 and Section 2 —
   maybe a colored left border per section, or a section "chip"
   ("Model B" / "Model A") to make the two governance APIs visible
   without long header text.
6. For one-line-body rules, render them as a single inline row
   (`<heading> · <one-line-body>`) instead of stacking the body
   underneath the heading.

### Touchpoints

- `src/components/ruleRenderers/RuleSetRenderer.tsx` —
  `PolicyRuleSetsAccordion` + per-id body components + `RULE_METADATA`
  registry.
- `src/components/ruleRenderers/ModelARulesetRenderer.tsx` —
  `RulesetBucketsAccordion` + `ParameterRow` + `PARAM_REGISTRY` +
  `BUCKET_METADATA`.
- `src/views/EnvironmentGroupDetail.tsx` →
  `GovernanceRulesBody` — orchestrates the two-section layout. Likely
  the right place for the "Developer mode" toggle.
- `docs/governance-rules-catalog.md` — keep in sync when display
  names / raw ids move between primary and tooltip surfaces.

### Explicitly NOT in scope for the polish pass

- Editing rules. Read-only stays the contract. Mutation lives on a
  separate roadmap entry if it ever happens.
- Pagination of role assignments (separate small task — see the
  `@odata.nextLink` note in `docs/admin-payload-samples.md`).
- "Compare two env groups" diff view. Different surface; depends on
  Phase 4 of the governance work (a `/admin/compare-groups` route).

---

## Bundle optimization (split vendor + lazy routes)

> **Status as of last session.** Build produces a single
> `dist/assets/index-*.js` ≈ **1.49 MB** (≈ 395 KB gzip). Vite emits its
> 500 KB chunk-size warning on every build. Fine while iterating locally;
> not fine when this app is published — every cold load downloads the whole
> thing before the user sees a thing.

### What's actually in the 1.5 MB

Three sources dominate, roughly:

| Component | Estimated size | Why |
| --- | --- | --- |
| `@fluentui/react-components` (+ icons + griffel + react-aria deps) | ~700–900 KB | Every view imports several components. We pay for the *entire* library because Vite has no chunk hints. |
| `recharts` (+ d3 deps) | ~440 KB | Pulled in by `TileView` only. Only the Dashboards / Home routes need it — every other route loads it for nothing today. |
| Our app code + generated client | ~150 KB | The generated `PowerPlatformforAdminsV2Service` is the biggest of these — has bindings for every action on the connector. |

### Plan

Two changes, independent, in priority order:

#### 1. Lazy-load every view (biggest win, lowest risk)

Wrap each route in `React.lazy` so the bundle is naturally code-split per
route. Wrapped views download only when the user navigates to them.

```tsx
// src/App.tsx
import { Suspense, lazy } from "react";
import { LoadingPane } from "./components/Status";

const EnvironmentGroupsList = lazy(() =>
  import("./views/EnvironmentGroupsList").then((m) => ({ default: m.EnvironmentGroupsList }))
);
const EnvironmentGroupDetail = lazy(() =>
  import("./views/EnvironmentGroupDetail").then((m) => ({ default: m.EnvironmentGroupDetail }))
);
// …and so on for every other view…

function AppShell() {
  return (
    <div className={styles.app}>
      <TopBar />
      <div className={styles.body}>
        <SideNav />
        <main className={styles.content}>
          <Suspense fallback={<LoadingPane label="Loading…" />}>
            <Routes>
              {/* unchanged */}
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
```

**Why this helps so much:** `recharts` is currently in the eager bundle
because *some* view (TileView) statically imports it. Move TileView to a
lazy boundary (Dashboard routes) and recharts moves with it. Users who
never open Dashboards stop downloading 440 KB.

**Watch-outs:**

- `HomeRedirect` resolves synchronously from localStorage — keep it
  *eager*, since it runs at `/` for every cold load. Lazy-loading it
  would add a flash.
- The `Suspense` fallback must not itself be lazy. Reuse the existing
  `LoadingPane`.
- A few components are imported from non-view modules (e.g.
  `EnvironmentPicker` is reused by AppsList, FlowsList, AgentsList,
  QueriesView). Those stay eager — they're shared across multiple lazy
  chunks and Vite will pull them into the common chunk automatically.

#### 2. Manual chunks for the heavyweights

Tell Rollup to split Fluent + recharts into named long-lived chunks. These
hashes change rarely, so returning users get them from cache.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "vite-plugin-power-apps"; // existing

export default defineConfig({
  plugins: [react(), powerApps()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // 700–900 KB — almost everything Fluent depends on.
          fluent: [
            "@fluentui/react-components",
            "@fluentui/react-icons",
          ],
          // 440 KB — only loaded behind Dashboards once lazy-loading is on.
          charts: ["recharts"],
          // 150 KB — only QueriesView + dashboards need router APIs deeply.
          router: ["react-router-dom"],
        },
      },
    },
  },
});
```

After both changes, expect (approximate, tenant-agnostic):

| Chunk | Size (raw / gzip) | When downloaded |
| --- | --- | --- |
| `index` (app shell + Home + redirect) | ~100–150 KB / ~35 KB | Always, on cold load |
| `fluent` | ~800 KB / ~210 KB | First view that needs it (= immediately, but cached on later loads) |
| `charts` | ~440 KB / ~120 KB | First Dashboard visit only |
| Per-view chunks | 5–30 KB each | On route navigation |

Net effect: first paint cost drops to roughly `index + fluent` (~245 KB
gzip) instead of the current `~395 KB gzip` everything-in-one bundle, and
the heaviest piece (charts) is paid only when warranted.

### How to verify

After the changes:

```pwsh
npm run build
```

- Watch for the chunk-size warning to disappear (or shrink to just
  `fluent`, which is acceptable for a vendor chunk).
- Inspect the `dist/assets/` listing — there should now be a handful of
  files, not one. Names like `index-*.js`, `fluent-*.js`, `charts-*.js`,
  and per-view chunks (`QueriesView-*.js`, `DashboardDetail-*.js`, …).
- Open the app, navigate Home → Apps → Dashboards. The Network panel
  should show new `.js` files load on each navigation, only once.

### Things that could trip this up

- **Generated client.** `PowerPlatformforAdminsV2Service` is statically
  imported by `inventory.ts`. That keeps the connector binding in the
  index chunk — fine, since every view talks to inventory. Don't try to
  lazy-load it.
- **Fluent dynamic theming.** If we add Dark mode + theme switching
  later (it's in the parked-ideas list), keep the `FluentProvider`
  eager — it wraps every route.
- **Power Apps host quirks.** Some embedded hosts have been known to
  rewrite asset paths. If routes 404 on JS chunks after deploy, check
  the `base` setting in `vite.config.ts` and confirm the host honors
  hashed filenames.

### Out of scope (for now)

- Switching component libraries to shrink Fluent. We're using a lot of
  Fluent and the cost is justified by the UX consistency. Don't go
  there.
- Tree-shaking individual Fluent icon imports. Fluent's icons package is
  already side-effect-free per its `package.json` — Vite handles this
  via `import { X } from "@fluentui/react-icons"` style we already use.
- Dynamic-import of recharts at the tile level (instead of route level).
  Route-level is simpler and just as effective.

---

## DLP Comparator — V2 scope expansion

> **Status as of last session.** V1 shipped in `src/views/DlpComparator.tsx`
> + `src/data/dlpDiff.ts`. It compares two `PolicyV2` objects across
> *scope*, *default classification*, and *connector bucket placement*
> (Business / Non-business / Blocked), with a search box, "show only
> differences" toggle, and a disclaimer MessageBar at the top calling out
> what's not yet covered.

### What V1 does NOT cover (in priority order)

1. **Custom connectors.** `PolicyV2.connectorGroups[].connectors[]`
   includes any connector the policy explicitly classifies, but the
   surface is the same shape regardless of first-party vs custom. The
   raw payload from `ListPoliciesV2` already returns custom connectors
   with their custom resource id (`/providers/.../apis/shared_<env>_<name>`).
   The diff already renders them — but we should add visual affordance
   (badge, separate sub-section) so users can tell first-party from
   custom at a glance, and surface a "custom connectors only" filter.
2. **Connector-specific blocked actions.** Per-connector action-level
   blocks (e.g. "SharePoint > Delete file is blocked even though
   SharePoint is in Non-business") are **not** in the `PolicyV2`
   payload at all. They live on a different connector endpoint — the
   policy detail endpoint that returns per-action `connectorActionConfigurations`.
   We need to issue a follow-up call per policy and weave the results
   into the comparator. Investigation needed: which connector exposes
   it, and what the auth/version story looks like.
3. **Endpoint configurations.** Same story as blocked actions —
   endpoint allow/deny URL patterns are a separate per-policy endpoint
   not returned by `ListPoliciesV2` / `GetPolicyV2`. Should diff as
   "URL pattern added / removed / modified" rows.

### Scope-section enrichment (smaller, cosmetic)

The scope card today shows environment **name** and **id** for each
environment in the policy's `environments[]`. It doesn't yet:

- Resolve environment names against the inventory cache (the connector
  returns the env display name in `name`, but if the policy was authored
  in PPAC and the env was later renamed, the cached name may drift —
  reconcile against `listEnvironmentsPage` from `inventory.ts` and show
  the **current** display name with a tooltip showing the policy-time
  name if different).
- Provide a **search/filter** on long environment lists. Big tenants
  may have hundreds of envs in an `ExceptEnvironments` scope — needs the
  same `SearchBox` treatment we just added to the connector table.
- Group "in both", "only in A", "only in B" into sub-sections with
  collapsible headers so the diff is scannable at scale.
- Link each environment row to the existing `/environments/:envId`
  detail page (one click to drill into what's running in it).

### Where to wire it in

- New per-policy enrichment helper next to `getDlpPolicy` in
  `src/data/dlpPolicies.ts` for whatever endpoint returns blocked
  actions + endpoint configs. Mirror the wrapper pattern: typed
  `DataResult<T>`, normalized errors. Schema sample should land in
  `docs/admin-payload-samples.md` once captured from a live tenant.
- Extend `DlpDiffResult` in `src/data/dlpDiff.ts` with two new
  branches: `blockedActions: BlockedActionDiff[]` and
  `endpointConfigs: EndpointConfigDiff[]`. Keep diff logic pure
  (no React) so **DLP Impact** (`src/views/DlpImpact.tsx`) can reuse it.
- Add two new sections to `DlpComparator.tsx` below the connector
  table. Same look-and-feel: KPI tile in the summary row, soft-warning
  row backgrounds for diffs, "show only differences" toggle.
- Remove the corresponding bullet(s) from the disclaimer MessageBar
  as each is implemented. When the disclaimer is empty, delete it.

### Open questions

- Do we want to fetch the supplementary endpoint **lazily** on first
  expand of those sections, or up-front when both policies are picked?
  Per-record enrichment style (see `src/data/adminEnrichment.ts`) would
  be a behind-a-button click; auto-fetch on selection matches the
  existing one-shot UX of the comparator. Lean auto-fetch unless the
  call is noticeably slow.
- Custom connectors: should the diff visually separate them, or just
  badge them inline? The badge approach keeps the unified table; the
  split approach is two tables (first-party, custom) and easier to
  scan when one side has many customs and the other has none.

---

## DLP Impact — V2 enhancements

> **Status as of last session.** V1 shipped in `src/views/DlpImpact.tsx`
> + `src/data/dlpImpact.ts`. Pick a DLP policy → pick a currently
> non-Blocked first-party connector from that policy → see every app,
> flow, and agent in the policy's scope (`AllEnvironments` /
> `OnlyEnvironments` / `ExceptEnvironments` / `SingleEnvironment`) that
> currently uses the connector. KPI strip (apps / flows / agents / envs /
> owners), flat sortable table with detail-page links, CSV export.
> `ExceptEnvironments` is filtered client-side because the typed
> `QueryFilterOp` union doesn't expose `!in~`; revisit if/when that
> changes upstream.

### V2 parking lot (in rough priority order)

1. **Custom connectors.** V1 hides them from the picker because their
   id shape (`/providers/.../apis/shared_<env>_<name>`) doesn't slug
   down to `shared_<x>` cleanly and the inventory's `__connectorBag`
   `has` filter is tokenized on the slug form. Needs either a
   per-shape matcher or a switch from `has` to `contains` (with the
   false-positive risk that implies). Once supported, drop the
   `_type === "Custom"` filter in `extractNonBlockedConnectors` and the
   warning MessageBar in the view.
2. **Reverse mode** ("what would unblock?"). Pick a currently-Blocked
   connector and show which apps/flows/agents *would gain capability*
   if unblocked. Symmetric query (`__connectorBag has 'slug'` + scope),
   but the framing flips and the warn/ok tones invert. Probably a
   toggle on the same page rather than a new route.
3. **Multi-connector simulation.** Select N connectors at once and see
   the union of impact + per-connector breakdown. The KQL would use
   `has_any` instead of `has`. Useful for "what if we tightened the
   whole `Confidential` bucket?" scenarios.
4. **Full classification-shift simulator.** V1 only simulates
   `current → Blocked`. The next-level version lets the user pick a
   connector and a *target* classification (Confidential / General /
   Blocked) and shows two flavors of impact:
   - Direct: which resources currently use it on the source side that
     would break under the new bucket (only meaningful when target is
     more restrictive — i.e. → Blocked).
   - Cross-bucket: which resources pair the connector with another in
     a way that would *now* violate the policy's cross-bucket rule
     (Business + Non-business cannot share a flow). For example
     "SharePoint Business → Non-business: 23 flows that combine SP
     with another Business connector would break."
   This subsumes "Cross-bucket move analysis" from earlier drafts.
   Requires loading every connector reference on every impacted
   resource (already in `properties.powerPlatformConnectors`) and
   applying the policy's bucket rule client-side.
5. **Connector-action level.** Once the DLP Comparator V2 adds blocked-
   action data (see above), DLP Impact should let users simulate
   blocking a *specific operation* (`OPERATION_FIELD` sentinel already
   exists in `inventory.ts`), not just the whole connector.
6. **Save-as-saved-query.** Hand off the underlying `QuerySpec` to
   `views/QueriesView.tsx` so a power user can keep tweaking it. The
   spec is already constructed in `queryDlpImpact` — exposing it would
   be a thin `dlpImpactToQuerySpec(policy, slug)` helper.
7. **Group by environment / by type.** V1 went with a flat sortable
   table for speed. If users routinely want the grouped view (e.g.
   "show me the blast radius env-by-env"), wire it as a layout toggle
   in the toolbar — keep the underlying `DlpImpactResult` shape stable.
8. **Result diff across runs.** "Last week 12 resources used this
   connector; today 18." Would need lightweight persistence in
   localStorage keyed by `policyId + connectorSlug`.

### Notes for whoever picks this up

- The data-layer helpers (`extractNonBlockedConnectors`,
  `countExcludedConnectors`, `resolveDlpScope`, `queryDlpImpact`) are
  all pure / typed and easy to unit-test in isolation if/when we add a
  test runner. They take a `PolicyV2` directly so you don't need to
  mock the connector layer to test them.
- The view uses `getEnvironmentNameMap()` from `inventory.ts` to
  resolve env ids in the scope card; the 5-minute env-map cache means
  this is essentially free on repeat renders.
- Connector slug `shared_sql` matches the inventory shape after
  `normalizeConnectorId`. Don't accidentally pass the policy's raw
  ARM-path id (`/providers/.../apis/shared_sql`) into the inventory
  query — it will tokenize wrong and return zero hits.

