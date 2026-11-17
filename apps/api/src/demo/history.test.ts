import assert from "node:assert/strict";
import { test } from "node:test";
import { type Event, EventInput, sleepScore } from "@michael/shared";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { scoreWithHistory } from "../score";
import { MemoryStore } from "../store";
import { SHORT_NIGHT_MINUTES } from "./body";
import {
  buildDemoHistory,
  HISTORY_DAYS,
  HISTORY_PREFIX,
  historyDay,
  isDemoHistory,
  measuredSources,
} from "./history";
import { seedDemoWeek } from "./sync";
import { addDays, athensMidnight, localDate, weekday } from "./time";
import { buildDemoWeek, DEMO_PREFIX, demoGoals, type EventRow, stableUuid } from "./week";

// The weeks before this one (demo/history.ts): 77 days before the week, lighter than it, the same
// whenever they are built, and with relations in them that a difference of means can find.

const STAGE = new Date("2026-11-15T20:00:00+02:00");
const NOWS = [
  STAGE,
  new Date("2026-11-16T10:00:00+02:00"), // pitch Monday
  new Date("2027-06-10T13:00:00+03:00"), // no measured day in reach: everything drawn in his range
];
/** No older day holds more events than this. */
const MAX_EVENTS_A_DAY = 80;
const HOUR = 3600_000;
const MINUTE = 60_000;

const key = (e: EventRow) => `${e.source}|${e.external_id}`;
const endOf = (e: EventRow) => Date.parse(e.end_at ?? e.start_at);

