/**
 * Visual regression tests — pixel-diff key pages against committed
 * baselines under `tests/e2e/screenshots/`.
 *
 * Workflow:
 *   - First run on a new test: `npm run e2e:update-snapshots` —
 *     Playwright records the baseline.
 *   - Subsequent runs: `npm run e2e:visual` — fails if the rendered
 *     page diverges from the baseline by more than `maxDiffPixelRatio`
 *     (configured in playwright.config.ts — currently 0.2%).
 *   - To accept a diff (e.g. after an intentional UI change), re-run
 *     `npm run e2e:update-snapshots` and review the diff before
 *     committing the new baselines.
 *
 * Baselines live next to this spec file in
 * `<spec-file-name>-snapshots/` subdirs created automatically by
 * Playwright. They're committed to git — yes, binary files in git. A
 * few KB each is fine; the alternative (per-developer baselines) is
 * unreproducible.
 *
 * Auth required.
 */
import { test, expect } from "@playwright/test";

test.describe("visual regression — key pages", () => {
  test("Agents list page", async ({ page }) => {
    await page.goto("/#/agents");
    // Wait for the row count to appear — that's the signal that the
    // server data has landed and the DataGrid has rendered.
    await expect(page.getByText(/Showing \d/)).toBeVisible({
      timeout: 30_000,
    });
    // Small settle delay so any in-flight Fluent animations finish.
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("agents-list.png");
  });

  test("Apps list page", async ({ page }) => {
    await page.goto("/#/apps");
    await expect(page.getByText(/Showing \d/)).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("apps-list.png");
  });

  test("Environments list page", async ({ page }) => {
    await page.goto("/#/environments");
    await expect(page.getByText(/\d+ of \d+/)).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("environments-list.png");
  });

  test("Side navigation (sidebar only)", async ({ page }) => {
    await page.goto("/#/dashboards");
    // Use a stable element to wait on — the SideNav is rendered as
    // soon as the layout shell mounts.
    const nav = page.locator("nav").first();
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(nav).toHaveScreenshot("side-nav.png");
  });
});
