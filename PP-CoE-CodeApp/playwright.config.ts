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
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    // When pointed at the Power Apps player URL, the app lives in an
    // iframe at localhost:5173 reached from apps.powerapps.com. Two
    // Chromium-specific concerns we paper over:
    //   1. The "Access other apps and services on this device"
    //      permission popup blocks the player from reaching localhost.
    //      The PNA family of flags disables it.
    //   2. Cross-origin iframe site isolation prevents the screenshot
    //      compositor from including the iframe content in
    //      page.screenshot() output. The site-isolation flags help
    //      navigation + content queries via frameLocator, though
    //      visual screenshot capture of in-iframe content is still
    //      not reliable (see tests/e2e/README.md "Known limitation").
    launchOptions: {
      args: [
        "--disable-features=IsolateOrigins,site-per-process,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForNavigations,PrivateNetworkAccessForIframes",
        "--disable-site-isolation-trials",
      ],
    },
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
    // Auth-required smoke tests. Reuses the storage state baked by
    // `npm run e2e:auth`. We intentionally do NOT depend on the setup
    // project here — that would force a fresh login on every run.
    // Run `npm run e2e:auth` explicitly when storage state expires.
    {
      name: "smoke",
      testDir: "./tests/e2e/smoke",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /.*\.anon\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
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
    },
  ],
});
