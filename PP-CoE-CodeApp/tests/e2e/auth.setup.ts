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
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_STATE = path.resolve(__dirname, ".auth/storageState.json");

setup("authenticate", async ({ page }) => {
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
   
  console.log(`A browser is open at: ${baseURL}`);
   
  console.log("Steps:");
   
  console.log("  1. Complete Microsoft sign-in in the browser.");
   
  console.log("  2. Wait until you see the app render (past 'Checking access…').");
   
  console.log("  3. Then press ENTER in this terminal to save the session.");
   
  console.log("────────────────────────────────────────────────────────\n");

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Press ENTER when login is complete... ", () => {
      rl.close();
      resolve();
    });
  });

  // Sanity check: confirm we're past the access gate before saving.
  // If the user pressed Enter too early we'd save an un-authed state.
  const bodyText = await page.locator("body").innerText();
  expect(
    bodyText.includes("Checking access"),
    "App is still on the AdminAccessGate — sign-in might not have completed. " +
      "Wait for the SideNav to appear before pressing ENTER.",
  ).toBe(false);

  // Persist storage state (cookies + origin storage).
  await page.context().storageState({ path: STORAGE_STATE });

   
  console.log(`\n✓ Auth state saved to ${STORAGE_STATE}`);
   
  console.log("  All subsequent `npm run e2e` runs will reuse this session.");
   
  console.log("  Re-run this when cookies expire (you'll see auth failures).\n");
});
