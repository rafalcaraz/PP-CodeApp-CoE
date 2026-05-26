/**
 * Anonymous smoke tests — verify the app boots without needing
 * Microsoft auth. The AdminAccessGate blocks data calls, but React +
 * Fluent should still mount cleanly. This is the cheapest possible
 * "is the app fundamentally broken?" test.
 *
 * Runs in the `smoke-anon` Playwright project (no storageState).
 * Files in this folder named `*.anon.spec.ts` go here.
 */
import { test, expect } from "@playwright/test";

test.describe("anonymous boot smoke", () => {
  test("app loads, React mounts, Fluent provider initializes", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for the React root to render *something*.
    await expect(page.locator("#root")).not.toBeEmpty();
    // Fluent provider is the first thing rendered — its className
    // pattern is stable across Fluent v9.
    await expect(
      page.locator(".fui-FluentProvider").first(),
    ).toBeAttached();
  });

  test("AdminAccessGate renders the 'Checking access…' state", async ({
    page,
  }) => {
    await page.goto("/");
    // The gate component renders this text first while it kicks off
    // the admin role check. Even without auth, the text shows.
    await expect(page.getByText(/Checking access/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("no uncaught errors during initial load", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        // Filter out the known auth-related errors that AdminAccessGate
        // produces (it tries to call the admin connector without auth
        // and gets a 401 — expected in this test).
        const text = msg.text();
        if (
          /401|Unauthorized|admin|access|sign|connector/i.test(text)
        ) {
          return;
        }
        consoleErrors.push(text);
      }
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    expect(
      consoleErrors,
      "Unexpected console errors during boot:\n" + consoleErrors.join("\n"),
    ).toEqual([]);
  });
});
