import assert from "node:assert/strict";
import { test } from "node:test";
import { TravelData } from "@michael/shared";
import { runAsUser } from "../context";
import { MemoryStore } from "../store";
import { seedDemoFocus, seedDemoTravel } from "./sync";
import { buildDemoWeek, DEMO_PREFIX, demoGoals } from "./week";

// The demo week's drives are precomputed: on stage they show without Google.

test("demo travel: drives on the week, and one leave later suggestion for tomorrow's finals", async () => {
  const now = new Date("2026-11-14T13:00:00Z");
  const week = buildDemoWeek(now);
  const drives = week.events.filter((e) => e.source === "maps" && e.type === "travel");
  assert.ok(drives.length >= 3);
  for (const d of drives) TravelData.parse(d.data);
  const finals = drives.find(
    (d) => d.title.startsWith("Drive to Hackathon venue") && d.start_at > now.toISOString(),
  );
  assert.ok(finals);
  assert.ok(TravelData.parse(finals.data).won_minutes >= 10);

  const store = new MemoryStore();
  await runAsUser(crypto.randomUUID(), async () => {
    await store.syncSeededEvents(DEMO_PREFIX, ["google_calendar", "maps"], week.events);
    await seedDemoTravel(store, week, now);
    assert.equal((await store.listPlaces()).length, 5);
    const recs = (await store.listRecommendations()).filter((r) => r.title.startsWith("Leave at"));
    assert.equal(recs.length, 1);
    assert.equal(recs[0]?.title, "Leave at 19:15 instead of 18:30, win 20 minutes");
    assert.equal(recs[0]?.action?.kind, "reminder");
    // Seeding again adds nothing.
    await seedDemoTravel(store, week, now);
    assert.equal((await store.listRecommendations()).filter((r) => r.title.startsWith("Leave at")).length, 1);
  });
});

// The pitch taps Do it, then Undo, on Today: there must always be one suggestion Michael can do.
test("demo focus: one free study hour Michael can book, never on a kept clear Sunday", async () => {
  const cases: [string, string][] = [
    ["2026-11-14T20:15:00+02:00", "Block 12:30 to 13:30 for University"], // Saturday night: Sunday is kept clear
    ["2026-11-15T19:15:00+02:00", "Block 12:30 to 13:30 for University"], // before the finals
    ["2026-11-16T12:30:00+02:00", "Block 14:00 to 15:00 for University"], // pitch Monday
  ];
  for (const [at, title] of cases) {
    const now = new Date(at);
    const week = buildDemoWeek(now);
    const store = new MemoryStore();
    await runAsUser(crypto.randomUUID(), async () => {
      await store.syncSeededEvents(DEMO_PREFIX, ["google_calendar"], week.events);
      await store.seedGoals(demoGoals, { overwrite: true });
      await store.createInstruction({
        text: "Keep Sundays clear",
        kind: "clear_day",
        days: [0],
        active: true,
      });
      // The in-memory store starts with sample suggestions: set them aside.
      for (const r of await store.listRecommendations())
        await store.updateRecommendationStatus(r.id, "dismissed");
      await seedDemoFocus(store, now);
      const focus = () => store.listRecommendations({ status: "proposed" });
      const recs = await focus();
      assert.equal(recs.length, 1, at);
      assert.equal(recs[0]?.title, title, at);
      assert.equal(recs[0]?.action?.involves_others, false);
      // Seeding again adds nothing while it is still ahead.
      await seedDemoFocus(store, now);
      assert.equal((await focus()).length, 1);
    });
  }
});
