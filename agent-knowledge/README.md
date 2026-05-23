# agent-knowledge

> **What this folder is.** The knowledge pack that grounds the
> Microsoft Copilot Studio agent (`msftcsa_PPCoEAgent`) embedded in
> the PP-CoE Code App. Every file in this folder is meant to be
> uploaded as a **knowledge source** in Copilot Studio. The agent's
> only job is to turn natural-language CoE / Power Platform inventory
> questions into validated **`QuerySpec` JSON** that the React app
> consumes (see `01-agent-role-and-output.txt`).

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
blocks) and renders fine in any editor that handles markdown. If you
want to preview them with proper formatting, point your editor at the
file and choose markdown rendering — the extension is the only thing
that's plain-text.

## Files in this pack (upload all of them)

| File | Purpose | Audience |
|---|---|---|
| `01-agent-role-and-output.txt` | Agent persona, output contract (`QuerySpec` JSON), hard rules (no clock, no execution, ask when unsure), 3 canonical examples | Agent (must read first) |
| `02-resource-types.txt` | The 10 `microsoft.*/...` types — what each is, when to query it | Agent |
| `03-fields-reference.txt` | Every common field path: type, enum domain, **which resource type(s) it lives on**, common ops, **🔶 polymorphic-field callouts** | Agent |
| `04-operators.txt` | The 13 operators: semantics, value formatting, **the missing `notLastNdays` workaround** | Agent |
| `05-sentinel-fields.txt` | `__connector` and `__operation` — when to prefer over raw paths | Agent |
| `06-connectors-catalog.txt` | Friendly name → connector ID table (SharePoint → `shared_sharepointonline`, etc.) | Agent |
| `07-recipes.txt` | Natural language → `QuerySpec` worked examples, including cross-resource two-step patterns and out-of-scope answers | Agent (most weight) |
| `08-tricks-and-gotchas.txt` | KQL idiosyncrasies + lessons learned that aren't obvious from the field list | Agent |

## How to upload to Copilot Studio

1. Open Copilot Studio → your agent (`msftcsa_PPCoEAgent`).
2. Go to **Knowledge** → **Add knowledge** → **Files**.
3. Upload **all 8** files in this folder (skip this `README.md`).
4. Wait for indexing to finish (a few minutes for small files).
5. In **Overview** → **Instructions**, paste the contents of
   `01-agent-role-and-output.txt` (the "Agent system instructions"
   section) as the agent's system prompt.
6. **Publish** the agent.
7. Test with the recipes from `07-recipes.txt` (the answers in there
   should match what the agent emits).

## When to refresh

Re-upload the affected file whenever:

- `src/data/inventory.ts` adds/removes a field in
  `COMMON_FIELD_SUGGESTIONS`, a resource type in `ALL_RESOURCE_TYPES`,
  a connector in `KNOWN_CONNECTORS`, an operator in `QueryFilterOp`,
  or a sentinel field
- The schema doc (`PP-CoE-CodeApp/docs/inventory-schema-samples.md`)
  documents a new field shape or value domain
- You discover a new common CoE question worth turning into a recipe

A future `scripts/generate-agent-knowledge.mjs` will regenerate the
data-driven files (02, 03, 04, 06) from `inventory.ts` so they never
drift. For now they're maintained by hand.

## The contract with the app (in one sentence)

The agent emits a fenced ` ```json ` block containing one `QuerySpec`
object. The React app reads `reply.parsed` (see
`src/services/copilotStudio.ts`), validates the shape, and either
deep-links to `/queries?spec=<base64>` or shows a "Paste into Queries"
button. **The agent never sees results, never executes anything, and
never sees data.** This isolation is intentional — it removes any
risk of token-blowup from large inventory dumps.
