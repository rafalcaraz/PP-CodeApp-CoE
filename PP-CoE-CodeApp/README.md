# PP CoE Code App

The Power Apps **Code App** that powers the Power Platform Center of Excellence
inventory & governance console. React 19 + TypeScript + Vite + Fluent UI v9,
running inside the Power Apps player and reading tenant inventory live through the
**Power Platform for Admins V2** connector.

> 👉 For the product overview — what it does, why it exists, and how to install
> it from a release — see the [repository root README](../README.md).
> This file is the **developer** quick reference.

## Prerequisites

- Node.js (LTS) and npm
- [Power Platform CLI (`pac`)](https://learn.microsoft.com/power-platform/developer/cli/introduction)
  authenticated to a Dataverse environment with admin access
- A **Power Platform for Admins V2** connection in the target environment

## Setup

```powershell
npm install        # deps + auto-heal generated connectors (postinstall)
npm run dev        # dev server on :5173, opened through the Power Apps player
```

> `npm install` runs `scripts/fixup-generated-connectors.mjs` to repair the
> auto-generated connector clients under `src/generated/`. Never hand-edit that
> folder — see [`docs/connector-generator-fixup.md`](docs/connector-generator-fixup.md).

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server (`:5173`), accessed via the Power Apps player |
| `npm run build` | `tsc -b && vite build` (CI build mode — strictest type-check) |
| `npm run lint` | ESLint, including the feature-boundary rules |
| `npx tsc --noEmit` | Type-check only |
| `npm run test:run` | Vitest, single CI run |
| `npm test` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with coverage |
| `npm run e2e` | Playwright smoke tests (needs a deployed URL — see `tests/e2e/README.md`) |
| `npm run screenshots` | Refresh the docs screenshots in `docs/img/` |

## Project structure

The codebase is organized **vertically by feature**. Features may import from
`shared/*`, `generated/*`, `app/*`, and `featureFlags/*` — but never from a
sibling feature, and never past another feature's `index.ts`. ESLint and CI
enforce this.

```
src/
├── app/            # shell: router, providers, TopBar, SideNav
├── features/       # vertical slices (apps, flows, agents, environments,
│                   #   dashboards, security, queries, deep-inventory, zones, …)
├── shared/         # inventory-core (the query engine), deep-inventory catalog,
│                   #   ui, portal-actions, user-lookup, connector-catalog
├── generated/      # auto-generated connector clients — DO NOT hand-edit
└── featureFlags/   # cross-cutting feature flags
```

## Testing

Tests live next to the code they test (`*.test.ts` / `*.test.tsx`). Pure
functions in `shared/inventory-core/` must have unit tests; each feature view
should have at least one smoke test with a mocked data layer. Don't hit the real
`QueryResources` connector in tests — mock it with `vi.mock`. See
[`tests/TESTING.md`](tests/TESTING.md) for the full playbook and
[`tests/e2e/README.md`](tests/e2e/README.md) for Playwright/E2E specifics.

> Run `npm run build` before pushing test-heavy changes — `tsc -b` (project
> references, used in CI) is stricter than `tsc --noEmit`.

## Conventions

- **UI:** Fluent UI v9 only (`@fluentui/react-components` + `@fluentui/react-icons`). No v8, no other UI libs.
- **Styling:** `makeStyles` + `tokens`. No inline styles except one-off computed values.
- **Router:** `react-router-dom` v7 `HashRouter` (required inside the player iframe).
- **Async data:** every call returns `DataResult<T>`; surface errors via `<ErrorPane>`, loading via `<LoadingPane>`.
- **Caching:** `runQuery` already caches, throttles, and retries 429s. Use `forceFresh: true` to bypass; call `invalidateInventoryCache()` after any write.

See the [root agent guide](../.github/copilot-instructions.md) for the complete
architecture rules and per-task required reading.
