import { randomUUID } from "node:crypto";
import { API_URL, expect, fillReady, tap, test } from "./fixtures";

// The public waiting list: join from /join signed out, land on /join/CODE with a position, and a
// friend's invite link moves the inviter up. The admin list (/waitlist) only for ADMIN_EMAILS
// (playwright.config.ts gives one test user that email).

const WAITLIST_ADMIN = "0000a0a0-0000-4000-8000-00000000a0a0";

/** People already on the list (straight to the API), so the newcomer is not first. */
async function seedList(n: number) {
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${API_URL}/v1/waitlist`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": `192.0.2.${i + 1}` },
      body: JSON.stringify({
        email: `seed-${randomUUID().slice(0, 8)}@example.com`,
        name: "Seed",
        role: "founder",
        hours_lost_per_week: 5,
        computer: "mac",
        phone: "iphone",
        calendar: "google",
      }),
    });
    expect(res.status).toBe(201);
  }
}

test("join from /join and land on your place with an invite link", async ({ page }) => {
  await seedList(6);
  await page.goto("/join?utm_source=e2e");
  await expect(page.getByRole("heading", { name: "On your side." })).toBeVisible();
  // Signed out and public: no tab bar.
  await expect(page.getByRole("navigation", { name: "Michael" })).toHaveCount(0);

  const email = `join-${randomUUID().slice(0, 8)}@example.com`;
  await fillReady(page.getByLabel("Email"), email);
  await fillReady(page.getByLabel("Name"), "Ada");
  await page.getByLabel("Role").selectOption("executive");
  await fillReady(page.getByLabel("Hours you lose a week"), "7");
  await tap(page.getByText("Windows", { exact: true }));
  await tap(page.getByRole("switch", { name: /Founding member/ }));
  await tap(page.getByRole("button", { name: "Join the waiting list" }));

  await expect(page).toHaveURL(/\/join\/[A-Za-z0-9_-]{8}$/);
  const position = page.getByTestId("waitlist-position");
  await expect(position).toHaveText(/^You are number \d+ of \d+\.$/);
  await expect(page.getByText("Each friend who joins with your link moves you up 5 places.")).toBeVisible();
  const link = await page.getByLabel("Invite link", { exact: true }).inputValue();
  expect(link).toMatch(/\/join\?ref=[A-Za-z0-9_-]{8}$/);
  const code = new URL(link).searchParams.get("ref");
  expect(page.url()).toContain(`/join/${code}`);

  // A friend joins with the link: the inviter moves up and sees it.
  const before = Number((await position.textContent())?.match(/number (\d+)/)?.[1]);
  await page.goto(`/join?ref=${code}`);
  await expect(page.getByText("A friend sent you.")).toBeVisible();
  await fillReady(page.getByLabel("Email"), `friend-${randomUUID().slice(0, 8)}@example.com`);
  await fillReady(page.getByLabel("Name"), "Grace");
  await fillReady(page.getByLabel("Hours you lose a week"), "4");
  await tap(page.getByRole("button", { name: "Join the waiting list" }));
  await expect(page).toHaveURL(/\/join\/[A-Za-z0-9_-]{8}$/);
  expect(page.url()).not.toContain(`/join/${code}`);

  await page.goto(`/join/${code}`);
  await expect(
    page.getByText(/1 friend has joined with your link\. That moved you up 5 places\./),
  ).toBeVisible();
  const after = Number((await position.textContent())?.match(/number (\d+)/)?.[1]);
  expect(after).toBe(Math.max(1, before - 5));

  // Joining again with the same email lands on the same place, never an error.
  await page.goto("/join");
  await fillReady(page.getByLabel("Email"), email.toUpperCase());
  await fillReady(page.getByLabel("Name"), "Ada again");
  await fillReady(page.getByLabel("Hours you lose a week"), "7");
  await tap(page.getByRole("button", { name: "Join the waiting list" }));
  await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
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
