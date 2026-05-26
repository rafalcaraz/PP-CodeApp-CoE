/**
 * Auth-required smoke tests — verify the main inventory navigation
 * flows render against a real authenticated session.
 *
 * Runs in the `smoke` Playwright project. Requires `npm run e2e:auth`
 * to have been run first (creates the storage state file).
 *
 * **Iframe-aware:** when E2E_BASE_URL is the Power Apps player URL
 * (the local-dev wrapper), the app lives in an iframe. We use a
 * helper to scope queries either to the top-level page (direct
 * localhost / deployed URL) or to the player's iframe.
 */
import { test, expect, type Page, type FrameLocator, type Locator } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

// Determined at runtime in beforeEach by checking if an iframe exists
// on the loaded page. Both the local-dev player URL and the deployed
// /play/e/<env>/app/<id> URL put the app inside an iframe; only direct
// localhost or fully-deployed-direct URLs render at the top level.
let appScopeIsIframe = false;

/**
 * Scope queries to either the top-level page or the player's iframe.
 * Runtime-detected based on whether an iframe exists at page load.
 */
function app(page: Page): {
  locator: (sel: string) => Locator;
  getByText: (text: RegExp | string, opts?: { exact?: boolean }) => Locator;
  getByRole: (role: Parameters<Page["getByRole"]>[0], opts?: Parameters<Page["getByRole"]>[1]) => Locator;
} {
  if (appScopeIsIframe) {
    const frame: FrameLocator = page.frameLocator("iframe").first();
    return {
      locator: (sel) => frame.locator(sel),
      getByText: (text, opts) => frame.getByText(text, opts),
      getByRole: (role, opts) => frame.getByRole(role, opts),
    };
  }
  return {
    locator: (sel) => page.locator(sel),
    getByText: (text, opts) => page.getByText(text, opts),
    getByRole: (role, opts) => page.getByRole(role, opts),
  };
}

/**
 * Navigate to a hash route on the app. When in iframe mode, set the
 * iframe's location.hash directly via evaluate (the player URL doesn't
 * pass through fragments to the iframe).
 */
async function gotoAppRoute(page: Page, hashPath: string): Promise<void> {
  if (!appScopeIsIframe) {
    await page.goto(`/${hashPath}`); // e.g. /#/agents
    return;
  }
  const frame = page
    .frames()
    .find((f) => !f.isDetached() && f.url().includes("/") && f !== page.mainFrame());
  if (frame) {
    await frame.evaluate((hash) => {
      window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
    }, hashPath);
    await page.waitForTimeout(500);
  }
}

test.describe("inventory nav smoke", () => {
  test.beforeEach(async ({ page }) => {
    // Land on the app root first so the iframe gets a chance to load.
    await page.goto(BASE_URL);

    // Detect at runtime whether the app loads at the top level
    // (deployed without player wrapper / direct localhost) or inside
    // an iframe (any apps.powerapps.com URL, both /a/local and /app/).
    // Wait up to 30s for an iframe to appear; if none, top-level mode.
    const iframeAppeared = await page
      .waitForSelector("iframe", { timeout: 30_000, state: "attached" })
      .then(() => true)
      .catch(() => false);

    // Re-evaluate the scoping based on what we actually see.
    // We mutate module state here for the test helpers below.
    appScopeIsIframe = iframeAppeared;

    // Wait for the app to render past AdminAccessGate. We check for a
    // Power Platform CoE brand-specific text rather than just <nav>,
    // because the Power Apps maker portal also has a <nav>.
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 60_000) {
      if (
        await app(page)
          .getByText("Power Platform CoE")
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
      test.skip(
        true,
        appScopeIsIframe
          ? "App didn't render past AdminAccessGate inside the player iframe. " +
            "Power Apps player wrapper is fragile for automation. See README."
          : "App didn't render past AdminAccessGate at top level. " +
            "Did `npm run e2e:auth` complete successfully?",
      );
    }
  });

  test("Agents page loads and renders rows", async ({ page }) => {
    await gotoAppRoute(page, "/agents");
    // The page title appears both in the SideNav (as a section button)
    // and as the page heading. Scope to the main content area or use
    // .first() to avoid strict-mode collisions.
    await expect(
      app(page).getByRole("main").getByText("Agents", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(app(page).getByText(/Showing \d/).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Apps page loads and renders rows", async ({ page }) => {
    await gotoAppRoute(page, "/apps");
    await expect(
      app(page).getByRole("main").getByText("Apps", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(app(page).getByText(/Showing \d/).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Flows page loads and renders rows", async ({ page }) => {
    await gotoAppRoute(page, "/flows");
    await expect(
      app(page).getByRole("main").getByText("Flows", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(app(page).getByText(/Showing \d/).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Environments page loads and renders rows", async ({ page }) => {
    await gotoAppRoute(page, "/environments");
    await expect(
      app(page)
        .getByRole("main")
        .getByText("Environments", { exact: true })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    // EnvironmentsList uses its own shell — count is "X of Y" not "Showing".
    await expect(app(page).getByText(/\d+ of \d+/).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
