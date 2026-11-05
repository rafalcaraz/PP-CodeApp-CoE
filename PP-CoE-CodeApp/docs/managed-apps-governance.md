# Managed apps governance

Open **Risk & Governance > Managed apps** (`#/managed-apps`) for a group/PDE/app
board in the existing Zones visual language. Unlike Zones' local organization,
columns represent live inventory environment-group membership. Nothing is
stored as local governance.

## Scope and search

The board drains `QueryResources` for `microsoft.powerapps/apps` with
`properties.subType == 'microsoftApp'`, using the same managed-app classifier
and subtype constant as the Apps list. App Builder and legacy/code app families
are not included. It joins normalized environment IDs against complete bulk
environment inventory, not only a Developer-filtered subset. Managed apps remain
visible and counted when their parent is missing, malformed or ineligible for
PDE transfers. Unavailable parents have an explicit **Environment details
unavailable** context, not fabricated ungrouped membership. Known non-Developer
or unmanaged parents retain their real group context but have no selection/drag
and a disabled move action with a reason. Only verified managed Developer
environments count as PDEs; other parent contexts are counted separately.
Missing parent metadata does not prove an environment type or permission issue.

Compact app rows retain inventory origin and connector-usage counts (including
explicitly unreported usage); owner, maker and subtype remain in app inspection.
App details lead with the app name, environment and joined group name, identity
names (or explicit unresolved lookup), and friendly connector names. Usage help
is contextual; transfer protocol warnings belong to move review, not app details.
Other environment apps are collapsed and exclude the selected app; failed or
incomplete sibling reads remain explicit errors rather than complete counts.
IDs/subtype are under **Technical details**. **Raw inventory record** lazily
displays only the selected app's original returned resource, including unmapped
fields, in a bounded scrollable JSON panel. It makes no extra request and stores
no payload in localStorage. Missing raw records and serialization failures are
shown explicitly, never replaced with reconstructed UI fields.
`CopilotStudio` is displayed
as **Copilot Studio**; other origin strings are shown literally with an
observed-origin badge. Missing origins are explicitly unavailable. Cowork,
CLI and Code are not invented API enums. Owner and maker names present in
inventory or the shared identity cache are searchable. **Resolve owner /
maker names** explicitly runs the existing bounded, cached identity lookup
for the loaded apps. A lookup miss is not evidence of a deleted account.

Search and origin/group filters affect cards, not the tenant membership.
Column counts distinguish filtered apps from total apps and count PDEs across
the unfiltered column. No group is treated as the initial routing group based
on its name. Missing group details and no-group membership remain distinct.

### Responsive group → PDE → app browsing

Only groups containing matching scoped apps appear by default. The existing
bulk join is `app.environmentId -> returned environment ->
environmentGroupId`; no per-app membership request or app-ID/group-ID inference
is needed. Each app-bearing PDE appears once by normalized environment ID, with
compact app rows nested beneath its name and app count. Empty PDEs are not shown.
A missing environment row is explicitly **details unavailable**, not
falsely ungrouped.

Columns fit the available container width and wrap into successive rows; narrow
containers use one column. The page scrolls vertically instead of maintaining
a fixed-width horizontal board. One PDE-level checkbox, pointer/keyboard drag
handle and menu own selection and movement; apps have no move/selection/drag
controls. The accessible **Move environment** menu is equivalent to dragging.
Multiselect deduplicates PDE IDs and reports all loaded sibling app counts,
including hidden rows. A filtered PDE says **N of M apps matching**; its move
always checks every sibling/resource through the existing fresh impact workflow.
**View governing rules / ACP** inspects the actual parent group's configuration,
not a fabricated PDE-owned policy. Ungrouped/unknown membership explains its
unavailable group ACP without implying unrestricted access.

**Show empty groups** includes groups with no scoped or matching
apps. Use it to inspect empty-group governance, search their configured
connectors/rules/properties, or expose empty drag destinations. The accessible
move destination picker always retains every inventory group, even when its
column is hidden. App filters never narrow fresh full-PDE sibling/impact reads
or modify inventory membership.

