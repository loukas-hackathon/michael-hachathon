import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// A brand new account (#478): judges may sign up on the night. Today, Goals, Timeline and Chat each
// give one next step, never a "0%" score, an empty chart or a list with nothing to do.

test("a brand new account is guided on every screen, and a goal is one tap", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET"): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}` },
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (res.status === 204 ? null : await res.json()) as T;
  };
  // The empty account a real first sign in has, not the sample day.
  await asUser("/v1/me/data", "DELETE");

  const noZeros = async () => {
    await expect(page.getByText(/\b0%/)).toHaveCount(0);
    await expect(page.getByText(/\b0 min\b/)).toHaveCount(0);
    await expect(page.getByText(/\b0 of \d+ (days|nights)\b/)).toHaveCount(0);
  };

  // Onboarding, skipped: Today is Get started and its one action, nothing else.
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await tap(page.getByRole("button", { name: "Skip", exact: true }));
  await expect(page).toHaveURL(/\/$/);
  const start = page.getByRole("region", { name: "Get started" });
  await expect(start.getByRole("link", { name: "Set my goals" })).toBeVisible();
  await expect(page.getByText("Optimisation score")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Morning plan" })).toHaveCount(0);
  await expect(page.getByText("Studying you.")).toHaveCount(0);
  await noZeros();

  // Goals: one goal per area, each one tap with its weekly budget.
  await page.goto("/goals");
  await expect(page.getByRole("heading", { name: "Pick your first goal." })).toBeVisible();
  const suggested = page.getByRole("list", { name: "Suggested goals" });
  await expect(suggested.getByRole("button", { name: /^Add / })).toHaveCount(3);
  await expect(suggested.getByText("10h a week · Business")).toBeVisible();
  await tap(suggested.getByRole("button", { name: "Add Deep work" }));
  // The first goal reads as a week ahead, never as already behind.
  await expect(page.getByRole("region", { name: "Needs you most" })).toContainText(
    "Deep work first: 10h this week, counted from today.",
  );
  await expect(page.getByText("behind pace")).toHaveCount(0);
  await noZeros();
  const { goals } = await asUser<{ goals: { title: string; weekly_budget_minutes: number | null }[] }>(
    "/v1/goals",
  );
  expect(goals.map((g) => [g.title, g.weekly_budget_minutes])).toEqual([["Deep work", 600]]);

  // Today again: the next step is the calendar.
  await page.goto("/");
  await expect(start.getByRole("link", { name: "Connect calendar" })).toBeVisible();
  await noZeros();

  // Timeline: what will appear, and the one action.
  await page.goto("/timeline");
  await expect(page.getByText("Your calendar blocks show here")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect your calendar" })).toBeVisible();
  await expect(page.getByText("No screens recorded")).toHaveCount(0);

  // Chat: one line on what Michael does, and three things to ask.
  await page.goto("/chat");
  await expect(
    page.getByText("I plan your week around your goals and book the time in your calendar."),
  ).toBeVisible();
  for (const name of ["Plan my week", "Book 2 hours for deep work tomorrow", "What do you know about me"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});
