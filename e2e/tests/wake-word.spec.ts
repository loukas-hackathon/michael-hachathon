import type { Page } from "@playwright/test";
import { READY_LINE } from "../../apps/web/lib/wake-word";
import { enterDemo, expect, tap, test } from "./fixtures";
import { live, type Mode, streamReply, stubSpeech, voice } from "./speech-stub";

// "Say Michael to talk": the in app wake word (lib/wake-word.ts, components/voice/wake-word-host.tsx)
// with the scripted recogniser from speech-stub.ts. Off by default; once on, a recogniser listens
// on every screen, and his name starts the existing hands free conversation on Chat.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

const REPLY = "Sixty two percent of goal time so far. Gym at 18:00 keeps it on track.";

/** The switch already on (cloud), as a returning user who turned it on has it. */
async function switchedOn(page: Page, mode: Mode = {}) {
  await stubSpeech(page, { holdSpeech: true, ...mode });
  // Once per test, not on every page load: a later reload must see what the app stored.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("wake-seeded")) return;
    sessionStorage.setItem("wake-seeded", "1");
    localStorage.setItem("michael.wake", JSON.stringify({ mode: "cloud", lang: "en-GB" }));
  });
  await enterDemo(page);
}

/** The wake recogniser: the newest one still running. */
const say = (page: Page, text: string) =>
  page.evaluate((t) => {
    const v = (window as unknown as { __voice: { recs: { ended: boolean; say(t: string): void }[] } })
      .__voice;
    v.recs
      .filter((r) => !r.ended)
      .at(-1)
      ?.say(t);
  }, text);

test("off by default; the switch on You turns it on and says where the audio goes", async ({ page }) => {
  await stubSpeech(page);
  await enterDemo(page);
  await expect(page.getByTestId("wake-pill")).toHaveCount(0);
  expect(await live(page)).toBe(0);

  await page.goto("/you");
  const row = page.getByTestId("wake-word-row");
  await expect(row).toContainText("Say Michael to talk");
  // The scripted recogniser has no on device call: the cloud line, before it is on.
  await expect(row).toContainText("Your browser's speech service hears what is said while I listen.");
  await tap(page.getByRole("checkbox", { name: /Say Michael to talk/ }));
  await expect(page.getByTestId("wake-pill")).toHaveText("Listening for Michael");
  await expect.poll(() => live(page)).toBe(1);
  expect(await voice<boolean>(page, "r.continuous && r.interimResults")).toBe(true);

  // Off again: the recogniser stops and the pill goes.
  await page.getByRole("checkbox", { name: /Say Michael to talk/ }).click();
  await expect(page.getByTestId("wake-pill")).toHaveCount(0);
  await expect.poll(() => live(page)).toBe(0);
});

test("on device where the browser can: the pack is installed on the tap, and audio stays here", async ({
  page,
}) => {
  await stubSpeech(page);
  // Chrome's on device calls on the scripted recogniser: a pack that downloads on install().
  await page.addInitScript(() => {
    const R = (window as unknown as { SpeechRecognition: Record<string, unknown> }).SpeechRecognition;
    const w = window as unknown as { __installed: string[] };
    w.__installed = [];
    R.available = async (o: { langs: string[] }) =>
      w.__installed.includes(o.langs[0] ?? "") ? "available" : "downloadable";
    R.install = async (o: { langs: string[] }) => {
      w.__installed.push(...o.langs);
      return true;
    };
  });
  await enterDemo(page);
  await page.goto("/you");
  const row = page.getByTestId("wake-word-row");
  await expect(row).toContainText("On this device where Chrome can, else its speech service hears it.");
  await tap(page.getByRole("checkbox", { name: /Say Michael to talk/ }));
  await expect(row).toContainText("Heard on this device, only while the app is open.");
  await expect.poll(() => live(page)).toBe(1);
  expect(await voice<unknown>(page, "r.processLocally")).toBe(true);
  expect(await voice<string>(page, "r.lang")).toBe("en-GB");
});

