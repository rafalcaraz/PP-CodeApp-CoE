/**
 * Auth setup — runs ONCE per session to capture Microsoft auth state.
 *
 * **How it works:**
 *   1. `npm run e2e:auth` invokes Playwright with this file as the test
 *      to run, in HEADED mode (browser is visible).
 *   2. The browser opens to the base URL (your localhost dev server or
 *      the published Power Apps URL — set via E2E_BASE_URL).
 *   3. You log in to Microsoft / Entra / pick your account / MFA — all
 *      the normal sign-in steps.
 *   4. Once you see the actual app render past the AdminAccessGate,
 *      hit ENTER in the terminal where the script is paused.
 *   5. The script saves cookies + localStorage + sessionStorage to
 *      `tests/e2e/.auth/storageState.json`.
 *   6. All subsequent test runs reuse that file — no re-login needed
 *      until tokens expire (typically days).
 *
 * **The storage file is gitignored.** It contains live session tokens.
 * Never commit it. For CI, stash it as a base64-encoded secret and
 * write it out at the start of the workflow run.
 */
import { test as setup, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_STATE = path.resolve(__dirname, ".auth/storageState.json");

setup("authenticate", async ({ page }) => {
  // Logging in takes minutes (MFA, account picker, consent prompts).
  // Disable the per-test timeout so the user has all the time they need.
  setup.setTimeout(10 * 60 * 1000); // 10 minutes

  // Ensure the .auth directory exists; it's gitignored but needs to
  // exist for Playwright to write into it.
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });

  // Open the app. We intentionally don't auto-fill credentials —
  // making this manual keeps us out of the "scrape MFA tokens"
  // territory that AAD policies (rightly) prohibit.
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
  await page.goto(baseURL);

  // Tell the user what to do.
  console.log("\n────────────────────────────────────────────────────────");
  console.log("AUTH SETUP");
  console.log("────────────────────────────────────────────────────────");
  console.log(`Browser open at: ${baseURL}`);
  console.log("");
  console.log("Steps:");
  console.log("  1. Complete Microsoft sign-in in the browser.");
  console.log("  2. Wait until the app's SideNav renders (Inventory / Security / Zones).");
  console.log("  3. This script auto-detects that signal and saves the session.");
  console.log("");
  console.log("Waiting up to 10 minutes for the SideNav to appear…");
  console.log("────────────────────────────────────────────────────────\n");

  // Poll for the SideNav. When the app is loaded past AdminAccessGate,
  // a <nav> element is rendered. This is our canonical "I'm signed in
  // and the app is alive" signal.
  //
  // Note: when running against the Power Apps player URL, the actual
  // app lives in an iframe. We check both the top-level page and any
  // accessible frames.
  //
  // Why poll instead of waiting on stdin? Because piping stdin through
  // `npm run → cmd → node` is unreliable on Windows. A polling
  // sentinel ("app rendered = done") is platform-agnostic.
  const TOTAL_WAIT_MS = 10 * 60 * 1000;
  const POLL_INTERVAL_MS = 1_000;
  const start = Date.now();

  let signedIn = false;
  while (Date.now() - start < TOTAL_WAIT_MS) {
    if (await page.locator("nav").first().isVisible().catch(() => false)) {
      signedIn = true;
      break;
    }
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        if (await frame.locator("nav").first().isVisible()) {
          signedIn = true;
          break;
        }
      } catch {
        // Cross-origin frame — can't introspect. Skip.
      }
    }
    if (signedIn) break;
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  expect(
    signedIn,
    "Timed out waiting for the SideNav to render. Either sign-in didn't " +
      "complete, or the app failed to load past the AdminAccessGate.",
  ).toBe(true);

  // Persist storage state (cookies + origin storage).
  await page.context().storageState({ path: STORAGE_STATE });

  console.log(`\n✓ Auth state saved to ${STORAGE_STATE}`);
  console.log("  All subsequent `npm run e2e` runs will reuse this session.");
  console.log("  Re-run this when cookies expire (you'll see auth failures).\n");
});
