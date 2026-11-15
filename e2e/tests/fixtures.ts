import { test as base, expect, type Locator, type Page } from "@playwright/test";

export const API_URL = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 18787}`;
export const API_KEY = "dev-key";

/** Today's date in Athens as the app writes it ("Saturday 14 November"). */
export const athensToday = () =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Athens",
  })
    .format(new Date())
    .replace(",", "");

/** GET from the API as the demo account, to compare the screen with the real numbers. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Sends the browser into the demo week, as the login page's "See the demo week" does. */
export async function enterDemo(page: Page) {
  await page.goto("/auth/demo");
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Clicks once React has hydrated the element (its props are attached), so a tap is never lost to a
 * server rendered button that has no handler yet. The root fix for "click did nothing" flakes.
 */
export async function tap(target: Locator) {
  await hydrated(target);
  await target.click();
}

/**
 * Fills a field once React has hydrated it. A controlled input filled before hydration keeps the
 * text in the DOM while React's state stays empty, so whatever reads that state never sees it (the
 * onboarding flake: "Keep these three" never appeared because the own words goal was lost).
 */
export async function fillReady(target: Locator, value: string) {
  await hydrated(target);
  await target.fill(value);
  await expect(target).toHaveValue(value);
}

async function hydrated(target: Locator) {
  await expect
    .poll(() => target.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))))
    .toBe(true);
}

type Guard = { problems: string[] };

/**
 * Every test fails on a console error, an uncaught page error, or a request that leaves the
 * machine (the suite is hermetic: no Google, Anthropic or Supabase).
 */
export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      await page.route(
        (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
        (route) => {
          problems.push(`external request: ${route.request().url()}`);
          return route.abort("blockedbyclient");
        },
      );
      page.on("console", (msg) => {
        if (msg.type() === "error") problems.push(`console error on ${page.url()}: ${msg.text()}`);
      });
      page.on("pageerror", (err) => problems.push(`page error on ${page.url()}: ${err.message}`));
      await use({ problems });
      expect(problems, "console errors, page errors or external requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