test("hidden where the browser cannot recognise speech", async ({ page }) => {
  await stubSpeech(page, { recognition: false });
  await enterDemo(page);
  await page.goto("/you");
  await expect(page.getByText("Talk to Michael")).toBeVisible();
  await expect(page.getByTestId("wake-word-row")).toHaveCount(0);
});

test("his name and a request from Today: Chat opens and he answers the request", async ({ page }) => {
  await streamReply(page, REPLY);
  await switchedOn(page);
  await expect(page.getByTestId("wake-pill")).toBeVisible();
  await expect.poll(() => live(page)).toBe(1);

  // Words that do not start with his name send nothing.
  let sent = 0;
  page.on("request", (r) => {
    if (r.url().includes("/chat/stream")) sent++;
  });
  await say(page, "I told Michael about the gym");
  await page.waitForTimeout(1200);
  expect(sent).toBe(0);

  const asked = page.waitForRequest("**/chat/stream");
  await say(page, "hey Michael how is my day going");
  expect((await asked).postDataJSON()).toMatchObject({ message: "How is my day going", spoken: true });
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId("conversation")).toBeVisible();
  await expect(page.getByTestId("conversation-orb")).toHaveAttribute("data-phase", "speaking");
  await expect.poll(async () => (await voice<string[]>(page, "v.spoken")).join(" ")).toBe(REPLY);
  // While he speaks or the conversation runs, the wake word is not listening.
  await expect(page.getByTestId("wake-pill")).toHaveCount(0);

  // The conversation ends: the wake word listens again.
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(page.getByTestId("wake-pill")).toBeVisible();
  await expect.poll(() => live(page)).toBe(1);
});

test("his name alone: a short ready line, then he listens", async ({ page }) => {
  await switchedOn(page);
  await page.goto("/chat");
  await expect.poll(() => live(page)).toBe(1);
  await say(page, "Michael");
  await expect(page.getByTestId("conversation")).toBeVisible();
  await expect.poll(() => voice<string[]>(page, "v.spoken")).toEqual([READY_LINE]);
  await voice(page, "v.finish()");
  await expect(page.getByTestId("conversation-orb")).toHaveAttribute("data-phase", "listening");
});

test("stops when the app is hidden, and listens again when it is back", async ({ page }) => {
  await switchedOn(page);
  await expect.poll(() => live(page)).toBe(1);
  const visibility = (state: "hidden" | "visible") =>
    page.evaluate((s) => {
      Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  await visibility("hidden");
  await expect.poll(() => live(page)).toBe(0);
  await visibility("visible");
  await expect.poll(() => live(page)).toBe(1);
});

test("restarts after the browser ends a session, and backs off after errors", async ({ page }) => {
  await switchedOn(page);
  await expect.poll(() => live(page)).toBe(1);
  const started = () => voice<number>(page, "v.started");
  const before = await started();
  // A normal end (after a while listening): straight back.
  await page.waitForTimeout(2100);
  await page.evaluate(() => {
    const v = (window as unknown as { __voice: { recs: { ended: boolean; end(): void }[] } }).__voice;
    v.recs
      .filter((r) => !r.ended)
      .at(-1)
      ?.end();
  });
  await expect.poll(started).toBe(before + 1);
  // A network error: it waits about a second before the next try, not at once.
  await page.waitForTimeout(2100);
  await voice(page, "r.fail('network')");
  await page.waitForTimeout(400);
  expect(await started()).toBe(before + 1);
  await expect.poll(started, { timeout: 3000 }).toBe(before + 2);
});

test("a refused microphone turns it off and says why", async ({ page }) => {
  await switchedOn(page);
  await expect.poll(() => live(page)).toBe(1);
  await voice(page, "r.fail('not-allowed')");
  await expect(page.getByTestId("wake-pill")).toHaveCount(0);
  await page.goto("/you");
  await expect(page.getByTestId("wake-word-row")).toContainText("I need the microphone to hear my name.");
  await expect(page.getByRole("checkbox", { name: /Say Michael to talk/ })).not.toBeChecked();
});
