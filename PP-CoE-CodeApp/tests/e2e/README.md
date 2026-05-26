# End-to-end tests (Playwright)

This folder contains the Playwright-based E2E tests for the PP CoE
Code App. They run against a **real, authenticated** session — either
your local dev server or the deployed Power Apps Code App — and
exercise behaviors that the in-process Vitest suite can't, like the
actual connector calls and Fluent rendering against a real DOM.

## TL;DR commands

```powershell
cd PP-CoE-CodeApp

# One-time per machine
npx playwright install chromium

# One-time per session (when cookies expire — usually every few days)
npm run e2e:auth

# Run everything
npm run e2e                  # smoke tests
npm run e2e:visual           # visual regression
npm run e2e:update-snapshots # re-bake visual baselines (do this AFTER reviewing intentional UI changes)

# Capture fresh fixtures for the Vitest suite
npm run capture:fixtures

# Refresh README screenshots
npm run screenshots
```

## What lives where

```
tests/e2e/
├─ .auth/                          gitignored — your storage state
│   └─ storageState.json           cookies + localStorage from `e2e:auth`
├─ auth.setup.ts                   interactive login flow
├─ smoke/
│   ├─ admin-gate.anon.spec.ts     no-auth: app boots, AdminAccessGate renders
│   └─ inventory-nav.spec.ts       auth: Agents/Apps/Flows/Envs load, row click navigates
├─ visual/
│   └─ key-pages.spec.ts           pixel-diff key pages
└─ README.md                       this file
```

Visual-regression baselines land in `tests/e2e/visual/<spec>-snapshots/`
automatically once you run `e2e:update-snapshots` the first time. They
get committed to git.

## Auth strategy

We use Playwright's **storage state** pattern. You log in once
interactively; cookies + localStorage are persisted to
`tests/e2e/.auth/storageState.json`; all subsequent test runs reuse
that state — no re-login, no MFA prompts.

The `.auth/` folder is **gitignored**. The storage state contains
live session tokens — never commit it.

### Re-authenticating

You'll know it's time when:
- A test fails with `Login required` or `401`
- The "Checking access…" page never resolves
- It's been more than ~14 days since the last `e2e:auth` run

Just re-run `npm run e2e:auth`.

### Pointing at a different environment

Default target is the local Vite dev server:

```powershell
npm run dev  # in another terminal
npm run e2e
```

To test against the deployed Power Apps Code App:

```powershell
$env:E2E_BASE_URL = "https://apps.powerapps.com/play/e/<env>/a/<app>?tenantId=<tenant>"
npm run e2e:auth     # re-auth for the new target
npm run e2e
```

(Different `E2E_BASE_URL` values share one storage state file — re-run
`e2e:auth` whenever you switch targets.)

### ⚠️ Known limitation — Power Apps player URL + iframe

When `E2E_BASE_URL` is set to the Power Apps **local-dev player URL**
(i.e. `https://apps.powerapps.com/play/e/<env>/a/local?_localAppUrl=http://localhost:5173/...`),
the player wraps your **localhost** dev server in a **cross-origin**
iframe — and that combination defeats Chromium's screenshot compositor
no matter what flags we set. Visual capture against the local-dev
player wrapper isn't possible with current Playwright/Chromium.

**TL;DR — use a deployed app URL when you can.** Both the smoke tests
and visual regression now work flawlessly against a deployed app URL
because the deployed iframe is **same-origin** to the player (both
apps.powerapps.com), so Chromium composes it correctly.

Compatibility matrix:

| `E2E_BASE_URL` | Auth | Smoke | Visual | Screenshots | Capture |
|---|---|---|---|---|---|
| `http://localhost:5173` (raw) | ❌ no auth (AdminAccessGate) | ❌ | ❌ | ❌ | ❌ |
| Local-dev player wrapper (`.../a/local?_localAppUrl=...`) | ✅ | 🟡 fragile | ❌ cross-origin | ❌ cross-origin | 🟡 only top-level fetches |
| **Deployed app URL** (`.../app/<id>?tenantId=...`) | ✅ | ✅ | ✅ | ✅ | ✅ |

When running against any apps.powerapps.com URL, tests/scripts are
iframe-aware: they detect the iframe at runtime and route DOM queries
through `page.frameLocator("iframe").first()`, and navigate by
setting the iframe's `window.location.hash` directly.

