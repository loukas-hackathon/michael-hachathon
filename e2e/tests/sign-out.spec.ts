import { randomUUID } from "node:crypto";
import { expect, tap, test } from "./fixtures";

// Sign out (#459): one tap lands on a clean /login, nothing of the old account stays on the device,
// and Back does not show the old account. The test sign in (cookie michael_e2e_user) only works
// with E2E_TEST_AUTH=on on the in-memory API.

test("sign out lands on a clean login and Back does not bring the account back", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);

  // Goals first, so Back after signing out has a signed in page to try.
  await page.goto("/goals");
  await expect(page).toHaveURL(/\/goals$/);
  await page.goto("/you");
  await expect(page).toHaveURL(/\/you$/);
  await expect(page.getByText("Signed in as")).toBeVisible();
  // What a signed in visit leaves in the browser: chat steps, the splash flag, the off the record copy.
  await page.evaluate(() => {
    sessionStorage.setItem("michael.chat.steps", "old account");
    localStorage.setItem("michael.offTheRecord", JSON.stringify({ on: true, since: null }));
  });

  const started = Date.now();
  await tap(page.getByRole("link", { name: "Sign out" }));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "On your side." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeEnabled();
  expect(Date.now() - started, "sign out takes about a second at most").toBeLessThan(3000);

  // No error line, no tab bar, nothing of the old account.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Michael" })).toHaveCount(0);
  await expect(page.getByText("Signed in as")).toHaveCount(0);
  const cookies = (await context.cookies()).map((c) => c.name);
  expect(cookies).not.toContain("michael_e2e_user");
  expect(cookies).not.toContain("michael_next");
  expect(cookies).not.toContain("michael_demo");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        session: sessionStorage.length,
        local: Object.keys(localStorage).filter((k) => k.startsWith("michael")),
      })),
    )
    .toEqual({ session: 0, local: [] });

  // Back never shows the old account: it is /login again, or the signed out redirect to it.
  await page.goBack();
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByText("Signed in as")).toHaveCount(0);

  // A signed in page is out of reach now.
  await page.goto("/you");
  await expect(page).toHaveURL(/\/login\?next=%2Fyou$/);
});
