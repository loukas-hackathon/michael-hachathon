import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// Meetings mode (#400): the first start goes through the consent sheet; while on, the pill shows on
// every screen; End from the pill stops it, and the API agrees.

test("meetings mode: consent, start, the pill on every screen, then end", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (res.status === 204 ? null : await res.json()) as T;
  };
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  const active = async () => (await asUser<{ active: unknown }>("/v1/meetings/active")).active !== null;

  await page.goto("/you");
  await tap(page.getByRole("button", { name: "Start", exact: true }));
  const sheet = page.getByRole("dialog", { name: "Meetings mode" });
  await expect(
    sheet.getByText("Only you start this. Tell the people in the room you're recording."),
  ).toBeVisible();
  expect(await active()).toBe(false);
  await tap(sheet.getByRole("button", { name: "Start" }));

  const pill = page.getByRole("status", { name: /Meeting on/ });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("Meeting on");
  await expect.poll(active).toBe(true);

  // Every screen shows it.
  await page.goto("/timeline");
  await expect(pill).toBeVisible();

  await tap(pill.getByRole("button", { name: "End" }));
  await expect(pill).toHaveCount(0);
  await expect.poll(active).toBe(false);
});

/** Calls the API as a fresh e2e account, never the demo account. */
function apiAs(user: string) {
  return async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer e2e_${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return (res.status === 204 ? null : await res.json()) as T;
  };
}

// After a meeting (#422): Today shows its commitments, Add to today puts one on today's outcomes,
// Draft a follow up writes the draft (template, no model), and Dismiss puts the card away.
test("after a meeting: the recap card on Today, add a commitment, draft, dismiss", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = apiAs(user);
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });

  const started = await asUser<{ active: { started_at: string } }>("/v1/meetings/start", "POST", {
    consent: true,
  });
  const now = Date.now();
  await asUser("/v1/events", "POST", {
    source: "omi",
    type: "conversation",
    start_at: new Date(now - 60_000).toISOString(),
    end_at: new Date(now - 1_000).toISOString(),
    title: "Planning call",
    data: {
      summary: "Agreed the pilot plan.",
      action_items: ["Send the deck by Friday", "Book the pricing call"],
      lesson: "Say the number first, then the reason.",
    },
    external_id: `omi:${randomUUID()}`,
  });
  await asUser("/v1/meetings/end", "POST");
  const at = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  }).format(new Date(started.active.started_at));

  await page.goto("/");
  const card = page.getByRole("region", { name: "After the meeting" });
  await expect(card.getByRole("heading", { name: `Meeting at ${at}: 2 commitments` })).toBeVisible();
  await expect(card.getByText("Say the number first, then the reason.")).toBeVisible();

  await tap(card.getByRole("button", { name: "Add to today" }).first());
  await expect(card.getByText("Added")).toBeVisible();
  await expect
    .poll(async () => {
      const day = await asUser<{ items: { text: string }[] }>("/v1/checklist");
      return day.items.map((i) => i.text);
    })
    .toContain("Send the deck by Friday");

  await tap(card.getByRole("button", { name: "Draft a follow up" }));
  await expect(card.getByText("Drafted. It is in Follow ups below.")).toBeVisible();

  await tap(card.getByRole("button", { name: "Dismiss" }));
  await expect(card).toHaveCount(0);
  // It stays dismissed on this device.
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Meeting at/ })).toHaveCount(0);
});

// The quick toggle (#422) is the first row of the Mi sheet; off the record turns it off.
test("meetings mode: the quick toggle sits first in the Mi sheet and waits while off the record", async ({
  page,
  context,
  baseURL,
}) => {
  const user = randomUUID();
  await context.addCookies([{ name: "michael_e2e_user", value: user, url: baseURL ?? "" }]);
  const asUser = apiAs(user);
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  await asUser("/v1/privacy/off-the-record", "PUT", { off_the_record: true });

  await page.goto("/you");
  await expect(page.getByText("Off the record is on. Nothing is kept.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
});
