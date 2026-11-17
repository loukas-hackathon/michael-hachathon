import type { Page, Route } from "@playwright/test";
import {
  HOME_SCREEN_LINE,
  NO_RECOGNISER_LINE,
  OFFER_HOLD_ON_LINE,
  OFFER_ON_LINE,
  OFFER_WAKE_LINE,
} from "../../apps/web/lib/wake-word";
import { enterDemo, expect, tap, test } from "./fixtures";
import { live, type Mode, streamReply, stubSpeech, voice } from "./speech-stub";

// "Yo Michael" made easy to find and sure to work: Michael offers it once, the first time Chat
// opens (components/voice/wake-offer.tsx); where it cannot run he offers holding the Mi button
// instead (components/voice/hold-to-talk.tsx), which works everywhere, the iPhone Home Screen app
// included; and every place that cannot listen says why in one line.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

/** conversation.ts MIC_TIMEOUT_COPY and HOLD_MISSED_COPY (that module needs the app's path aliases). */
const MIC_TIMEOUT_COPY = "The microphone didn't open. Hold me again.";
const HOLD_MISSED_COPY = "I didn't catch that. Hold me and speak.";
const REPLY = "Forty seven minutes of deep work so far. Block 15:00 to finish it.";
const offer = (page: Page) => page.getByTestId("wake-offer");
const island = (page: Page) => page.getByTestId("wake-island");
const mi = (page: Page) => page.getByTestId("mi-button");

/** The API can transcribe, and every recording comes back as `text`. */
async function stubTranscribe(page: Page, text: string) {
  const uploads: number[] = [];
  await page.route("**/chat/transcribe", async (route: Route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { available: true } });
    uploads.push(req.postDataBuffer()?.byteLength ?? 0);
    return route.fulfill({ json: { text, language: "en" } });
  });
  return uploads;
}

/** The newest recogniser still running hears these words. */
const say = (page: Page, text: string) =>
  page.evaluate((t) => {
    const v = (window as unknown as { __voice: { recs: { ended: boolean; say(t: string): void }[] } })
      .__voice;
    v.recs
      .filter((r) => !r.ended)
      .at(-1)
      ?.say(t);
  }, text);

/** Presses and holds the Mi button, once it is hydrated. */
async function holdMi(page: Page) {
  const button = mi(page);
  await expect(button).toBeVisible();
  await expect
    .poll(() => button.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))))
    .toBe(true);
  const box = await button.boundingBox();
  if (!box) throw new Error("no Mi button");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

async function openChat(page: Page, mode: Mode = {}) {
  await stubSpeech(page, mode);
  await enterDemo(page);
  await page.goto("/chat");
}

test("the first time Chat opens, Michael offers it once, and one tap turns it on", async ({ page }) => {
  await openChat(page);
  await expect(offer(page)).toHaveAttribute("data-kind", "wake");
  await expect(offer(page)).toContainText(OFFER_WAKE_LINE);
  // Where the audio goes, before it is on.
  await expect(offer(page)).toContainText("Your browser's speech service hears what is said while I listen.");
  expect(await live(page)).toBe(0);

  await tap(offer(page).getByRole("button", { name: "Turn on" }));
  await expect(offer(page)).toContainText(OFFER_ON_LINE);
  await expect.poll(() => live(page)).toBe(1);
  await expect(page.locator('[data-testid="wake-armed"]:visible')).toHaveCount(1);

  // Never again: not after a reload, not on Today.
  await page.reload();
  await expect(page.getByLabel("Message Michael")).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
  await page.goto("/");
  await expect(offer(page)).toHaveCount(0);
  // And You agrees.
  await page.goto("/you");
  await expect(page.getByRole("checkbox", { name: /Yo Michael/ })).toBeChecked();
});

test("Not now: he never asks again, and nothing listens", async ({ page }) => {
  await openChat(page);
  await tap(offer(page).getByRole("button", { name: "Not now" }));
  await expect(offer(page)).toHaveCount(0);
  // Chat's own one time hint takes its place.
  await expect(page.getByTestId("hint-talk")).toBeVisible();
  expect(await live(page)).toBe(0);
  await page.reload();
  await expect(page.getByLabel("Message Michael")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(offer(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("michael.wake.offer"))).toBe("no");
});

test("Today offers it only after a day with Michael, if Chat was never opened", async ({ page }) => {
  await stubSpeech(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem("michael.firstSeen")) {
      localStorage.setItem("michael.firstSeen", String(Date.now() - 25 * 60 * 60 * 1000));
    }
  });
  await enterDemo(page);
  await expect(offer(page)).toHaveAttribute("data-kind", "wake");
  await expect(offer(page)).toContainText(OFFER_WAKE_LINE);
});

test("a blocked microphone: the offer says how to allow it, in one line", async ({ page }) => {
  await openChat(page, { micDenied: true });
  await tap(offer(page).getByRole("button", { name: "Turn on" }));
  await expect(offer(page)).toContainText(
    "Microphone blocked. Click the icon left of the address and allow it.",
  );
  expect(await live(page)).toBe(0);
});

