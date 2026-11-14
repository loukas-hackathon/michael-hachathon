import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Event,
  EventInput,
  PersonalRecord,
  RecordsResponse,
  Score,
  TargetResponse,
  WeeklyTarget,
} from "@michael/shared";
import type { z } from "zod";
import { app } from "../app";
import { runAsUser } from "../context";
import { env } from "../env";
import { T } from "../patterns/testkit";
import { store } from "../store";

// Weekly targets (#165) and personal records (#166) over HTTP, against the in-memory store. The
// API key is the demo account; it gets a made up month of its own here. Every title is made up.

const headers = { Authorization: "Bearer dev-key", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <S extends z.ZodType>(schema: S, res: Response): Promise<z.infer<S>> => {
  assert.equal(res.status, 200, await res.clone().text());
  return schema.parse(await res.json());
};
const enc = encodeURIComponent;
const SOMEONE_ELSE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const asDemo = <T>(fn: () => Promise<T>) => runAsUser(env.DEMO_USER_ID, fn);

type Input = z.input<typeof EventInput>;
const block = (title: string, start: string, end: string): Input => ({
  source: "google_calendar",
  type: "calendar_event",
  start_at: T(start),
  end_at: T(end),
  title,
  data: { attendees: 0 },
});
const phone = (start: string, end: string): Input => ({
  source: "iphone_usage",
  type: "app_usage",
  start_at: T(start),
  end_at: T(end),
  title: "Instagram",
  data: {
    bundle_id: "com.burbn.instagram",
    device: "iphone",
    seconds: (Date.parse(T(end)) - Date.parse(T(start))) / 1000,
  },
});
const day = (monday: string, i: number) =>
  new Date(Date.UTC(+monday.slice(0, 4), +monday.slice(5, 7) - 1, +monday.slice(8, 10) + i))
    .toISOString()
    .slice(0, 10);
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A week: sales 10:00 to 12:00 Monday to Friday, the gym on Tuesday, `lost` minutes on the phone. */
function week(monday: string, lost: number): Input[] {
  const out: Input[] = [];
  for (let i = 0; i < 5; i++)
    out.push(block("Cold Outreach", `${day(monday, i)} 10:00`, `${day(monday, i)} 12:00`));
  out.push(block("Gym", `${day(monday, 1)} 18:00`, `${day(monday, 1)} 19:00`));
  let left = lost;
  for (let i = 0; left > 0; i++) {
    const m = Math.min(left, 100);
    out.push(phone(`${day(monday, i)} 10:10`, `${day(monday, i)} ${clock(610 + m)}`));
    left -= m;
  }
  return out;
}

// Weeks scoring 80, 90, 70 and 85 (of 660 minutes, 132, 66, 198 and 99 lost), then the target
// week: three hours of sales on Monday with nothing lost, the longest block so far.
const HISTORY = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];
const TARGET_WEEK = "2026-10-26";

async function setUp() {
  await asDemo(async () => {
    const own = await store.listEvents({ from: "2000-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" });
    await store.deleteEvents(own.map((e: Event) => e.id));
    for (const g of await store.listGoals()) await store.deleteGoal(g.id);
    await store.createGoal({
      category: "business",
      title: "The company",
      target: { calendar_titles: ["Cold Outreach"], work_categories: ["communication"] },
      weekly_budget_minutes: 480,
      active: true,
    });
    await store.createGoal({
      category: "health",
      title: "70.3",
      target: { calendar_titles: ["Gym"] },
      weekly_budget_minutes: 540,
      active: true,
    });
    const events = [
      ...HISTORY.flatMap((m, i) => week(m, [132, 66, 198, 99][i] ?? 0)),
      block("Cold Outreach", `${TARGET_WEEK} 10:00`, `${TARGET_WEEK} 13:00`),
      block("Gym", `${day(TARGET_WEEK, 1)} 18:00`, `${day(TARGET_WEEK, 1)} 19:00`),
    ];
    await store.insertEvents(events.map((e) => EventInput.parse(e)));
  });
  // Someone else's target and record for the same week: never seen by the demo account.
  await runAsUser(SOMEONE_ELSE, async () => {
    await store.saveTarget({
      week_start: TARGET_WEEK,
      overall_pct: 99,
      areas: { business: 99, health: 99, personal: null },
      floors: { business: 90, health: 90, personal: 90 },
      status: "accepted",
      set_by: "user",
      reason: "Theirs.",
      basis: { weeks_used: 0, median_pct: null, step: null, on_target_weeks: 0, heavy_week: false },
    });
    await store.insertRecords([
      {
        key: `best_week:${TARGET_WEEK}`,
        type: "best_week",
        area: null,
        goal_id: null,
        value: 99,
        unit: "pct",
        previous_value: 80,
        achieved_on: TARGET_WEEK,
        event_id: null,
        tick_index: null,
        line: "Best week since you started. 99%. Do it again.",
      },
    ]);
  });
}

test("targets and records need the API key", async () => {
  assert.equal((await app.request("/v1/targets/current")).status, 401);
  assert.equal((await app.request("/v1/records")).status, 401);
  assert.equal((await app.request(`/v1/targets/${TARGET_WEEK}`, { method: "PUT", body: "{}" })).status, 401);
});

