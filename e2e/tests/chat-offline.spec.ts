import { enterDemo, expect, tap, test } from "./fixtures";

// Venue wifi (finals QA): with the network gone, a send ends as Michael's one line under the box,
// the typed message stays to send again, and nothing throws an uncaught "Failed to fetch".

const OFFLINE = "I could not reach the server. Your message is still here to send again.";
const REPLY = "You have 40 minutes free at 15:00.";

function answer() {
  const now = new Date().toISOString();
  return [
    `event: delta\ndata: ${JSON.stringify({ text: REPLY })}\n\n`,
    `event: done\ndata: ${JSON.stringify({
      message: { id: "m-offline-user", role: "user", content: "asked", created_at: now },
      reply: { id: "m-offline-reply", role: "assistant", content: REPLY, created_at: now },
      actions: [],
    })}\n\n`,
  ].join("");
}

/** The browser reports each refused request as a console error; that one is expected here. */
function dropRefusedLoads(problems: string[]) {
  for (let i = problems.length - 1; i >= 0; i--)
    if (/Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|FAILED)/.test(problems[i] ?? ""))
      problems.splice(i, 1);
}

test("chat offline: the aborted stream is one line, the message stays, Try again sends it", async ({
  page,
  guard,
}) => {
  await enterDemo(page);
  let online = false;
  await page.route("**/chat/stream", (route) =>
    online
      ? route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: answer() })
      : route.abort("internetdisconnected"),
  );

  await page.goto("/chat");
  const field = page.getByLabel("Message Michael");
  await tap(field);
  await field.fill("When am I free?");
  await page.keyboard.press("Enter");

  const alert = page.getByRole("alert").filter({ hasText: OFFLINE });
  await expect(alert).toBeVisible();
  await expect(field).toHaveValue("When am I free?");

  online = true;
  await tap(alert.getByRole("button", { name: "Try again" }));
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible();
  await expect(alert).toHaveCount(0);

  dropRefusedLoads(guard.problems);
  expect(guard.problems.filter((p) => p.startsWith("page error"))).toEqual([]);
});

test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("chat offline: the whole network gone, no page error, the line and the message stay", async ({
    page,
    guard,
  }) => {
    await enterDemo(page);
    await page.goto("/chat");
    const field = page.getByLabel("Message Michael");
    await tap(field);
    await field.fill("When am I free?");

    await page.context().setOffline(true);
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alert").filter({ hasText: OFFLINE });
    await expect(alert).toBeVisible();
    await expect(field).toHaveValue("When am I free?");

    // The conversations beside the chat search through a server action: offline it answers
    // nothing, the titles here still filter, and nothing throws.
    const search = page.getByRole("navigation", { name: "Conversations" }).getByPlaceholder("Search");
    await search.fill("zz no such conversation");
    await page.waitForTimeout(800);
    await search.fill("");
    await page.context().setOffline(false);

    dropRefusedLoads(guard.problems);
    expect(guard.problems.filter((p) => p.startsWith("page error"))).toEqual([]);
  });
});
