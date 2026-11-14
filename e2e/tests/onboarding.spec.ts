import { randomUUID } from "node:crypto";
import { API_URL, enterDemo, expect, tap, test } from "./fixtures";

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
  await expect(page).toHaveURL(/\/onboarding$/);
  const next = page.getByRole("button", { name: /^(Next|None of these|Start)$/ });

  await expect(page.getByRole("heading", { name: "What are we playing for?" })).toBeVisible();
  const deepWork = page.getByRole("button", { name: /Deep work/ });
  await tap(deepWork);
  await expect(deepWork).toHaveAttribute("aria-pressed", "true");
  await tap(next);
  await expect(page.getByRole("heading", { name: "What does a usual week look like?" })).toBeVisible();
  await tap(next);
  await expect(page.getByRole("heading", { name: "Where does your time leak?" })).toBeVisible();
  await tap(next);
  await expect(page.getByRole("heading", { name: "When should I stay quiet?" })).toBeVisible();
  await tap(next); // saves
  await expect(page.getByRole("heading", { name: "Let me see your day." })).toBeVisible();
  // Connecting Google would leave the machine: take the quiet way past it.
  await tap(page.getByRole("button", { name: "Later" }));
  await expect(page.getByRole("heading", { name: "Right. Let's get to work." })).toBeVisible();
  // "Start", or "Not now" when the browser could take nudges.
  await tap(page.getByRole("button", { name: /^(Start|Not now)$/ }));

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Today|Evening)$/ })).toBeVisible();

  // Saved for this user only, never on the demo account.
  const { goals } = await asUser<{ goals: { title: string }[] }>("/v1/goals");
  expect(goals.map((g) => g.title)).toEqual(["Deep work"]);
  const profile = await asUser<{ onboarded_at: string | null }>("/v1/profile");
  expect(profile.onboarded_at).not.toBeNull();
});

// Redo setup on the demo week: the visitor walks the whole talk; nothing is written (#239).
test("a demo visitor can walk onboarding to the end", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/onboarding");
  const next = page.getByRole("button", { name: /^(Next|None of these)$/ });
  await expect(page.getByRole("heading", { name: "What are we playing for?" })).toBeVisible();
  await tap(next);
  await expect(page.getByRole("heading", { name: "What does a usual week look like?" })).toBeVisible();
  await tap(next);
  await expect(page.getByRole("heading", { name: "Where does your time leak?" })).toBeVisible();
  await tap(next);
  await expect(page.getByRole("heading", { name: "When should I stay quiet?" })).toBeVisible();
  await tap(next);
  await expect(page.getByRole("heading", { name: "Let me see your day." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Apple Watch" })).toBeVisible();
});
