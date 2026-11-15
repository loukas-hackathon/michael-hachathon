import { randomUUID } from "node:crypto";
import { API_URL, enterDemo, expect, fillReady, tap, test } from "./fixtures";

// A fresh, non demo user: Today sends them to onboarding, two screens, and Today takes them in.
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
  // Two goals start ticked: a week anyone can hold. One tap keeps them.
  await expect(page.getByRole("button", { name: /^Deep work/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Training/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Sleep/ })).toHaveAttribute("aria-pressed", "false");
  // Each starter says its area; one more goal in the user's own words (#190).
  await expect(page.getByRole("button", { name: /^Time for yourself.*Personal$/ })).toBeVisible();
  await fillReady(page.getByLabel("Something else, in your own words"), "Learn Greek");
  await tap(page.getByRole("button", { name: "Keep these three" }));

  await expect(page.getByRole("heading", { name: "Now, your days." })).toBeVisible();
  // Only connections proven on production are offered (#295); Coming soon ones are not here at all.
  await expect(page.getByText("Google Calendar")).toBeVisible();
  await expect(page.getByText("Apple Watch")).toHaveCount(0);
  await tap(page.getByRole("link", { name: "Go to Today" }));

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Today|Evening)$/ })).toBeVisible();

  // Saved for this user only, never on the demo account.
  const { goals } = await asUser<{ goals: { title: string }[] }>("/v1/goals");
  expect(goals.map((g) => g.title).sort()).toEqual(["Deep work", "Learn Greek", "Training"]);
  const profile = await asUser<{ onboarded_at: string | null }>("/v1/profile");
  expect(profile.onboarded_at).not.toBeNull();

  // House rules are one tap on You (#190), and leave the suggestions once added.
  await page.goto("/you");
  await tap(page.getByRole("button", { name: "Add: Keep Sundays clear" }));
  await expect(page.getByRole("button", { name: "Add: Keep Sundays clear" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Keep Sundays clear" })).toBeChecked();
});

// Redo setup on the demo week: the visitor walks both screens; nothing is written (#239).
test("a demo visitor can walk onboarding to the end", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: /^(What are we playing for\?|Here's what your week is for\.)$/ }),
  ).toBeVisible();
  // The demo week already has goals, so they start ticked and one tap moves on.
  await tap(page.getByRole("button", { name: /^(Keep (this goal|these .+)|Next)$/ }));
  await expect(page.getByRole("heading", { name: /^(Here's your week\.|Now, your days\.)$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Today" })).toBeVisible();
});

// Connections not proven on production say Coming soon and offer nothing to tap (#295).
test("You shows unproven connections as Coming soon, with nothing to tap", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/you");
  const list = page.locator("#connections");
  await expect(list.getByText("Apple Watch")).toBeVisible();
  await expect(list.getByText("Coming soon").first()).toBeVisible();
  await expect(list.getByRole("link", { name: /Apple Watch/ })).toHaveCount(0);
  await page.goto("/you/connections/apple-watch");
  await expect(page.getByText("Coming soon. I will tell you when it is ready.")).toBeVisible();
});

// The demo week replays recorded sources, so a demo visitor sees them as what they are, and a tap
// the API refuses says the one demo line next to the control (#330).
test("You on the demo week: sources read Sample data, a refused tap says why", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/you");
  const list = page.locator("#connections");
  await expect(
    list.getByText("The demo week runs on sample data from calendar, Mac, iPhone and watch."),
  ).toBeVisible();
  await expect(list.getByText("Sample data", { exact: true })).toHaveCount(4);
  await expect(list.getByRole("link", { name: /Google Calendar|Apple Watch|Mac|iPhone/ })).toHaveCount(0);

  const privacy = page.locator("section", { has: page.getByRole("heading", { name: "Privacy" }) });
  await expect(async () => {
    await page.locator("#off-the-record").click();
    await expect(
      privacy.getByText("This is the demo week. Sign in with Google to make it yours."),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator("#off-the-record")).not.toBeChecked();
});
