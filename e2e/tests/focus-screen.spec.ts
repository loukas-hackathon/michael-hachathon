import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// Focus now's session screen (#534): the whole goal name (Loukas saw "Personal T"), the ring
// draining in real time, the living Mi, and under reduced motion a still ring that steps once a
// minute. The session starts on the API, so no Shortcuts hand over happens here.

const TITLE = "Personal Training with the strength coach";

async function asUser<T>(user: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

for (const reduced of [false, true]) {
  test(`the session screen shows the whole goal${reduced ? ", still under reduced motion" : ", and drains"}`, async ({
    page,
    context,
    baseURL,
  }) => {
    const user = randomUUID();
    await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
    await asUser(user, "/v1/me/data", "DELETE");
    await asUser(user, "/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
    const goal = await asUser<{ id: string }>(user, "/v1/goals", "POST", {
      category: "health",
      title: TITLE,
      weekly_budget_minutes: 180,
    });
    await asUser(user, "/v1/focus/start", "POST", { goal_id: goal.id, minutes: 25 });
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    const screen = page.getByRole("dialog", { name: TITLE });
    await expect(screen).toBeVisible();
    const heading = screen.getByRole("heading", { name: TITLE });
    await expect(heading).toBeVisible();
    // Nothing cut: the heading's text fits its box (it wraps instead).
    expect(await heading.evaluate((h) => h.scrollWidth <= h.clientWidth + 1)).toBe(true);
    await expect(screen.getByText("minutes left")).toBeVisible();

    const ring = screen.locator("circle.m-ring-drain");
    if (reduced) {
      await expect(ring).toHaveCount(0);
      // The breathing Mi stands still.
      expect(
        await screen.locator(".m-focus-breath").evaluate((el) => getComputedStyle(el).animationName),
      ).toBe("none");
    } else {
      await expect(ring).toHaveCount(1);
      expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe("m-ring-drain");
    }

    // +15 restarts the drain to the new end, and the number follows.
    await tap(screen.getByRole("button", { name: "+15 min" }));
    await expect(screen.getByText("40", { exact: true })).toBeVisible();
  });
}

test("hidden on Chat, the session row never covers the composer", async ({ page, context, baseURL }) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  await asUser(user, "/v1/me/data", "DELETE");
  await asUser(user, "/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  const goal = await asUser<{ id: string }>(user, "/v1/goals", "POST", {
    category: "health",
    title: TITLE,
    weekly_budget_minutes: 180,
  });
  await asUser(user, "/v1/focus/start", "POST", { goal_id: goal.id, minutes: 25 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");
  await tap(page.getByRole("dialog", { name: TITLE }).getByRole("button", { name: "Hide" }));
  const pill = page.getByRole("button", { name: /min left\. Open Focus now$/ });
  await expect(pill).toBeVisible();
  const composer = page.locator("textarea").last();
  await expect(composer).toBeVisible();
  const a = await pill.boundingBox();
  const b = await composer.boundingBox();
  expect(a && b).toBeTruthy();
  if (a && b) expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  // And it opens the session again.
  await tap(pill);
  await expect(page.getByRole("dialog", { name: TITLE })).toBeVisible();
});