for (const now of NOWS) {
  test(`history at ${now.toISOString()}: 77 valid days before the week, nothing after now, no id twice`, () => {
    const history = buildDemoHistory(now);
    const week = buildDemoWeek(now);
    assert.equal(history.days.length, HISTORY_DAYS);
    assert.equal(history.days.at(-1), addDays(week.days[0] as string, -1));
    assert.equal(new Set(history.days).size, HISTORY_DAYS);

    const keys = new Set(week.events.map(key));
    const perDay = new Map<string, number>();
    for (const e of history.events) {
      EventInput.parse(e);
      assert.ok(e.external_id?.startsWith(HISTORY_PREFIX) && e.external_id.startsWith(DEMO_PREFIX));
      assert.ok(isDemoHistory(e));
      assert.ok(!keys.has(key(e)), `duplicate ${key(e)}`);
      keys.add(key(e));
      // All of it has happened, and all of it is before the week starts (the week takes over there).
      assert.ok(
        endOf(e) <= athensMidnight(addDays(localDate(now.getTime()), -(7 - 1))),
        `${e.title} ends ${e.end_at}`,
      );
      const day = (e.external_id ?? "").slice(HISTORY_PREFIX.length, HISTORY_PREFIX.length + 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    for (const e of week.events) assert.ok(!isDemoHistory(e));

    // Lighter than the week: a few dozen events a day, every day under the bound.
    // (The last day holds only what ended seven days before now: its night, and the day so far.)
    for (const day of history.days) {
      const n = perDay.get(day) ?? 0;
      const least = day === history.days.at(-1) ? 4 : 8;
      assert.ok(n >= least && n <= MAX_EVENTS_A_DAY, `${day} has ${n} events`);
    }
    assert.ok(history.events.length / HISTORY_DAYS < 50, "a few dozen a day on average");

    // Every day has what the engine's daily series are read from: the night with its score, the
    // morning's recovery, heart rate variability and resting heart rate, on the day the night ends.
    for (const day of history.days) {
      const from = athensMidnight(day);
      const to = athensMidnight(addDays(day, 1));
      const ended = (e: EventRow) => endOf(e) >= from && endOf(e) < to;
      const sleep = history.events.filter((e) => e.type === "sleep" && ended(e));
      assert.equal(sleep.length, 1, `${day} sleep`);
      const night = sleep[0]?.data as {
        score: number;
        duration_min: number;
        deep_min: number;
        rem_min: number;
        core_min: number;
        awake_min: number;
        in_bed_min: number;
      };
      assert.ok(night.score >= 30 && night.score <= 100, `${day} score ${night.score}`);
      assert.equal(night.deep_min + night.rem_min + night.core_min, night.duration_min);
      assert.equal(night.duration_min + night.awake_min, night.in_bed_min);
      // The score is the one a reader works out from the same stages.
      const { score, ...stages } = night;
      assert.equal(score, sleepScore(stages));
      const started = (e: EventRow) => Date.parse(e.start_at) >= from && Date.parse(e.start_at) < to;
      const recovery = history.events.filter((e) => e.type === "recovery" && started(e));
      assert.equal(recovery.length, 1, `${day} recovery`);
      const r = recovery[0]?.data as { recovery_pct: number; hrv_ms: number; resting_hr: number };
      assert.ok(r.recovery_pct >= 5 && r.recovery_pct <= 100);
      assert.ok(r.hrv_ms >= 25 && r.hrv_ms <= 95, `${day} hrv ${r.hrv_ms}`);
      assert.ok(r.resting_hr >= 44 && r.resting_hr <= 66, `${day} resting ${r.resting_hr}`);
      for (const metric of ["heart_rate_variability", "resting_heart_rate"])
        assert.ok(
          history.events.some((e) => e.type === "biometric" && e.data.metric === metric && started(e)),
          `${day} ${metric}`,
        );
      assert.ok(
        history.events.some((e) => e.type === "calendar_event" && started(e)) ||
          weekday(day) === 6 ||
          day === history.days.at(-1),
        `${day} calendar`,
      );
    }

    // No screen in use while asleep or in the middle of a workout.
    const quiet = history.events.filter((e) => e.type === "sleep" || e.type === "workout");
    for (const e of history.events) {
      if (e.type !== "app_usage") continue;
      const s = Date.parse(e.start_at);
      for (const q of quiet)
        assert.ok(
          !(s < endOf(q) && endOf(e) > Date.parse(q.start_at)),
          `${e.title} at ${e.start_at} during ${q.title}`,
        );
    }
  });
}

test("a history day is the same whenever it is built, and later runs keep earlier events", () => {
  const first = buildDemoHistory(new Date("2026-11-15T09:00:00+02:00"));
  const later = buildDemoHistory(new Date("2026-11-18T21:00:00+02:00"));
  const laterKeys = new Map(later.events.map((e) => [key(e), e]));
  const shared = first.days.filter((d) => later.days.includes(d));
  assert.equal(shared.length, HISTORY_DAYS - 3);
  for (const e of first.events) {
    const day = (e.external_id ?? "").slice(HISTORY_PREFIX.length, HISTORY_PREFIX.length + 10);
    if (!shared.includes(day)) continue;
    assert.deepEqual(laterKeys.get(key(e)), e, `${key(e)} changed`);
  }
  assert.deepEqual(historyDay("2026-09-23"), historyDay("2026-09-23"));
  // The same day, later the same day: nothing is lost.
  const evening = buildDemoHistory(new Date("2026-11-15T23:30:00+02:00"));
  const eveningKeys = new Set(evening.events.map(key));
  assert.deepEqual(
    first.events.filter((e) => !eveningKeys.has(key(e))),
    [],
  );
  // The history ends where the week starts, so it does not change through the day at all.
  assert.deepEqual(evening.events, first.events);
});

test("days his own numbers cover are built from them", () => {
  // Chrome's history reaches back to 17 August, Screen Time to the middle of October.
  assert.ok(measuredSources("2026-09-10").includes("chrome"));
  assert.ok(measuredSources("2026-11-03").includes("phone"));
  assert.deepEqual(measuredSources("2027-03-03"), []);
  // 3 November: 152 minutes on the phone after 23:00, by Screen Time.
  const late = historyDay("2026-11-03").filter(
    (e) => e.source === "iphone_usage" && Date.parse(e.start_at) >= Date.parse("2026-11-03T23:00:00+02:00"),
  );
  const minutes = late.reduce((t, e) => t + (endOf(e) - Date.parse(e.start_at)) / MINUTE, 0);
  assert.equal(Math.round(minutes), 152);
});

// ---------- the relations, measured from the events alone ----------

interface Row {
  day: string;
  wd: number;
  score: number;
  asleep: number;
  deepShare: number;
  recovery: number;
  hrv: number;
  resting: number;
  /** Minutes on the phone after 23:00 on this day's evening, and from 20:00 to 23:00. */
  latePhone: number;
  eveningPhone: number;
  /** Minutes of AI coding after 23:00 on this day's evening. */
  lateAi: number;
  lateHardWorkout: boolean;
  meetings: number;
  /** The first goal block of a working day, as the score counts it. */
  lost: number | null;
  opens: number | null;
  /** Minutes from the block's start to the first work on the Mac. */
  delay: number | null;
}

function table(now: Date): Row[] {
  const history = buildDemoHistory(now);
  const events: Event[] = history.events.map((e) => ({
    id: stableUuid(key(e)),
    source: e.source,
    type: e.type,
    start_at: e.start_at,
    end_at: e.end_at ?? null,
    title: e.title,
    data: e.data,
    external_id: e.external_id ?? null,
    created_at: e.start_at,
  }));
  // The goal blocks and their lost minutes, from the score itself, five weeks at a time.
  const blocks = new Map<string, { start: number; end: number; lost: number; title: string }>();
  for (let day = history.days.at(-1) as string; day >= (history.days[0] as string); day = addDays(day, -28)) {
    const built = scoreWithHistory(events, demoGoals, { date: day, now: now.toISOString() });
    for (const b of built.blocks) {
      if (b.goal_title !== "The company") continue;
      const start = Date.parse(b.start_at);
      const d = localDate(start);
      if (!blocks.has(d) || start < (blocks.get(d)?.start ?? 0))
        blocks.set(d, { start, end: Date.parse(b.end_at), lost: b.lost_minutes, title: b.title });
    }
  }
  const minutes = (list: Event[]) =>
    list.reduce((t, e) => t + (Date.parse(e.end_at ?? e.start_at) - Date.parse(e.start_at)) / MINUTE, 0);
  return history.days.map((day) => {
    const from = athensMidnight(day);
    const to = athensMidnight(addDays(day, 1));
    const starts = (e: Event, a: number, b: number) =>
      Date.parse(e.start_at) >= a && Date.parse(e.start_at) < b;
    const sleep = events.find(
      (e) => e.type === "sleep" && Date.parse(e.end_at ?? "") >= from && Date.parse(e.end_at ?? "") < to,
    );
    const recovery = events.find((e) => e.type === "recovery" && starts(e, from, to));
    const night = (sleep?.data ?? {}) as Record<string, number>;
    const r = (recovery?.data ?? {}) as Record<string, number>;
    const phone = events.filter((e) => e.source === "iphone_usage");
    const block = blocks.get(day) ?? null;
    const inBlock = (e: Event) => block !== null && starts(e, block.start, block.end);
    const firstMac = events
      .filter((e) => e.source === "macos_usage" && inBlock(e))
      .map((e) => Date.parse(e.start_at))
      .sort((a, b) => a - b)[0];
    return {
      day,
      wd: weekday(day),
      score: night.score as number,
      asleep: night.duration_min as number,
      deepShare: (night.deep_min as number) / (night.duration_min as number),
      recovery: r.recovery_pct as number,
      hrv: r.hrv_ms as number,
      resting: r.resting_hr as number,
      latePhone: minutes(phone.filter((e) => starts(e, from + 23 * HOUR, to + 5 * HOUR))),
      eveningPhone: minutes(phone.filter((e) => starts(e, from + 20 * HOUR, from + 23 * HOUR))),
      lateAi: minutes(
        events.filter((e) => e.type === "ai_session" && starts(e, from + 23 * HOUR, to + 5 * HOUR)),
      ),
      lateHardWorkout: events.some(
        (e) =>
          e.type === "workout" &&
          starts(e, from, to) &&
          e.data.name === "Traditional Strength Training" &&
          Date.parse(e.end_at ?? "") > from + 21.5 * HOUR,
      ),
      meetings: events.filter(
        (e) => e.type === "calendar_event" && starts(e, from, to) && Number(e.data.attendees) > 0,
      ).length,
      lost: block ? block.lost : null,
      opens: block ? phone.filter(inBlock).length : null,
      delay: block && firstMac !== undefined ? (firstMac - block.start) / MINUTE : null,
    };
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n: number) => Math.round(n * 10) / 10;

interface Relation {
  name: string;
  /** Values of the outcome where the trigger was there, and where it was not. */
  with: number[];
  without: number[];
  /** The least the two means must differ by, signed: negative when the trigger lowers it. */
  atLeast: number;
}

/** Every planted relation as two lists of an outcome: the trigger's days against the others. */
function relations(rows: Row[]): Relation[] {
  // The evening of the day before, next to the morning after it.
  const pairs = rows.slice(1).map((today, i) => ({ before: rows[i] as Row, today }));
  const split = <T>(list: T[], trigger: (x: T) => boolean, value: (x: T) => number | null) => ({
    with: list.filter(trigger).flatMap((x) => value(x) ?? []),
    without: list.filter((x) => !trigger(x)).flatMap((x) => value(x) ?? []),
  });
  const late = (p: (typeof pairs)[number]) => p.before.latePhone >= 30;
  const low = (r: Row) => r.score < 78;
  const short = (r: Row) => r.asleep < SHORT_NIGHT_MINUTES;
  const afterShort = pairs.filter((p) => short(p.today));
  const mondays = pairs.filter((p) => p.today.wd === 1);
  return [
    {
      name: "late phone (30 min or more after 23:00) > sleep score",
      atLeast: -8,
      ...split(pairs, late, (p) => p.today.score),
    },
    {
      name: "late phone > deep sleep, share of the night",
      atLeast: -0.015,
      ...split(pairs, late, (p) => p.today.deepShare),
    },
    {
      name: "low sleep score (under 78) > recovery that morning",
      atLeast: -12,
      ...split(rows, low, (r) => r.recovery),
    },
    { name: "low sleep score > heart rate variability, ms", atLeast: -4, ...split(rows, low, (r) => r.hrv) },
    { name: "low sleep score > resting heart rate, bpm", atLeast: 1, ...split(rows, low, (r) => r.resting) },
    {
      name: "low sleep score > minutes lost in the first goal block",
      atLeast: 4,
      ...split(rows, low, (r) => r.lost),
    },
    {
      name: "low sleep score > phone opens in the first goal block",
      atLeast: 2,
      ...split(rows, low, (r) => r.opens),
    },
    {
      name: "late hard workout > deep sleep that night, share",
      atLeast: -0.01,
      ...split(
        pairs,
        (p) => p.before.lateHardWorkout,
        (p) => p.today.deepShare,
      ),
    },
    {
      name: "heavy meeting day (3 or more with others) > phone 20:00 to 23:00, min",
      atLeast: 10,
      ...split(
        rows.filter((r) => r.wd >= 1 && r.wd <= 5),
        (r) => r.meetings >= 3,
        (r) => r.eveningPhone,
      ),
    },
    {
      name: "second short night in a row > recovery, against one short night",
      atLeast: -4,
      ...split(
        afterShort,
        (p) => short(p.before),
        (p) => p.today.recovery,
      ),
    },
    {
      name: "late AI coding night (30 min or more after 23:00) > start of the first block, min late",
      atLeast: 12,
      ...split(
        pairs,
        (p) => p.before.lateAi >= 30,
        (p) => p.today.delay,
      ),
    },
    {
      name: "Sunday evening on the phone (50 min or more) > start of Monday's first block, min late",
      atLeast: 5,
      ...split(
        mondays,
        (p) => p.before.eveningPhone >= 50,
        (p) => p.today.delay,
      ),
    },
  ];
}

test("the planted relations are measurable in the generated weeks, and none is perfect", (t) => {
  const rows = table(STAGE);
  for (const r of relations(rows)) {
    assert.ok(
      r.with.length >= 4 && r.without.length >= 4,
      `${r.name}: seen ${r.with.length} and ${r.without.length} times`,
    );
    const diff = mean(r.with) - mean(r.without);
    t.diagnostic(
      `${r.name}: ${round1(mean(r.with) * (r.name.includes("share") ? 100 : 1))} (n ${r.with.length}) against ${round1(mean(r.without) * (r.name.includes("share") ? 100 : 1))} (n ${r.without.length})`,
    );
    assert.ok(r.atLeast < 0 ? diff <= r.atLeast : diff >= r.atLeast, `${r.name}: differs by ${round1(diff)}`);
  }

  // Sizes a person would believe: about 68 to 74 after a late phone night, 82 to 88 otherwise.
  const pairs = rows.slice(1).map((today, i) => ({ before: rows[i] as Row, today }));
  const lateNights = pairs.filter((p) => p.before.latePhone >= 30).map((p) => p.today.score);
  const others = pairs.filter((p) => p.before.latePhone < 30).map((p) => p.today.score);
  assert.ok(
    mean(lateNights) >= 66 && mean(lateNights) <= 76,
    `late nights average ${round1(mean(lateNights))}`,
  );
  assert.ok(mean(others) >= 81 && mean(others) <= 89, `other nights average ${round1(mean(others))}`);
  // Never perfect: about one late night in five is followed by a good score all the same.
  const spared = lateNights.filter((s) => s >= 80).length / lateNights.length;
  t.diagnostic(`late phone nights followed by a score of 80 or more: ${Math.round(spared * 100)}%`);
  assert.ok(spared >= 0.08 && spared <= 0.4, `${Math.round(spared * 100)}% of late nights end well`);

  // The slow trend: twelve weeks of training lower the resting heart rate and raise the variability.
  const firstWeeks = rows.slice(0, 28);
  const lastWeeks = rows.slice(-28);
  const resting = mean(lastWeeks.map((r) => r.resting)) - mean(firstWeeks.map((r) => r.resting));
  const hrv = mean(lastWeeks.map((r) => r.hrv)) - mean(firstWeeks.map((r) => r.hrv));
  t.diagnostic(
    `resting heart rate, last 4 weeks against first 4: ${round1(resting)} bpm; variability: ${round1(hrv)} ms`,
  );
  assert.ok(resting <= -0.8, `resting heart rate moved ${round1(resting)}`);
  assert.ok(hrv >= 1.5, `variability moved ${round1(hrv)}`);
});

test("drawn in his range, with no measured day in reach, the main relations still hold", () => {
  const rows = table(new Date("2027-06-10T13:00:00+03:00"));
  for (const r of relations(rows).slice(0, 7)) {
    assert.ok(
      r.with.length >= 4 && r.without.length >= 4,
      `${r.name}: seen ${r.with.length} and ${r.without.length} times`,
    );
    const diff = mean(r.with) - mean(r.without);
    assert.ok(r.atLeast < 0 ? diff <= r.atLeast : diff >= r.atLeast, `${r.name}: differs by ${round1(diff)}`);
  }
});

// ---------- seeding ----------

const auth = { Authorization: "Bearer dev-key" };

test("the history is seeded with the week, and a reseed keeps it", async () => {
  const store = new MemoryStore();
  await runAsUser(env.DEMO_USER_ID, async () => {
    const week = buildDemoWeek(STAGE);
    const history = buildDemoHistory(STAGE);
    const first = await seedDemoWeek(store, { overwriteGoals: true, now: STAGE });
    assert.equal(first.days.length, 7);
    assert.equal(first.events.inserted, week.events.length + history.events.length);
    const again = await seedDemoWeek(store, { overwriteGoals: false, now: STAGE });
    assert.deepEqual(again.events, { inserted: 0, removed: 0, kept: first.events.inserted });
    // A day later the oldest day goes, and yesterday's first week day is now history.
    const next = await seedDemoWeek(store, {
      overwriteGoals: false,
      now: new Date(STAGE.getTime() + 24 * HOUR),
    });
    assert.ok(next.events.removed > 0 && next.events.inserted > 0);
    const all = await store.listEvents({ from: "2026-08-01T00:00:00Z", to: "2026-12-01T00:00:00Z" });
    const old = all.filter(isDemoHistory);
    assert.ok(old.length > 2000);
    assert.ok(old.every((e) => localDate(Date.parse(e.start_at)) >= "2026-08-24"));
  });
});

test("the score reads the same weeks as before the history: no target from it, no usual day", async () => {
  const now = "2026-11-15T20:00:00+02:00";
  const read = async () => {
    const res = await app.request(`/v1/score?now=${encodeURIComponent(new Date(now).toISOString())}`, {
      headers: auth,
    });
    assert.equal(res.status, 200);
    return (await res.json()) as { target: unknown; day: { time_won_back: { history_days: number } } };
  };
  await app.request("/v1/demo/reseed", { method: "POST", headers: auth });
  const s = await read();
  // Without the weeks before, the baseline is not ready and the usual day is this week's own.
  assert.equal(s.target, null);
  assert.ok(s.day.time_won_back.history_days <= 6);
});
