import { API_KEY, API_URL, apiGet, enterDemo, expect, tap, test } from "./fixtures";

// The pitch's headline moment (#330): Claude books a block, the presenter looks at Today, and the
// block is on the first screen with its Undo. Once undone it is gone: never "Your next move".

type Rec = { id: string; title: string; status: string; source?: string };

const athens = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hourCycle: "h23", ...opts }).format(d);

/** "2026-11-15T15:00" in Athens, as the MCP tool takes it. */
const local = (d: Date) =>
  `${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(d)}T${athens(d, { hour: "2-digit", minute: "2-digit" })}`;

/** What Claude's create_focus_block does, as the demo account. */
async function claudeBooks(title: string, start: Date, end: Date) {
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

test("a block Claude books is on Today's first screen with Undo, and gone once undone", async ({ page }) => {
  // The first free 15 minutes from the next half hour on: quiet hours and meetings are refused.
  const from = Math.ceil((Date.now() + 10 * 60_000) / 1_800_000) * 1_800_000;
  let start: Date | null = null;
  for (let i = 0; i < 48 && !start; i++) {
    const at = new Date(from + i * 1_800_000);
    if (await claudeBooks("Sales focus", at, new Date(at.getTime() + 15 * 60_000))) start = at;
  }
  expect(start, "a free slot in the next 24 hours").not.toBeNull();
  const until = athens(start as Date, { hour: "2-digit", minute: "2-digit" });
  const status = async () =>
    (await apiGet<{ recommendations: Rec[] }>("/v1/recommendations")).recommendations.find(
      (r) => r.title === "Sales focus" && r.source === "chat",
    )?.status;
  expect(await status()).toBe("done");

  await enterDemo(page);
  await expect(page.getByText("This is the demo week.")).toBeVisible();
  const booked = page.getByRole("region", { name: "Booked for you" });
  await expect(booked.getByText("Sales focus.")).toBeVisible();
  await expect(booked.getByText(/^Booked at your request through /)).toBeVisible();
  await expect(booked.getByRole("status")).toHaveText(`Done. Undo until ${until}.`);
  // On the first screen, above the tab bar, without scrolling.
  await expect(booked.getByRole("button", { name: "Undo" })).toBeInViewport({ ratio: 1 });
  const tabBar = await page.getByRole("navigation").last().boundingBox();
  const card = await booked.boundingBox();
  expect((card?.y ?? 0) + (card?.height ?? 0)).toBeLessThan(tabBar?.y ?? 0);
  // Shown once: not again as the next move or under More from Michael.
  await expect(page.getByText("Sales focus.")).toHaveCount(1);

  await tap(booked.getByRole("button", { name: "Undo" }));
  await expect(booked.getByRole("status")).toHaveText("Undone. Your calendar is back as it was.");
  await expect(booked.getByRole("button")).toHaveCount(0);
  await expect.poll(status).toBe("undone");

  // A fresh look: the undone block is nowhere, least of all offered back as "Do it".
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/Updated \d\d:\d\d/)).toBeVisible();
  await expect(page.getByText("Sales focus")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Booked for you" })).toHaveCount(0);
});

test("Today never names the model that wrote the brief", async ({ page }) => {
  await enterDemo(page);
  await tap(page.getByRole("button", { name: /Michael's brief/ }));
  await expect(page.getByRole("button", { name: /Ask (for a fresh|Michael for a) brief/ })).toBeVisible();
  await expect(page.getByText(/Written by/)).toHaveCount(0);
});
