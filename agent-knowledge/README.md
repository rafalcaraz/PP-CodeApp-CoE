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

## File format — `.txt` (written as markdown)

The 8 knowledge files are saved with a `.txt` extension because that
is the format Copilot Studio's file-knowledge upload accepts most
reliably. The **content is markdown** (headings, tables, fenced code
blocks) and renders fine in any editor that handles markdown.

## Files in this pack (upload all 8)

| File | Purpose | Audience |
|---|---|---|
| `01-agent-role-and-output.txt` | Agent persona + **`Clauses[]` JSON contract** + 5 hard rules + 3 canonical examples | Agent (must read first) |
| `02-resource-types.txt` | The 10 `microsoft.*/...` types — what each is, when to query it | Agent |
| `03-fields-reference.txt` | Every common field path: type, enum domain, **which resource type(s) it lives on**, common ops, **🔶 polymorphic-field callouts** | Agent |
| `04-operators.txt` | The KQL operators inside `where` clauses + value-quoting rules + the `notLastNdays` workaround | Agent |
| `05-sentinel-fields.txt` | The `extend __connectorBag` + `where __connectorBag has` pattern for connector / operation filters | Agent |
| `06-connectors-catalog.txt` | Friendly name → connector ID table | Agent |
| `07-recipes.txt` | Natural language → `Clauses[]` worked examples (27 recipes incl. cross-resource two-step) | Agent (most weight) |
| `08-tricks-and-gotchas.txt` | ARG / KQL / schema idiosyncrasies that bite | Agent |

## How to upload to Copilot Studio

1. Open Copilot Studio → your agent (`msftcsa_PPCoEAgent`).
2. Go to **Knowledge** → **Add knowledge** → **Files**.
3. Upload **all 8** `.txt` files (skip this `README.md`).
4. Wait for indexing to finish (a few minutes for small files).
5. In **Overview** → **Instructions**, paste the agent system
   instructions (see `01-agent-role-and-output.txt` § "Agent system
   instructions" — or use the dedicated drop-in block kept outside
   this folder).
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
