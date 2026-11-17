import type { Page } from "@playwright/test";
import { enterDemo, expect, tap, test } from "./fixtures";
import { live, type Mode, streamReply, stubSpeech, voice } from "./speech-stub";

// "Yo Michael": the in app wake word (lib/wake-word.ts, components/voice/wake-word-host.tsx) with
// the scripted recogniser from speech-stub.ts. Off by default; once on, a recogniser listens on
// every screen and the Mi button wears a still ring. His name opens the island at the top of the
// screen (components/voice/wake-island.tsx), where he listens, answers and closes, on the screen
// the user is on.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

const REPLY = "Sixty two percent of goal time so far. Gym at 18:00 keeps it on track.";
const SWITCH = /Yo Michael/;

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

/** The newest recogniser still running hears these words (not final yet, as a phrase in progress). */
const say = (page: Page, text: string) =>
  page.evaluate((t) => {
    const v = (window as unknown as { __voice: { recs: { ended: boolean; say(t: string): void }[] } })
      .__voice;
    v.recs
      .filter((r) => !r.ended)
      .at(-1)
      ?.say(t);
  }, text);

/** The armed ring on the Mi button: the sign that the wake word is listening. */
const armed = (page: Page) => page.locator('[data-testid="wake-armed"]:visible');
const island = (page: Page) => page.getByTestId("wake-island");

test("off by default; the switch on You turns it on and says where the audio goes", async ({ page }) => {
  await stubSpeech(page);
  await enterDemo(page);
  await expect(armed(page)).toHaveCount(0);
  expect(await live(page)).toBe(0);

  await page.goto("/you");
  const row = page.getByTestId("wake-word-row");
  await expect(row).toContainText("Yo Michael");
  await expect(row).toContainText("Listen for my name while the app is open.");
  // The scripted recogniser has no on device call: the cloud line, before it is on.
  await expect(row).toContainText("Your browser's speech service hears what is said while I listen.");
  await tap(page.getByRole("checkbox", { name: SWITCH }));
  await expect.poll(() => live(page)).toBe(1);
  expect(await voice<boolean>(page, "r.continuous && r.interimResults")).toBe(true);

  // Armed: a still ring round the Mi button on the tabs, and its name says so.
  await page.goto("/");
  await expect(armed(page)).toHaveCount(1);
  await expect(page.getByRole("link", { name: "You. Listening for my name" }).first()).toBeAttached();

  // Off again: the recogniser stops and the ring goes.
  await page.goto("/you");
  await page.getByRole("checkbox", { name: SWITCH }).click();
  await expect.poll(() => live(page)).toBe(0);
  await page.goto("/");
  await expect(armed(page)).toHaveCount(0);
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
  await tap(page.getByRole("checkbox", { name: SWITCH }));
  await expect(row).toContainText("Heard on this device, only while the app is open.");
  await expect.poll(() => live(page)).toBe(1);
  expect(await voice<unknown>(page, "r.processLocally")).toBe(true);
  expect(await voice<string>(page, "r.lang")).toBe("en-GB");
});

test("where the browser cannot recognise speech, the row says so and points to holding Mi", async ({
  page,
}) => {
  await stubSpeech(page, { recognition: false });
  await enterDemo(page);
  await page.goto("/you");
  await expect(page.getByText("Talk to Michael")).toBeVisible();
  const row = page.getByTestId("wake-word-row");
  await expect(row).toHaveAttribute("data-support", "no-recogniser");
  await expect(page.getByTestId("wake-word-line")).toHaveText(
    "This browser can't listen for my name. Hold the Mi button to talk.",
  );
  // Never a switch that does nothing: it is off and cannot be turned on here.
  await expect(page.getByRole("checkbox", { name: SWITCH })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: SWITCH })).not.toBeChecked();
});

test("his name and a request on Today: the island answers there, then closes", async ({ page }) => {
  await streamReply(page, REPLY);
  await switchedOn(page);
  await expect(armed(page)).toHaveCount(1);
  await expect.poll(() => live(page)).toBe(1);

  // Words that do not start with his name send nothing and show nothing.
  let sent = 0;
  page.on("request", (r) => {
    if (r.url().includes("/chat/stream")) sent++;
  });
  await say(page, "I told Michael about the gym");
  await page.waitForTimeout(1200);
  expect(sent).toBe(0);
  await expect(island(page)).toHaveCount(0);

  const asked = page.waitForRequest("**/chat/stream");
  await say(page, "hey Michael how is my day going");
  // Two stages: the island comes in dim while the phrase is unfinished, then wakes.
  await expect(island(page)).toHaveAttribute("data-phase", "heard");
  expect((await asked).postDataJSON()).toMatchObject({ message: "How is my day going", spoken: true });
  // Still on Today: no screen change, the island answers at the top.
  await expect(page).not.toHaveURL(/\/chat/);
  await expect(island(page)).toHaveAttribute("data-phase", "speaking");
  await expect(island(page)).toHaveAccessibleName("Tap to cut in");
  await expect(page.getByTestId("wake-reply")).toHaveText(REPLY);
  await expect.poll(async () => (await voice<string[]>(page, "v.spoken")).join(" ")).toBe(REPLY);
  // While he speaks or listens, the wake word is not listening: no ring.
  await expect(armed(page)).toHaveCount(0);

  // A tap cuts in: he stops and listens for the follow up.
  await tap(island(page));
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  expect(await voice<number>(page, "v.held()")).toBe(0);

  // Escape closes it: the wake word listens again.
  await page.keyboard.press("Escape");
  await expect(island(page)).toHaveCount(0);
  await expect(armed(page)).toHaveCount(1);
  await expect.poll(() => live(page)).toBe(1);
});

