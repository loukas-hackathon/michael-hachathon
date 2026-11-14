import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { copyFor } from "../../apps/web/app/chat/copy";
import { API_KEY, API_URL, apiGet, athensToday, enterDemo, expect, tap, test } from "./fixtures";

// The pitch, screen by screen (docs/pitch.md, docs/demo-runbook.md), on the demo week.
// Assertions hold at any hour of any day: the demo week follows the clock.

type Score = {
  score_pct: number | null;
  day: { blocks: unknown[]; score_pct: number | null };
};
type Rec = { id: string; title: string; status: string };

const focusCard = (page: Page) =>
  page.getByRole("listitem").filter({ hasText: "Block 09:30 to 11:00 for cold outreach." });

test("login offers Google and the demo week", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "On your side." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
  await page.getByRole("link", { name: "See the demo week" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Today|Evening)$/ })).toBeVisible();
});

test("Today shows the demo week's real numbers, not the sample day", async ({ page }) => {
  await enterDemo(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Morning|Today|Evening)$/ })).toBeVisible();
  await expect(page.getByText(athensToday(), { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Updated \d\d:\d\d/)).toBeVisible(); // live, only when not sample
  await expect(page.getByText(/Sample day/)).toHaveCount(0);

  // The same numbers the API computes for the demo account.
  const score = await apiGet<Score>("/v1/score");
  if (score.score_pct != null) {
    await expect(page.getByText(`We're at ${score.score_pct}% of goal time this week.`)).toBeVisible();
  }
  if (score.day.blocks.length > 0 && score.day.score_pct != null) {
    await expect(page.getByText(/of your goal time (today|so far)\./)).toBeVisible();
  }

  // The demo's focus block suggestion, wherever Today places it.
  const card = focusCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByText("Wins 1h 30 for The company.")).toBeVisible();
});

test("Today has no serious accessibility violations", async ({ page }) => {
  await enterDemo(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Let the count up and entrance animations settle so contrast is measured on final colours.
  await page.waitForTimeout(1500);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  // The brand pink (#e6007a, --m-tint-text in light mode) is a deliberate product decision and is
  // kept as is, although it is under 4.5:1 on the grey fill. Only contrast findings on that exact
  // colour are exempt; every other rule and every other colour still fails the test.
  const isBrandPink = (n: { any: { data?: unknown }[] }) =>
    n.any.some((c) => {
      const fg = (c.data as { fgColor?: string } | undefined)?.fgColor?.toLowerCase();
      return fg === "#e6007a";
    });
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .flatMap((v) =>
      v.nodes
        .filter((n) => !(v.id === "color-contrast" && isBrandPink(n)))
        .map((n) => `${v.id}: ${n.target.join(" ")}: ${n.failureSummary ?? v.help}`),
    );
  expect(serious).toEqual([]);
});

test("Timeline shows today's blocks", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/timeline");
  await expect(page.getByRole("heading", { level: 1, name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: athensToday() })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Days" })).toBeVisible();
  // Blocks and calendar outlines carry "Title, HH:MM to HH:MM".
  await expect(page.locator('[title*=" to "]').first()).toBeVisible();
});

test("Goals shows the demo goals", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/goals");
  await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
  await expect(page.getByText("The company").first()).toBeVisible();
  await expect(page.getByText("University").first()).toBeVisible();
  await expect(page.getByText(/Sample/)).toHaveCount(0);
});

test("a recommendation: Do it, then Undo", async ({ page }) => {
  await enterDemo(page);
  const card = focusCard(page);
  await tap(card.getByRole("button", { name: "Do it" }));
  await expect(card.getByRole("status")).toHaveText(/^Done\. Undo until 09:30\.$/);

  const find = async () =>
    (await apiGet<{ recommendations: Rec[] }>("/v1/recommendations")).recommendations.find(
      (r) => r.title === "Block 09:30 to 11:00 for cold outreach",
    )?.status;
  await expect.poll(find).toBe("done");

  await tap(card.getByRole("button", { name: "Undo" }));
  await expect.poll(find).toBe("undone");
});

test("chat renders and says calmly that it cannot talk without a key", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/chat");
  await expect(page.getByRole("heading", { level: 1, name: "Chat" })).toBeVisible();
  await tap(page.getByRole("button", { name: "How is my day going?" }));
  // The line comes from the app's own copy, so wording changes never break the test.
  await expect(page.getByText(copyFor("unavailable"))).toBeVisible();
});

test("Agents shows Connect Claude with the MCP link", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agents");
  await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
  await expect(page.getByText("Connect Claude")).toBeVisible();
  await expect(page.getByText(`${API_URL}/mcp`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
});

test("stage: N sends a test nudge and shows it", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/stage");
  await expect(page.getByText(athensToday()).first()).toBeVisible();
  const status = page.getByText("Shown here. No device has nudges on.");
  // N only works once the page has hydrated; press until the stage answers.
  await expect(async () => {
    await page.keyboard.press("n");
    await expect(status).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });

  const res = await fetch(`${API_URL}/v1/nudges`, { headers: { authorization: `Bearer ${API_KEY}` } });
  const { nudges } = (await res.json()) as { nudges: { status: string; text: string }[] };
  const test = nudges.find((n) => n.status === "test");
  expect(test).toBeTruthy();
  await expect(
    page.getByRole("region", { name: "Latest nudge" }).getByText(test?.text ?? "", { exact: false }),
  ).toBeVisible();
});
