# Testing — framework & playbook

This is the **how** for adding new tests to the PP CoE Code App. For
the **what** (high-priority gaps), see [`coverage-gaps.md`](./coverage-gaps.md).

## TL;DR — Which kind of test do I write?

```
                                       ┌─────────────────────────────┐
                                       │   Is it a pure function?    │
                                       │  (no React, no I/O, just    │
                                       │   in → out)                 │
                                       └──┬──────────────────────┬───┘
                                          │ Yes                  │ No
                                          ▼                      ▼
                          ┌─────────────────────┐  ┌─────────────────────────┐
                          │ vitest unit test    │  │ Does it call the        │
                          │ next to the source  │  │ connector / Dataverse?  │
                          │ (foo.test.ts)       │  └──┬──────────────────┬───┘
                          └─────────────────────┘     │ Yes              │ No
                                                      ▼                  ▼
                                  ┌────────────────────────┐  ┌─────────────────────────┐
                                  │ vitest with mocked     │  │ Is it a React component │
                                  │ generated service      │  │ / view?                 │
                                  │ (vi.hoisted + vi.mock) │  └──┬──────────────────────┘
                                  └────────────────────────┘     │
                                                                 ▼
                                              ┌─────────────────────────────────────┐
                                              │ vitest smoke test with the data     │
                                              │ layer mocked + Fluent provider      │
                                              │ wrapped — assert it renders without │
                                              │ throwing                            │
                                              └─────────────────────────────────────┘

                          ┌─────────────────────────────────────────────────────────────┐
                          │ Cross-cutting flows (real connector, real auth) that vitest │
                          │ can't validate?  →  Playwright E2E (tests/e2e/)             │
                          └─────────────────────────────────────────────────────────────┘
```

## The four test categories

### 1. Pure unit tests (vitest, no mocks)

**When:** Pure data transforms, formatters, predicates, reducers, anything that takes input and returns output with no side effects.

**Where:** Sibling to the source file as `<name>.test.ts`.

**Examples:** `data/dlpDiff.test.ts`, `utils/csv.test.ts`, `components/detail/formatting.test.ts`.

**Pattern:**
```ts
import { describe, it, expect } from "vitest";
import { functionUnderTest } from "./module";

describe("functionUnderTest", () => {
  it("does the thing for the happy path", () => {
    expect(functionUnderTest(input)).toEqual(expected);
  });
  it("handles the edge case", () => { /* ... */ });
});
```

**Golden-oracle pattern** (when you have real captured behavior to validate against):
- Capture real output once (e.g. the `[DLP coverage] evaluation` console log)
- Save as anonymized fixture under `src/test/fixtures/`
- Reconstruct the input from the fixture
- Run the function under test on the reconstructed input
- Assert the output equals the fixture field-for-field

See `data/dlpPolicies.test.ts` (the `evaluateDlpCoverage` test) for the canonical example.

### 2. Data-layer tests with mocked generated services

**When:** Functions that call `PowerPlatformforAdminsV2Service.X()` or `AadusersService.Y()` from `src/generated/`.

**Where:** Sibling to source as `<name>.test.ts`.

**Examples:** `data/inventory.runQuery.test.ts`, `data/adminEnrichment.test.ts`, `data/userEnrichment.test.ts`.

**Critical pattern — use `vi.hoisted` for mocks:** vitest hoists `vi.mock(...)` factories above imports, so any variables the factory references must also be hoisted, otherwise you get `ReferenceError: Cannot access 'X' before initialization`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryResourcesMock } = vi.hoisted(() => ({
  queryResourcesMock: vi.fn(),
}));

vi.mock("../generated", () => ({
  PowerPlatformforAdminsV2Service: {
    QueryResources: queryResourcesMock,
  },
}));

// Import AFTER vi.mock so the mock is in place when inventory.ts loads.
import { listEnvironmentsPage, invalidateInventoryCache } from "./inventory";

beforeEach(() => {
  queryResourcesMock.mockReset();
  invalidateInventoryCache(); // module-level cache between tests
});

