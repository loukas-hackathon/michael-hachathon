import type { Page } from "@playwright/test";
import { API_KEY, API_URL, enterDemo, expect, tap, test } from "./fixtures";

// Separate conversations (#308). Hermetic: no model, so the threads are made through the API as
// this visitor (the same call the app makes), then opened and switched in the app.

/** Makes a thread for the browser's own demo visitor, as POST /v1/chat/threads does. */
async function threadAs(page: Page, title: string) {
  const visitor = (await page.context().cookies()).find((c) => c.name === "michael_demo")?.value;
  expect(visitor, "the demo visitor cookie").toBeTruthy();
  const res = await fetch(`${API_URL}/v1/chat/threads`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "x-michael-demo-visitor": visitor ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; title: string };
}

test("chat: start a new conversation and switch between them", async ({ page }) => {
  await enterDemo(page);
  await threadAs(page, "Exam week");
  await threadAs(page, "Gym before work");
  await page.goto("/chat");
  await expect(page.getByRole("heading", { level: 1, name: "Chat" })).toBeVisible();
  // The latest conversation opens; its name sits above the title.
  await expect(page.getByRole("button", { name: /^Gym before work\. Show all conversations/ })).toBeVisible();

  // The list: both, newest first. Open the older one.
  await tap(page.getByRole("button", { name: /Show all conversations$/ }));
  const sheet = page.getByRole("dialog", { name: "Conversations" });
  await expect(sheet.getByRole("button", { name: /^Exam week/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Gym before work/ })).toBeVisible();
  await tap(sheet.getByRole("button", { name: /^Exam week/ }));
  await expect(page.getByRole("button", { name: /^Exam week\. Show all conversations/ })).toBeVisible();

  // Search narrows the list by title.
  await tap(page.getByRole("button", { name: /Show all conversations$/ }));
  await sheet.getByRole("searchbox").fill("gym");
  await expect(sheet.getByRole("button", { name: /^Exam week/ })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /^Gym before work/ })).toBeVisible();
  await sheet.getByRole("searchbox").fill("");

  // A new chat: an empty page with starters, named "New chat" until its first line.
  await tap(sheet.getByRole("button", { name: "New", exact: true }));
  await expect(page.getByRole("button", { name: /^New chat\. Show all conversations/ })).toBeVisible();
  await expect(page.getByText("New conversation. What is on your mind?")).toBeVisible();

  // Rename from the row's actions; it sticks after a reload.
  await tap(page.getByRole("button", { name: /Show all conversations$/ }));
  await tap(sheet.getByRole("button", { name: "More for Exam week" }));
  await tap(sheet.getByRole("button", { name: "Rename" }));
  const name = sheet.getByRole("textbox", { name: "Name this conversation" });
  await name.fill("Exam week plan");
  await name.press("Enter");
  await expect(sheet.getByRole("button", { name: /^Exam week plan/ })).toBeVisible();
  // The rename shows at once (optimistic) while the save is still in flight: reloading before it
  // lands read the old name, the flake. Wait until the API has it, then reload once.
  await expect
    .poll(async () => (await threadsAs(page)).map((t) => t.title), { timeout: 10_000 })
    .toContain("Exam week plan");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Chat" })).toBeVisible();
  await tap(page.getByRole("button", { name: /Show all conversations$/ }));
  await expect(sheet.getByRole("button", { name: /^Exam week plan/ })).toBeVisible();
});

test("chat: New chat and the conversations stay one tap away in a long conversation", async ({ page }) => {
  await enterDemo(page);
  // No model: a long answer is played back for each line, so the page scrolls well past the title.
  const reply =
    "I moved Email triage from 15:00 to 17:30 and booked University 15:00 to 17:00. Gym at 18:30 still fits after that. Undo until 15:00.";
  let n = 0;
  await page.route("**/chat/stream", (route) => {
    n++;
    const now = new Date().toISOString();
    const body = [
      `event: delta\ndata: ${JSON.stringify({ text: reply })}\n\n`,
      `event: done\ndata: ${JSON.stringify({
        message: { id: `u-long-${n}`, role: "user", content: "asked", created_at: now },
        reply: { id: `r-long-${n}`, role: "assistant", content: reply, created_at: now },
        actions: [],
      })}\n\n`,
    ].join("");
    return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
  });
  await page.goto("/chat");
  const field = page.getByLabel("Message Michael");
  await tap(field);
  for (let i = 1; i <= 4; i++) {
    await field.fill(`Question ${i}`);
    await page.keyboard.press("Enter");
    await expect(page.getByText(reply, { exact: true })).toHaveCount(i);
  }
  // Scrolled to the newest line: the large title is gone, the bar is not.
  await expect(page.getByRole("heading", { level: 1, name: "Chat" })).not.toBeInViewport();
  await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: /Show all conversations$/ })).toBeInViewport();
  await tap(page.getByRole("button", { name: /Show all conversations$/ }));
  await expect(page.getByRole("dialog", { name: "Conversations" })).toBeVisible();
});

/** The browser's own demo visitor's threads, as GET /v1/chat/threads gives them. */
async function threadsAs(page: Page): Promise<{ id: string; title: string | null }[]> {
  const visitor = (await page.context().cookies()).find((c) => c.name === "michael_demo")?.value ?? "";
  const res = await fetch(`${API_URL}/v1/chat/threads`, {
    headers: { authorization: `Bearer ${API_KEY}`, "x-michael-demo-visitor": visitor },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { threads?: { id: string; title: string | null }[] };
  return body.threads ?? [];
}
