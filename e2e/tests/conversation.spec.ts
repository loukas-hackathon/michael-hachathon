import type { Page } from "@playwright/test";
import { DICTATE_COPY } from "../../apps/web/components/voice/speech";
import { enterDemo, expect, tap, test } from "./fixtures";
import { live, type Mode, streamReply, stubSpeech, voice } from "./speech-stub";

// Talk to Michael (#299): a hands free conversation on /chat, against the production build, with
// the scripted recogniser and the recording speech synthesiser from speech-stub.ts.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

const REPLY = "Forty seven minutes of deep work so far. Want a block at 15:00?";

async function openTalk(page: Page, mode: Mode = {}) {
  await stubSpeech(page, { holdSpeech: true, ...mode });
  await enterDemo(page);
  await page.goto("/chat");
  await tap(page.getByTestId("talk"));
  await expect(page.getByTestId("conversation")).toBeVisible();
  return page.getByTestId("conversation-orb");
}

/** Says a line into the newest recogniser; the turn ends on the pause after it. */
async function sayTurn(page: Page, text: string) {
  await voice(page, `r.say(${JSON.stringify(text)})`);
}

test("one tap: Michael listens, answers briefly by voice after a pause, then listens again", async ({
  page,
}) => {
  await streamReply(page, REPLY);
  const orb = await openTalk(page);
  await expect(orb).toHaveAttribute("data-phase", "listening");
  await expect(orb).toHaveAccessibleName("Listening");

  const sent = page.waitForRequest("**/chat/stream");
  await sayTurn(page, "How much deep work have I done today");
  await expect(page.getByTestId("conversation")).toContainText("How much deep work have I done today");
  // Sent on the pause, asking for an answer to be read aloud.
  expect((await sent).postDataJSON()).toEqual({
    message: "How much deep work have I done today",
    spoken: true,
  });

  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  await expect(page.getByTestId("conversation")).toContainText("Forty seven minutes");
  expect((await voice<string[]>(page, "v.spoken")).join(" ")).toBe(REPLY);

  await voice(page, "v.finish()");
  await expect(orb).toHaveAttribute("data-phase", "listening");
  await expect.poll(() => live(page)).toBe(1);
  // Said once, never twice.
  expect((await voice<string[]>(page, "v.spoken")).join(" ")).toBe(REPLY);
  // The lines are in the chat too, under the sheet.
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(page.getByTestId("conversation")).toBeHidden();
  await expect(page.getByRole("paragraph").filter({ hasText: "Forty seven minutes" })).toBeVisible();
});

test("a tap while Michael speaks stops him and listens", async ({ page }) => {
  await streamReply(page, REPLY);
  const orb = await openTalk(page);
  await sayTurn(page, "How is my day");
  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  await orb.click();
  await expect(orb).toHaveAttribute("data-phase", "listening");
  expect(await voice<number>(page, "v.cancelled")).toBe(1);
});

test("speaking over Michael stops him; his own voice coming back does not", async ({ page }) => {
  await streamReply(page, REPLY);
  const orb = await openTalk(page);
  await sayTurn(page, "How is my day");
  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  await expect(orb).toHaveAccessibleName("Speak or tap to cut in");
  // The microphone hears the speaker: still speaking.
  await voice(page, `r.say("forty seven minutes of deep work")`);
  await page.waitForTimeout(200);
  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  // The user cuts in.
  await voice(page, `r.say(" wait, what about the gym tomorrow")`);
  await expect(orb).toHaveAttribute("data-phase", "listening");
  expect(await voice<number>(page, "v.cancelled")).toBe(1);
});

test("iPhone: no speaking over him (the mic would cut his voice), a tap still does", async ({ page }) => {
  await streamReply(page, REPLY);
  const orb = await openTalk(page, { iphone: true });
  await sayTurn(page, "How is my day");
  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  await expect(orb).toHaveAccessibleName("Tap to cut in");
  expect(await live(page)).toBe(0);
  await orb.click();
  await expect(orb).toHaveAttribute("data-phase", "listening");
});

test("silence ends the conversation; a tap starts it again; End stops everything", async ({ page }) => {
  test.setTimeout(45_000);
  await streamReply(page, REPLY);
  const orb = await openTalk(page);
  await expect(orb).toHaveAttribute("data-phase", "off", { timeout: 15_000 });
  await expect(page.getByTestId("conversation")).toContainText("I'll be here when you need me.");
  expect(await live(page)).toBe(0);
  await orb.click();
  await expect(orb).toHaveAttribute("data-phase", "listening");
  await sayTurn(page, "How is my day");
  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(page.getByTestId("conversation")).toBeHidden();
  expect(await voice<number>(page, "v.cancelled")).toBe(1);
  await expect.poll(() => live(page)).toBe(0);
});

test("iPhone home screen app: an honest line instead of a conversation that cannot hear", async ({
  page,
}) => {
  await openTalk(page, { standalone: true });
  await voice(page, `r.fail("service-not-allowed")`);
  await expect(page.getByTestId("conversation").getByRole("alert")).toHaveText(
    `I can't listen in this app. ${DICTATE_COPY}`,
  );
  await expect.poll(() => live(page)).toBe(0);
});
