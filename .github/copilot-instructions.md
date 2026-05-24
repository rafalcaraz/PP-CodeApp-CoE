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
│  └─ settings/
├─ shared/
│  ├─ inventory-core/             # clause builders, executor, cache, ResourceType, DataResult
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
| Anything that calls `QueryResources` / writes a clause-builder query | `PP-CoE-CodeApp/docs/inventory-schema-samples.md` |
| Owner / creator / maker user resolution | `PP-CoE-CodeApp/docs/inventory-schema-samples.md#owner--creator-guid-resolution` |
| Portal-action buttons on detail pages | `PP-CoE-CodeApp/docs/portal-actions.md` |
| Environment-group rule renderers | `PP-CoE-CodeApp/docs/governance-rules-catalog.md` + `PP-CoE-CodeApp/docs/admin-payload-samples.md` |
| Admin-connector enrichment (per-record `Get_*` calls) | `PP-CoE-CodeApp/docs/admin-connector-inventory.md` + `admin-payload-samples.md` |
| The Copilot Studio assistant chat | `PP-CoE-CodeApp/docs/copilot-studio-integration.md` |
| Anything under `src/generated/` | `PP-CoE-CodeApp/docs/connector-generator-fixup.md` (the generator is auto-healed by `postinstall` — don't hand-edit) |
| Dashboards / KPI / chart tiles | `PP-CoE-CodeApp/src/features/dashboards/_components/TileView.tsx` is the entry point; chart tiles must stay `source: "builder"`, raw clauses only work with KPI/Table viz |

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

## Testing

- Unit tests live next to the code they test (`*.test.ts` / `*.test.tsx`).
- Pure functions in `shared/inventory-core/` (clause builders, sentinel helpers, `buildClausesFromSpec`) MUST have unit tests. They are the lowest-level seam — breaks here ripple through every feature.
- Each feature should have at least one smoke test per view: render with mocked data layer, assert it doesn't throw and renders the expected key elements.
- Use `vi.mock("../path/to/data")` to mock data calls — do NOT hit the real `QueryResources` connector in tests.

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
