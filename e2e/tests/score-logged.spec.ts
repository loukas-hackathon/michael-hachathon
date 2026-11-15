import { randomUUID } from "node:crypto";
import { API_URL, expect, test } from "./fixtures";

type Score = {
  day: { planned_minutes: number; spent_minutes: number; score_pct: number | null; logged_minutes?: number };
  goals: { goal_id: string; spent_minutes: number; logged_minutes?: number; minutes_left: number }[];
};

// #372: time logged outside every block counts toward the goal's budget, never toward the score.
// The issue's morning, on a fresh user: one 90 minute block later today, 30 minutes logged before
// it. Before the fix Today jumped to "100% so far" and "keeps the day" fell from 63 to 54.

const athensHour = () =>
  Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Athens" }).format(
      new Date(),
    ),
  );

test("logging outside a block moves the goal's week, not Today's score or 'keeps the day'", async ({
  page,
  context,
  baseURL,
}) => {
  // The block must fit in today after now, and the log in today before it.
  const hour = athensHour();
  test.skip(hour < 1 || hour >= 21, "needs today to hold 40 minutes before now and 2h 30 after it");

  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return (res.status === 204 ? null : await res.json()) as T;
  };
  await asUser("/v1/me/data", "DELETE");
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  const goal = await asUser<{ id: string }>("/v1/goals", "POST", {
    category: "work",
    title: "University",
    weekly_budget_minutes: 360,
    target: { calendar_titles: ["University"] },
  });
  const minute = 60_000;
  const now = Math.floor(Date.now() / minute) * minute;
  await asUser("/v1/events", "POST", {
    source: "google_calendar",
    type: "calendar_event",
    start_at: new Date(now + 60 * minute).toISOString(),
    end_at: new Date(now + 150 * minute).toISOString(),
    title: "University",
    data: { attendees: 0 },
    external_id: `e2e-372-${user}`,
  });

  const score = () => asUser<Score>("/v1/score");
  const before = await score();
  expect([before.day.planned_minutes, before.day.spent_minutes, before.day.score_pct]).toEqual([90, 0, null]);

  await page.goto("/");
  await expect(
    page.getByText(/Your first block starts at \d\d:\d\d\. 63 minutes keeps the day\./),
  ).toBeVisible();

  // 30 minutes logged before the block: the budget moves, the day's plan and score do not.
  await asUser("/v1/log", "POST", {
    goal_id: goal.id,
    start_at: new Date(now - 40 * minute).toISOString(),
    end_at: new Date(now - 10 * minute).toISOString(),
  });
  const after = await score();
  expect([after.day.planned_minutes, after.day.spent_minutes, after.day.score_pct]).toEqual([90, 0, null]);
  expect(after.day.logged_minutes).toBe(30);
  const row = after.goals.find((g) => g.goal_id === goal.id);
  expect([row?.spent_minutes, row?.logged_minutes, row?.minutes_left]).toEqual([0, 30, 330]);

  // Today: the same sentence, the same 63 minutes, and the day bar reads the day's plan.
  await page.reload();
  await expect(
    page.getByText(/Your first block starts at \d\d:\d\d\. 63 minutes keeps the day\./),
  ).toBeVisible();
  await expect(page.getByText(/% of your goal time so far\./)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "This week against the 70% line" })).toContainText(
    "today: 0% of 1h 30 planned, the line is 70%",
  );

  // Goals: the budget counts it, and says where it came from.
  await page.goto("/goals");
  await expect(page.getByText("30 min of it you logged outside your blocks.").first()).toBeVisible();
});
