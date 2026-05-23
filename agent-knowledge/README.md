# agent-knowledge

> **What this folder is.** The knowledge pack that grounds the
> Microsoft Copilot Studio agent (`msftcsa_PPCoEAgent`) embedded in
> the PP-CoE Code App. Every file in this folder is uploaded as a
> **knowledge source** in Copilot Studio. The agent's job is to turn
> natural-language CoE / Power Platform inventory questions into a
> **raw `Clauses[]` JSON array** that pastes directly into the
> app's **Queries → Advanced** tab and runs without further
> conversion.

## Not part of the app

This folder is **not** read at runtime by the React code app, **not**
packed into the Power Platform solution zip, and **not** referenced by
any build step. It only exists so the grounding pack is version-
controlled and reviewable. Treat it like documentation: PRs welcome,
breaking the build is impossible.

## File format — plain text, NOT markdown

The 8 knowledge files are pure ASCII plain text. **No markdown
formatting at all** — no `#` headings, no `**bold**`, no
backticks, no fenced code blocks, no `|` tables, no `__` or
`==` outside of JSON literals where KQL requires them.

This is intentional. Copilot Studio's knowledge ingestion
parses file content as markdown when chunking, which mangles
constructs like `__connectorBag` (interpreted as bold-marker
start) and `==text==` (highlight syntax in some flavors). By
keeping the source files free of markdown, the agent sees the
exact identifiers, operators, and JSON structures we intend.

JSON examples inside the files are raw JSON (no fences) since
JSON syntax does not overlap with markdown.

## Files in this pack (upload all 8 knowledge files)

| File | Purpose | Audience |
|---|---|---|
| `01-agent-role-and-output.txt` | Agent persona + **`Clauses[]` JSON contract** + 6 hard rules + 3 canonical examples | Agent (must read first) |
| `02-resource-types.txt` | The 10 `microsoft.*/...` types — what each is, when to query it | Agent |
| `03-fields-reference.txt` | Every common field path: type, enum domain, **which resource type(s) it lives on**, common ops, **🔶 polymorphic-field callouts**, **🚫 what's NOT in the inventory** | Agent |
| `04-operators.txt` | The KQL operators inside `where` clauses + value-quoting rules + the `notLastNdays` workaround | Agent |
| `05-sentinel-fields.txt` | The `extend __connectorBag` + `where __connectorBag has` pattern for connector / operation filters | Agent |
| `06-connectors-catalog.txt` | Friendly name → connector ID table | Agent |
| `07-recipes.txt` | Natural language → `Clauses[]` worked examples (27 recipes incl. cross-resource two-step) | Agent (most weight) |
| `08-tricks-and-gotchas.txt` | ARG / KQL / schema idiosyncrasies that bite | Agent |

## System instructions (also in this folder)

| File | Purpose |
|---|---|
| `copilot-studio-instructions.txt` | The **system instructions** to paste into Copilot Studio → **Overview** → **Instructions**. Defines persona, capability map, refinement guardrails, and forbidden behaviors. Not uploaded as a knowledge file — it's the agent's system prompt. |

## How to upload to Copilot Studio

1. Open Copilot Studio → your agent (`msftcsa_PPCoEAgent`).
2. Go to **Knowledge** → **Add knowledge** → **Files**.
3. Upload **all 8** `.txt` knowledge files (skip `README.md` and
   `copilot-studio-instructions.txt`).
4. Wait for indexing to finish (a few minutes for small files).
5. In **Overview** → **Instructions**, paste the entire contents
   of `copilot-studio-instructions.txt`.
6. **Publish** the agent.
7. Test with recipes from `07-recipes.txt` — the JSON the agent
   emits should paste **directly** into the app's **Queries →
   Advanced** tab and run.

## When to refresh

Re-upload the affected file whenever:

- `src/data/inventory.ts` adds/removes a field in
  `COMMON_FIELD_SUGGESTIONS`, a resource type in `ALL_RESOURCE_TYPES`,
  a connector in `KNOWN_CONNECTORS`, an operator in the where-clause
  catalog (`04-operators.txt`),
  or a sentinel field
- The schema doc (`PP-CoE-CodeApp/docs/inventory-schema-samples.md`)
  documents a new field shape or value domain
- You discover a new common CoE question worth turning into a recipe

## The contract with the app (in one sentence)

The agent emits a fenced ` ```json ` block containing a **raw
`Clauses[]` JSON array** — each element is an object with a `$type`
discriminator (`where` / `extend` / `orderby` / `project` /
`summarize` / `take` / `distinct` / `count` / `join`) that the
app's `runRawQuery` function (`src/data/inventory.ts`) hands
straight to the `QueryResources` connector. The user copies the
array, pastes it into **Queries → Advanced**, and clicks **Run
query**. **The agent never sees results, never executes anything,
and never sees data** — this isolation is intentional and removes
any risk of token-blowup from large inventory dumps.
