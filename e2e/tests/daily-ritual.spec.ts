import { randomUUID } from "node:crypto";
import { API_URL, expect, fillReady, tap, test } from "./fixtures";

// The daily ritual (#318) for a fresh signed in user: the morning card keeps two outcomes (one for
// a goal, with an estimate), the outcomes move into Today's list, and the evening card ticks them
// and shows Michael's line with the maths. `?ritual=` shows each half whatever the clock says.

test("morning outcomes saved, evening ticked and logged", async ({ page, context, baseURL }) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  // An empty account with one goal, so Today opens (no onboarding) with nothing else on it.
  await asUser("/v1/me/data", "DELETE");
  const training = await asUser<{ id: string }>("/v1/goals", "POST", {
    category: "health",
    title: "Training",
    weekly_budget_minutes: 300,
  });

  await page.goto("/?ritual=morning");
  const morning = page.getByRole("region", { name: "Morning plan" });
  await expect(morning.getByRole("heading", { name: "What would make today a win?" })).toBeVisible();
  const first = morning.getByLabel("Outcome 1");
  await fillReady(first, "Send the deck");
  await fillReady(morning.getByLabel("Outcome 2"), "Long swim");
  await tap(morning.getByRole("button", { name: "Training" }));
  await tap(morning.getByRole("button", { name: "1h", exact: true }));
  await tap(morning.getByRole("button", { name: "Keep these 2" }));

  // Saved: the card goes, and the outcomes sit in Today's list.
  await expect(morning).toHaveCount(0);
  const list = page.getByRole("region", { name: "Today's outcomes" });
  await expect(list.getByText("Send the deck")).toBeVisible();
  await expect(list.getByText("Long swim")).toBeVisible();
  const day = await asUser<{
    items: { text: string; linked_goal_id: string | null; estimate_minutes: number | null }[];
  }>("/v1/ritual");
  expect(day.items.map((i) => [i.text, i.linked_goal_id, i.estimate_minutes])).toEqual([
    ["Send the deck", null, null],
    ["Long swim", training.id, 60],
  ]);

  await page.goto("/?ritual=evening");
  const evening = page.getByRole("region", { name: "Evening log" });
  await expect(evening.getByRole("heading", { name: "What did you get done?" })).toBeVisible();
  await tap(
    evening
      .getByRole("group", { name: "Send the deck: how did it go" })
      .getByRole("button", { name: "Done" }),
  );
  await tap(
    evening.getByRole("group", { name: "Long swim: how did it go" }).getByRole("button", { name: "Partly" }),
  );
  await tap(evening.getByRole("group", { name: /^Time on it/ }).getByRole("button", { name: "30 min" }));
  await tap(evening.getByRole("button", { name: "Carry to tomorrow" }));
  await tap(evening.getByRole("button", { name: "Log the day" }));

  await expect(page.getByRole("heading", { name: "The day, logged." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "1 of 2 done, 1 partly." })).toContainText(
    "30 min logged for Training. One carried to tomorrow.",
  );
});
