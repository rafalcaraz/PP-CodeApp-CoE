/**
 * Visual regression tests — pixel-diff key pages against committed
 * baselines under `tests/e2e/visual/*-snapshots/`.
 *
 * Iframe-aware (see inventory-nav.spec.ts for the same pattern):
 * when running against a Power Apps player URL (either local-dev or
 * deployed), the app lives in an iframe — we detect that at runtime
 * and route screenshots through the right frame.
 *
 * Workflow:
 *   - First run on a new test: `npm run e2e:update-snapshots` —
 *     Playwright records the baseline.
 *   - Subsequent runs: `npm run e2e:visual` — fails if the rendered
 *     page diverges from the baseline by more than `maxDiffPixelRatio`
 *     (configured in playwright.config.ts — currently 0.2%).
 *   - To accept a diff after an intentional UI change, re-run
 *     `npm run e2e:update-snapshots` and commit the new baselines.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

let appScopeIsIframe = false;

function appLocator(page: Page, sel: string): Locator {
  if (appScopeIsIframe) {
    return page.frameLocator("iframe").first().locator(sel);
  }
  return page.locator(sel);
}

function appText(page: Page, text: RegExp | string): Locator {
  if (appScopeIsIframe) {
    return page.frameLocator("iframe").first().getByText(text);
  }
  return page.getByText(text);
}

async function gotoAppRoute(page: Page, hashPath: string): Promise<void> {
  if (!appScopeIsIframe) {
    await page.goto(`/${hashPath}`);
    return;
  }
  const frame = page
    .frames()
    .find((f) => !f.isDetached() && f !== page.mainFrame());
  if (frame) {
    await frame.evaluate((hash) => {
      window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
    }, hashPath);
    await page.waitForTimeout(500);
  }
}

test.describe("visual regression — key pages", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    const iframeAppeared = await page
      .waitForSelector("iframe", { timeout: 30_000, state: "attached" })
      .then(() => true)
      .catch(() => false);
    appScopeIsIframe = iframeAppeared;

    // Wait for the SideNav brand text — signal that the app is past AdminAccessGate.
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 60_000) {
      if (
        await appText(page, "Power Platform CoE")
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        ready = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!ready) {
      test.skip(true, "App didn't render past AdminAccessGate — see README.");
    }
  });

  test("Agents list page", async ({ page }) => {
    test.setTimeout(120_000); // Agents page is slow — 16k+ rows on real tenant
    await gotoAppRoute(page, "/agents");
    await expect(appText(page, /Showing \d/).first()).toBeVisible({
      timeout: 90_000,
    });
    await page.waitForTimeout(1_500);
    await expect(page).toHaveScreenshot("agents-list.png");
  });

  test("Apps list page", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoAppRoute(page, "/apps");
    await expect(appText(page, /Showing \d/).first()).toBeVisible({
      timeout: 90_000,
    });
    await page.waitForTimeout(1_500);
    await expect(page).toHaveScreenshot("apps-list.png");
  });

  test("Environments list page", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoAppRoute(page, "/environments");
    await expect(appText(page, /\d+ of \d+/).first()).toBeVisible({
      timeout: 90_000,
    });
    await page.waitForTimeout(1_500);
    await expect(page).toHaveScreenshot("environments-list.png");
  });

  test("Side navigation (sidebar only)", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoAppRoute(page, "/dashboards");
    const nav = appLocator(page, "nav").first();
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await expect(nav).toHaveScreenshot("side-nav.png");
  });
});
