# GitHub Copilot / AI agent instructions for PP-CodeApp-CoE

This repository is a Power Apps Code App (React 19 + TypeScript + Vite +
Fluent UI v9) that surfaces tenant-wide Power Platform inventory through the
Power Platform for Admins V2 connector's `QueryResources` API. The app is
packaged as a managed Power Platform solution (`PPCoECodeApp`) and shipped
via GitHub Releases.

Before making changes, read this file and the relevant docs under
`PP-CoE-CodeApp/docs/`.

---

## Architecture: feature-slice layout

The codebase is organized **vertically by feature**, not horizontally by
technical role.

```
PP-CoE-CodeApp/src/
├─ app/                           # shell only: App.tsx, router, providers, TopBar, SideNav
├─ features/
│  ├─ agents/                     # AgentsList, AgentDetail, data.ts, routes.tsx, index.ts
│  ├─ apps/
│  ├─ flows/
│  ├─ environments/
│  ├─ environment-groups/
│  ├─ dashboards/
│  ├─ zones/
│  ├─ security/                   # Comparator + Impact + DLP*
│  ├─ queries/
│  ├─ deep-inventory/             # tenant-scan UI (admin-apps fanout, filter + column builder)
│  └─ settings/
├─ shared/
│  ├─ inventory-core/             # clause builders, executor, cache, ResourceType, DataResult
│  ├─ deep-inventory/             # property catalog (curated + observed), source registry, runner
│  ├─ ui/                         # ResourceListPage, detail/*, Status, RawJsonAccordion, EnvironmentPicker
│  ├─ portal-actions/             # action registry + bar
│  ├─ copilot-chat/               # global floating MCS assistant
│  └─ user-lookup/                # UserChip + UserLookupProvider + useUserDisplay + userEnrichment
├─ featureFlags/                  # cross-cutting flags (FeatureFlagsProvider, useFeatureFlag)
└─ generated/                     # auto-generated connector clients — DO NOT HAND-EDIT
```

### Rules (enforced by ESLint and CI)

1. **Features may import from `shared/*`, `generated/*`, `app/*`, `featureFlags/*`, and their own folder.** They MUST NOT import from sibling features.
2. **`shared/*` may import from `generated/*` only.** It MUST NOT import from features (no circular dependencies).
3. **`generated/*` is a leaf.** It MUST NOT import from anything else in `src/`.
4. **Each `features/<x>/index.ts` is the public API.** Other code MUST NOT deep-import past `index.ts` (no `import "../features/agents/internal/Foo"`).

**Why these rules exist:** they scope the blast radius of any change.
A prompt like "add a column to Agents" should only touch
`features/agents/**`. If a Copilot edit reaches outside the slice, CI fails
and the diff is obvious in code review.

### When you're asked to work on area X

- Default to `features/<x>/`. Make all edits inside that folder.
- If the change needs new shared plumbing, add it to `shared/<category>/`
  and import from there — do not duplicate it in the feature.
- Never reach into a sibling feature. If two features need the same logic,
  move it to `shared/`.
- Never bypass a feature's `index.ts`.

### When you're adding a new feature

1. Create `src/features/<name>/` with `data.ts`, `<view files>.tsx`,
   `routes.tsx`, `index.ts`.
2. Export the `<Route>` elements from `routes.tsx`, then re-export them
   from `index.ts`.
3. Import the feature's routes into `src/app/App.tsx`.
4. Add at least one smoke test (`<name>.test.tsx`) under the feature.

---

## Required reading per task type

