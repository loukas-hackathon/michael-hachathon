import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// Connections update the moment they land (#466): Loukas connected and saw nothing change until he
// reloaded. A flow that finishes elsewhere (Telegram) waits on the row and flips by itself; a flow
// that comes back to the app (the Google return) shows Connected at once.

test("Telegram: Start in Telegram flips the row to Connected within 3 s, without a reload", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  // Telegram itself is never reached: the t.me hop is answered here.
  await context.route(/^https:\/\/t\.me\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Telegram</title>" }),
  );

  await page.goto("/you");
  const row = page.locator('#connections [data-connection="telegram"]');
  await expect(row).toHaveAttribute("data-state", "none");
  await expect(row.getByText("Not connected")).toBeVisible();

  const loads: string[] = [];
  page.on("load", () => loads.push(page.url()));

  // Connect opens Telegram beside the app; this page stays and waits.
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    tap(row.getByRole("link", { name: "Connect", exact: true })),
  ]);
  await popup.waitForURL(/^https:\/\/t\.me\//);
  const start = new URL(popup.url()).searchParams.get("start");
  expect(start).toBeTruthy();
  await popup.close();
  await expect(row.getByText("Waiting for Telegram…")).toBeVisible();

  // The user taps Start: Telegram calls our webhook with the one-time token.
  const res = await fetch(`${API_URL}/v1/webhooks/telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "e2e-telegram-secret",
    },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        text: `/start ${start}`,
        chat: { id: 4242, type: "private" },
        from: { id: 4242, username: "e2e_user" },
      },
    }),
  });
  expect(res.ok).toBe(true);

  await expect(row).toHaveAttribute("data-state", "on", { timeout: 3_000 });
  await expect(row.getByText(/^Connected/)).toBeVisible();
  await expect(row.getByRole("link", { name: "Manage", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Telegram connected." })).toHaveCount(1);
  expect(loads, "no reload").toEqual([]);
});

test("Google Calendar: back from Google, the row says Connected at once, with no banner", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "michael_e2e_user", value: randomUUID(), url: baseURL ?? "" }]);
  await page.goto("/you?connected=google_calendar");
  const row = page.locator('#connections [data-connection="google-calendar"]');
  await expect(row).toHaveAttribute("data-state", "on");
  await expect(row.getByText(/^Connected/)).toBeVisible();
  await expect(page.getByText("Google Calendar connected. Your plans are on the timeline.")).toHaveCount(0);
  // Said once, and a reload does not replay it.
  await expect(page).not.toHaveURL(/connected=/);
});

test("iPhone: Shortcut added, then the shortcut's test run turns it Connected while the page waits", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  // An empty account: nothing sent from any device yet.
  await fetch(`${API_URL}/v1/me/data`, {
    method: "DELETE",
    headers: { authorization: `Bearer e2e_${user}` },
  });
  // The key the Connect step makes and the shortcut saves.
  const made = await fetch(`${API_URL}/v1/tokens`, {
    method: "POST",
    headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "iPhone Shortcuts" }),
  });
  expect(made.status).toBe(201);
  const { secret } = (await made.json()) as { secret: string };

  await page.goto("/you");
  const row = page.locator('#connections [data-connection="iphone"]');
  await expect(row.getByText("Not connected · Shortcut added")).toBeVisible();
  await tap(row.getByRole("link", { name: "Connect", exact: true }));
  await expect(page).toHaveURL(/\/you\/connections\/iphone/);
  await expect(page.getByText("Waiting for iPhone…")).toBeVisible();

  // The shortcut posts with its key (here an open, held until the next one: nothing is stored).
  const res = await fetch(`${API_URL}/v1/webhooks/ios-shortcuts`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ app: "Safari", action: "open" }),
  });
  expect(res.status).toBe(200);
  await expect(page.getByText(/^Connected · test received \d\d:\d\d$/)).toBeVisible({ timeout: 3_000 });
});
