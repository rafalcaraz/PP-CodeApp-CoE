#!/usr/bin/env node
/**
 * Refresh the README / docs screenshots by driving the app in a
 * Playwright browser with the stored auth, then saving PNGs into
 * `docs/img/`.
 *
 * Run when you make a UI change that affects how the app looks in
 * documentation. Idempotent — re-runs overwrite the existing PNGs.
 *
 * Usage:
 *   npm run screenshots
 *
 * Environment overrides:
 *   E2E_BASE_URL  — target app URL (defaults to localhost:5173)
 *   SCREENSHOT_OUT — output dir (defaults to docs/img/)
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
const OUT_DIR =
  process.env.SCREENSHOT_OUT ??
  path.join(REPO_ROOT, "PP-CoE-CodeApp/docs/img");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

if (!fs.existsSync(STORAGE_STATE)) {
  // eslint-disable-next-line no-console
  console.error(
    `\nNo auth state at ${STORAGE_STATE}.\nRun \`npm run e2e:auth\` first.\n`,
  );
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOTS = [
  { path: "/#/dashboards", file: "01-dashboards.png", wait: () => null },
  { path: "/#/agents", file: "02-agents.png", waitFor: /Showing \d/ },
  { path: "/#/apps", file: "03-apps.png", waitFor: /Showing \d/ },
  { path: "/#/flows", file: "04-flows.png", waitFor: /Showing \d/ },
  { path: "/#/environments", file: "05-environments.png", waitFor: /\d+ of \d+/ },
  { path: "/#/environment-groups", file: "06-environment-groups.png", waitFor: /\d+ of \d+/ },
  { path: "/#/security/comparator", file: "07-security-comparator.png" },
  { path: "/#/security/dlp-comparator", file: "08-dlp-comparator.png" },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: STORAGE_STATE,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

// eslint-disable-next-line no-console
console.log(`[screenshots] writing to ${OUT_DIR}`);

for (const shot of SHOTS) {
  // eslint-disable-next-line no-console
  console.log(`  ${shot.file}  ←  ${shot.path}`);
  await page.goto(`${BASE_URL}${shot.path}`);
  if (shot.waitFor) {
    await page
      .getByText(shot.waitFor)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {
        // eslint-disable-next-line no-console
        console.warn(`    (timed out waiting for content)`);
      });
  } else {
    // No specific waitFor — give the page a moment to settle.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT_DIR, shot.file),
    fullPage: false,
  });
}

await browser.close();

// eslint-disable-next-line no-console
console.log(`\n[screenshots] done. ${SHOTS.length} images written.`);
// eslint-disable-next-line no-console
console.log("[screenshots] commit the updated PNGs if you want them in the next docs build.\n");
