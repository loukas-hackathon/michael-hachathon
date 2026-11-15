import { randomUUID } from "node:crypto";
import { expect, fillReady, tap, test } from "./fixtures";

// Email and password (#475): create an account, sign out, sign in, and a wrong password, all on
// /login without leaving the page for another site. Hermetic: with E2E_TEST_AUTH=on the server
// action keeps test accounts in memory and signs in with the e2e test cookie; on a deployment the
// same form talks to Supabase Auth.

test("create an account, sign out, sign in, and a wrong password says so", async ({ page, context }) => {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = "lift heavy 0600";

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  // Closed until asked: the fields are not reachable yet.
  await expect(page.locator("[inert] input[name=email]")).toHaveCount(1);
  await tap(page.getByRole("button", { name: "Continue with email" }));
  const emailField = page.getByPlaceholder("Email");
  const passwordField = page.getByPlaceholder(/^Password/);
  await expect(emailField).toBeVisible();
  await expect(emailField).toBeFocused();

  // A short password never leaves the device.
  await fillReady(emailField, email);
  await fillReady(passwordField, "short");
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(page.getByRole("form", { name: "Email sign in" }).getByRole("alert")).toHaveText(
    "Passwords need 8 characters at least. Add a few.",
  );

  // Create the account: straight into the app, no other site on the way.
  await fillReady(passwordField, password);
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(page).not.toHaveURL(/\/login/);
  expect((await context.cookies()).map((c) => c.name)).toContain("michael_e2e_user");

  // Sign out, then try to create it again: Michael says it exists and offers Sign in.
  await page.goto("/auth/signout");
  await expect(page).toHaveURL(/\/login$/);
  await tap(page.getByRole("button", { name: "Continue with email" }));
  await fillReady(page.getByPlaceholder("Email"), email);
  await fillReady(page.getByPlaceholder(/^Password/), password);
  await tap(page.getByRole("button", { name: "Create account" }));
  await expect(page.getByRole("form", { name: "Email sign in" }).getByRole("alert")).toHaveText(
    "You already have an account. Sign in instead.",
  );
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  // A wrong password: one line, still on /login.
  await fillReady(page.getByPlaceholder(/^Password/), "not my password");
  await tap(page.getByRole("button", { name: "Sign in", exact: true }));
  await expect(page.getByRole("form", { name: "Email sign in" }).getByRole("alert")).toHaveText(
    "Wrong email or password. Try again.",
  );
  await expect(page).toHaveURL(/\/login$/);

  // The right one signs in.
  await fillReady(page.getByPlaceholder(/^Password/), password);
  await tap(page.getByRole("button", { name: "Sign in", exact: true }));
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/you");
  await expect(page.getByText("Signed in as")).toBeVisible();
});
