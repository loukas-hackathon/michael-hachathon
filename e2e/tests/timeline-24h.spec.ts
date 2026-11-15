import { enterDemo, expect, tap, test } from "./fixtures";

// #393: the add block sheet is 24-hour in any browser language. A native `type=time` showed
// "10:00 AM" in an en-US browser; our own hour and minute selects never do. Nine days ahead is
// always empty in the demo week (timeline-edit.spec.ts uses eight).

test.use({ locale: "en-US" });

const athensDate = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

test("add block sheet: 24-hour times under an en-US locale, set from the keyboard", async ({ page }) => {
  await enterDemo(page);
  await page.goto(`/timeline?day=${athensDate(9)}`);
  await tap(page.getByRole("button", { name: /Open these hours to plan/ }).first());
  const timeline = page.locator("#day-timeline");
  const fourteen = timeline.getByText("14:00", { exact: true });
  await fourteen.scrollIntoViewIfNeeded();
  const at = await fourteen.boundingBox();
  const box = await timeline.boundingBox();
  if (!at || !box) throw new Error("timeline not laid out");
  await timeline.click({ position: { x: box.width / 2, y: at.y + 7 + 20 - box.y } });

  const sheet = page.getByRole("dialog");
  const hour = sheet.getByRole("combobox", { name: "Starts, hour" });
  const minutes = sheet.getByRole("combobox", { name: "Starts, minutes" });
  await expect(hour).toHaveValue("14");
  await expect(minutes).toHaveValue("00");
  // Every option and every word in the sheet: never AM or PM.
  await expect(sheet).not.toHaveText(/\b(AM|PM)\b/i);
  expect(await hour.locator("option").allTextContents()).toEqual(
    Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
  );
  expect(await minutes.locator("option").allTextContents()).toEqual(["00", "15", "30", "45"]);

  // From the keyboard: Tab from the title to the hour, arrow down one hour, then the minutes.
  await sheet.getByRole("textbox", { name: "Title" }).fill("Swim");
  await page.keyboard.press("Tab");
  await expect(hour).toBeFocused();
  await hour.selectOption("15");
  await page.keyboard.press("Tab");
  await expect(minutes).toBeFocused();
  await minutes.selectOption("45");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added at 15:45." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Swim, 15:45 to 16:45" })).toBeVisible();
});
