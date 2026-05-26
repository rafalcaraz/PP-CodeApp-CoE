/**
 * Auth-required smoke tests — verify the main inventory navigation
 * flows render against a real authenticated session.
 *
 * Runs in the `smoke` Playwright project, which depends on the
 * `setup` project (auth.setup.ts). If you haven't run
 * `npm run e2e:auth` yet, this test file will fail with a missing
 * storageState error — the message will tell you what to run.
 */
import { test, expect } from "@playwright/test";

test.describe("inventory nav smoke", () => {
  // Each test loads a list view, waits for at least one row, and
  // confirms the page title rendered. If the QueryResources call is
  // failing this catches it immediately — vitest can't.

  test("Agents page loads and renders rows", async ({ page }) => {
    await page.goto("/#/agents");
    await expect(page.getByRole("heading", { name: /Agents/i })).toBeVisible({
      timeout: 30_000,
    });
    // Wait for the count footer ("Showing X of Y") which only appears
    // when ResourceListPage transitions to its ready state.
    await expect(page.getByText(/Showing \d/)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Apps page loads and renders rows", async ({ page }) => {
    await page.goto("/#/apps");
    await expect(page.getByRole("heading", { name: /^Apps$/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Showing \d/)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Flows page loads and renders rows", async ({ page }) => {
    await page.goto("/#/flows");
    await expect(page.getByRole("heading", { name: /^Flows$/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Showing \d/)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Environments page loads and renders rows", async ({ page }) => {
    await page.goto("/#/environments");
    await expect(
      page.getByRole("heading", { name: /Environments/i }),
    ).toBeVisible({
      timeout: 30_000,
    });
    // EnvironmentsList uses its own custom shell — the count footer is
    // "X of Y" without the "Showing" prefix.
    await expect(page.getByText(/\d+ of \d+/)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("clicking an app row navigates to its detail page", async ({
    page,
  }) => {
    await page.goto("/#/apps");
    await expect(page.getByText(/Showing \d/)).toBeVisible({
      timeout: 30_000,
    });

    // Click the first row's name link. AppsList renders the displayName
    // inside a Fluent Link with role="link" in the Name column.
    const firstAppLink = page.locator('[role="row"]').nth(1).getByRole("link").first();
    await firstAppLink.click();

    // Detail page renders a breadcrumb back to "Apps" — wait for it
    // as the navigation-complete signal.
    await expect(
      page.getByRole("button", { name: /Apps/ }).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    // URL should match /apps/<guid>
    expect(page.url()).toMatch(/#\/apps\/[0-9a-f-]{36}/i);
  });
});
