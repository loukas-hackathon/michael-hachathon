import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, fillReady, tap, test } from "./fixtures";

// Email and password (#475, #492): create an account and you are in, sign in, a wrong password, and
// the switch between the two, all on /login without leaving the page for another site. Hermetic:
// with E2E_TEST_AUTH=on the server action keeps test accounts in memory and signs in with the e2e
// test cookie; on a deployment the same form talks to POST /v1/accounts and Supabase Auth.

const form = (page: Page) => page.getByRole("form", { name: "Email sign in" });

async function openEmail(page: Page) {
  await page.goto("/login");
  await tap(page.getByRole("button", { name: "Continue with email" }));
  await expect(page.getByPlaceholder("Email")).toBeFocused();
}

async function signedIn(page: Page) {
  // Let the signed in page finish loading: signing out under a render still in flight fails it.
  await page.waitForLoadState("networkidle");
  expect((await page.context().cookies()).map((c) => c.name)).toContain("michael_e2e_user");
}

test("create an account and you land on onboarding, signed in, with no extra tap", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  // Closed until asked: the fields are not reachable yet.
  await expect(page.locator("[inert] input[name=email]")).toHaveCount(1);
  await openEmail(page);

  // A short password never leaves the device.
  await fillReady(page.getByPlaceholder("Email"), email);
  await fillReady(page.getByPlaceholder(/^Password/), "short");
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(form(page).getByRole("alert")).toHaveText("Passwords need 8 characters at least. Add a few.");

  // One tap on Create account: straight into onboarding. No "now sign in", no second button.
  await fillReady(page.getByPlaceholder(/^Password/), "lift heavy 0600");
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(page).toHaveURL(/\/onboarding$/);
  await signedIn(page);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

test("sign in, a wrong password, and the switch between modes", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = "lift heavy 0600";

  // An account to sign in to.
  await openEmail(page);
  await fillReady(page.getByPlaceholder("Email"), email);
  await fillReady(page.getByPlaceholder(/^Password/), password);
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(page).toHaveURL(/\/onboarding$/);
  await signedIn(page);
  await page.goto("/auth/signout");
  await expect(page).toHaveURL(/\/login$/);

  // The switch: one field set, the button and the way across change together.
  await openEmail(page);
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  await tap(page.getByRole("button", { name: "Sign in", exact: true }));
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveAttribute("type", "submit");
  await expect(page.getByPlaceholder("Password", { exact: true })).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  await tap(page.getByRole("button", { name: "Create an account" }));
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();

  // Create again with another password: Michael says it exists and offers Sign in, password kept.
  await fillReady(page.getByPlaceholder("Email"), email);
  await fillReady(page.getByPlaceholder(/^Password/), "not my password");
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(form(page).getByRole("alert")).toHaveText("You already have an account. Sign in instead.");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveAttribute("type", "submit");

  // A wrong password: one line, still on /login.
  await tap(page.getByRole("button", { name: "Sign in", exact: true }));
  await expect(form(page).getByRole("alert")).toHaveText("Wrong email or password. Try again.");
  await expect(page).toHaveURL(/\/login$/);

  // The right one signs in, to Today's side of the app.
  await fillReady(page.getByPlaceholder(/^Password/), password);
  await tap(page.getByRole("button", { name: "Sign in", exact: true }));
  await expect(page).not.toHaveURL(/\/login/);
  await signedIn(page);
  await page.goto("/you");
  await expect(page.getByText("Signed in as")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.goto("/auth/signout");
  await expect(page).toHaveURL(/\/login$/);

  // Create account with the right password for an existing account simply signs in.
  await openEmail(page);
  await fillReady(page.getByPlaceholder("Email"), email);
  await fillReady(page.getByPlaceholder(/^Password/), password);
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(page).not.toHaveURL(/\/login/);
  await signedIn(page);
});
