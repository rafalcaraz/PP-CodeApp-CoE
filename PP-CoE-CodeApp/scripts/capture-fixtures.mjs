#!/usr/bin/env node
/**
 * Capture fresh API responses (QueryResources / Get_AdminApp /
 * ListPoliciesV2 / env-group governance) by driving the app in a
 * Playwright browser with the stored auth.
 *
 * Iframe-aware: uses `context.on('response')` which captures
 * responses across ALL frames (top-level AND iframe) at the network
 * layer — no JS injection needed, works equally well for the deployed
 * app (which iframes the app content under apps.powerapps.com) and
 * direct localhost.
 *
 * Workflow:
 *   1. Reads `tests/e2e/.auth/storageState.json` (run `npm run e2e:auth` first).
 *   2. Opens the app, hooks the context's `response` event.
 *   3. Navigates through key pages (Apps, Flows, Envs, Env Groups, Agents).
 *   4. Clicks into first Environment detail → clicks Load admin details
 *      + Load DLP policy coverage to trigger the enrichment calls.
 *   5. Filters captured responses by URL pattern + writes raw JSON to
 *      `docs/fixtures-raw/` (gitignored).
 *   6. You then run `node ../scripts/anonymize-fixtures.mjs` to
 *      anonymize and write to `src/test/fixtures/` (committed).
 *
 * The captures are RAW (real tenant data). The anonymization step is
 * mandatory before committing anything generated under
 * `src/test/fixtures/`.
 *
 * Usage (from PP-CoE-CodeApp/):
 *   npm run capture:fixtures
 *
 * Environment overrides:
 *   E2E_BASE_URL — target app URL (defaults to localhost:5173).
 *                  Use a deployed Power Apps URL for best results.
 *   CAPTURE_OUT  — output dir (defaults to PP-CoE-CodeApp/docs/fixtures-raw)
 */

import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const STORAGE_STATE = path.join(APP_ROOT, "tests/e2e/.auth/storageState.json");
const RAW_DIR =
  process.env.CAPTURE_OUT ?? path.join(APP_ROOT, "docs/fixtures-raw");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

if (!fs.existsSync(STORAGE_STATE)) {
  console.error(
    `\nNo auth state at ${STORAGE_STATE}.\nRun \`npm run e2e:auth\` first.\n`,
  );
  process.exit(1);
}

fs.mkdirSync(RAW_DIR, { recursive: true });

// URL patterns we want to capture. Anything not matching is ignored.
const CAPTURE_PATTERNS = [
  { name: "query-resources", match: /QueryResources/i },
  { name: "get-admin-app", match: /Get_AdminApp/i },
  { name: "get-environment-by-id-for-user", match: /GetEnvironmentByIdForUser/i },
  { name: "list-policies-v2", match: /ListPoliciesV2|ListPolicies/i },
  { name: "get-rule-set-list", match: /GetRuleSetListForTenant/i },
  { name: "list-rule-assignments", match: /ListRuleAssignmentsByEnvironmentGroupId/i },
];

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-features=IsolateOrigins,site-per-process,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForNavigations,PrivateNetworkAccessForIframes",
    "--disable-site-isolation-trials",
  ],
});
const ctx = await browser.newContext({ storageState: STORAGE_STATE });

// Hook the network layer — captures every response across every frame.
// We accumulate everything and filter at the end by URL pattern.
const captures = [];
ctx.on("response", async (response) => {
  const url = response.url();
  // Skip the chatty stuff we don't care about (saves memory).
  if (!CAPTURE_PATTERNS.some((p) => p.match.test(url))) return;
  try {
    const body = await response.text();
    captures.push({
      url,
      status: response.status(),
      body,
      timestamp: Date.now(),
    });
  } catch {
    // body-read failures (already-consumed streams, etc.) — skip
  }
});

const page = await ctx.newPage();

console.log(`[capture] opening ${BASE_URL} with saved auth`);
await page.goto(BASE_URL);

// Detect iframe mode for navigation routing.
const iframeAppeared = await page
  .waitForSelector("iframe", { timeout: 30_000, state: "attached" })
  .then(() => true)
  .catch(() => false);

console.log(`[capture] iframe mode: ${iframeAppeared}`);