| If you're touching… | Read first |
|---|---|
| **Adding or modifying any tests** | `PP-CoE-CodeApp/tests/TESTING.md` (decision tree + patterns) and `PP-CoE-CodeApp/tests/coverage-gaps.md` (what's untested) |
| Anything that calls `QueryResources` / writes a clause-builder query | `PP-CoE-CodeApp/docs/inventory-schema-samples.md` |
| Owner / creator / maker user resolution | `PP-CoE-CodeApp/docs/inventory-schema-samples.md#owner--creator-guid-resolution` |
| Portal-action buttons on detail pages | `PP-CoE-CodeApp/docs/portal-actions.md` |
| Environment-group rule renderers | `PP-CoE-CodeApp/docs/governance-rules-catalog.md` + `PP-CoE-CodeApp/docs/admin-payload-samples.md` |
| Admin-connector enrichment (per-record `Get_*` calls) | `PP-CoE-CodeApp/docs/admin-connector-inventory.md` + `admin-payload-samples.md` |
| **Tenant scans** (deep-inventory fanout across envs — `embeddedApp.type`, `usesPremiumApi`, etc.) | `PP-CoE-CodeApp/src/shared/deep-inventory/index.ts` is the public barrel; curated properties live in `catalog/curated.<source>.ts`. The runner streams events; the UI is `features/deep-inventory/DeepScanView.tsx`. Adding a queryable property = appending one entry to the curated registry (one-line change). |
| The Copilot Studio assistant chat | `PP-CoE-CodeApp/docs/copilot-studio-integration.md` |
| Anything under `src/generated/` | `PP-CoE-CodeApp/docs/connector-generator-fixup.md` (the generator is auto-healed by `postinstall` — don't hand-edit) |
| Dashboards / KPI / chart tiles | `PP-CoE-CodeApp/src/features/dashboards/_components/TileView.tsx` is the entry point; chart tiles must stay `source: "builder"`, raw clauses only work with KPI/Table viz |
| **E2E tests / Playwright / browser automation** | `PP-CoE-CodeApp/tests/e2e/README.md` (auth flow, iframe gotchas, deployed-URL recommendation) |
| **Capturing fixtures from real connector responses** | `PP-CoE-CodeApp/scripts/anonymize-fixtures.mjs` + the existing fixtures under `PP-CoE-CodeApp/src/test/fixtures/` (anonymize before committing — real tenant data NEVER lands in `src/test/fixtures/`) |

---

## Working efficiently (cost-aware patterns)

These habits keep sessions short and context windows lean. Prior session-history analysis showed sessions routinely hitting 30-40 turns without compaction and large inline pastes dragging through every subsequent turn.

### Tool selection

Use the **built-in** Copilot CLI tools instead of shelling out to PowerShell — they return cleaner, smaller output:

| Goal | ✅ Use this | ❌ Not this |
|---|---|---|
| List files matching a pattern | `glob "**/*.ts"` | `Get-ChildItem -Recurse -Include *.ts \| Where-Object ...` |
| Search file contents | `grep` with a `glob` filter | `Get-Content $f \| Select-String "pattern"` |
| Read a file | `view` (with `view_range` for large files) | `Get-Content $f` |
| Inspect a directory | `view` on a folder path | `Get-ChildItem \| Format-Table` |

PowerShell is fine for things only it can do (process management, registry, `Invoke-WebRequest`). For file/text operations, the built-ins are faster, cheaper, and produce output that's easier to parse next turn.

### Big inputs as files, not pastes

If the user shares a large blob (a JSON capture, a log dump, a security report), **suggest saving it to disk first**:

- Anonymized fixtures: `PP-CoE-CodeApp/src/test/fixtures/<name>.json`
- Raw captures (gitignored): `PP-CoE-CodeApp/docs/fixtures-raw/<name>.json`
- One-off scratch: `~/.copilot/session-state/<session-id>/files/`

Then reference by path: *"based on `docs/fixtures-raw/foo.json` …"*. Inline pastes get carried through every later turn; file references get read on demand.

### Delegate heavy reading

If you need to understand a 400+ line file (or a cross-module flow) **purely for context** — not to edit — use the `task` tool with `agent_type: explore`. It runs in a separate context and returns only a summary. Examples that should delegate:

- "How is DLP coverage computed end-to-end?"
- "Trace where AgentRow gets built from the QueryResources envelope"
- "Find every component that uses `EnvironmentPicker` and how they wire it"

Inline file reads are correct when you intend to edit; delegate when you only need to learn.

### Compact at natural breakpoints

After committing a meaningful chunk of work (a feature, a phase of tests, a refactor pass), suggest the user run `/compact` before continuing. Sessions over ~25 turns without compaction carry a noticeable per-turn cost; mid-session compaction is much cheaper than continuing to drag the full history.

---

## Conventions

- **UI**: Fluent UI v9 (`@fluentui/react-components`, `@fluentui/react-icons`). Do not introduce v8 imports or other UI libraries.
- **Styling**: `makeStyles` + `tokens` from Fluent. No inline `style={...}` except for one-off computed values (chart sizing, etc.).
- **Router**: `react-router-dom` v7 `HashRouter` — required because the app runs inside the Power Apps player iframe.
- **State**: local component state + `useMemo`/`useCallback`. No Redux, no Zustand, no context proliferation. The user-lookup provider and the feature-flags provider are the only app-wide contexts.
- **Async data**: every inventory call returns `DataResult<T> = { ok: true; data } | { ok: false; error }`. Surface errors via `<ErrorPane>`. Use `LoadingPane` while loading.
- **Caching**: `runQuery` already has an LRU cache + throttling + 429 retry. Use `RunQueryOpts.cacheTtlMs` to opt into longer TTLs (e.g. `DASHBOARD_CACHE_TTL_MS`); use `forceFresh: true` to bypass. Call `invalidateInventoryCache()` after any write.
- **Pagination**: the `QueryResources` connector is unreliable about `SkipToken` — always send both `SkipToken` AND `Skip=rowsLoaded`. Treat `skipToken` as authoritative, `totalRecords` as approximate. See `shared/inventory-core/`.
- **Owner / creator GUIDs**: can resolve to member users, guests, deleted accounts, service principals, or managed identities. An `aaduser` miss is NOT "deleted user". See `inventory-schema-samples.md`.
- **Copilot Studio agents**: filter out `msdyn_*` schemaName to exclude first-party Dynamics agents, or counts inflate 10–20×.
- **Agent row keys**: `AgentRow.id` is the bot GUID and is NOT tenant-unique (same solution deployed to multiple envs reuses the botId). Always key React lists by `${environmentId}::${id}`.

## Commands

Run from `PP-CoE-CodeApp/`:

```
npm install          # install deps + auto-heal generated connectors via postinstall
npm run lint         # ESLint
npx tsc --noEmit     # type-check (also runs as part of npm run build)
npm run build        # tsc -b && vite build (Vite warns about 1.5 MB bundle; expected)
npm test             # Vitest in watch mode
npm run test:run     # Vitest single run (CI mode)
npm run dev          # local dev server on :5173, accessed via Power Apps player
```

CI runs lint + typecheck + build + tests on every push/PR via
`.github/workflows/ppcoecodeapp-ci.yml`.

### Session start: install deps in the background if missing

Worktrees start without `node_modules`. Running `npx`, `npm test`, or
`npm run build` before install completes hangs silently (especially
`npx vitest run` — it goes into a no-output resolution loop that looks
indistinguishable from a stuck test). Real-world cost of getting this
wrong has been 5–10 minutes per session.

**The right pattern on session start:**

1. Check once: `Test-Path PP-CoE-CodeApp/node_modules`.
2. If missing, kick off `npm ci` (preferred over `npm install` —
   uses the lockfile, doesn't mutate it) in the **background** with
   `mode: "async"` from the `PP-CoE-CodeApp/` directory, then continue
   with planning / exploration / file reads in parallel.
3. By the time you need the first `npm`-backed command (test, lint,
   build), install will be done or nearly done — wait on it then.

**If you forget step 1** and a command hangs with zero output for
more than ~30 seconds, abort it immediately and check
`Test-Path node_modules` + `Get-Command npx`. Do not poll a silent
command for minutes — the failure mode is silent stall, not slow
progress.

The `postinstall` hook (`scripts/fixup-generated-connectors.mjs`) is
idempotent and cheap (~200ms); running install in an already-installed
worktree is a no-op-with-overhead but never harmful.

## Testing

- Unit tests live next to the code they test (`*.test.ts` / `*.test.tsx`).
- Pure functions in `shared/inventory-core/` (clause builders, sentinel helpers, `buildClausesFromSpec`) MUST have unit tests. They are the lowest-level seam — breaks here ripple through every feature.
- Each feature should have at least one smoke test per view: render with mocked data layer, assert it doesn't throw and renders the expected key elements.
- Use `vi.mock("../path/to/data")` to mock data calls — do NOT hit the real `QueryResources` connector in tests.
- For the full testing playbook (decision tree, four test categories, `vi.hoisted` pattern, golden-oracle pattern, common gotchas), see `PP-CoE-CodeApp/tests/TESTING.md`.
- **Always run `npm run build` before pushing test-heavy changes.** `tsc -b` (project-references build mode, used in CI) is stricter than `npx tsc --noEmit` and catches type errors in test files that `--noEmit` skips (most commonly: `as TargetType` casts that need `as unknown as TargetType`, and spread-with-defaults that produce duplicate-key warnings).
- E2E (Playwright) tests need a deployed app URL to work reliably — the local-dev player wrapper has cross-origin iframe limitations. See `PP-CoE-CodeApp/tests/e2e/README.md`.

### Scope test runs to the files you changed (default; full suite on request only)

Full `npm run test:run` runs all ~370 tests in 70–90 seconds. Scoped
runs against the files you actually changed run in 5–10 seconds.
Default to scoped; the user runs the full suite themselves or
explicitly asks for one.

**Default workflow when making changes:**

1. Identify which test files exercise the code you changed (the
   sibling `<file>.test.ts(x)` and any cross-cutting tests under
   `src/test/` for shared modules).
2. Run only those: `npm run test:run -- src/data/foo.test.ts src/features/bar/Baz.test.tsx`.
3. Iterate until green.
4. **Promote to full suite only when** (a) you changed something
   cross-cutting (e.g. `inventory.ts`, `shared/` modules, anything
   re-exported through a feature's `index.ts`), (b) the user
   explicitly asks for a full run, or (c) you're about to commit a
   refactor that touches many files. Otherwise, trust CI to catch the
   long-tail.
5. Always run `npm run lint` and `npx tsc --noEmit` regardless of
   scoping — both are cheap (<30s combined) and catch the
   highest-leverage breakage class (imports, types, hook rules).

This trades a tiny bit of paranoia (a regression in an unrelated
file slipping through to CI) for meaningful iteration-loop speed. CI
is the safety net for the unscoped suite; local runs are for
confirming the change you just made works.

## What NOT to do

- ❌ Do not hand-edit anything under `src/generated/`. It's overwritten by `scripts/fixup-generated-connectors.mjs` on every `npm install`.
- ❌ Do not introduce new global state (Redux, Zustand, MobX, etc.).
- ❌ Do not introduce new HTTP clients. All data goes through `PowerPlatformforAdminsV2Service` in `src/generated/` or `runQuery` in `shared/inventory-core/`.
- ❌ Do not import across sibling features (`features/agents` → `features/apps` is forbidden).
- ❌ Do not bypass a feature's `index.ts` with deep imports.
- ❌ Do not commit secrets, tokens, connection IDs, or environment IDs into source. Connection IDs in `power.config.json` are environment-specific placeholders — the user fills them in locally.
- ❌ Do not modify `.github/workflows/release.yml` without explicit user direction. Releases are manual dispatch.

## Co-authored-by

Commits made by Copilot agents should include:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