// Runs first: records are never deleted, so it needs a clean history.
test("records: baselines first, a new best once, the mark on the block, announced once", async () => {
  await setUp();
  // Monday of the target week: the four weeks before set the baselines, none announced.
  const first = await json(
    Score,
    await call("GET", `/v1/score?date=${TARGET_WEEK}&now=${enc(T(`${TARGET_WEEK} 08:00`))}`),
  );
  assert.deepEqual(first.records, []);
  const baselines = await asDemo(() => store.listRecords());
  assert.deepEqual(
    baselines.map((r) => [r.type, r.area, r.value, r.previous_value, r.line, r.achieved_on]).sort(),
    [
      ["best_week", null, 90, null, null, "2026-10-05"],
      ["best_week_area", "business", 89, null, null, "2026-10-05"],
      // The first two days of 28 September lost time to the phone: Wednesday has the first clean run.
      ["longest_block", "business", 120, null, null, "2026-09-30"],
    ].sort(),
  );

  // A week later, the target week has ended: 100% overall, business 100%, a 3 hour block.
  const after = enc(T("2026-11-02 08:00"));
  const s = await json(Score, await call("GET", `/v1/score?date=${TARGET_WEEK}&now=${after}`));
  const byType = (t: string) => s.records.find((r) => r.type === t);
  assert.deepEqual(
    s.records.map((r) => [r.type, r.area, r.value, r.previous_value]).sort(),
    [
      ["best_week", null, 100, 90],
      ["best_week_area", "business", 100, 89],
      ["longest_block", "business", 180, 120],
    ].sort(),
  );
  // Health has an hour a week: under the 2 hours a week record needs.
  assert.ok(!s.records.some((r) => r.area === "health"));
  assert.equal(byType("best_week")?.line, "Best week since you started. 100%. Do it again.");
  const longest = byType("longest_block");
  assert.equal(longest?.line, "3h on The company without a break. Your longest block yet.");
  // The old best of 120 minutes was passed in the 25th tick (125 minutes).
  assert.equal(longest?.tick_index, 24);
  const [sales] = s.day.blocks;
  assert.deepEqual([sales?.title, sales?.record_id, sales?.ticks.length], ["Cold Outreach", longest?.id, 36]);

  // Read again: nothing new is stored.
  const count = (await asDemo(() => store.listRecords())).length;
  await call("GET", `/v1/score?date=${TARGET_WEEK}&now=${after}`);
  await call("GET", "/v1/records");
  assert.equal((await asDemo(() => store.listRecords())).length, count);
  // A replay in the future never writes records.
  await call("GET", `/v1/score?date=2099-01-05&now=${enc("2099-01-12T08:00:00+02:00")}`);
  assert.equal((await asDemo(() => store.listRecords())).length, count);

  // The list: the current best of each scope plus unannounced; never someone else's.
  const list = await json(RecordsResponse, await call("GET", "/v1/records"));
  assert.deepEqual(
    list.records.map((r) => [r.type, r.area, r.value]).sort(),
    [
      ["best_week", null, 100],
      ["best_week_area", "business", 100],
      ["longest_block", "business", 180],
    ].sort(),
  );
  const theirs = await runAsUser(SOMEONE_ELSE, () => store.listRecords());
  assert.ok(!list.records.some((r) => r.id === theirs[0]?.id));

  // Announced once: the first time sets the instant, the second keeps it.
  const id = byType("best_week")?.id as string;
  const marked = await json(PersonalRecord, await call("POST", `/v1/records/${id}/announced`));
  assert.ok(marked.announced_at);
  const twice = await json(PersonalRecord, await call("POST", `/v1/records/${id}/announced`));
  assert.equal(twice.announced_at, marked.announced_at);
  // Someone else's record, or no record at all: not found.
  assert.equal((await call("POST", `/v1/records/${theirs[0]?.id}/announced`)).status, 404);
  assert.equal((await call("POST", "/v1/records/not-an-id/announced")).status, 400);
  // Their record is untouched.
  assert.equal((await runAsUser(SOMEONE_ELSE, () => store.listRecords()))[0]?.announced_at, null);
});