it("maps envelope to row", async () => {
  queryResourcesMock.mockResolvedValue({ success: true, data: envsFixture });
  const result = await listEnvironmentsPage();
  expect(result.ok).toBe(true);
  // ...
});
```

**Fixtures live in `src/test/fixtures/`** — anonymized real captures (see `scripts/anonymize-fixtures.mjs`). Tests import them as JSON.

### 3. View smoke tests (vitest + testing-library)

**When:** A React component that renders something. Goal: catch broken imports / prop renames / removed exports that compile cleanly but crash at runtime.

**Where:** Sibling to source as `<name>.test.tsx`.

**Examples:** `features/agents/AgentsList.test.tsx`, `features/apps/AppDetail.test.tsx`, `components/ResourceListPage.test.tsx`.

**Pattern:**
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

// Mock the feature's data layer.
vi.mock("../../features/apps/data", async () => {
  const actual = await vi.importActual<typeof import("../../features/apps/data")>(
    "../../features/apps/data",
  );
  return { ...actual, listAppsPage: vi.fn().mockResolvedValue({ ok: true, data: { rows: [...], skipToken: undefined, totalRecords: 1 } }) };
});

// Stub providers / chips that hit other layers.
vi.mock("../../components/EnvironmentPicker", () => ({
  EnvironmentPicker: () => <div data-testid="env-picker" />,
}));

// Import AFTER mocks.
import { AppsList } from "../../features/apps/AppsList";

function renderWithProviders() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/apps"]}>
        <Routes>
          <Route path="/apps" element={<AppsList />} />
        </Routes>
      </MemoryRouter>,
  );
}

describe("AppsList smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the mocked row", async () => {
    renderWithProviders();
    await waitFor(() => expect(screen.getByText("Mocked App")).toBeInTheDocument());
  });
});
```

**Reusable boilerplate:**
- `src/test/setup.ts` already configures jest-dom matchers + `ResizeObserver` + `matchMedia` shims
- `vitest.config.ts` already stubs `@microsoft/power-apps/data` (the Power Apps client throws without a host shell — these stubs are no-ops)

### 4. E2E Playwright tests (real connector, real auth)

**When:** Real-world cross-cutting validation that vitest can't fake: actual connector calls, actual Fluent rendering, click-through flows.

**Where:** `tests/e2e/smoke/` for assertions, `tests/e2e/visual/` for screenshot diffs.

**Pattern:** See `tests/e2e/smoke/inventory-nav.spec.ts` for the iframe-aware helper (`app(page)`, `gotoAppRoute`).

**Critical for deployed-URL targets:**
- Auth via `npm run e2e:auth` (one-time, saves cookie state)
- Set `E2E_BASE_URL` to the **deployed** app URL — not the local-dev player wrapper (see `tests/e2e/README.md` for why)
- Runtime iframe detection: `await page.waitForSelector("iframe", { timeout: 30_000 })`

## Conventions

### File / folder naming

| Layer | Test file pattern | Where |
|---|---|---|
| Pure unit | `<source>.test.ts` | next to source |
| Data layer (mocked) | `<source>.test.ts` | next to source |
| View smoke | `<source>.test.tsx` | next to source |
| Cross-cutting feature smokes | `*.test.tsx` under `src/test/` | `src/test/feature-routes.test.tsx` is the canonical example |
| E2E anonymous | `*.anon.spec.ts` | `tests/e2e/smoke/` |
| E2E auth-required | `*.spec.ts` | `tests/e2e/smoke/` or `tests/e2e/visual/` |

### Fixture naming

Under `src/test/fixtures/`:

| Pattern | Example | Use |
|---|---|---|
| `query-resources-<resource>-<state>.json` | `query-resources-envs-page1.json` | Full QueryResources envelope captures |
| `get-<endpoint>.json` | `get-admin-app.json` | Single-record enrichment responses |
| `<feature>-<output-type>.json` | `dlp-evaluation-trace.json` | Logged debug output / golden oracles |

**All fixtures are anonymized.** Run captures through `scripts/anonymize-fixtures.mjs` before committing. Real GUIDs / display names / URLs are replaced with `00000000-…`, `Fixture Env N`, `contoso.example`. Cross-references within one fixture stay consistent.

### Mock import order

Always:
1. `vi.hoisted(...)` at the top — declares mock variables that will be referenced by `vi.mock` factories.
2. `vi.mock("../path", () => ({ ... }))` factories — these get hoisted above all imports.
3. **Stubs for cross-cutting providers** (EnvironmentPicker, UserChip, etc.) — also `vi.mock` calls.
4. Regular `import` statements — these run AFTER the mocks are registered.

### Cache invalidation

Many data-layer modules have module-level state (caches, subscribers, queues). Call the appropriate `invalidate*` / `clear*` function in `beforeEach`:

| Module | Reset call |
|---|---|
| `data/inventory.ts` | `invalidateInventoryCache()` |
| `data/userEnrichment.ts` | `clearUserCache()` |
| `data/savedQueries.ts` | `localStorage.clear()` |
| `data/zones.ts`, `data/standardGroups.ts` | `localStorage.clear()` |
| `featureFlags/storage.ts` | `localStorage.clear()` |

## Common gotchas

### `tsc -b` vs `tsc --noEmit`

`npm run lint` and `npx tsc --noEmit` are LOOSER than what CI runs (`npm run build` = `tsc -b && vite build`). Project-references build mode catches type errors in test files that `--noEmit` ignores. **Always run `npm run build` before pushing test-heavy changes.**

