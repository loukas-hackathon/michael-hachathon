import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// Saying "I did x" on Goals (#317): a fresh user with one goal, Everything bath at 60 minutes a
// week, logs 30 minutes from the goal's row, sees the maths, then takes it back.

test("a goal row logs 30 minutes with the maths, and Undo takes it back", async ({
  page,
  context,
  baseURL,
}) => {
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
    title: "Everything bath",
    weekly_budget_minutes: 60,
  });

  await page.goto("/goals");
  await tap(page.getByRole("button", { name: "Log time for Everything bath" }));
  const sheet = page.getByRole("dialog");
  await tap(sheet.getByRole("button", { name: "30 min", exact: true }));
  await tap(sheet.getByRole("button", { name: "Log 30 min" }));
  // Michael varies how he says Logged (#398): the minutes and the maths are what stay.
  await expect(sheet.getByRole("status")).toContainText("30 min");
  await expect(sheet.getByRole("status")).toContainText("Everything bath: 30 of 60 min this week.");
  // Nothing left to cancel once logged: the sheet closes with Done (QA round 2, #346).
  await expect(sheet.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);

  // On the API: one manual entry for the goal.
  const from = new Date(Date.now() - 2 * 3600_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const logged = await asUser<{ events: { source: string; data: { goal_id?: string } }[] }>(
    `/v1/timeline?${new URLSearchParams({ from, to })}`,
  );
  expect(logged.events.filter((e) => e.source === "manual" && e.data.goal_id === goal.id)).toHaveLength(1);

  await tap(sheet.getByRole("button", { name: "Undo" }));
  await expect(sheet.getByRole("status")).toContainText("Off the books.");
  await expect
    .poll(async () => {
      const after = await asUser<{ events: { source: string; data: { goal_id?: string } }[] }>(
        `/v1/timeline?${new URLSearchParams({ from, to })}`,
      );
      return after.events.filter((e) => e.source === "manual" && e.data.goal_id === goal.id).length;
    })
    .toBe(0);
});