### Pointing at a deployed app URL

```powershell
$env:E2E_BASE_URL = "https://apps.powerapps.com/play/e/<env>/app/<appId>?tenantId=<tenant>"
npm run e2e:auth     # log in once (saves cookies for this URL)
npm run e2e          # full smoke
npm run e2e:visual   # visual regression
npm run screenshots  # docs PNGs
npm run capture:fixtures  # refresh test fixtures
```

### Pointing at the local-dev player wrapper

The local-dev player wrapper URL is what `pac code init` produces — it
looks like `https://apps.powerapps.com/play/e/<env>/a/local?_localAppUrl=http://localhost:5173/&_localConnectionUrl=...`.
Auth works. Smoke tests *can* work but the player sometimes redirects
to the maker portal; tests skip with a message when that happens.
Visual + screenshots + capture do NOT work — see the table above.

## Smoke vs visual

| Project       | Auth needed? | What it does                                                      |
| ------------- | ------------ | ----------------------------------------------------------------- |
| `smoke-anon`  | No           | Verifies app boots without auth — catches build/import breaks     |
| `smoke`       | Yes          | Loads Agents/Apps/Flows/Envs pages, asserts rows render, click-through to detail |
| `visual`      | Yes          | Pixel-diffs each key page against a baseline screenshot           |

Smoke is fast and runs nightly in CI. Visual regression is also
nightly but more sensitive to flake — investigate diffs by viewing
`playwright-report/index.html` which embeds before/after/diff images.

## Visual regression workflow

1. **First time adding a visual test** for a new page:
   ```powershell
   npm run e2e:update-snapshots -- visual/your-new-test.spec.ts
   ```
   This records the baseline PNG. Commit it.

2. **Day to day**:
   ```powershell
   npm run e2e:visual
   ```
   Failures mean either a real regression OR an intentional UI change.

3. **You made an intentional UI change**:
   ```powershell
   npm run e2e:visual          # see what changed (HTML report has diff images)
   npm run e2e:update-snapshots # re-bake the baselines
   git diff tests/e2e/visual/  # review the binary diff (size in KB)
   git add tests/e2e/visual/
   ```

The pixel-diff threshold is **0.2%** (`maxDiffPixelRatio: 0.002` in
`playwright.config.ts`). That's loose enough to ignore Fluent's
sub-pixel anti-aliasing on different machines without missing real
layout drift. Tune up/down if you see chronic false positives.

## CI

E2E tests run **nightly** via `.github/workflows/e2e-nightly.yml`
(default: 9am UTC daily, plus manual `workflow_dispatch`). The
workflow:

1. Decodes the `E2E_STORAGE_STATE_B64` secret into the storage state file
2. Installs Playwright browsers
3. Runs `npm run e2e` + `npm run e2e:visual`
4. Uploads the HTML report as a workflow artifact on failure

**To set up CI** (one-time):

```powershell
# Locally
npm run e2e:auth
[Convert]::ToBase64String(
  [System.IO.File]::ReadAllBytes("tests/e2e/.auth/storageState.json")
) | Set-Clipboard
```

Then in the repo settings → Secrets → Actions → New repository secret:
- Name: `E2E_STORAGE_STATE_B64`
- Value: paste from clipboard

Optionally also set `E2E_BASE_URL` (variable, NOT secret — no
sensitive data) to point at the deployed app instead of the
locally-built one.

## Capture script

`scripts/capture-fixtures.mjs` is the headless cousin of the manual
workflow you used to build the Vitest fixtures (see commit history
for the first set). It:

1. Loads the app with your saved auth
2. Injects a fetch interceptor that records every API response into `window.__capturedResponses`
3. Clicks through the key pages (Apps → first row → Load admin details → DLP coverage → ...)
4. Reads the array back, filters by URL pattern, writes raw JSON to `docs/fixtures-raw/` (gitignored)

Then run `node scripts/anonymize-fixtures.mjs` to anonymize and write
to `src/test/fixtures/` (committed). Re-run any time the connector
responses might have drifted:

```powershell
npm run capture:fixtures
node ../scripts/anonymize-fixtures.mjs
```
