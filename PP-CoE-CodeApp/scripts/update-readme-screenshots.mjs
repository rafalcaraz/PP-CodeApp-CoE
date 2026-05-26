#!/usr/bin/env node
/**
 * Refresh the README / docs screenshots by driving the app in a
 * Playwright browser with the stored auth, then saving PNGs into
 * `docs/img/`.
 *
 * Run when you make a UI change that affects how the app looks in
 * documentation. Idempotent — re-runs overwrite the existing PNGs.
 *
 * Iframe-aware: when running against a Power Apps player URL
 * (deployed or local-dev), the app lives in an iframe. We detect that
 * at runtime and route navigation through `frame.evaluate()`.
 *
 * Usage (from PP-CoE-CodeApp/):
 *   npm run screenshots
 *   E2E_BASE_URL=<deployed url> npm run screenshots
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const STORAGE_STATE = path.join(APP_ROOT, "tests/e2e/.auth/storageState.json");
const OUT_DIR =
  process.env.SCREENSHOT_OUT ?? path.join(APP_ROOT, "docs/img");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

if (!fs.existsSync(STORAGE_STATE)) {
  console.error(
    `\nNo auth state at ${STORAGE_STATE}.\nRun \`npm run e2e:auth\` first.\n`,
  );
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOTS = [
  { path: "/dashboards", file: "01-dashboards.png" },
  { path: "/agents", file: "02-agents.png", waitFor: /Showing \d/ },
  { path: "/apps", file: "03-apps.png", waitFor: /Showing \d/ },
  { path: "/flows", file: "04-flows.png", waitFor: /Showing \d/ },
  { path: "/environments", file: "05-environments.png", waitFor: /\d+ of \d+/ },
  { path: "/environment-groups", file: "06-environment-groups.png", waitFor: /\d+ of \d+/ },
  { path: "/security/comparator", file: "07-security-comparator.png" },
  { path: "/security/dlp-comparator", file: "08-dlp-comparator.png" },
];

const browser = await chromium.launch({
  headless: true,
  // Same flags used by the test runner — bypass the PNA popup and
  // hint Chromium toward composable iframe rendering.
  args: [
    "--disable-features=IsolateOrigins,site-per-process,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForNavigations,PrivateNetworkAccessForIframes",
    "--disable-site-isolation-trials",
  ],
});
const ctx = await browser.newContext({
  storageState: STORAGE_STATE,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

console.log(`[screenshots] navigating to ${BASE_URL}`);
await page.goto(BASE_URL);

// Detect iframe mode and wait for the app to be ready.
const iframeAppeared = await page
  .waitForSelector("iframe", { timeout: 30_000, state: "attached" })
  .then(() => true)
  .catch(() => false);

console.log(`[screenshots] iframe mode: ${iframeAppeared}`);

// Wait for the SideNav brand text — signal that the app is past AdminAccessGate.
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
  console.error("[screenshots] App didn't render past AdminAccessGate. Re-run `npm run e2e:auth`.");
  await browser.close();
  process.exit(2);
}

console.log(`[screenshots] writing to ${OUT_DIR}`);

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
    await page.waitForTimeout(800);
  }
}

for (const shot of SHOTS) {
  console.log(`  ${shot.file}  ←  ${shot.path}`);
  await navigateApp(shot.path);
  if (shot.waitFor) {
    const target = iframeAppeared
      ? page.frameLocator("iframe").first().getByText(shot.waitFor).first()
      : page.getByText(shot.waitFor).first();
    await target.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {
      console.warn(`    (timed out waiting for content)`);
    });
  } else {
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT_DIR, shot.file),
    fullPage: false,
  });
}

await browser.close();

console.log(`\n[screenshots] done. ${SHOTS.length} images written.`);
console.log("[screenshots] commit the updated PNGs if you want them in the next docs build.\n");