// Wait for the SideNav brand text — signal that the app is past
// AdminAccessGate.
const start = Date.now();
let ready = false;
while (Date.now() - start < 90_000) {
  const target = iframeAppeared
    ? page.frameLocator("iframe").first().getByText("Power Platform CoE").first()
    : page.getByText("Power Platform CoE").first();
  if (await target.isVisible().catch(() => false)) {
    ready = true;
    break;
  }
  await page.waitForTimeout(500);
}

if (!ready) {
  console.error(
    "[capture] App never rendered past 'Checking access…'. " +
      "Storage state may be stale — re-run `npm run e2e:auth`.",
  );
  await browser.close();
  process.exit(2);
}

console.log("[capture] app ready; driving navigation…");

// Helper: navigate to a hash route (iframe-aware).
async function navigateApp(hashPath) {
  if (!iframeAppeared) {
    await page.goto(`${BASE_URL}/#${hashPath}`);
    return;
  }
  const frame = page.frames().find((f) => !f.isDetached() && f !== page.mainFrame());
  if (frame) {
    await frame.evaluate((hash) => {
      window.location.hash = `#${hash}`;
    }, hashPath);
    await page.waitForTimeout(1_000);
  }
}

// Helper: get app-scoped text locator.
function appText(text) {
  return iframeAppeared
    ? page.frameLocator("iframe").first().getByText(text)
    : page.getByText(text);
}

// Helper: get app-scoped role locator.
function appRole(role, opts) {
  return iframeAppeared
    ? page.frameLocator("iframe").first().getByRole(role, opts)
    : page.getByRole(role, opts);
}

// Drive the list pages — each trigger its mount-time QueryResources calls.
const pages = [
  { path: "/agents", label: "Agents list" },
  { path: "/apps", label: "Apps list" },
  { path: "/flows", label: "Flows list" },
  { path: "/environments", label: "Environments list" },
  { path: "/environment-groups", label: "Environment groups list" },
];

for (const p of pages) {
  console.log(`[capture]   → ${p.label} (${p.path})`);
  await navigateApp(p.path);
  await appText(/Showing \d|\d+ of \d+/)
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => {
      console.warn(`[capture]     (timed out waiting for rows on ${p.path})`);
    });
}

// Click into first env → trigger admin details + DLP coverage.
// This part is best-effort — if the row selector misses, we still
// have all the list-page captures and write them.
console.log("[capture]   → first Environment detail (best-effort)");
try {
  await navigateApp("/environments");
  await appText(/\d+ of \d+/)
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
  // Wait for rows to actually render (header counts as row 0).
  const rowsRoot = iframeAppeared
    ? page.frameLocator("iframe").first().locator('[role="row"]')
    : page.locator('[role="row"]');
  await rowsRoot.nth(2).waitFor({ state: "visible", timeout: 30_000 });
  // Try a few link-like selectors — Fluent's Link sometimes renders
  // as a button, sometimes an anchor.
  const candidates = [
    rowsRoot.nth(1).locator("a").first(),
    rowsRoot.nth(1).getByRole("link").first(),
    rowsRoot.nth(1).locator("button").first(),
  ];
  let clicked = false;
  for (const cand of candidates) {
    if (await cand.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cand.click({ timeout: 10_000 });
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    console.warn("[capture]     (couldn't find clickable env row — skipping detail capture)");
  } else {
    await page.waitForTimeout(3_000);

    console.log("[capture]   → click Load admin details (best-effort)");
    const loadAdminBtn = appRole("button", { name: "Load admin details" }).first();
    if (await loadAdminBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await loadAdminBtn.click();
      await page.waitForTimeout(4_000);
    } else {
      console.warn("[capture]     (Load admin details button not found)");
    }

    console.log("[capture]   → click Load DLP policy coverage (best-effort)");
    const loadDlpBtn = appRole("button", { name: "Load DLP policy coverage" }).first();
    if (await loadDlpBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await loadDlpBtn.click();
      await page.waitForTimeout(6_000);
    } else {
      console.warn("[capture]     (Load DLP policy coverage button not found)");
    }
  }
} catch (err) {
  console.warn(`[capture]     (env detail capture failed: ${err.message})`);
}

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
  "[capture] Run `node ../scripts/anonymize-fixtures.mjs` to anonymize + write to src/test/fixtures/\n",
);

await browser.close();