test("targets: cold start, the proposal with its maths, accept, then the user's own numbers", async () => {
  await setUp();
  const monday = enc(T(`${TARGET_WEEK} 08:00`));

  // Before the history: no full weeks, so no proposal and the baseline says why.
  const cold = await json(
    TargetResponse,
    await call("GET", `/v1/targets/current?week=2026-09-28&now=${enc(T("2026-09-28 08:00"))}`),
  );
  assert.equal(cold.target, null);
  assert.deepEqual([cold.baseline.ready, cold.baseline.full_weeks, cold.baseline.needed], [false, 0, 2]);
  assert.match(cold.baseline.reason ?? "", /two full weeks/);
  // One full week is still not enough.
  const one = await json(
    TargetResponse,
    await call("GET", `/v1/targets/current?week=2026-10-05&now=${enc(T("2026-10-05 08:00"))}`),
  );
  assert.deepEqual([one.target, one.baseline.full_weeks], [null, 1]);
  // Accepting with nothing to accept is refused; sending a number is not, and each category
  // with time goals starts at it.
  assert.equal((await call("PUT", "/v1/targets/2026-10-05", { accept: true })).status, 409);
  const own = await json(WeeklyTarget, await call("PUT", "/v1/targets/2026-10-05", { overall_pct: 70 }));
  assert.deepEqual(
    [own.set_by, own.reason, own.areas],
    ["user", "You set 70%.", { business: 70, health: 70, personal: null }],
  );

  // Four full weeks (80, 90, 70, 85): median 83, two at or above it, so we hold.
  const fresh = await json(
    TargetResponse,
    await call("GET", `/v1/targets/current?week=${TARGET_WEEK}&now=${monday}`),
  );
  assert.equal(fresh.baseline.ready, true);
  const p = fresh.target;
  assert.deepEqual([p?.status, p?.set_by, p?.overall_pct], ["proposed", "michael", 83]);
  assert.deepEqual(p?.basis, {
    weeks_used: 4,
    median_pct: 83,
    step: "hold",
    on_target_weeks: 2,
    heavy_week: false,
  });
  assert.deepEqual(p?.areas, { business: 81, health: 100, personal: null });
  assert.deepEqual(p?.floors, { business: 50, health: 50, personal: 50 });
  assert.equal(p?.reason, "Usual week 83%. You hit 2 of the last 4, so we hold. Target 83%.");
  // Any day of the week finds the same week; the proposal is not stored.
  const midweek = await json(
    TargetResponse,
    await call("GET", `/v1/targets/current?week=2026-10-28&now=${monday}`),
  );
  assert.equal(midweek.target?.week_start, TARGET_WEEK);
  assert.deepEqual(await asDemo(() => store.listTargets(TARGET_WEEK, TARGET_WEEK)), []);

  // Accept: Michael's numbers, now stored.
  const accepted = await json(
    WeeklyTarget,
    await call("PUT", `/v1/targets/${TARGET_WEEK}`, { accept: true }),
  );
  assert.deepEqual([accepted.status, accepted.set_by, accepted.overall_pct], ["accepted", "michael", 83]);
  assert.equal(accepted.reason, p?.reason);
  const back = await json(
    TargetResponse,
    await call("GET", `/v1/targets/current?week=${TARGET_WEEK}&now=${monday}`),
  );
  assert.deepEqual([back.target?.status, back.target?.created_at], ["accepted", accepted.created_at]);

  // Edit: any number makes it the user's, and the floors they did not send stay.
  const edited = await json(
    WeeklyTarget,
    await call("PUT", `/v1/targets/${TARGET_WEEK}`, { overall_pct: 75, floors: { personal: 30 } }),
  );
  assert.deepEqual([edited.status, edited.set_by, edited.overall_pct], ["accepted", "user", 75]);
  assert.deepEqual(edited.floors, { business: 50, health: 50, personal: 30 });
  assert.deepEqual(edited.areas, { business: 81, health: 100, personal: null });
  assert.equal(edited.reason, "You set 75%. I proposed 83%.");
  assert.equal(edited.created_at, accepted.created_at);
  // Accepting again keeps who set it.
  const again = await json(WeeklyTarget, await call("PUT", `/v1/targets/${TARGET_WEEK}`, { accept: true }));
  assert.deepEqual([again.set_by, again.overall_pct], ["user", 75]);

  // Refused: a day that is not a Monday, an empty body, a number out of range.
  assert.equal((await call("PUT", "/v1/targets/2026-10-27", { accept: true })).status, 400);
  assert.equal((await call("PUT", `/v1/targets/${TARGET_WEEK}`, {})).status, 400);
  assert.equal((await call("PUT", `/v1/targets/${TARGET_WEEK}`, { overall_pct: 101 })).status, 400);
  assert.equal((await call("GET", "/v1/targets/current?week=2026-02-30")).status, 400);

  // The score carries the target and the verdict. Monday morning: nothing elapsed, no verdict.
  const early = await json(Score, await call("GET", `/v1/score?date=${TARGET_WEEK}&now=${monday}`));
  assert.deepEqual(early.target, {
    overall_pct: 75,
    areas: edited.areas,
    floors: edited.floors,
    status: "accepted",
    set_by: "user",
  });
  assert.equal(early.on_target, null);
  // Tuesday night: business 100, health 100, the personal floor does not apply (no time goals).
  const late = await json(
    Score,
    await call("GET", `/v1/score?date=2026-10-27&now=${enc(T("2026-10-27 22:00"))}`),
  );
  assert.equal(late.on_target, true);
  assert.deepEqual(
    late.areas.map((a) => [a.area, a.score_pct, a.target_pct, a.floor_pct, a.meets_floor]),
    [
      ["business", 100, 81, 50, true],
      ["health", 100, 100, 50, true],
      ["personal", null, null, 30, null],
    ],
  );
  // The other user's target for the same week never shows.
  assert.notEqual(late.target?.overall_pct, 99);
});
