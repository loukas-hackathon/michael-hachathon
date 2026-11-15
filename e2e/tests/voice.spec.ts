import type { Page } from "@playwright/test";
import { copyFor } from "../../apps/web/app/chat/copy";
import { DICTATE_COPY } from "../../apps/web/components/voice/speech";
import { enterDemo, expect, tap, test } from "./fixtures";
import { live, type Mode, streamReply, stubSpeech, voice } from "./speech-stub";

// Push to talk on /chat, end to end against the production build. Chromium has the Web Speech API
// but cannot reach a recogniser here, so a scripted one stands in (window.__voice); speech out is
// recorded instead of played. The microphone itself is Chromium's fake device.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

async function openChat(page: Page, mode?: Mode) {
  await stubSpeech(page, mode);
  await enterDemo(page);
  await page.goto("/chat");
  const mic = page.getByTestId("push-to-talk");
  await expect(mic).toBeVisible();
  await expect
    .poll(() => mic.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))))
    .toBe(true);
  return mic;
}

async function press(page: Page) {
  const box = await page.getByTestId("push-to-talk").boundingBox();
  if (!box) throw new Error("no mic button");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test("hold to talk: live words, let go sends, the answer streams and is spoken once", async ({ page }) => {
  const reply = "You have done **1h 20m** of deep work.\n\n- 09:30 to 10:50 on the pitch";
  await streamReply(page, reply);
  const mic = await openChat(page);
  await expect(mic).toHaveAttribute("data-supported", "true");

  await press(page);
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder("Listening. Let go to send")).toBeVisible();
  await voice(page, `r.say("How much deep work")`);
  await expect(page.locator("#chat-input")).toHaveValue("How much deep work");
  await voice(page, `r.say(" have I done today")`);
  await expect(page.locator("#chat-input")).toHaveValue("How much deep work have I done today");

  const sent = page.waitForRequest("**/chat/stream");
  await page.mouse.up();
  expect((await sent).postDataJSON()).toMatchObject({ message: "How much deep work have I done today" });
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("You have done")).toBeVisible();
  await expect(page.locator("#chat-input")).toHaveValue("");

  await expect.poll(() => voice<string[]>(page, "v.spoken")).not.toEqual([]);
  await page.waitForTimeout(300);
  const spoken = (await voice<string[]>(page, "v.spoken")).join(" ");
  // Read once, as words: no markdown read out.
  expect(spoken).toContain("1h 20m");
  expect(spoken).not.toContain("*");
  expect(spoken).not.toMatch(/(^|\s)- /);
  expect(spoken.match(/deep work/g)?.length).toBe(1);
  expect(await voice<number>(page, "v.started")).toBe(1);
});

test("letting go with nothing said sends nothing", async ({ page }) => {
  const mic = await openChat(page);
  let sent = false;
  await page.route("**/chat/stream", (route) => {
    sent = true;
    return route.abort();
  });
  await press(page);
  await voice(page, `r.fail("no-speech")`);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toContainText("I didn't catch that");
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(300);
  expect(sent).toBe(false);
});

test("microphone refused: Michael says how to allow it", async ({ page }) => {
  await openChat(page);
  await press(page);
  await voice(page, `r.fail("not-allowed")`);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toContainText("I need the microphone");
});

test("no connection: the line comes back to the box and the error is spoken", async ({ page }) => {
  await openChat(page);
  // The line drops mid answer: a piece of the reply, then nothing.
  await page.route("**/chat/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `event: delta\ndata: {"text":"You have"}\n\n`,
    }),
  );
  await press(page);
  await voice(page, `r.say("When should I train")`);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toContainText(copyFor("network"));
  await expect(page.locator("#chat-input")).toHaveValue("When should I train");
  await expect.poll(() => voice<string[]>(page, "v.spoken")).toEqual([copyFor("network")]);
});

