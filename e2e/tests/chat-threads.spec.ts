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
  await expect
    .poll(async () => {
      await page.reload();
      await tap(page.getByRole("button", { name: /Show all conversations$/ }));
      return sheet.getByRole("button", { name: /^Exam week plan/ }).count();
    })
    .toBe(1);
});
