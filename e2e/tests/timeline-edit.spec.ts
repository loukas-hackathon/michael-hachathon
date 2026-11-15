import { apiGet, enterDemo, expect, tap, test } from "./fixtures";

// #271: edit the day on the Timeline, like Calendar on the iPhone. A day eight days ahead is always
// empty in the demo week (calendar events are planned to the end of the current week only), so the
// test holds at any hour of any day.

type TimelineEvent = { id: string; title: string; start_at: string; type: string };

const athensDate = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

const athensTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

test("Timeline: add a block on a free slot, drag it later, undo the move", async ({ page }) => {
  const day = athensDate(8);
  await enterDemo(page);
  await page.goto(`/timeline?day=${day}`);
  await expect(page.getByText("Nothing planned yet.")).toBeVisible();

  // The empty day is one quiet row: a tap opens its hours.
  await tap(page.getByRole("button", { name: /Open these hours to plan/ }).first());
  const timeline = page.locator("#day-timeline");
  const ten = timeline.getByText("10:00", { exact: true });
  await ten.scrollIntoViewIfNeeded();
  const tenBox = await ten.boundingBox();
  const tlBox = await timeline.boundingBox();
  if (!tenBox || !tlBox) throw new Error("timeline not laid out");
  // The hour rule sits 7px below its label's top; tap 20px into the hour: the block starts at 10:00.
  await timeline.click({ position: { x: tlBox.width / 2, y: tenBox.y + 7 + 20 - tlBox.y } });

  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Deep work");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // Shown at once; the Undo arrives with the server's answer.
  await expect(page.getByRole("status").filter({ hasText: "Added at 10:00." })).toBeVisible();
  await expect(page.getByRole("status").getByRole("button", { name: "Undo" })).toBeVisible();
  const block = page.getByRole("button", { name: "Deep work, 10:00 to 11:00" });
  await expect(block).toBeVisible();

  // Long press, then drag it two hours down (the emulated iPhone sends touch pointers; a real mouse
  // would drag at once).
  await block.scrollIntoViewIfNeeded();
  const b = await block.boundingBox();
  if (!b) throw new Error("block not laid out");
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(500);
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (112 * i) / 8);
  await page.mouse.up();
  // Michael varies the phrasing by day (#398); the block and the new time are always in it.
  await expect(page.getByRole("status").filter({ hasText: /Deep work.*12:00\./ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deep work, 12:00 to 13:00" })).toBeVisible();

  const startOf = async () => {
    const { events } = await apiGet<{ events: TimelineEvent[] }>(
      `/v1/timeline?${new URLSearchParams({
        from: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        to: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      })}`,
    );
    const e = events.find((x) => x.type === "calendar_event" && x.title === "Deep work");
    return e ? athensTime(e.start_at) : null;
  };
  await expect.poll(startOf).toBe("12:00");

  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^(Undone|Taken back|Reversed)/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deep work, 10:00 to 11:00" })).toBeVisible();
  await expect.poll(startOf).toBe("10:00");
});
