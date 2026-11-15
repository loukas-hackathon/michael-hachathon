import type { Page, Route } from "@playwright/test";
import {
  NOTHING_HEARD_COPY,
  TAPPED_COPY,
  transcribeErrorCopy,
} from "../../apps/web/components/voice/recorder";
import { enterDemo, expect, tap, test } from "./fixtures";
import { type Mode, streamReply, stubSpeech, voice } from "./speech-stub";

// Voice input by recording (#313), against the production build: where the browser cannot
// recognise speech (the iPhone home screen app, Firefox), the app records with MediaRecorder and
// the API transcribes. Chromium's fake microphone gives a real recording; the transcription
// itself is stubbed at /chat/transcribe, since the test API has no ElevenLabs key.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

type Upload = { type: string | null; size: number };

/** The API can transcribe, and every recording sent comes back as `text` (or `fail`). */
async function stubTranscribe(
  page: Page,
  answer: { text?: string; fail?: { status: number; code: string } },
) {
  const uploads: Upload[] = [];
  await page.route("**/chat/transcribe", async (route: Route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { available: true } });
    uploads.push({
      type: req.headers()["content-type"] ?? null,
      size: req.postDataBuffer()?.byteLength ?? 0,
    });
    if (answer.fail) {
      return route.fulfill({
        status: answer.fail.status,
        json: { error: { code: answer.fail.code, message: "stub" } },
      });
    }
    return route.fulfill({ json: { text: answer.text ?? "", language: "en" } });
  });
  return uploads;
}

async function openChat(page: Page, mode: Mode) {
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

test("iPhone home screen app: hold records, let go transcribes on the server, and it sends", async ({
  page,
}) => {
  const uploads = await stubTranscribe(page, { text: "How much deep work have I done today?" });
  await streamReply(page, "Forty seven minutes so far.");
  const mic = await openChat(page, { standalone: true });
  await expect(mic).toHaveAttribute("data-mode", "recorder");
  await expect(mic).toHaveAttribute("data-supported", "true");

  await press(page);
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder("Listening. Let go to send")).toBeVisible();
  await expect(page.getByTestId("voice-level")).toBeVisible();
  await page.waitForTimeout(900);
  const sent = page.waitForRequest("**/chat/stream");
  await page.mouse.up();

  expect((await sent).postDataJSON()).toMatchObject({ message: "How much deep work have I done today?" });
  await expect(page.getByText("Forty seven minutes so far.").first()).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0]?.type).toBe("audio/webm");
  expect(uploads[0]?.size).toBeGreaterThan(0);
  // The browser's recogniser, which iOS refuses there, was never started.
  expect(await voice<number>(page, "v.started")).toBe(0);
  // And the answer is read aloud, as with the browser's recogniser.
  await expect.poll(() => voice<string[]>(page, "v.spoken")).toEqual(["Forty seven minutes so far."]);
});

test("a tap is not a sentence: nothing is sent or uploaded", async ({ page }) => {
  const uploads = await stubTranscribe(page, { text: "never" });
  let sent = false;
  await page.route("**/chat/stream", (route) => {
    sent = true;
    return route.abort();
  });
  await openChat(page, { recognition: false });
  await expect(page.getByTestId("push-to-talk")).toHaveAttribute("data-mode", "recorder");
  await press(page);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toHaveText(TAPPED_COPY);
  await page.waitForTimeout(300);
  expect(uploads).toHaveLength(0);
  expect(sent).toBe(false);
});

test("nothing said: Michael says so and sends nothing", async ({ page }) => {
  await stubTranscribe(page, { text: "" });
  let sent = false;
  await page.route("**/chat/stream", (route) => {
    sent = true;
    return route.abort();
  });
  await openChat(page, { recognition: false });
  await press(page);
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toHaveText(NOTHING_HEARD_COPY);
  expect(sent).toBe(false);
});

test("too many recordings: the calm rate limit line", async ({ page, guard }) => {
  await stubTranscribe(page, { fail: { status: 429, code: "rate_limited" } });
  await openChat(page, { recognition: false });
  await press(page);
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toHaveText(transcribeErrorCopy("rate_limited"));
  // The browser logs the 429 itself; that one is expected.
  const i = guard.problems.findIndex((p) => p.includes("429"));
  if (i >= 0) guard.problems.splice(i, 1);
});

test("microphone refused on the recorder path: Michael says how to allow it", async ({ page }) => {
  await stubTranscribe(page, { text: "never" });
  await openChat(page, { recognition: false, micDenied: true });
  await press(page);
  await page.mouse.up();
  await expect(page.locator("form [role=alert]")).toContainText("I need the microphone");
});

test("no recogniser and the API cannot transcribe: the dictation hint stays", async ({ page }) => {
  // No stub: the test API has no ElevenLabs key, so /chat/transcribe says it is not available.
  const mic = await openChat(page, { recognition: false });
  await expect(mic).toHaveAttribute("data-supported", "false");
  await tap(mic);
  await expect(page.locator("form [role=alert]")).toContainText("keyboard");
});

test("Talk to Michael in the home screen app: a recorded turn, answered by voice", async ({ page }) => {
  const uploads = await stubTranscribe(page, { text: "When should I train tomorrow?" });
  await streamReply(page, "Train at 18:00.");
  await stubSpeech(page, { standalone: true });
  await enterDemo(page);
  // Let the app learn the API can transcribe before the tap.
  const asked = page.waitForResponse("**/chat/transcribe");
  await page.goto("/chat");
  await asked;
  await tap(page.getByTestId("talk"));
  const orb = page.getByTestId("conversation-orb");
  await expect(orb).toHaveAttribute("data-phase", "listening");
  await expect(page.getByTestId("voice-level")).toBeVisible();
  await page.waitForTimeout(900);

  const sent = page.waitForRequest("**/chat/stream");
  // A tap says "done" (the fake microphone never goes quiet).
  await tap(orb);
  expect((await sent).postDataJSON()).toMatchObject({
    message: "When should I train tomorrow?",
    spoken: true,
  });
  await expect(page.getByTestId("conversation")).toContainText("Train at 18:00.");
  await expect.poll(() => voice<string[]>(page, "v.spoken")).toEqual(["Train at 18:00."]);
  // Then it listens again, recording the next turn.
  await expect(orb).toHaveAttribute("data-phase", "listening");
  expect(uploads).toHaveLength(1);
  expect(await voice<number>(page, "v.started")).toBe(0);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(page.getByTestId("conversation")).toBeHidden();
});
