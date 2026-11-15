import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// Focus now (#397): a fresh user with one goal starts 45 minutes from the goal's row on Goals, the
// calm session screen opens, survives a reload (the state is on the server), +15 moves the end,
// and End early asks "Count 1 min?" once there is a minute to count; one tap counts it as goal time.

type Session = {
  id: string;
  status: string;
  minutes: number;
  counted_minutes: number | null;
  log_recommendation_id: string | null;
};

test("start from Goals, leave and come back, +15, then end early and count it", async ({
  page,
  context,
  baseURL,
}) => {
  // Up to a minute and a half: the screen waits until there is a minute to count.
  test.setTimeout(150_000);
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (res.status === 204 ? null : await res.json()) as T;
  };
  await asUser("/v1/me/data", "DELETE");
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  const goal = await asUser<{ id: string }>("/v1/goals", "POST", {
    category: "personal",
    title: "University",
    weekly_budget_minutes: 360,
  });

  await page.goto("/goals");
  await tap(page.getByRole("button", { name: "Focus now on University" }).first());
  await tap(page.getByRole("dialog").getByRole("button", { name: "Focus for 45 minutes" }));

  // The session screen: the goal, the minutes left, until when. No Mac here, so no guard line.
  const screen = page.getByRole("dialog", { name: "University" });
  await expect(screen).toBeVisible();
  await expect(screen.getByText("minutes left")).toBeVisible();
  await expect(screen.getByText("45", { exact: true })).toBeVisible();
  await expect(screen.getByText("Michael is guarding your Mac.")).toHaveCount(0);

  const active = await asUser<{ session: Session | null }>("/v1/focus/active");
  expect(active.session?.status).toBe("active");
  expect(active.session?.minutes).toBe(45);

  // Leaving the app and coming back: the same countdown reattaches.
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "University" })).toBeVisible();

  await tap(page.getByRole("button", { name: "+15 min" }));
  await expect(
    page.getByRole("dialog", { name: "University" }).getByText("60", { exact: true }),
  ).toBeVisible();
  expect((await asUser<{ session: Session | null }>("/v1/focus/active")).session?.minutes).toBe(60);

  // End early asks first. Under half a minute in there is nothing to count; the screen's own clock
  // turns the question into "Count 1 min?" once there is, so the test waits for that, not a timer.
  await tap(page.getByRole("button", { name: "End early" }));
  const count = page.getByRole("button", { name: /^Count [1-9]\d* min$/ });
  await expect(count).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/^Count [1-9]\d* min\?$/)).toBeVisible();
  // Wait on the server's answer to the tap (the server action POST), never on time.
  const answered = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined,
  );
  await tap(count);
  expect((await answered).ok()).toBe(true);

  const result = page.getByRole("dialog", { name: /Counted \d+ min for University\./ });
  await expect(result).toBeVisible();
  await expect(result.getByText("It counts as goal time on Today and Goals.")).toBeVisible();

  // On the API: the session ended early, counted, and logged as done time for the goal.
  const after = await asUser<{ session: Session | null; last: Session | null }>("/v1/focus/active");
  expect(after.session).toBeNull();
  expect(after.last?.status).toBe("ended");
  expect(after.last?.counted_minutes ?? 0).toBeGreaterThanOrEqual(1);
  expect(after.last?.log_recommendation_id).toBeTruthy();
  const from = new Date(Date.now() - 2 * 3600_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const timeline = await asUser<{ events: { source: string; data: { goal_id?: string; log?: string } }[] }>(
    `/v1/timeline?${new URLSearchParams({ from, to })}`,
  );
  expect(
    timeline.events.filter(
      (e) => e.source === "manual" && e.data.log === "done" && e.data.goal_id === goal.id,
    ),
  ).toHaveLength(1);

  // Done closes the result, and it does not come back on the next visit.
  await tap(result.getByRole("button", { name: "Done" }));
  await expect(result).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("dialog", { name: /Counted/ })).toHaveCount(0);
});
