# 04 — Operators

The full set of operators allowed in a `QueryFilter`. Pick the
**most specific** one that fits the intent.

## Operator catalog

| Op | KQL it produces | What it means | Value format |
|---|---|---|---|
| `==` | `==` | exact equality | a single string; booleans as `"true"`/`"false"`; numbers as `"30"` |
| `!=` | `!=` | not equal | same |
| `>` | `>` | greater than | single string; ISO date for datetime fields, number string for numeric |
| `<` | `<` | less than | same |
| `>=` | `>=` | gte | same |
| `<=` | `<=` | lte | same |
| `contains` | `contains` | case-insensitive substring | single string |
| `startswith` | `startswith` | case-insensitive prefix | single string |
| `endswith` | `endswith` | case-insensitive suffix | single string |
| `in~` | `in~` | case-insensitive membership in a list | **comma-separated** values, e.g. `"Production,Sandbox"` |
| `has` | `has` | tokenised substring (word-boundary aware) | single string |
| `has_any` | `has_any` | any token from a list matches | **comma-separated** values |
| `lastNdays` | `> ago(Nd)` | datetime in the last N days | integer string like `"30"` (do NOT include a date) |

## Value formatting (the app handles all of this for you)

`value` is **always a string**. The clause builder does the right
quoting downstream:

- `"true"` / `"false"` → emitted as KQL booleans (unquoted)
- `"30"` (number-like) → emitted as KQL numbers (unquoted)
- `"ago(30d)"` would be passed through literally — but **don't write
  `ago(...)` yourself**; use the `lastNdays` op which constructs it
- Everything else → emitted as single-quoted KQL strings, embedded
  quotes doubled

## When to pick which operator

| Intent | Best op |
|---|---|
| Exact match on a known enum value (e.g. `status == "Suspended"`) | `==` |
| Match one of several enum values (e.g. `environmentType in (Production, Sandbox)`) | `in~` |
| Substring match (e.g. `displayName contains "finance"`) | `contains` |
| Prefix / suffix (`displayName startswith "Test_"`) | `startswith` / `endswith` |
| "Within the last N days" | `lastNdays` |
| Connector-name filter | use the **`__connector` sentinel** with `==` (`has`) or `in~` (`has_any`) |
| Polymorphic owner/creator GUID match | `contains` (see `03-fields-reference.md` 🔶 callouts) |
| Boolean | `==` with value `"true"` / `"false"` |

## ⚠️ Important: there is NO inverse of `lastNdays`

There is **no** `notLastNdays` or `olderThanNdays` operator. This is
a real product gap. When the user asks for things like:

- "apps not modified in the last 90 days"
- "abandoned apps"
- "agents that haven't been published recently"
- "flows that haven't run in 6 months"

You have **two correct paths**:

### Path A — ask the user for an absolute cutoff date (PREFERRED)

```
You're looking for resources older than a certain date. The
QuerySpec contract has no "olderThanNdays" operator. What ISO 8601
cutoff date should I use? (e.g. "2024-11-22T00:00:00Z" for ~6
months ago — I can't compute today's date myself, so the user has
to choose.)
```

Once they answer, emit a spec with `op: "<"` and `value: <their date>`.

### Path B — explain and provide an example

If you must produce a spec, **make it explicit that the date came
from the user, not from you**, and warn that the date may be stale:

```jsonc
{
  "filters": [
    {
      "field": "properties.lastModifiedAt",
      "op": "<",
      "value": "2024-11-22T00:00:00Z"
    }
  ]
}
```

**Never invent the date yourself.** You do not know today's date and
absolute dates you choose will be wrong.

## Multiple filters are AND-ed

Every entry in `filters[]` becomes a separate `where` clause, and
consecutive `where` clauses in ARG are conjunctive. So:

```json
"filters": [
  { "field": "__connector", "op": "==", "value": "shared_office365" },
  { "field": "__connector", "op": "==", "value": "shared_sql" }
]
```

…matches resources whose `__connectorBag` contains **BOTH** Office 365
Outlook **AND** SQL Server. This is the correct way to express "uses
both X and Y" (see recipe 7.7).

To express OR (uses X **or** Y), use a single `in~` / `has_any` filter:

```json
"filters": [
  { "field": "__connector", "op": "in~", "value": "shared_office365,shared_sql" }
]
```

There is **no** OR composition across separate filters.