test("hold Mi to talk: the island listens while held and answers when let go", async ({ page }) => {
  await streamReply(page, REPLY);
  await stubSpeech(page, { holdSpeech: true });
  await enterDemo(page);
  await holdMi(page);
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await expect(island(page)).toHaveAccessibleName("Listening");
  // A pause while held does not end the turn: only letting go does.
  await say(page, "how much deep work have I done");
  await page.waitForTimeout(1500);
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await expect(page.getByTestId("wake-heard")).toHaveText("how much deep work have I done");

  const asked = page.waitForRequest("**/chat/stream");
  await page.mouse.up();
  expect((await asked).postDataJSON()).toMatchObject({
    message: "how much deep work have I done",
    spoken: true,
  });
  await expect(page.getByTestId("wake-reply")).toHaveText(REPLY);
  await expect.poll(async () => (await voice<string[]>(page, "v.spoken")).join(" ")).toBe(REPLY);
  // Still on Today: a hold never opens You.
  await expect(page).toHaveURL(/\/$/);
  // He answers once and does not listen again; the answer stays to read.
  await voice(page, "v.finish()");
  await expect(island(page)).toHaveAttribute("data-phase", "ended");
  await expect(page.getByTestId("wake-reply")).toHaveText(REPLY);
  expect(await live(page)).toBe(0);

  // A short tap keeps Mi's own action.
  await tap(mi(page));
  await expect(page).toHaveURL(/\/you$/);
});

test("hold Mi and let go without a word: he says so, and sends nothing", async ({ page }) => {
  let sent = 0;
  page.on("request", (r) => {
    if (r.url().includes("/chat/stream")) sent++;
  });
  await stubSpeech(page);
  await enterDemo(page);
  await holdMi(page);
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await page.mouse.up();
  await expect(page.getByTestId("wake-note")).toHaveText(HOLD_MISSED_COPY);
  expect(sent).toBe(0);
});

test("iPhone Home Screen app: hold Mi records, the API transcribes, he answers", async ({ page }) => {
  const uploads = await stubTranscribe(page, "When should I train tomorrow?");
  await streamReply(page, "Train at 18:00.");
  await stubSpeech(page, { standalone: true });
  await enterDemo(page);
  await holdMi(page);
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await page.waitForTimeout(900);
  const asked = page.waitForRequest("**/chat/stream");
  await page.mouse.up();
  expect((await asked).postDataJSON()).toMatchObject({ message: "When should I train tomorrow?" });
  await expect(page.getByTestId("wake-reply")).toHaveText("Train at 18:00.");
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toBeGreaterThan(0);
  // The browser's recogniser, which iOS refuses there, was never started.
  expect(await voice<number>(page, "v.started")).toBe(0);
});

test("iPhone Home Screen app: the offer and You say why, and point to holding Mi", async ({ page }) => {
  await stubTranscribe(page, "never");
  await openChat(page, { standalone: true });
  await expect(offer(page)).toHaveAttribute("data-kind", "hold");
  await expect(offer(page)).toContainText(HOME_SCREEN_LINE);
  await tap(offer(page).getByRole("button", { name: "Allow microphone" }));
  await expect(offer(page)).toContainText(OFFER_HOLD_ON_LINE);

  await page.goto("/you");
  await expect(page.getByTestId("wake-word-line")).toHaveText(HOME_SCREEN_LINE);
  await expect(page.getByRole("checkbox", { name: /Yo Michael/ })).toBeDisabled();
});

test("no recogniser at all: the offer is holding Mi, with the reason", async ({ page }) => {
  await openChat(page, { recognition: false });
  await expect(offer(page)).toHaveAttribute("data-kind", "hold");
  await expect(offer(page)).toContainText(NO_RECOGNISER_LINE);
});

test("after his first answer in Chat, once: Hold me to talk, under Mi", async ({ page }) => {
  await streamReply(page, REPLY);
  await openChat(page, { holdSpeech: true });
  await tap(offer(page).getByRole("button", { name: "Not now" }));
  await expect(page.getByTestId("hold-hint")).toHaveCount(0);
  const field = page.getByLabel("Message Michael");
  await field.fill("How is my day");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(REPLY).first()).toBeVisible();
  const hint = page.getByTestId("hold-hint");
  await expect(hint).toHaveText(/Hold me to talk\./);
  // Holding Mi is using it: the hint goes for good.
  await holdMi(page);
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await expect(hint).toHaveCount(0);
  await page.mouse.up();
  await page.reload();
  await expect(field).toBeVisible();
  await expect(page.getByTestId("hold-hint")).toHaveCount(0);
});

test("iPhone Home Screen app: hold after hold keeps working, and ?debug=voice shows each step", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let n = 0;
  await page.route("**/chat/transcribe", async (route: Route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
    n++;
    return route.fulfill({ json: { text: `Question ${n}`, language: "en" } });
  });
  await streamReply(page, "Train at 18:00.");
  await stubSpeech(page, { standalone: true });
  await enterDemo(page);
  await page.goto("/?debug=voice");
  for (let i = 1; i <= 4; i++) {
    await holdMi(page);
    await expect(island(page), `hold ${i}`).toHaveAttribute("data-phase", "listening");
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByTestId("wake-reply"), `hold ${i}`).toHaveText("Train at 18:00.");
    await page.waitForTimeout(i % 2 ? 400 : 7000);
  }
  expect(n).toBe(4);
  await tap(page.getByTestId("wake-debug"));
  const steps = page.getByTestId("voice-steps");
  await expect(steps).toContainText("hold, recorded for the API");
  await expect(steps).toContainText(/mic open in \d+ ms/);
  await expect(steps).toContainText('heard: "Question 4"');
  await expect(steps).toContainText("answered");
});

test("iPhone Home Screen app: a microphone that never opens says so, and the next hold works", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubTranscribe(page, "How is my day going?");
  await streamReply(page, "Train at 18:00.");
  await stubSpeech(page, { standalone: true });
  // The first getUserMedia never answers (iOS after the app was in the background); later ones do.
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let calls = 0;
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
      calls++;
      return calls === 1 ? new Promise<MediaStream>(() => {}) : real(c);
    };
  });
  await enterDemo(page);
  await holdMi(page);
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await page.mouse.up();
  await expect(page.getByText(MIC_TIMEOUT_COPY)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(6500);
  await holdMi(page);
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByTestId("wake-reply")).toHaveText("Train at 18:00.");
});
