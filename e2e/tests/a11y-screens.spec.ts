import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { enterDemo, expect, test } from "./fixtures";

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