test("his name alone: he listens at once, and a quiet wake closes with no line", async ({ page }) => {
  await switchedOn(page);
  await page.goto("/chat");
  await expect.poll(() => live(page)).toBe(1);
  await say(page, "Michael");
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await expect(page.getByTestId("conversation")).toHaveCount(0);
  // Nothing said for 4 seconds: it closes, quietly.
  await expect(island(page)).toHaveCount(0, { timeout: 8000 });
  expect(await voice<string[]>(page, "v.spoken")).toEqual([]);
});

test("not caught: he says so once, then offers typing", async ({ page }) => {
  await switchedOn(page);
  await expect.poll(() => live(page)).toBe(1);
  await say(page, "yo Michael");
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await voice(page, "r.fail('no-match')");
  await expect(page.getByTestId("wake-note")).toHaveText("I didn't catch that. Say it again.");
  await expect.poll(() => voice<string[]>(page, "v.spoken")).toEqual(["I didn't catch that. Say it again."]);
  await voice(page, "v.finish()");
  await expect(island(page)).toHaveAttribute("data-phase", "listening");
  await voice(page, "r.fail('no-match')");
  await expect(page.getByTestId("wake-note")).toHaveText("Type it instead.");
  await expect(page.getByRole("link", { name: "Open the keyboard" })).toBeVisible();
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
  await expect(armed(page)).toHaveCount(0);
  await visibility("visible");
  await expect.poll(() => live(page)).toBe(1);
});

test("listens again within 300ms of the browser ending a session, and a wake straight after is heard", async ({
  page,
}) => {
  await streamReply(page, REPLY);
  await switchedOn(page);
  await expect.poll(() => live(page)).toBe(1);
  await page.waitForTimeout(2100);
  const before = await voice<number>(page, "v.started");
  await page.evaluate(() => {
    const v = (window as unknown as { __voice: { recs: { ended: boolean; end(): void }[] } }).__voice;
    v.recs
      .filter((r) => !r.ended)
      .at(-1)
      ?.end();
  });
  await expect.poll(() => voice<number>(page, "v.started")).toBe(before + 1);
  const gap = await voice<number>(page, "v.starts.at(-1) - v.ends.at(-1)");
  expect(gap).toBeLessThan(300);
  // Half a second into the new session: "yo Michael" and a request, not lost to the restart.
  await page.waitForTimeout(500);
  const asked = page.waitForRequest("**/chat/stream");
  await say(page, "yo Michael what is next");
  expect((await asked).postDataJSON()).toMatchObject({ message: "What is next" });
  await expect(page.getByTestId("wake-reply")).toHaveText(REPLY);
});

test("?debug=voice: tapping the armed island shows what the recogniser last heard", async ({ page }) => {
  await switchedOn(page);
  await expect.poll(() => live(page)).toBe(1);
  // Hidden unless asked for.
  await expect(page.getByTestId("wake-debug")).toHaveCount(0);
  await page.goto("/?debug=voice");
  await expect.poll(() => live(page)).toBe(1);
  const pill = page.getByTestId("wake-debug");
  await expect(pill).toContainText("Armed");
  await say(page, "we were talking about the gym");
  await tap(pill);
  const card = page.getByTestId("wake-debug-card");
  await expect(card).toContainText('"we were talking about the gym"');
  await expect(card).toContainText("Sessions");
  // Stays for the visit, without the parameter.
  await page.goto("/timeline");
  await expect.poll(() => live(page)).toBe(1);
  await expect(page.getByTestId("wake-debug")).toBeVisible();
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
  await expect(armed(page)).toHaveCount(0);
  await page.goto("/you");
  // What to do, in one line, for this browser (Chrome on a laptop here).
  await expect(page.getByTestId("wake-word-line")).toHaveText(
    "Microphone blocked. Click the icon left of the address and allow it.",
  );
  await expect(page.getByRole("checkbox", { name: SWITCH })).not.toBeChecked();
});
