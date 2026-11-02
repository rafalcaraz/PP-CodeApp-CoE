# Queries investigation workspace

Queries is a local-first investigation tool. The library is searchable,
collapsible, and supports favorites. Nothing in this workflow provisions
Dataverse tables, changes tenant permissions, or schedules background exports.

## Drafts, executions, and navigation

Basic and Advanced are separate drafts. The first switch to Advanced seeds it
from Basic; later switches retain each draft, including invalid Advanced text.
Use **Replace Advanced with current Basic clauses** to intentionally replace
Advanced. Loading a template or a saved query starts that query's draft.

Every result set belongs to immutable executed clauses and request options.
Changing filters, scope, mode, page size, or the loaded query marks the results
**Query changed - run again**. Old results remain useful to inspect, but cannot
be continued or exported using the edited draft. Late responses from superseded
requests or from a page that has been left are ignored.

The draft, loaded saved-query identity, mode, library settings, CSV mode, and
selected columns are kept in `sessionStorage` for this tab. Results and
continuation state remain in JavaScript memory only, so returning from a
resource detail page restores them without writing tenant records to durable
browser storage. A full reload can restore the draft, but requires another run
to fetch results. Invalid/older workspace data opens a fresh draft with a
warning and does not change saved queries.

## Filters and dates

The Basic condition builder has a **Root group** and one level of subgroups.
Choose **Match all (AND)** or **Match any (OR)** for each group. Conditions in
a subgroup stay together; the readable condition summary includes explicit
parentheses. Resource types always constrain the entire condition tree,
regardless of the root operator.

For example:

```text
Canvas apps AND (
  Environment ID equals Production-ID
  AND (Is quarantined equals true OR Is managed equals false)
)
```

This includes only Production resources that are quarantined or explicitly
unmanaged. Missing/null `isManaged` is not false and does not satisfy the
second branch on its own. Use two Match all subgroups beneath a Match any
root to express `(A AND B) OR (C AND D)`.

**Add condition** adds to the chosen group. **Add group** is available at the
root only. Empty subgroups and an empty Match any root are invalid; Run,
Save, and clause copying stay disabled until they are repaired or removed.
An empty Match all root means no conditions beyond the resource-type scope.
Single-condition groups are valid. Imported structures deeper than one
subgroup level are rejected explicitly, never flattened.

Old saved `filters` arrays are displayed as a Match all root without changing
their stored form. Editing the tree stores a typed `conditions` expression
and clears the legacy array. A spec cannot contain competing nonempty flat
filters and grouped conditions.

Field suggestions use the inventory field catalog and selected resource types.
Operators and inputs follow field kinds; unknown field paths remain available
as an escape hatch. Incomplete filters are errors, never silently omitted.
Boolean values are explicit true/false; missing data is not displayed as false.
Catalog suggestions are a union for mixed scopes: a field may not be reported
on all selected types. Legacy array-emptiness semantics treat a missing array
as empty. Empty-array filters do not require a value.

Known operators lower to genuine parenthesized KQL expressions inside the
connector's `Clause[]` contract. Grouping is not implemented by chaining
unrelated `where` clauses. **Copy clauses JSON** is the runnable connector
payload: paste it into Advanced or another compatible clause editor to
preserve the same grouping. **Copy reusable query JSON** is a separate
builder envelope that also retains editable groups and relative presets.
Unsupported legacy operators inside a grouped tree produce a visible
validation error rather than approximate grouping; raw Advanced clauses
remain the escape hatch.

| Date choice | Meaning |
|---|---|
| Last X days (rolling) | Strictly after X complete 24-hour durations before the run's reference time; positive whole days; lower bound only, so future timestamps also match |
| Today (UTC) | Current UTC midnight inclusive through next UTC midnight exclusive |
| Yesterday (UTC) | Previous UTC midnight inclusive through current UTC midnight exclusive |
| On date (UTC) | Selected UTC midnight inclusive through next midnight exclusive |
| Date range (UTC) | Start date inclusive through midnight after the selected end date exclusive |
| Before/after timestamp | Explicit ISO date/time with `Z` or an offset, e.g. `2026-03-08T01:30:00-08:00` |

