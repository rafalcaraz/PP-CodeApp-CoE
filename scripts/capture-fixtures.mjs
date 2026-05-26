#!/usr/bin/env node
/**
 * Capture fresh QueryResources / Get_AdminApp / ListPoliciesV2
 * responses by driving the app in a Playwright browser with the
 * stored auth.
 *
 * Workflow:
 *   1. Reads `PP-CoE-CodeApp/tests/e2e/.auth/storageState.json` (run
 *      `npm run e2e:auth` first).
 *   2. Opens the app, injects a fetch interceptor that records every
 *      API response into `window.__capturedResponses`.
 *   3. Navigates through key pages, clicking buttons that trigger the
 *      enrichment calls.
 *   4. Reads the captured array back, filters by URL pattern, writes
 *      raw JSON to `PP-CoE-CodeApp/docs/fixtures-raw/` (gitignored).
 *   5. You then run `node scripts/anonymize-fixtures.mjs` to anonymize
 *      and write to `PP-CoE-CodeApp/src/test/fixtures/` (committed).
 *
 * The captures are RAW (real tenant data). The anonymization step is
 * mandatory before committing anything generated under
 * `src/test/fixtures/`.
 *
 * Usage:
 *   npm run capture:fixtures   (from PP-CoE-CodeApp/)
 *
 * Environment overrides:
 *   E2E_BASE_URL  — target app URL (defaults to localhost:5173)
 *   CAPTURE_OUT   — output dir (defaults to PP-CoE-CodeApp/docs/fixtures-raw/)
 */

import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const STORAGE_STATE = path.join(
  REPO_ROOT,
  "PP-CoE-CodeApp/tests/e2e/.auth/storageState.json",
);
const RAW_DIR =
  process.env.CAPTURE_OUT ??
  path.join(REPO_ROOT, "PP-CoE-CodeApp/docs/fixtures-raw");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

if (!fs.existsSync(STORAGE_STATE)) {
  console.error(
    `\nNo auth state at ${STORAGE_STATE}.\nRun \`npm run e2e:auth\` first (from PP-CoE-CodeApp/).\n`,
  );
  process.exit(1);
}

fs.mkdirSync(RAW_DIR, { recursive: true });

// URL patterns we want to capture. Anything not matching gets ignored.
const CAPTURE_PATTERNS = [
  { name: "query-resources", match: /QueryResources/i },
  { name: "get-admin-app", match: /Get_AdminApp/i },
  { name: "get-environment-by-id-for-user", match: /GetEnvironmentByIdForUser/i },
  { name: "list-policies-v2", match: /ListPoliciesV2|ListPolicies/i },
  { name: "get-rule-set-list", match: /GetRuleSetListForTenant/i },
  { name: "list-rule-assignments", match: /ListRuleAssignmentsByEnvironmentGroupId/i },
];

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ storageState: STORAGE_STATE });
const page = await ctx.newPage();

console.log(`[capture] opening ${BASE_URL} with saved auth`);
await page.goto(BASE_URL);

// Wait for the access gate to pass — the SideNav is the signal.
const navAppeared = await page
  .locator("nav")
  .first()
  .waitFor({ state: "visible", timeout: 60_000 })
  .then(() => true)
  .catch(() => false);

if (!navAppeared) {
  console.error(
    "[capture] App never rendered past 'Checking access…'. " +
      "Storage state may be stale — re-run `npm run e2e:auth`.",
  );
  await browser.close();
  process.exit(2);
}

// Inject the fetch interceptor.
await page.evaluate(() => {
  if (window.__capturedResponses) return;
  window.__capturedResponses = [];
  window.__origFetch = window.fetch;
  window.fetch = async function patched(...args) {
    const req = args[0];
    const url =
      typeof req === "string"
        ? req
        : req instanceof URL
          ? req.href
          : req.url;
    const res = await window.__origFetch.apply(this, args);
    try {
      const clone = res.clone();
      const body = await clone.text();
      window.__capturedResponses.push({
        url,
        status: res.status,
        body,
        timestamp: Date.now(),
      });
    } catch {
      // swallow body-read failures (stream already consumed etc.)
    }
    return res;
  };
});

console.log("[capture] interceptor installed; driving navigation…");

// Drive the list pages. Each goto triggers the page's mount-time fetches.
// React-router-dom uses hash routing, so navigation is in-page.
const pages = [
  { path: "/#/agents", label: "Agents list" },
  { path: "/#/apps", label: "Apps list" },
  { path: "/#/flows", label: "Flows list" },
  { path: "/#/environments", label: "Environments list" },
  { path: "/#/environment-groups", label: "Environment groups list" },
];

for (const p of pages) {
  console.log(`[capture]   → ${p.label} (${p.path})`);
  await page.goto(`${BASE_URL}${p.path}`);
  await page
    .getByText(/Showing \d|\d+ of \d+/)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {
      console.warn(`[capture]     (timed out waiting for rows on ${p.path})`);
    });
}

// Click into the first env to trigger admin details + DLP coverage.
console.log("[capture]   → first Environment detail");
await page.goto(`${BASE_URL}/#/environments`);
await page
  .getByText(/\d+ of \d+/)
  .first()
  .waitFor({ state: "visible", timeout: 30_000 });
const firstEnvLink = page.locator('[role="row"]').nth(1).getByRole("link").first();
await firstEnvLink.click();
await page.waitForTimeout(2_000);

console.log("[capture]   → click Load admin details");
const loadAdminBtn = page.getByRole("button", { name: "Load admin details" }).first();
if (await loadAdminBtn.isVisible().catch(() => false)) {
  await loadAdminBtn.click();
  await page.waitForTimeout(3_000);
}

console.log("[capture]   → click Load DLP policy coverage");
const loadDlpBtn = page
  .getByRole("button", { name: "Load DLP policy coverage" })
  .first();
if (await loadDlpBtn.isVisible().catch(() => false)) {
  await loadDlpBtn.click();
  await page.waitForTimeout(5_000);
}

// Pull the captures back.
const captures = await page.evaluate(() => {
  return window.__capturedResponses ?? [];
});

console.log(`\n[capture] collected ${captures.length} responses total`);

// Group + write. One file per (pattern, sequence-number).
const counts = {};
for (const cap of captures) {
  for (const pattern of CAPTURE_PATTERNS) {
    if (!pattern.match.test(cap.url)) continue;
    counts[pattern.name] = (counts[pattern.name] ?? 0) + 1;
    const idx = counts[pattern.name];
    const fileName = `${pattern.name}-${String(idx).padStart(2, "0")}.json`;
    const filePath = path.join(RAW_DIR, fileName);
    let body = cap.body;
    try {
      body = JSON.stringify(JSON.parse(cap.body), null, 2);
    } catch {
      // not JSON — write raw
    }
    fs.writeFileSync(filePath, body, "utf8");
    break;
  }
}

console.log("[capture] wrote:");
for (const [name, n] of Object.entries(counts)) {
  console.log(`  ${name}: ${n}`);
}

console.log(`\n[capture] raw captures are at: ${RAW_DIR}`);
console.log(
  "[capture] Run `node scripts/anonymize-fixtures.mjs` to anonymize + write to src/test/fixtures/\n",
);

await browser.close();
