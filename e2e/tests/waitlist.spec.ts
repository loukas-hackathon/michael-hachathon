import { randomUUID } from "node:crypto";
import { API_URL, expect, fillReady, tap, test } from "./fixtures";

// The public waiting list: join from /join signed out (the hours as chips, email, an optional
// name, the setup folded into one row), land on /join/CODE with the place first, say yes to
// founding member there, and a friend's invite link moves the inviter up. The admin list
// (/waitlist) and the investor view (/traction) only for ADMIN_EMAILS (playwright.config.ts gives
// one test user that email); /traction never shows a name or an email.

const WAITLIST_ADMIN = "0000a0a0-0000-4000-8000-00000000a0a0";

/** People already on the list (straight to the API), so the newcomer is not first. */
async function seedList(n: number, over: Record<string, unknown> = {}) {
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${API_URL}/v1/waitlist`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": `192.0.2.${i + 1}` },
      body: JSON.stringify({
        email: `seed-${randomUUID().slice(0, 8)}@example.com`,
        name: "Seed Person",
        role: "founder",
        hours_lost_per_week: 5,
        computer: "mac",
        phone: "iphone",
        calendar: "google",
        source: "x.com",
        ...over,
      }),
    });
    expect(res.status).toBe(201);
  }
}

const placeOf = async (text: string | null) => Number(text?.match(/number (\d+)/)?.[1]);

test("join from /join and land on your place with an invite link", async ({ page }) => {
  await seedList(6);
  await page.goto("/join?utm_source=e2e");
  await expect(page.getByRole("heading", { name: "On your side." })).toBeVisible();
  // Signed out and public: no tab bar.
  await expect(page.getByRole("navigation", { name: "Michael" })).toHaveCount(0);
  // The button is above the fold on a 390x844 phone.
  const button = page.getByRole("button", { name: "Join the waiting list" });
  expect((await button.boundingBox())?.y ?? 9999).toBeLessThan(700);

  // The hours come first: without them, one line asks for them.
  const email = `join-${randomUUID().slice(0, 8)}@example.com`;
  await fillReady(page.getByLabel("Email"), email);
  await tap(button);
  await expect(page.getByText("Pick your best guess.")).toBeVisible();

  await tap(page.getByText("8h", { exact: true }));
  await fillReady(page.getByLabel("Name"), "Ada");
  // The setup is one row; opened, it has the role and the three choices.
  const setup = page.getByRole("button", { name: /^Setup/ });
  await expect(setup).toHaveAttribute("aria-expanded", "false");
  await tap(setup);
  await page.getByLabel("Role").selectOption("executive");
  await tap(page.getByText("Windows", { exact: true }));
  await expect(page.getByTestId("join-setup")).toHaveText(/^Executive · Windows · /);
  await tap(button);

  await expect(page).toHaveURL(/\/join\/[A-Za-z0-9_-]{8}$/);
  const position = page.getByTestId("waitlist-position");
  await expect(position).toHaveText(/^You are number \d+ of \d+ waiting\.$/);
  // Their own hours, said back as a year.
  await expect(
    page.getByText("You said 8 hours a week. That's 416 hours a year. I want them back."),
  ).toBeVisible();
  await expect(page.getByText("Each friend who joins moves you up 5 places.")).toBeVisible();
  const link = await page.getByLabel("Invite link", { exact: true }).inputValue();
  expect(link).toMatch(/\/join\?ref=[A-Za-z0-9_-]{8}$/);
  const code = new URL(link).searchParams.get("ref");
  expect(page.url()).toContain(`/join/${code}`);

  // Founding member, asked here: on at once, kept after a reload.
  const founding = page.getByRole("switch", { name: "Founding member" });
  await expect(founding).not.toBeChecked();
  await tap(founding);
  await expect(page.getByText("Done. You're a founding member.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Founding member" })).toBeChecked();

  // A friend joins with the link, without a name: the inviter moves up and sees it.
  const before = await placeOf(await position.textContent());
  await page.goto(`/join?ref=${code}`);
  await expect(page.getByText("A friend sent you.")).toBeVisible();
  await tap(page.getByText("4h", { exact: true }));
  await fillReady(page.getByLabel("Email"), `friend-${randomUUID().slice(0, 8)}@example.com`);
  await tap(page.getByRole("button", { name: "Join the waiting list" }));
  await expect(page).toHaveURL(/\/join\/[A-Za-z0-9_-]{8}$/);
  expect(page.url()).not.toContain(`/join/${code}`);

  await page.goto(`/join/${code}`);
  await expect(page.getByTestId("waitlist-referrals")).toHaveText("1 friend joined. You moved up 5 places.");
  await expect.poll(async () => placeOf(await position.textContent())).toBe(Math.max(1, before - 5));

  // Joining again with the same email lands on the same place, never an error.
  await page.goto("/join");
  await tap(page.getByText("2h", { exact: true }));
  await fillReady(page.getByLabel("Email"), email.toUpperCase());
  await tap(page.getByRole("button", { name: "Join the waiting list" }));
  await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
});

test("an invite link that matches nobody says so and points to /join", async ({ page }) => {
  await page.goto("/join/nobody12");
  await expect(page.getByText("That link doesn't open a place.")).toBeVisible();
  await tap(page.getByRole("link", { name: "Join here" }));
  await expect(page).toHaveURL(/\/join$/);
});

test("the login page links to the waiting list", async ({ page }) => {
  await page.goto("/login");
  await tap(page.getByRole("link", { name: "Not in yet? Join the waiting list" }));
  await expect(page).toHaveURL(/\/join$/);
});

test("the waiting list is for admins only", async ({ page, context, baseURL }) => {
  // Someone signed in who is not an admin: the plain not found page (streamed, so the status
  // line is already 200; the CSV, not streamed, is a real 404).
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto("/waitlist");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  expect((await page.request.get("/waitlist/csv")).status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Waiting list" })).toHaveCount(0);

  await context.addCookies([{ name: "michael_e2e_user", value: WAITLIST_ADMIN, url: baseURL ?? "" }]);
  await page.goto("/waitlist");
  await expect(page.getByRole("heading", { name: "Waiting list" })).toBeVisible();
  await expect(page.getByText(/people waiting\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Everyone, newest first" })).toBeVisible();
  const csv = await page.request.get("/waitlist/csv");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toMatch(/^"position","created_at","email"/);
});

test("an admin sees the waiting list on /traction as numbers only, no name and no email", async ({
  page,
  context,
  baseURL,
}) => {
  await seedList(3, { name: "Private Seed", founding_member: true, hours_lost_per_week: 9 });
  await context.addCookies([{ name: "michael_e2e_user", value: WAITLIST_ADMIN, url: baseURL ?? "" }]);
  await page.goto("/traction");
  const headline = page.getByTestId("traction-headline");
  await expect(headline).toContainText(/people waiting\./);
  await expect(page.getByRole("button", { name: "Copy for investors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Founding members" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  // The range control changes the daily chart's sentence.
  await tap(page.getByText("7 days", { exact: true }));
  await expect(page.getByTestId("traction-momentum")).toContainText("in the last 7 days");
  // Safe on a shared screen: nobody's name or email anywhere on the page.
  const text = (await page.locator("main").textContent()) ?? "";
  expect(text).not.toMatch(/@example\.com|Private Seed|Seed Person/);
});
