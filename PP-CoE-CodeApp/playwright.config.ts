import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the auth storage-state file lands after `npm run e2e:auth`. The
// directory itself is gitignored so cookies / tokens never leak.
const STORAGE_STATE = path.join(__dirname, "tests/e2e/.auth/storageState.json");

/**
 * Playwright config for the PP CoE Code App.
 *
 * Two test categories:
 *  - **smoke** — quick navigations + asserts. Most don't need auth (the
 *    AdminAccessGate is informative even when blocked). Auth-required
 *    smoke tests use the storage state created by `auth.setup.ts`.
 *  - **visual** — screenshot regression via `toHaveScreenshot()`. Same
 *    auth strategy as smoke.
 *
 * Auth flow:
 *   1. `npm run e2e:auth` runs `auth.setup.ts` interactively (browser
 *      opens, you log in, hit Enter in the terminal, storage state
 *      saved).
 *   2. All subsequent `npm run e2e` / `npm run e2e:visual` runs reuse
 *      the saved state — no re-login needed until the cookies expire.
 *
 * Pointing at a different target:
 *   - Default base URL is the local Vite dev server (`http://localhost:5173`).
 *   - For testing against the deployed Power Apps Code App, set
 *     `E2E_BASE_URL=https://apps.powerapps.com/play/e/<env>/a/<app>?...`
 *     before running the npm scripts.
 *
 * Browsers: Chromium only — keeps CI fast and avoids the per-OS
 * screenshot-diff churn from multi-browser baselines. Add `firefox` /
 * `webkit` projects later if cross-browser parity is ever a real
 * concern.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Ignore the auth setup helper when running tests directly — it's
  // only invoked via the `setup` project / the `e2e:auth` script.
  testIgnore: "**/auth.setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // E2E tests are I/O bound — 4 workers locally is plenty without
  // saturating the connector. CI uses fewer to share resources.
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 5s default click timeout is plenty for the local dev server. We
    // crank the overall page-action timeout higher because the first
    // QueryResources call against a 700+ env tenant can be slow.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  // Visual snapshots config — pixel diff threshold tuned for Fluent UI
  // which renders sub-pixel anti-aliasing differently across machines.
  // 0.2% is loose enough to ignore that noise without missing real
  // layout drift.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
    },
  },
  projects: [
    // Setup project: runs the interactive login once and saves storage
    // state. Other projects depend on it but only when the env var
    // `E2E_REQUIRE_AUTH=1` is set (i.e. you're running an auth-required
    // test). Anonymous smoke tests don't need it.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    // Anonymous smoke tests — no auth required.
    {
      name: "smoke-anon",
      testDir: "./tests/e2e/smoke",
      testMatch: /.*\.anon\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Auth-required smoke tests.
    {
      name: "smoke",
      testDir: "./tests/e2e/smoke",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /.*\.anon\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
    // Visual regression tests — always auth-required.
    {
      name: "visual",
      testDir: "./tests/e2e/visual",
      use: {
        ...devices["Desktop Chrome"],
        // Visual regression needs deterministic rendering — fix the
        // viewport so screenshots are pixel-comparable across machines.
        viewport: { width: 1440, height: 900 },
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
  ],
});
