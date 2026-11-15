import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { API_URL, enterDemo, expect, tap, test } from "./fixtures";

// Every main screen in dark mode on the demo week: no serious axe finding (Today's light mode check
// is in demo-path.spec.ts), and the small capsules keep a 44 by 44 hit area on the phone.

async function serious(page: Page) {
  // Let entrance animations settle so contrast is measured on final colours.
  await page.waitForTimeout(1000);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.failureSummary ?? v.help}`));
}

for (const path of ["/timeline", "/goals", "/chat", "/agents", "/you"]) {
  test(`${path} has no serious accessibility violations in dark mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await enterDemo(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });
}

test("Goals capsules drawn at 36px still take a 44px tap", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/goals");
  const focus = page.getByRole("button", { name: /^Focus now on/ }).first();
  await expect(focus).toBeVisible();
  const box = await focus.boundingBox();
  if (!box) throw new Error("no Focus now button");
  // A point just above the drawn capsule, inside the 44px hit area, still lands on the button.
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? "",
    { x: box.x + box.width / 2, y: box.y + box.height / 2 - 21 },
  );
  expect(hit).toContain("Focus now");
});

test("Focus now keeps Tab inside, and Escape hands focus back to the page", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  };
  await asUser("/v1/me/data", "DELETE");
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  await asUser("/v1/goals", "POST", {
    category: "personal",
    title: "University",
    weekly_budget_minutes: 360,
  });

  await page.goto("/goals");
  await tap(page.getByRole("button", { name: "Focus now on University" }).first());
  await tap(page.getByRole("dialog").getByRole("button", { name: "Focus for 45 minutes" }));
  const screen = page.getByRole("dialog", { name: "University", exact: true });
  await expect(screen).toBeVisible();
  const sheetOpen = () => page.evaluate(() => document.querySelectorAll("dialog[open]").length);
  await expect.poll(sheetOpen, { timeout: 3000 }).toBe(0);

  // Many more Tabs than the screen has controls: focus never leaves it.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
    expect(await screen.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(screen).toBeHidden();
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
  // Back on the button that started it.
  expect(focused).toContain("Focus now");

  await asUser("/v1/me/data", "DELETE");
});
