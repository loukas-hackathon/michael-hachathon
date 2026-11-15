import type { Page } from "@playwright/test";
import { enterDemo, expect, tap, test } from "./fixtures";

// Tapping a nudge notification (#405). public/sw.js runs the same openNudge() for a notification
// click and for an "open-nudge" message, so the tests drive it from the page: an open app is routed
// inside itself (no reload) and the nudge card shows at once; a cold open on the deep link paints
// the card from the URL fragment before the day has loaded.

const NUDGE = { text: "Wrap up, your block starts at 14:00.", kind: "block_soon" };

async function controlled(page: Page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 20_000 });
}

test("a nudge tap routes the open app to Today and shows the nudge within a second", async ({ page }) => {
  await enterDemo(page);
  await controlled(page);
  // Somewhere else in the app, as the person may have left it.
  await tap(page.getByRole("link", { name: "Goals" }).first());
  await expect(page).toHaveURL(/\/goals/);
  await page.evaluate(() => {
    (window as unknown as { stayed: boolean }).stayed = true;
  });

  const started = Date.now();
  await page.evaluate(
    (nudge) =>
      navigator.serviceWorker.controller?.postMessage({
        type: "open-nudge",
        nudge: { ...nudge, url: "/", at: Date.now() },
      }),
    NUDGE,
  );
  const card = page.getByTestId("nudge-opened");
  await expect(card).toContainText(NUDGE.text, { timeout: 1000 });
  console.log(`[nudge-open] open app: card after ${Date.now() - started} ms`);
  await expect(page).toHaveURL(/\/$/);
  // Routed, not reloaded: the page kept its state.
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);

  await expect(card.getByRole("link", { name: "See the block" })).toBeVisible();
  await tap(card.getByRole("button", { name: "Got it" }));
  await expect(card).toHaveCount(0);
});

test("a cold open on the nudge's deep link paints the nudge before the day", async ({ page }) => {
  await enterDemo(page);
  await controlled(page);
  const hash = `#nudge=${encodeURIComponent(JSON.stringify({ ...NUDGE, at: Date.now() }))}`;

  // A fresh document, as when iOS opens the app from the notification.
  await page.goto("about:blank");
  const started = Date.now();
  await page.goto(`/${hash}`, { waitUntil: "commit" });
  const card = page.getByTestId("nudge-opened");
  await expect(card).toContainText(NUDGE.text, { timeout: 3000 });
  console.log(`[nudge-open] cold open: card after ${Date.now() - started} ms`);

  // The action goes where the nudge points and the card goes with it.
  await tap(card.getByRole("link", { name: "See the block" }));
  await expect(page).toHaveURL(/\/timeline/);
  await expect(card).toHaveCount(0);
});