test("without a model key the calm line is shown and spoken, and the browser voice is used", async ({
  page,
}) => {
  await openChat(page);
  let speakCalls = 0;
  await page.route("**/chat/speak", (route) => {
    speakCalls++;
    return route.fulfill({ status: 503 });
  });
  await press(page);
  await voice(page, `r.say("How is my day")`);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toContainText(copyFor("unavailable"));
  await expect.poll(() => voice<string[]>(page, "v.spoken")).toEqual([copyFor("unavailable")]);
  // The API has no ElevenLabs key here, so the app never asks for it.
  expect(speakCalls).toBe(0);
});

test("keyboard: hold Space to talk", async ({ page }) => {
  await streamReply(page, "Train at 18:00.");
  const mic = await openChat(page);
  await mic.focus();
  await page.keyboard.down(" ");
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await voice(page, `r.say("When should I train")`);
  const sent = page.waitForRequest("**/chat/stream");
  await page.keyboard.up(" ");
  expect((await sent).postDataJSON()).toMatchObject({ message: "When should I train" });
  await expect(page.getByText("Train at 18:00.")).toBeVisible();
});

test("leaving the tab while holding sends nothing, and the tabs still work", async ({ page }) => {
  await openChat(page);
  let sent = false;
  await page.route("**/chat/stream", (route) => {
    sent = true;
    return route.abort();
  });
  await press(page);
  await voice(page, `r.say("half a thought")`);
  // A second finger on the tab bar while the first still holds the mic.
  await page.evaluate(() => (document.querySelector('nav a[href="/goals"]') as HTMLAnchorElement).click());
  await expect(page).toHaveURL(/\/goals$/);
  await page.mouse.up();
  await expect.poll(() => live(page)).toBe(0);
  await page.waitForTimeout(300);
  expect(sent).toBe(false);
  // Back on Chat the half thought waits in the box, unsent, like any draft.
  await page.evaluate(() => (document.querySelector('nav a[href="/chat"]') as HTMLAnchorElement).click());
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator("#chat-input")).toHaveValue("half a thought");
  expect(sent).toBe(false);
});

test("reduced motion: the listening ring holds still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openChat(page);
  await press(page);
  const ring = page.locator(".m-listen-ring");
  await expect(ring).toBeVisible();
  expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await voice(page, `r.fail("aborted")`);
  await page.mouse.up();
});

test("no speech recognition on a phone: a tap opens the keyboard for its dictation", async ({ page }) => {
  const mic = await openChat(page, { recognition: false });
  await expect(mic).toHaveAttribute("data-supported", "false");
  await expect(mic).toHaveAccessibleName("Dictate with your keyboard's mic");
  await tap(mic);
  await expect(page.locator("form [role=alert]")).toHaveText(DICTATE_COPY);
  await expect(page.locator("#chat-input")).toBeFocused();
});

test("iPhone home screen app: a refused recogniser turns the button into the dictation hint", async ({
  page,
}) => {
  const mic = await openChat(page, { standalone: true });
  await expect(mic).toHaveAttribute("data-supported", "true");
  await press(page);
  await voice(page, `r.fail("service-not-allowed")`);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toHaveText(DICTATE_COPY);
  await expect(mic).toHaveAttribute("data-supported", "false");
  // Remembered: the next visit starts as the hint and never starts a recogniser that cannot run.
  await page.reload();
  await expect(page.getByTestId("push-to-talk")).toHaveAttribute("data-supported", "false");
  await tap(page.getByTestId("push-to-talk"));
  await expect(page.locator("form [role=alert]")).toHaveText(DICTATE_COPY);
  expect(await voice<number>(page, "v.started")).toBe(0);
});

test("the reply's voice is unlocked on the release, inside the tap", async ({ page }) => {
  await streamReply(page, "Train at 18:00.");
  await openChat(page);
  await press(page);
  await voice(page, `r.say("When should I train")`);
  expect(await voice<number>(page, "v.primed")).toBe(0);
  await page.mouse.up();
  expect(await voice<number>(page, "v.primed")).toBe(1);
  await expect.poll(() => voice<string[]>(page, "v.spoken")).toEqual(["Train at 18:00."]);
});
