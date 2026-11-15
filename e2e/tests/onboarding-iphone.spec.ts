import { enterDemo, expect, tap, test } from "./fixtures";
import { stubSpeech } from "./speech-stub";

// The onboarding talk on iPhone Safari, which listens by recording (#313): Chromium's fake
// microphone gives a real recording and level, and the transcription is stubbed at
// /chat/transcribe, since the test API has no ElevenLabs key.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

test("iPhone: the talk records each answer, shows the level, and the server's words count", async ({
  page,
}) => {
  let uploads = 0;
  await page.route("**/chat/transcribe", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
    uploads++;
    return route.fulfill({ json: { text: "Study for my exams and train twice a week", language: "en" } });
  });
  await stubSpeech(page, { iphone: true });
  await enterDemo(page);
  await page.goto("/onboarding");
  await tap(page.getByRole("button", { name: "Let's talk" }));
  const notNow = page.getByRole("button", { name: "Not now" });
  const orb = page.getByTestId("talk-orb");
  await expect(notNow.or(orb)).toBeVisible();
  if (await notNow.isVisible()) await tap(notNow);

  await expect(orb).toHaveAttribute("data-state", "listening");
  await expect(page.getByTestId("voice-level")).toBeVisible();
  // The pause after speaking ends the turn; a tap says "done" when the room never goes quiet.
  await page.waitForTimeout(1500);
  if ((await orb.getAttribute("data-state")) === "listening") await orb.click();
  await expect(page.getByRole("button", { name: /^You said: Study for my exams/ })).toBeVisible();
  expect(uploads).toBe(1);
});
