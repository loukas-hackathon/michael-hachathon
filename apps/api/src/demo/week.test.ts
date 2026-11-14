import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DemoSeedResult, EventInput, Goal, TimelineResponse } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { HttpError } from "../http";
import { HaePayload, mapHealthAutoExport } from "../ingest/health-auto-export";
import { mapOmi } from "../ingest/omi";
import { MemoryStore } from "../store";
import { seedDemoWeek } from "./sync";
import { addDays, athensMidnight, localDate, weekday } from "./time";
import { buildDemoWeek, DEMO_PREFIX, demoGoals } from "./week";

const NOWS = [
  new Date(), // whenever the tests run
  new Date("2026-11-14T20:15:00+02:00"), // hackathon Saturday evening
  new Date("2026-11-16T10:00:00+02:00"), // pitch Monday morning
  new Date("2026-11-15T23:50:00+02:00"), // Sunday, last minutes of the week
  new Date("2027-06-10T13:00:00+03:00"), // summer time
];

const LANES = ["macos_usage", "iphone_usage", "chrome", "claude_code"];

for (const now of NOWS) {
  test(`demo week at ${now.toISOString()} validates and covers every day`, () => {
    const week = buildDemoWeek(now);
    const today = localDate(now.getTime());
    assert.equal(week.days.length, 7);
    assert.equal(week.days.at(-1), today);

    const keys = new Set<string>();
    for (const e of week.events) {
      EventInput.parse(e);
      assert.ok(e.external_id?.startsWith(DEMO_PREFIX), e.external_id ?? "no external id");
      const key = `${e.source}|${e.external_id}`;
      assert.ok(!keys.has(key), `duplicate ${key}`);
      keys.add(key);
      // Only the calendar and its drives are planned ahead; everything else has already happened.
      if (e.source !== "google_calendar" && e.source !== "maps")
        assert.ok(Date.parse(e.end_at ?? e.start_at) <= now.getTime(), e.title);
    }

    const onDay = (day: string) => {
      const from = athensMidnight(day);
      const to = athensMidnight(addDays(day, 1));
      return week.events.filter((e) => Date.parse(e.start_at) >= from && Date.parse(e.start_at) < to);
    };
    for (const day of week.days.slice(0, -1)) {
      const events = onDay(day);
      const has = (source: string, type?: string) =>
        events.some((e) => e.source === source && (!type || e.type === type));
      assert.ok(has("health_auto_export", "sleep"), `${day} sleep`);
      assert.ok(has("health_auto_export", "biometric"), `${day} heart rate`);
      assert.ok(has("iphone_usage"), `${day} iPhone`);
      assert.ok(has("macos_usage"), `${day} Mac`);
      assert.ok(has("chrome"), `${day} Chrome`);
      assert.ok(has("google_calendar"), `${day} calendar`);
      if (weekday(day) !== 6) assert.ok(has("health_auto_export", "workout"), `${day} workout`);
      if (weekday(day) >= 1 && weekday(day) <= 5)
        assert.ok(has("claude_code", "ai_session"), `${day} Claude Code`);
    }

    // The week as a whole: meetings with others and own blocks, conversations, meals.
    const cal = week.events.filter((e) => e.type === "calendar_event");
    assert.ok(cal.some((e) => e.data.attendees === 0));
    assert.ok(cal.some((e) => (e.data.attendees as number) > 0));
    assert.ok(week.events.some((e) => e.source === "omi" && e.type === "conversation"));
    assert.ok(week.events.some((e) => e.type === "meal"));

    // Calendar runs to the end of this Monday to Sunday week.
    const sunday = addDays(today, (7 - weekday(today)) % 7);
    assert.ok(cal.some((e) => localDate(Date.parse(e.start_at)) === sunday));

    // No screen in use while asleep.
    const nights = week.events.filter((e) => e.type === "sleep");
    for (const e of week.events) {
      if (!LANES.includes(e.source) || e.type === "screen") continue;
      const s = Date.parse(e.start_at);
      const end = e.end_at ? Date.parse(e.end_at) : s;
      for (const n of nights)
        assert.ok(
          !(s < Date.parse(n.end_at as string) && end > Date.parse(n.start_at)),
          `${e.title} during sleep`,
        );
    }
  });
}

test("the demo week is deterministic: later runs keep earlier events", () => {
  const first = buildDemoWeek(new Date("2026-11-14T15:00:00+02:00"));
  const later = buildDemoWeek(new Date("2026-11-14T18:00:00+02:00"));
  const laterKeys = new Set(later.events.map((e) => `${e.source}|${e.external_id}`));
  const lost = first.events.filter((e) => !laterKeys.has(`${e.source}|${e.external_id}`));
  assert.deepEqual(
    lost.map((e) => e.title),
    [],
  );
  assert.ok(later.events.length > first.events.length);
});

