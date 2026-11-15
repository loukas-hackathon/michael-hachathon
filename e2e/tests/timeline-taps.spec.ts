import { randomUUID } from "node:crypto";
import { API_URL, expect, test } from "./fixtures";

// QA round 2 (#346): time drawn over a planned block (a workout from the watch, time the user
// logged) swallowed the tap, so a block it covered could not be opened, and Did it / Didn't was
// out of reach. Those drawings let the tap through to the block beneath.

const athens = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

test("Timeline: a block covered by logged time still opens on a tap", async ({ page, context, baseURL }) => {
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
    title: "Study",
    weekly_budget_minutes: 300,
  });

  // Yesterday 10:00 to 11:00 Athens: a calendar block, and the same hour logged as done.
  const day = athens(-1);
  const at = (hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`).toISOString();
  await asUser("/v1/events", "POST", {
    source: "google_calendar",
    type: "calendar_event",
    start_at: at("10:00"),
    end_at: at("11:00"),
    title: "Study block",
    external_id: `qa-${user}`,
  });
  await asUser("/v1/log", "POST", { goal_id: goal.id, start_at: at("10:00"), end_at: at("11:00") });

  await page.goto(`/timeline?day=${day}`);
  const block = page.locator("#day-timeline").getByRole("button", { name: /^Study block, 10:00 to 11:00/ });
  await block.scrollIntoViewIfNeeded();
  // A real tap in the middle of the block, where the logged time is drawn on top.
  const box = await block.boundingBox();
  if (!box) throw new Error("block not laid out");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("dialog")).toContainText("Study block");
});
