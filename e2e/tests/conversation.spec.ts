import type { Page } from "@playwright/test";
import { DICTATE_COPY } from "../../apps/web/components/voice/speech";
import { API_KEY, API_URL, apiGet, enterDemo, expect, tap, test } from "./fixtures";
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

/** The text a sighted user sees in the sheet: everything but the visually hidden live regions. */
const shownText = (page: Page) =>
  page.getByTestId("conversation").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
    return copy.textContent ?? "";
  });

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
  // Sent on the pause, asking for an answer to be read aloud.
  expect((await sent).postDataJSON()).toMatchObject({
    message: "How much deep work have I done today",
    spoken: true,
  });

  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  expect((await voice<string[]>(page, "v.spoken")).join(" ")).toBe(REPLY);
  // A conversation, not a transcript (#458): neither line is on screen, but a screen reader hears
  // the reply from the hidden live region.
  await expect(page.getByTestId("conversation-reply")).toHaveText(REPLY);
  await expect(page.getByTestId("conversation-reply")).toHaveAttribute("aria-live", "polite");
  expect(await shownText(page)).not.toContain("Forty seven minutes");
  expect(await shownText(page)).not.toContain("How much deep work");

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

/** A reply as the chat stream sends it, with whatever Michael changed while answering. */
function streamed(text: string, actions: unknown[] = []) {
  const now = new Date().toISOString();
  return [
    `event: delta\ndata: ${JSON.stringify({ text })}\n\n`,
    `event: done\ndata: ${JSON.stringify({
      message: { id: "m-user", role: "user", content: "asked", created_at: now },
      reply: { id: "m-reply", role: "assistant", content: text, created_at: now },
      actions,
    })}\n\n`,
  ].join("");
}

test("while Michael thinks, the step is the only line; the words wait in Chat", async ({ page }) => {
  test.setTimeout(45_000);
  // The answer is held back until the thinking line has been seen.
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/chat/stream", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: streamed(REPLY),
    });
  });
  const orb = await openTalk(page);
  await sayTurn(page, "How is my day");
  await expect(orb).toHaveAttribute("data-phase", "thinking");
  await expect(page.getByTestId("conversation-line")).toHaveText("Thinking");
  expect(await shownText(page)).not.toContain("How is my day");
  release();
  await expect(orb).toHaveAttribute("data-phase", "speaking");
  await expect.poll(() => voice<number>(page, "v.held()")).toBeGreaterThan(0);
  await voice(page, "v.finish()");
  await expect(orb).toHaveAttribute("data-phase", "listening");

  // A long silence ends it: Michael rests, and one link leads to the words.
  await expect(orb).toHaveAttribute("data-phase", "off", { timeout: 15_000 });
  await expect(page.getByTestId("conversation-line")).toHaveText("I'll be here when you need me.");
  expect(await shownText(page)).not.toContain("Forty seven minutes");
  await tap(page.getByRole("link", { name: "See it in Chat" }));
  await expect(page.getByTestId("conversation")).toBeHidden();
  await expect(page.getByRole("paragraph").filter({ hasText: "Forty seven minutes" })).toBeVisible();
});

type Rec = { id: string; title: string; status: string };

const athens = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hourCycle: "h23", ...opts }).format(d);

/** "2026-11-15T15:00" in Athens, as the MCP tool takes it. */
const local = (d: Date) =>
  `${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(d)}T${athens(d, { hour: "2-digit", minute: "2-digit" })}`;

/** Books 15 minutes as Claude's create_focus_block does, on the local e2e API; true when booked. */
async function books(title: string, start: Date) {
  const end = new Date(start.getTime() + 15 * 60_000);
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "create_focus_block", arguments: { title, start: local(start), end: local(end) } },
    }),
  });
  const raw = await res.text();
  const data = raw
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5))
    .join("");
  const out = JSON.parse(data || raw) as { result?: { isError?: boolean } };
  return res.ok && out.result !== undefined && !out.result.isError;
}

const recs = async () => (await apiGet<{ recommendations: Rec[] }>("/v1/recommendations")).recommendations;

test("what Michael changes shows as a quiet chip, and Undo takes it back", async ({ page }) => {
  const title = "Voice focus";
  const from = Math.ceil((Date.now() + 10 * 60_000) / 1_800_000) * 1_800_000;
  let booked = false;
  for (let i = 0; i < 48 && !booked; i++) booked = await books(title, new Date(from + i * 1_800_000));
  expect(booked, "a free slot in the next 24 hours").toBe(true);
  const rec = (await recs()).find((r) => r.title === title && r.status === "done");
  expect(rec).toBeDefined();

  // The answer that made the change carries it, as the chat stream does after a tool call.
  const said = `Booked ${title}. Undo until it starts.`;
  await page.route("**/chat/stream", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: streamed(said, [rec]),
    }),
  );
  const orb = await openTalk(page);
  await sayTurn(page, "Book me fifteen minutes of focus");
  await expect(orb).toHaveAttribute("data-phase", "speaking");
  const chip = page.getByTestId("voice-action");
  await expect(chip.getByRole("status")).toHaveText(title);
  await expect(page.getByTestId("conversation-reply")).toHaveText(said);
  expect(await shownText(page)).not.toContain("Undo until it starts");

  await tap(chip.getByRole("button", { name: new RegExp(`^Undo ${title}`) }));
  await expect(chip.getByRole("status")).toHaveText(`Undone: ${title}`);
  await expect(chip.getByRole("button")).toHaveCount(0);
  await expect.poll(async () => (await recs()).find((r) => r.id === rec?.id)?.status).toBe("undone");
});

test("mute: the microphone goes off until unmuted, and End still ends it", async ({ page }) => {
  const orb = await openTalk(page);
  await expect(orb).toHaveAttribute("data-phase", "listening");
  await expect.poll(() => live(page)).toBe(1);
  await tap(page.getByRole("button", { name: "Mute", exact: true }));
  await expect(page.getByRole("button", { name: "Unmute", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(orb).toHaveAccessibleName("Muted. Tap to unmute");
  await expect.poll(() => live(page)).toBe(0);
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  await expect(orb).toHaveAccessibleName("Listening");
  await expect.poll(() => live(page)).toBe(1);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(page.getByTestId("conversation")).toBeHidden();
});

test("reduced motion: Michael holds still and the state is said in words", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const orb = await openTalk(page);
  await expect(orb).toHaveAttribute("data-phase", "listening");
  await expect(page.getByTestId("conversation-line").getByText("Listening")).toBeVisible();
  const moving = await orb.evaluate((el) =>
    [...el.querySelectorAll("*")].some((n) => getComputedStyle(n).animationName !== "none"),
  );
  expect(moving).toBe(false);
});