The primary toolbar keeps unified search, **Filters**, **Show empty groups**
and refresh together. **Actions** groups duplication, owner/maker resolution
and pending-only transfer recovery. Selected-PDE move preparation and actionable
errors, historical-snapshot warnings and transfer outcomes remain visible.

**Filters** opens one responsive panel for app/environment/group fields and
configured connector/rule/property controls. Its count includes each effective
nonempty field once, including global search; connector all/any mode belongs
to its connector field, and a rule field only filters after choosing a value.
**Clear filters** resets every search/filter field and connector mode, without
refreshing evidence, clearing selection or changing transfer journals. It
preserves **Show empty groups**, which is browse scope rather than a filter.

The concise result line counts matching apps, app-bearing PDEs and actual
environment groups; diagnostic ungrouped/unknown columns are not claimed as
real groups. **About this view and totals** exposes shown/total apps, unique
app-bearing PDEs, shown/total board columns and the separate managed Developer
inventory total, plus scope/refresh/identity help. Unread governance does not
match configuration filters; an active-filter notice directs empty-group
searches to Show empty groups instead of claiming no governance groups exist.

Inventory paging uses stable resource identity ordering and counts raw returned
rows for the connector's required `Skip` plus `SkipToken` workaround. Missing
resource collections, conflicting duplicate snapshots, missing identities and
stalled continuation fail explicitly rather than yielding partial success.
[The Resource Query contract](
https://learn.microsoft.com/en-us/rest/api/power-platform/resourcequery/resource-query/query-resources)
defines `resultTruncated` as **0 = truncated, 1 = not truncated**. Explicit
truncation or unrecognized completion metadata without a continuation token
is rejected; approximate totals alone are not a completeness guarantee.

## Policy inspection

Global search includes app names/IDs, owner/maker names, PDE names/IDs and actual
group names/IDs. Open **Filters** for
separate name-or-ID fields combined with AND. Searchable Fluent pickers retain
actual IDs and disambiguate duplicate group names; typing is not a destination
selection. Empty groups remain available through Show empty groups and through
the independent **Actions > Duplicate environment group** source picker.

Cards show the count of inventory-reported `powerPlatformConnectors[].connectorId`
values. **Inspect app and connectors** shows catalog names with raw-ID fallback.
Missing/unreadable usage is not an empty list, and usage is not ACP permission.

The tenant rules endpoint requests pages of 100 (its supported maximum), follows
returned skip-token continuations and fails on unsupported/stalled pagination.
This is not a global inventory page-size change. Rules failures have a concise
message plus expandable technical detail, independent of successful ACP reads.

**Inspect ACP permissions** opens a side panel and freshly loads group
properties, Model A rules, Model B assignments and policy bodies on demand.
**Load group rules / ACP** explicitly reads evidence for all loaded groups,
with bounded concurrency and one paginated tenant-rules read per batch.
Initial navigation loads inventory only, not passive policy fanout.
Policies retain their
identities, raw inputs and rule versions; they are not unioned into a new
group-level allow/block verdict or a restrictiveness ranking. Missing,
partial and unknown data are explicitly unavailable. Listed action and
connection-type modes describe the returned configuration, not independently
verified effective enforcement. Draft/published state, environment overrides,
other governance models and overlapping policies are not resolved here.

The **Configured group governance** section in **Filters** lets you
search group names/descriptions, match one or more comma-separated connector
IDs with explicit **all** / **any** behavior, and select an exact property or
rule value actually returned by the APIs. ARM, `shared_` and bare connector
IDs are normalized for comparison. Connector matches mean readable ACP
configuration with known action and connection modes, not verified runtime
access. Listed-action restrictions remain visible. Unknown modes, incomplete
policy reads and absent connector entries never count as allowed.

Model A settings are associated only by explicit `Include` /
`EnvironmentGroup` filters. Unresolved applicability remains separate.
Policies and rulesets keep their identities when settings are compared.
Unsupported continuation shapes, repeated tokens and missing identities fail
closed; a failed section does not become an empty or unrestricted policy.
Assignment scope, returned policy identity, rule metadata and supplied counts
are validated. An unread assignment continuation fails before policy fanout.
Shared policy IDs are fetched once per explicit evidence batch, never reused
across refreshes. Empty evidence batches make no tenant-rules request.

**Refresh inventory** bypasses query caches for inventory and reloads group
properties, tenant rules and ACP evidence after external edits. It immediately
clears selections and closes stale inspections/copy/move previews. Per-group
section errors remain inspectable; evidence coverage and read times are shown.
Superseded reads are cancelled at page/fanout boundaries and late responses
cannot overwrite a newer refresh. Returning to the window invalidates policy
evidence and closes previews, prompting an explicit refresh. Inventory retained
on screen is labeled historical, not current authorization. Read timestamps
describe nontransactional read windows, not an atomic tenant snapshot.

## Movement capability

Membership execution uses the supported Admins V2 actions. PDE checkboxes
support multi-selection. Drag a PDE's handle onto a real environment-group
column, or use **Move environment** / **Prepare selected PDE moves** for the accessible equivalent. These
actions prepare a preview only; they do not change membership.

Preparation deduplicates PDEs, forces fresh inventory reads, verifies selected
apps and destination still exist, reads all four app types plus four other
operational resource types in each PDE, and reloads source/destination rules
and policy evidence. After sibling reads, a targeted fresh read rechecks each
PDE's managed Developer eligibility and membership before governance reads.
App or membership changes between reads invalidate that PDE's preview.
Failed or incomplete PDE reads clear their apparent app/connector impact rather
than showing a complete-looking list. Closing or superseding preparation stops
later fanout.
Every affected sibling app is listed, including unselected/filtered and
non-board app types. Per-PDE outcomes are **preview prepared**, **already in
destination** or **preparation failed**, never mutation-shaped success.
Observed connector/action references and identity-preserving configuration
comparisons are expandable. Inventory cannot prove every runtime dependency;
unknown or not-listed permissions are not labeled safe or blocked.

The bundled connector and [Microsoft's environment-group documentation](
https://learn.microsoft.com/power-platform/admin/environment-groups) expose
`AddEnvironmentToGroup` and `RemoveEnvironmentFromGroup`. Membership is
exclusive; a transfer requires removing the PDE from the old group before
adding it to the new one. Only managed environments can be grouped. Removal
retains the last applied rules but unlocks them. These APIs do not constitute
an atomic move.

The registered `AddEnvironmentToGroup` and `RemoveEnvironmentFromGroup` accept
group ID, environment ID and API version `2024-10-01`, with no request body.
Their documented responses are `202` / `204`, and the SDK returns no operation
ID or status-header envelope. Completion is therefore verified using direct,
identity-checked `GetEnvironmentByIdForUser` reads, not an invented operation
status schema. Group membership is an optional string. A missing/null/empty
group ID on a complete environment resource represents no reported assignment,
not a malformed resource. Exactly one matching managed Developer environment
from a fresh, fully drained targeted inventory read still establishes eligibility.
The valid, identity-checked direct connector response takes precedence for
membership when inventory lags. Both use the same membership normalization,
including the zero-GUID sentinel. Preview source membership and corresponding
policy evidence use that direct result; stale inventory cannot authorize the
next removal/add. The direct source is checked again immediately before writes.
Contradictory group names/details without an ID, malformed group values,
missing resource identity/properties/eligibility, incomplete collections and
unavailable eligibility evidence block writes. A membership disagreement alone
does not: verified direct destination membership is reported as **Moved; inventory
is updating** when the measured inventory group differs. Neither a missing resource nor an
unread collection is classified as ungrouped. No invented full-group membership
endpoint or mandatory field is required: registered group details contain
group metadata, not an authoritative member collection.
Direct identity must match, state must be `Enabled`, and real deletion dates
are rejected. The existing anonymized admin fixture returns
`deletedDateTime: "1970-01-01T00:00:00Z"` for an Enabled environment; that epoch
sentinel is not treated as an actual deletion. Arbitrary wrapper/ARM-ID shapes
are not inferred. Field-specific diagnostics contain no raw response payload. The board's
ungrouped-column description says no group is reported in the inventory
snapshot; it does not claim independent live verification. Actual transfers
perform the fresh direct/eligibility checks above before every write/completion read.
Direct and targeted inventory completion timestamps and returned group IDs are
retained in the current result's technical detail, not fabricated server timestamps
or persistent inventory changes. A recent verified direct result updates only
that PDE's displayed membership for up to 60 seconds; raw inventory is unchanged,
older/future evidence is ignored, and external-focus invalidation clears it.
Its
`dataverseId` is required before removal/add; no automatic database creation
or managed-environment upgrade is attempted.

**Move PDE** (or **Move N PDEs**) requires a fresh complete impact review and a
separate checkbox naming each PDE, destination and whole-PDE impact. The review
shows named source/destination groups, affected apps/resource counts and the
non-atomic failure risk. Routine historical records, counts, operation IDs and
SDK/polling narrative are not rendered. Only current errors have collapsed
technical detail; actionable uncertainty remains visible.

After confirming, **Continue in background** closes the review without stopping
the submitted batch or its membership verification. A compact app-shell strip
remains across same-app routes, with **View progress** reopening the same task,
not submitting it again. Reviewed cards and progress show actual per-PDE stages:
queued, fresh impact checks, removing, adding, membership checks and the verified
result or attention needed. No percentage or completion is inferred from a
request acknowledgement. Only one in-app batch runs at a time; the existing
cross-tab Web Lock remains authoritative.

This is an in-memory runner in the current browser app, not a server background
job. Keep that tab open: closing or reloading it stops the runner and loses its
in-memory progress/error detail. The active task installs a tab-unload warning.
After reload, durable request flags support bounded **read-only** recovery;
neither mounting the shell, reopening progress nor returning to a route replays
membership writes. Current results can be dismissed. Successful completion stays
in the compact progress strip with the batch's names, completed count and
destination. It does not reload inventory, blank/remount the board or refetch
all policy evidence. Only the matching move preview closes and completed PDEs
leave the selection; filters, browse scope, scroll and unrelated selections or
inspections remain intact. Partial/error results retain their named recovery
actions without forcing a screen reset.

The existing temporary, timestamped direct-membership projection updates only
successfully verified destination PDEs, including when returning from another
route. It does not rewrite inventory records or infer membership for uncertain
entries. Prior unrelated recent evidence is retained. The projection still
expires after 60 seconds or external-focus invalidation: it is not a permanent
claim that the underlying inventory snapshot caught up. **Refresh inventory**
remains an explicit user action; no automatic background refresh replaces newer
direct evidence with lagging inventory. Later moves always perform their own
fresh eligibility, impact, governance and direct-membership checks.

Before each PDE, fresh full sibling/resource identities, membership and group
governance must still match confirmation. Failed/unresolved policy or rules
evidence blocks writes. Already-members are freshly verified and skipped.
Ungrouped PDEs use add only; grouped PDEs use remove, verify ungrouped, recheck
impact/destination, add, verify destination. Published destination rules are
inherited by the platform; removal retains old settings but unlocks them.
Membership verification does **not** independently certify effective policy
enforcement, publication or override behavior. Reads and writes remain
nontransactional and concurrent external admin changes cannot be locked out.

The **Power Platform Administrator role** is required. Reads do not prove
write permission; no invented permission-introspection endpoint gates the
supported actions. Actual permission/validation rejections are reported.
Unknown transport/SDK failures are treated as ambiguous, not safe to retry.
Outcomes distinguish no membership writes attempted (`remove: none`, `add: none`)
from attempted/uncertain operations. A preflight parsing failure is not an
authorization rejection and is not reported as a failed cloud membership write.
The main warning explains whole-PDE scope, published destination rules and the
possible ungrouped state after add failure; polling/SDK details are expandable.
Each request is bounded at 30 seconds without pretending to cancel cloud
operations; membership completion polls up to 12 direct reads, 5 seconds apart.
Post-write completion checks retry read failures as well as unmatched membership
within a 60-second polling window (at most 12 reads, with bounded individual
requests). Pre-write failures remain fail-closed. An unverified step stops the
batch before any later PDE is written. Results distinguish read failure, pending
membership propagation and unexpected group membership, preserving the last
precise error/phase in technical details.

Write intent and actual per-PDE outcomes are persisted before actions in strict
browser-local journals containing only IDs, SHA-256 preview fingerprint,
timestamps and phases. Storage failure blocks writes. Web Locks serialize this
app's transfer/reconciliation attempts across tabs; a browser without that
capability is blocked. They do not lock other apps/admins or the tenant.
Incomplete journals prevent duplicate execution for the same PDEs.
Conflict checks apply to the individual PDE's actual write flags, not another
PDE's unfinished step in the same batch. Attempts with no writes do not block
later confirmation. **Check move status** is shown only for unresolved requests
and checks retained
matching records under the same cross-tab lock. A previously attempted add
is marked verified only after a valid fresh direct read places that PDE in that
record's destination; inventory can still be updating. Other unknown operations remain unresolved;
one completed record cannot clear unrelated or conflicting writes.
Verified historical outcomes are retained unchanged when later moves change
membership; checking history never turns an old completed move into a new
unfinished operation. Records are not deleted. After checking, prepare a
fresh preview and confirm explicitly; no move is automatically retried.
**Resolve pending move** appears independently of selection only when retained
records contain genuinely unresolved requests or detached recovery. It remains
available after reload or clearing selection; completed/no-write records create
no menu item or warning. Opening it automatically performs one bounded read-only check of unresolved
records under the existing cross-tab lock. Closing cancels later polling, not
already submitted cloud requests. This never repeats a membership write.
Completed and no-write records are retained durably but never listed in move
dialogs. Successful current results are concise and dismissible; dismissal
only hides the result and never deletes journals or resolves pending requests.
Pending reminders are also dismissible for the same pending state in this loaded
app, including route changes and ordinary status/focus refreshes. Timestamp-only
journal updates do not restore a dismissed reminder. A new pending operation or
changed phase/request/membership state can notify again. **Actions > Resolve
pending move** stays available even when the reminder is dismissed. Closing a
recovery dialog never automatically reopens it.
Read-only checks never appear as a new move's outcomes;
old failed preflight records do not overshadow verified completion.
Status checking reads recorded identities without reissuing writes.
Move dialogs scope those checks and visible warnings to the selected PDE IDs,
including before an impact preview exists. Pending recovery can check unresolved
records independently of selection; unrelated entries in a mixed batch never block the selection.

A proven detached PDE can continue through **Review impact → Move to [group]**
with new explicit whole-PDE confirmation when its previous removal was accepted
and its add was never issued or conclusively rejected. The journal must report
ungrouped membership, and fresh impact/eligibility/governance/direct membership
checks must still prove the PDE ungrouped immediately before the new add.
This is a new confirmed add-only operation, not an automatic retry or rollback.
An accepted removal can stop before add if its ungrouped verification fails,
post-removal impact/destination checks fail or change, or the final direct
membership/Dataverse check fails. The current task retains the actual original
phase/error for inspection, but older journals contain only identities, flags
and outcomes, not original error text. A detached/no-add journal alone cannot
identify which check triggered the stop; recovery details say explicitly when
that original reason is unavailable.
Its per-PDE `recoveryOf` record IDs are saved before the add; original phases,
source and request outcomes remain unchanged. Only a verified linked recovery
resolves the old blocker for that exact PDE. A failed or uncertain recovery does
not erase the prior partial operation. Any other unresolved add/removal blocks
execution; seeing an ungrouped PDE alone cannot prove an asynchronous write ended.
After failed add following removal, the PDE may be detached; uncertain
asynchronous operations may still complete. Inspect the recorded source,
destination and PDE IDs in PPAC for explicitly user-directed manual recovery.
There is no automatic rollback, retry, deletion or cleanup. Recovery records
survive reload in the same browser, not clearing browser storage or switching
devices. Refresh invalidates historical previews and reloads board/evidence
after returned success, partial/uncertain outcomes or reconciliation.

No real tenant move was performed during development. Focused tests use
synthetic adapter responses, including async/ambiguous completion and
permission failures. Safe user-run verification still needs an explicitly
confirmed expendable PDE, actual authority, and inspection of destination
membership plus published-rule behavior. Independent-copy applicability and
completion checks remain separate from this movement contract.

Contract references: [add](https://learn.microsoft.com/rest/api/power-platform/environmentmanagement/environment-groups/add-environment-to-group),
[remove](https://learn.microsoft.com/rest/api/power-platform/environmentmanagement/environment-groups/remove-environment-from-group),
and [Admins V2 connector](https://learn.microsoft.com/connectors/powerplatformadminv2/).

## Independent environment-group copy

In the group panel, enter a new name and choose **Review copy**.
The duplication form appears before the group evidence. The default view shows
the new name, independent ACP and zero environments copied. Group settings,
policy grids, connector declarations, technical identities and raw values are
under closed disclosures. A blocked review shows one short actionable reason;
the complete checks and exact unmapped fields remain in **Copy details**.
There is no disabled creation confirmation for an unavailable path. Unfinished
operations and their recovery controls remain expanded.
This now runs a **fresh preflight**, not an assessment of the historical drawer
snapshot. It reads group properties, direct group Model A rules, complete tenant
rule applicability, group assignments and complete Model B policy bodies.
Disagreement between the direct and tenant reads, changed properties, unread
continuation, unresolved applicability or malformed/missing evidence fails
explicitly. Reads are nontransactional; a SHA-256 source fingerprint is rechecked
before writes and at completion.

The proposed copy includes the new name, source description, **all Model A
parameter buckets/settings**, and **all Model B modules**, not just ACP.
The exact copied values and original resource/module identities are expandable.
Model A setting IDs and string values (including `"false"` and numeric strings)
remain unchanged. Source Model A resource IDs/timestamps are omitted; its filter
becomes destination-only `Include / EnvironmentGroup`. Model B module IDs,
versions and complete inputs are deep-copied, including ACP-only mode, explicit
action/connection-type lists, unknown readable modules, empty arrays and false
values. Observed `Policy.lastModifiedOffset` and the `lastModifiedDate` fields
on Model A buckets and Model B modules are server-generated response timestamps,
not writable settings. Their types are validated, but they are not sent or
compared as destination settings. An identically named property **inside inputs**
is still copied unchanged. `PolicyRequest` contains only `name` and `ruleSets`.
Other unknown container
fields are not guessed to be metadata: their exact paths and returned values
remain in the review, and block writing until their mapping is established.
Policy/group identities must come from creation; group rule identities must
come from the creation response or exact destination-scoped read-back.
References to source-owned resources without a verified remapping rule, duplicate
identities and unknown non-input resource settings are concrete blockers, not
silently omitted settings. A nonempty source hierarchy is also blocked: copying
neither its parent nor its children cannot establish inherited rule fidelity.

The current connector's **runtime metadata and both playground registries do
expose group-only `GetRuleSet` / `CreateRuleSet`**. The historical env-scoped-route
failure is not a valid blanket gate for the current route. Named SDK calls use
`groupId`, `api-version` and `body`, without the obsolete generated signature's
extraneous `environmentId`; generated files are not changed. This follows the
existing connector-playground SDK transport, not a new HTTP client or the
body-only REST wrapper.

[Microsoft's independent ACP-copy tutorial](
https://learn.microsoft.com/power-platform/admin/programmability-tutorial-manage-advanced-connector-policies)
documents independent Model B copying and whole-group assignment with `{}`.
The documented path has **one assigned policy per group**. Multiple assignments
or overrides without a verified mapping block preflight; policies are never
unioned or selected by position. The orchestration creates a new group, creates
destination-scoped Model A rules, creates one independent policy containing every
source module, reads it back and, if necessary, patches only the new exclusive
policy before assignment. It never patches a source or existing target policy.
It then assigns the new policy only to the new group and re-reads both models,
group properties, assignment scope/exclusivity, empty membership, source
fingerprint and applied state. Success requires equivalence of **both**
rule models and fresh read-back of their applied configuration.
The board refreshes only after verified completion and retains the verified
destination link after closing the stale drawer.

### Applied configuration and remaining boundaries

The supported single-resource path is enabled. An explicitly authorized disposable
empty-group test established the admin center's Save/Apply contract:

- Adding rules and saving an edited rule staged changes in the browser without
  governance writes. A fresh group-rule API GET still returned the previous value.
  Staged state could survive SPA navigation; it was not stored in that API response.
- **Apply changes** (the control titled **Publish rules**) created the independent
  policy, POSTed the new group's Model A parameters and assigned the new policy
  with `{}`. There was no additional Publish request. The UI reported **Applied**.
- Applying a later saved change PUT the existing Model A resource, and a fresh GET
  returned the changed value. Fresh policy/assignment reads showed one independent
  policy assigned only to the new group. The group remained empty after reload.
- Saving a confirmed edit to that existing ACP also issued no governance write.
  The browser staged a 23-connector list while a fresh policy GET still returned
  24. **Apply changes** PATCHed the same independent policy; a subsequent fresh GET
  returned 23. No second group, policy or assignment was created.
- The server added `lastModifiedDate` to bucket/module responses even when it was
  absent from their write payloads. These are the specifically recognized metadata
  fields, not permission to discard arbitrary extensions.

Production copies **applied API configuration**, not pending admin-center browser
edits. This distinction appears in review and the final confirmation. No draft-only
copy mode, invented Publish endpoint, synthetic published flag, or manual-publish
success shortcut is used. Final applied-state verification repeats the independent
group, tenant-rule, assignment and policy reads; disagreement or unavailable reads
cannot produce success.

The observed PPAC governance calls used `2021-10-01-preview`; production uses the
registered `2024-10-01` operations and documented request models. The disposable
test verifies PPAC's operation/staging semantics, **not an end-to-end run through
this app's connector identity** or every source module combination. The
production-adapter integration tests use synthetic responses. Caller-specific
permission/transport behavior still requires verification when the user runs a copy.

Multiple Model A source resources remain a specific cardinality gate: the API
does not specify whether repeated creation preserves separate resources.
A single resource is read back with its complete settings and new-group scope.
Its identity may be group-keyed; a fresh unrelated UUID is not assumed.

The documented synchronous `200`/`201` and body-less `204` outcomes do not justify
a blanket missing-HTTP-headers gate. A group or policy creation without an
identifiable result still stops, and async/operation bodies are not treated as
completion. For a `204` group-rule creation, the known new group's complete GET
must identify exactly one previously absent resource with the exact settings
and destination-only scope; POST is never retried. A body-less group-rule GET
establishes empty configuration only when an independent complete tenant-rule
read agrees. Missing collections elsewhere are not treated as empty.

Empty membership requires agreement between fresh inventory across **all
environment types** and the live `ListEnvironmentsForUser` operation filtered by
`environmentGroupId`. The latter alone cannot prove tenant-wide absence because
its scope is the caller's visible environments. The live check requests at most
one matching environment; any returned environment makes the group nonempty.
Missing bodies, foreign membership, continuation or inconsistent counts fail
explicitly. This combined app-connector check was tested with mocked SDK responses,
not exercised against tenant inventory by the agent.

Specific unsupported settings, ambiguous scope, incomplete reads and unknown or
mismatched state remain blocked or incomplete, never a successful partial copy.
There is no shared-ACP substitute. Test resources are retained for review/manual
cleanup; the workflow does not delete them automatically.

Group management requires tenant administrator authority. Governance writes
require the actual caller's permission; Microsoft documents Power Platform
contributor/owner for service principals. The confirmation explains that reads do
not prove write authorization. No fictional permission-preflight endpoint or
read-success authorization shortcut is used. Actual connector authorization
errors remain visible and stop later writes.

### Confirmation, uncertain outcomes and recovery

Before any enabled write path, confirmation identifies the source/new destination,
all copied settings, independent ACP, preserved state, no membership/source
changes, and partial-resource recovery risk. Neither environment nor PDE
membership is copied or changed by cloning. Separately confirmed PDE transfers
use the independent movement workflow described above.

An operation journal follows the app's localStorage/local-change-event pattern.
It stores only operation/resource IDs, source/payload fingerprints and step
outcomes; it does **not** store policy payloads, names, credentials or raw errors.
Storage failure before write intent is durable blocks that write. This is
browser-local recovery, not a transactional or cross-device tenant journal.

Each non-idempotent step persists its intent before the request and its returned
ID before further work. Requests have a 60-second bound; a timed-out request may
still complete in the service. Unresolved creation IDs, async operation bodies,
authorization/network failures during writes and lost responses stop later
writes. Actual operation IDs are retained when exposed, but no unrelated lifecycle
operation endpoint is guessed or polled. There is no blind POST retry or
same-name adoption. An already started operation can only be reconciled by
recorded IDs; the UI also blocks a new copy while an unresolved local operation
is present.

**Reconcile known IDs (read only)** performs full read-back, without creation,
PATCH, assignment or deletion. A re-created preview must match the original
semantic plan/source fingerprint; its read timestamp may differ. Unknown
creation IDs, partial configuration or a changed source need manual admin
recovery. Returned IDs for group/rules/policy and actual step outcomes remain
visible, including invalid source-ID returns. No automatic cleanup is attempted;
policy deletion/unassignment and group-delete cascades are not established, so
atomic rollback is not promised.

A destination PPAC link is shown only after a fully verified outcome using the
actual returned group identity. Successful completion refreshes the board through
its existing race-protected refresh path. Refresh/external-return invalidation
still closes stale previews. No unverified destination link is fabricated.

### Required safe tenant verification

The authorized disposable PPAC check established Save versus Apply and fresh
read-back as described above; it did not run an app-originated end-to-end clone.
Before wider rollout, verify a user-confirmed copy through the app's actual
connector identity: complete source models, every module/input/action/connection-
type setting, new identities, destination-only assignment, both empty-membership
reads and unchanged source. Observe authorization failures and ambiguous transport
outcomes rather than assuming PPAC's interactive account and the app connector
have identical rights. Recovery remains read-only; cleanup needs separate explicit
authorization. Broader Model A cardinality is not enabled by this single-resource
test. Passing mocked tests or a successful CLI/build alone is not tenant proof.

## Inventory loading

Environments, environment groups and managed apps are independent inventory
queries and start together. Every collection must still finish pagination and
pass completeness/identity checks before the board is displayed. A failed
collection never becomes a successful partial board.

Search, filters, browse scope and selection reuse the mounted snapshot. Opening
app details reads only that environment's complete app inventory, not the
tenant-wide environments/groups again. Board effect reattachments (including
development StrictMode) share only the same board's unfinished ordinary read;
each subscriber can cancel independently. Once all subscribers leave, pagination
stops after the current SDK call; cancelling a subscriber does not cancel a
cloud request already submitted.

No new global tenant/account snapshot cache is introduced. Each mounted board
owns its loader; finished results/errors are released, and later ordinary
navigation reads use the existing bounded 60-second `runQuery` page cache.
Separate board loaders do not share pending work. **Refresh inventory** always
starts a fresh read of all three collections and bypasses both pending ordinary
work and the page cache. Transfer impact, membership checks and mutation safety
reads retain their existing fresh-read paths; move completion still updates
verified display membership without reloading the screen.

## Validation boundary

Automated clone tests use synthetic identities and mocked reads, never tenant mutations.
The existing authenticated deployed app was freshly reloaded and its inventory,
group selectors and ACP configuration reads were observed with real data. This
verified the incumbent read path only. Subsequently, the separately authorized
disposable PPAC test verified group-only Model A responses, response timestamp
metadata, Save/Apply persistence and an independent exclusive ACP on an empty
group. Only those test resources were written; no source or memberships changed.
Raw responses were inspected transiently, without committing tenant payloads.
The app-originated clone adapter, its combined live/inventory membership check,
all module combinations, caller permissions and real partial-failure recovery
remain tenant-unverified. Test resources remain for manual review/cleanup.
Review screenshots from the previous increments are explicitly synthetic UI
evidence, not deployed or authenticated tenant proof.

The third increment includes synthetic 10,000-app pagination regressions and
a browser scenario with 1,200 apps across 240 PDEs. Keyboard selection,
accessible preparation, empty-group drag/drop, mixed prepared/already-target/
failed outcomes, scrollable full impact, Escape focus recovery, mobile dialog
containment and external-return invalidation were exercised without tenant
requests. App search/cards and PDE indexes are memoized, search is deferred,
and offscreen cards use native content visibility without removing keyboard
controls. This reduces work but is not virtualization: the final isolated
synthetic measurement was approximately **9.7 seconds to ready and 3.4 seconds
from search input to result commit** on this host. Very large-board rendering
remains a measurable performance limitation, not proof of smooth tenant-scale
interaction. Browser locator timings include additional automation overhead.