UTC is deliberately visible in calendar labels. These are not the viewer's
local calendar days, and daylight saving does not shorten or lengthen them.
Basic run execution fixes a reference time for relative predicates so paging
cannot cross into a different date window. Saving preserves the relative
`QuerySpec`, not a date calculated when Save was clicked. Rerunning recomputes
the window. Builder dashboard tiles also recompute relative predicates when
they execute. Raw clauses preserve their own KQL expressions and backend
evaluation semantics; arbitrary raw `now()` expressions are not rewritten.

## Connector and operation evidence

Independent **Connector** and **Operation** fields retain raw clause
compatibility. Independent matches may be reported by different connector
entries on the same resource. They do not prove a connector/operation pair.

For an Operation filter, set **Within connector** to require operation evidence
from that connector specifically. Matching normalizes ARM paths, case, and the
optional `shared_` prefix, and uses the same shared evidence reader as the
Connectors feature. Reported actions and trigger operations are distinguished
from reference-only connector declarations. None of these are runtime execution
or audit-log evidence.

A connector and its paired operation remain one atomic condition, including
inside OR groups. An OR sibling cannot cause an operation reported on another
connector to become a matching pair. Candidate filtering must remain a
superset of the complete expression: it must not incorrectly require every
ordinary branch when the group says Match any.

The clause API cannot expand nested connector/operation pairs. Paired Queries
therefore drain the complete candidate query before exact client-side matching.
Failed or safety-limited scans never display candidate rows as confirmed
matches. They keep any previous investigation results and show an error.
Paired specs can be saved and shared with **Copy reusable query JSON**.
Advanced/raw-clause conversion and raw dashboard conversion cannot express the
pairing and are blocked rather than returning misleading cross-connector
matches or a false zero. Dashboard support for such specs explicitly reports
the unsupported paired execution path.

Ordinary non-paired groups retain their expression in dashboard snapshots and
server-side aggregates. The dashboard tile editor preserves grouped saved
queries rather than flattening them into its legacy flat-filter editor.
Exact paired groups still require the complete Queries client-filtered scan
and are explicitly unsupported in dashboard execution.

## Results and CSV

Inventory columns are selectable from the same catalog, with type-aware
defaults for owner, environment, dates, status, and declared connectors.
Friendly names use existing environment/identity facilities without replacing
IDs. Inspect raw rows to copy original JSON and resource IDs. Only complete
resource identities create detail links. Project, summarize, count, and
identity-less outputs instead use columns discovered from their returned shape.

**Export loaded** exports only fetched rows. **Export complete result** follows
continuation tokens until the connector reports no continuation. Every request
uses both the token and cumulative offset; approximate totals are informational.
Repeated/cyclic tokens and no-progress pages stop with an incomplete warning.
Export also stops at a 200-page safety limit per attempt.

Request failures, cancellation, and safety-limit stops do not automatically
download an incomplete file. Fetched rows are retained and an explicit
**Download partial CSV** choice is offered. A retry can resume from a valid
retained token. A connector paging anomaly requires rerunning.

CSV can contain the displayed field paths or all flattened raw fields. It
always preserves original values/IDs, not resolved display names; the filename
identifies `loaded`, `all`, or `partial`. The same choice applies to complete
and partial exports. Clipboard and persistence failures are visible.

## Saving and sharing

Loading a saved query retains its identity while editing and shows unsaved
changes. **Update existing** changes its query content without changing its ID;
**Save as new** creates another query. Rename/description edits and favorites
are independent. Existing `ppcoe.savedQueries.v1` entries remain compatible;
malformed storage is not silently overwritten. Failed writes never claim
success or close the Save dialog.

**Copy reusable query JSON** includes the builder spec, source, clauses, and
page size. Import accepts that envelope, legacy raw `Clause[]`, or
`{ "clauses": [...] }`. Reusable builder JSON retains relative dates and
connector pairing. Raw clauses remain compatible, but cannot encode exact
client-side pairing. Existing dashboard tiles own their own query snapshots;
updating or deleting a saved library entry does not mutate those snapshots.