test("generated Apple Watch and Omi events have the shapes the ingest webhooks produce", () => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`../ingest/fixtures/${name}.json`, import.meta.url), "utf8"));
  const real = [
    ...mapHealthAutoExport(
      HaePayload.parse(fixture("health-auto-export")),
      Date.parse("2026-11-14T10:30:00+02:00"),
    ).events,
    mapOmi(fixture("omi")),
  ].filter((e) => e !== null);
  // Data keys per source, type and metric, as the real mappers write them.
  const kind = (e: { source: string; type: string; data?: Record<string, unknown> }) =>
    `${e.source} ${e.type} ${(e.data?.metric as string | undefined) ?? ""}`;
  const keys = new Map<string, Set<string>>();
  for (const e of real) {
    const set = keys.get(kind(e)) ?? new Set<string>();
    for (const k of Object.keys(e.data ?? {})) set.add(k);
    keys.set(kind(e), set);
  }
  const week = buildDemoWeek(new Date("2026-11-14T20:15:00+02:00"));
  let compared = 0;
  for (const e of week.events) {
    const allowed = keys.get(kind(e));
    if (!allowed) continue;
    compared++;
    for (const k of Object.keys(e.data))
      assert.ok(allowed.has(k), `${kind(e)}: ${k} is not a key the webhook writes`);
  }
  assert.ok(compared > 100);
  for (const k of [
    "health_auto_export sleep ",
    "health_auto_export workout ",
    "health_auto_export biometric heart_rate",
  ])
    assert.ok(keys.has(k), `fixture lacks ${k}`);
});

test("demo goals are valid and carry weekly budgets", () => {
  for (const g of demoGoals) Goal.parse(g);
  const budgets = demoGoals.filter((g) => g.weekly_budget_minutes);
  assert.deepEqual([...new Set(budgets.map((g) => g.category))].sort(), ["gym", "rest", "work"]);
});

test("seeding refuses any account but the demo one", async () => {
  const someone = "11111111-1111-4111-8111-111111111111";
  await assert.rejects(
    runAsUser(someone, () => seedDemoWeek(new MemoryStore(), { overwriteGoals: true })),
    (err: unknown) => err instanceof HttpError && err.code === "forbidden",
  );
});

test("off the record stops the demo week too, and a reseed only touches demo rows", async () => {
  const store = new MemoryStore();
  await runAsUser(env.DEMO_USER_ID, async () => {
    const now = new Date("2026-11-14T20:15:00+02:00");
    const first = await seedDemoWeek(store, { overwriteGoals: true, now });
    assert.ok(first.events.inserted > 1000);
    await store.insertEvents([
      {
        source: "manual",
        type: "note",
        start_at: now.toISOString(),
        title: "Mine",
        data: {},
        external_id: "x",
      },
    ]);
    await store.setOffTheRecord(true);
    const later = await seedDemoWeek(store, {
      overwriteGoals: false,
      now: new Date("2026-11-20T12:00:00+02:00"),
    });
    assert.deepEqual(later.events, { inserted: 0, removed: 0, kept: 0 });
    await store.setOffTheRecord(false);
    const next = await seedDemoWeek(store, {
      overwriteGoals: false,
      now: new Date("2026-11-20T12:00:00+02:00"),
    });
    assert.ok(next.events.removed > 0 && next.events.inserted > 0);
    const all = await store.listEvents({ from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z" });
    assert.ok(all.some((e) => e.title === "Mine"));
  });
});

const auth = { Authorization: "Bearer dev-key" };

test("POST /v1/demo/reseed fills the demo account and is idempotent", async () => {
  const first = DemoSeedResult.parse(
    await (await app.request("/v1/demo/reseed", { method: "POST", headers: auth })).json(),
  );
  assert.equal(first.days.length, 7);
  const second = DemoSeedResult.parse(
    await (await app.request("/v1/demo/reseed", { method: "POST", headers: auth })).json(),
  );
  assert.ok(second.events.kept > 1000);
  assert.ok(second.events.inserted < 20, `inserted ${second.events.inserted} on a rerun`);
  assert.equal(second.goals_written, demoGoals.length);

  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const res = await app.request(
    `/v1/timeline?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date().toISOString())}`,
    {
      headers: auth,
    },
  );
  const body = TimelineResponse.parse(await res.json());
  assert.ok(body.events.length > 1000);
  const goals = (await (await app.request("/v1/goals", { headers: auth })).json()) as { goals: Goal[] };
  assert.ok(goals.goals.some((g) => g.title === "70.3"));
});
