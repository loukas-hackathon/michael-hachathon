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
