import { randomUUID } from "node:crypto";
import { API_URL, expect, tap, test } from "./fixtures";

// What I know about you (#379): a fresh user told Michael two things. The page lists them under
// "Things you told me"; Forget waits five seconds with Undo, Undo keeps the memory, and once the
// five seconds are up the memory is really gone from the API.

test("what I know: forget one memory, undo, then forget it for good", async ({ page, context, baseURL }) => {
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
  await asUser("/v1/me/data", "DELETE");
  await asUser("/v1/profile", "PUT", { onboarded_at: new Date().toISOString() });
  for (const title of ["Trains best before 08:00", "Fridays are for family"]) {
    await asUser("/v1/events", "POST", {
      source: "manual",
      type: "memory",
      start_at: new Date(Date.now() - 60_000).toISOString(),
      title,
    });
  }
  const memories = async () =>
    (await asUser<{ told: { kind: string; text: string }[] }>("/v1/me/knowledge")).told
      .filter((i) => i.kind === "memory")
      .map((i) => i.text);
  expect(await memories()).toHaveLength(2);

  // Reachable from You > Privacy.
  await page.goto("/you");
  await tap(page.getByRole("link", { name: /What I know about you/ }));
  await expect(page).toHaveURL(/\/you\/knowledge$/);
  await expect(page.getByRole("heading", { name: "What I know about you", level: 1 })).toBeVisible();
  await expect(page.getByText("Trains best before 08:00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What I never keep" })).toBeVisible();

  // Forget, then Undo inside the five seconds: nothing is deleted.
  await tap(page.getByRole("button", { name: "Forget: Trains best before 08:00" }));
  await expect(page.getByRole("status").filter({ hasText: "Forgotten." })).toBeVisible();
  await tap(page.getByRole("button", { name: "Undo" }));
  await expect(page.getByText("Trains best before 08:00")).toBeVisible();
  await page.waitForTimeout(5_500);
  expect(await memories()).toContain("Trains best before 08:00");

  // Forget and let it run out: the row is gone, and so is the memory on the API.
  await tap(page.getByRole("button", { name: "Forget: Trains best before 08:00" }));
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect.poll(memories, { timeout: 10_000 }).toEqual(["Fridays are for family"]);
  await expect(page.getByText("Trains best before 08:00")).toHaveCount(0);
  await expect(page.getByText("Fridays are for family")).toBeVisible();
});
