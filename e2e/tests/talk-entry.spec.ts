import { enterDemo, expect, tap, test } from "./fixtures";
import { stubSpeech } from "./speech-stub";

// Talking to Michael is obvious (#377): a labelled Talk button in the composer, a one time hint
// that says how it differs from the hold to dictate mic, and a way in from the You sheet.

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

test("the composer shows Talk, with a one time hint, and it opens the conversation", async ({ page }) => {
  await stubSpeech(page, { holdSpeech: true });
  await enterDemo(page);
  await page.goto("/chat");

  const talk = page.getByRole("button", { name: "Talk to Michael" });
  await expect(talk).toBeVisible();
  await expect(talk).toHaveText("Talk");
  await expect(page.getByRole("button", { name: "Hold to dictate" })).toBeVisible();
  const hint = page.getByTestId("hint-talk");
  await expect(hint).toContainText("Tap Talk to speak with me");

  // Writing turns Talk into Send; an empty field brings it back.
  const field = page.getByLabel("Message Michael");
  await field.fill("How is my day");
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(talk).toBeHidden();
  await field.fill("");
  await expect(talk).toBeVisible();

  await tap(talk);
  await expect(page.getByTestId("conversation")).toBeVisible();
  await expect(page.getByTestId("conversation-orb")).toHaveAttribute("data-phase", "listening");
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect(page.getByTestId("conversation")).toBeHidden();

  // Used once, the hint is gone, also after a reload.
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(talk).toBeVisible();
  await expect(hint).toBeHidden();
});

test("Talk to Michael on the You sheet opens the conversation, ready for a tap", async ({ page }) => {
  await stubSpeech(page, { holdSpeech: true });
  await enterDemo(page);
  await page.goto("/you");
  await tap(page.getByRole("link", { name: /Talk to Michael/ }));
  await expect(page).toHaveURL(/\/chat$/);
  const orb = page.getByTestId("conversation-orb");
  await expect(orb).toHaveAttribute("data-phase", "off");
  await expect(orb).toHaveAccessibleName("Tap to start");
  await orb.click();
  await expect(orb).toHaveAttribute("data-phase", "listening");
});
