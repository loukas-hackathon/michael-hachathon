import { expect, test } from "./fixtures";

// "Get the app" on /login (#460): one quiet line in a browser tab, the Home Screen steps on iPhone
// Safari, and nothing at all once Michael runs from the Home Screen.

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

test.use({ userAgent: IPHONE_SAFARI });

test("the login page offers the app in a Safari tab and opens the steps", async ({ page }) => {
  await page.goto("/login");
  const row = page.getByRole("button", { name: "Get the app" });
  await expect(row).toBeVisible();
  await row.click();
  const sheet = page.getByRole("dialog", { name: "Get the app" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Add to Home Screen")).toBeVisible();
  await expect(sheet.getByText("Open Michael from your Home Screen")).toBeVisible();
  await expect(sheet.getByText("Notifications need iOS 16.4 or later.")).toBeVisible();

  // Not now, for good on this device: the row stays gone after a reload.
  await sheet.getByRole("button", { name: "Don't show this again" }).click();
  await expect(row).toBeHidden();
  await page.reload();
  await expect(page.getByText("See the demo week")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get the app" })).toBeHidden();
});

test("the row is hidden when Michael already runs from the Home Screen", async ({ page }) => {
  // Chromium cannot emulate display-mode, so the page's media query answers as a Home Screen app.
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (!query.includes("display-mode: standalone")) return real(query);
      return Object.defineProperties(real("all"), { matches: { value: true }, media: { value: query } });
    };
  });
  await page.goto("/login");
  await expect(page.getByText("See the demo week")).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(true);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Get the app" })).toHaveCount(0);
});
