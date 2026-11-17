import { randomUUID } from "node:crypto";
import { enterDemo, expect, test } from "./fixtures";

// /traction is for the founders only (admin.ts: a signed in account whose email is in
// ADMIN_EMAILS). Anyone else, a signed in user or a demo visitor, meets the calm not found, and
// no number is shown.

test("a signed in user who is not an admin meets a calm not found on /traction", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto("/traction");
  await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy for investors" })).toHaveCount(0);
  await expect(page.getByText("people signed up")).toHaveCount(0);
});

test("a demo visitor meets the same not found on /traction", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/traction");
  await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy for investors" })).toHaveCount(0);
});
