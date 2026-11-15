import assert from "node:assert/strict";
import { test } from "node:test";
import { TravelData } from "@michael/shared";
import { runAsUser } from "../context";
import { MemoryStore } from "../store";
import { seedDemoTravel } from "./sync";
import { buildDemoWeek, DEMO_PREFIX } from "./week";

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
