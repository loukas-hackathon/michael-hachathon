import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// A fresh, non demo user: Today sends them to onboarding, they answer, and Today takes them in.
// The test sign in (cookie michael_e2e_user) only works with E2E_TEST_AUTH=on on the in-memory API.

test("onboarding completes for a fresh user", async ({ page, context, baseURL }) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET"): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}` },
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  // The in-memory store hands every new user the sample day; deleting it leaves the empty account a
  // real first sign in has (and checks that deletion really deletes).
  await asUser("/v1/me/data", "DELETE");

  await page.goto("/");
  // No Google keys here, so the calendar consent is skipped and the starters lead.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "What are we playing for?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Deep work/ })).toHaveAttribute("aria-pressed", "true");
  const training = page.getByRole("button", { name: /^Training/ });
  await tap(training); // untick: one goal is enough for the test
  await expect(training).toHaveAttribute("aria-pressed", "false");
  await tap(page.getByRole("button", { name: "Keep this goal" }));

  await expect(page.getByRole("heading", { name: "Now, your days." })).toBeVisible();
  await expect(page.getByText("Apple Watch")).toBeVisible();
  await tap(page.getByRole("link", { name: "Go to Today" }));

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Today|Evening)$/ })).toBeVisible();

  // Saved for this user only, never on the demo account.
  const { goals } = await asUser<{ goals: { title: string }[] }>("/v1/goals");
  expect(goals.map((g) => g.title)).toEqual(["Deep work"]);
  const profile = await asUser<{ onboarded_at: string | null }>("/v1/profile");
  expect(profile.onboarded_at).not.toBeNull();
});