Common errors `tsc -b` catches that `--noEmit` misses:
- `as TargetType` casts on objects that don't sufficiently overlap → use `as unknown as TargetType`
- Spread-with-defaults that produce duplicate-key warnings (TS2783)

### Anti-flake hygiene for view tests

- Use `waitFor(() => expect(...))` not `await screen.findByText(...)` when asserting on async-rendered content — gives nicer error messages
- For Date.now() / clock-sensitive tests, use `vi.useFakeTimers() + vi.setSystemTime(NOW)` in `beforeEach`
- For tests that need millisecond-distinct timestamps (sort tests), `await new Promise(r => setTimeout(r, 5))` is cleaner than mocking the entire Date subsystem

### Fluent UI v9 strict-mode collisions

When a page has multiple elements with the same accessible name (SideNav item + page heading both say "Apps"), `getByText("Apps")` errors with "strict mode violation". Three fixes:
1. Use `.first()` if you don't care which one
2. Scope to a parent: `getByRole("main").getByText("Apps")`
3. Use a more specific predicate: `getByRole("heading", { name: "Apps" })`

### iframe handling for E2E (Power Apps player wrapper)

When testing against any `apps.powerapps.com` URL, the app lives in an iframe.

- Detect at runtime: `const iframeAppeared = await page.waitForSelector("iframe", { timeout: 30_000, state: "attached" }).then(() => true).catch(() => false)`
- Scope queries via `page.frameLocator("iframe").first().locator(...)` when iframe mode
- Navigate hashes via `frame.evaluate((h) => { window.location.hash = h }, "#/agents")` (the player URL doesn't pass hash fragments through)
- See `tests/e2e/smoke/inventory-nav.spec.ts` for the full helper pattern

## Adding a new test — step by step

### Adding a unit test for a new pure function

1. Identify the test file: `src/path/to/module.test.ts` (sibling to source)
2. Write `describe` / `it` blocks per behavior (not per code branch — per behavior)
3. Run: `npm run test:run -- module.test.ts`
4. Commit. CI runs vitest automatically.

### Adding a smoke test for a new view

1. Copy `features/agents/AgentsList.test.tsx` as a starting template
2. Update `vi.mock` targets to match your view's data dependencies
3. Make sure to mock anything that hits the network (EnvironmentPicker, UserChip, etc.)
4. Render with FluentProvider + MemoryRouter
5. Assert at least one expected element renders

### Adding an E2E smoke flow

1. Decide: does it need auth? (most do)
2. If no — add as `<name>.anon.spec.ts` under `tests/e2e/smoke/`
3. If yes — copy `inventory-nav.spec.ts` as a template (has the iframe-aware helper baked in)
4. Run locally: `cd PP-CoE-CodeApp; $env:E2E_BASE_URL = "<deployed app URL>"; npm run e2e`
5. If adding a visual baseline: `npm run e2e:update-snapshots` first, then commit the PNG

### Adding a new data-layer module with tests

1. Write the module's pure logic
2. Add a `<module>.test.ts` next to it using the `vi.hoisted` pattern above
3. Capture real data if needed: `npm run capture:fixtures` (against deployed URL)
4. Anonymize: `node ../scripts/anonymize-fixtures.mjs`
5. Reference the new fixture in your test

## CI

| Workflow | Trigger | What it runs |
|---|---|---|
| `ppcoecodeapp-ci.yml` | every push / PR | `lint` + `tsc -b` + `vite build` + `npm run test:run` (343 vitest tests) |
| `ppcoecodeapp-codeql.yml` | every push / PR | CodeQL scanning |
| `e2e-nightly.yml` | cron 9am UTC + `workflow_dispatch` + push to main | Playwright smoke + visual (against the deployed URL if `E2E_STORAGE_STATE_B64` + `E2E_BASE_URL` are configured; skips with a friendly message otherwise) |

## Quick reference: commands

```powershell
cd PP-CoE-CodeApp

# Vitest
npm run test:run        # one-shot
npm run test            # watch mode
npm run test:coverage   # coverage report

# Type check & build
npx tsc --noEmit        # quick type check (loose — doesn't catch test files)
npm run build           # full project-references build (strict — runs in CI)
npm run lint            # eslint

# Playwright E2E
$env:E2E_BASE_URL = "<deployed app URL>"
npm run e2e:auth        # one-time, opens browser, you log in
npm run e2e             # smoke (anonymous + auth-required)
npm run e2e:anon        # just anonymous smoke (no auth needed)
npm run e2e:visual      # visual regression
npm run e2e:update-snapshots  # re-bake visual baselines (review diffs before committing)
npm run e2e:report      # open last HTML report
npm run capture:fixtures      # drive the app to capture API responses
npm run screenshots           # refresh docs PNGs under docs/img/
```
