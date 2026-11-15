import { enterDemo, expect, tap, test } from "./fixtures";

// How Michael worked it out (#410). Hermetic: no model, so the stream is played back with the
// `step` events the API sends around each tool call.

const REPLY = "You have 40 minutes free at 15:00.";

test("chat: the steps fold into one line under the reply and open on a tap", async ({ page }) => {
  await enterDemo(page);
  const now = new Date().toISOString();
  const step = (id: string, label: string, status: string) =>
    `event: step\ndata: ${JSON.stringify({ id, label, status })}\n\n`;
  const body = [
    step("open", "Reading your day", "running"),
    step("open", "Reading your day", "done"),
    step("s1", "Reading your calendar", "running"),
    step("s1", "Reading your calendar", "done"),
    `event: delta\ndata: ${JSON.stringify({ text: REPLY })}\n\n`,
    `event: done\ndata: ${JSON.stringify({
      message: { id: "m-user", role: "user", content: "asked", created_at: now },
      reply: { id: "m-reply", role: "assistant", content: REPLY, created_at: now },
      actions: [],
    })}\n\n`,
  ].join("");
  await page.route("**/chat/stream", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body }),
  );

  await page.goto("/chat");
  const field = page.getByLabel("Message Michael");
  await tap(field);
  await field.fill("When am I free?");
  await page.keyboard.press("Enter");

  await expect(page.getByText(REPLY)).toBeVisible();
  const fold = page.getByRole("button", { name: "How I worked it out · 2 steps" });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await tap(fold);
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Reading your calendar")).toBeVisible();
});
