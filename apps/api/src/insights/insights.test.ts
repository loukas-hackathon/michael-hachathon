import assert from "node:assert/strict";
import { test } from "node:test";
import { type Insight, InsightsResponse, sleepScore, voiceProblems } from "@michael/shared";
import { FEATURES } from "./dictionary";
import { buildFeatures, FEATURE_KEYS, type FeatureKey, type FeatureTable } from "./features";
import { buildInsights, pickInsight } from "./index";
import { MINER_RULES, mine, WATCH_CANDIDATES } from "./miner";
import { benjaminiHochberg, permutationP, seeded, spearman } from "./stats";
import { asEvents, plantedMonth } from "./testkit";

// ---------- the shared sleep score ----------

test("sleep score: the source's own score wins, else duration and stages, else nothing", () => {
  assert.equal(sleepScore({ score: 71.4, duration_min: 200 }), 71);
  assert.equal(sleepScore({ duration_min: 480 }), 100);
  assert.equal(sleepScore({ duration_min: 240 }), 50);
  // 6 hours, 60 deep and 84 REM (40% of the night), 18 awake of 378 in bed.
  assert.equal(sleepScore({ duration_min: 360, deep_min: 60, rem_min: 84, awake_min: 18 }), 80);
  // A worse night scores lower on every part.
  assert.ok(
    (sleepScore({ duration_min: 330, deep_min: 40, rem_min: 60, awake_min: 40 }) ?? 100) <
      (sleepScore({ duration_min: 450, deep_min: 80, rem_min: 105, awake_min: 12 }) ?? 0),
  );
  assert.equal(sleepScore({}, 420), 88);
  assert.equal(sleepScore({}), null);
});

// ---------- the statistics ----------

test("permutation test: far apart is rare, the same is common, and a seed repeats", () => {
  const a = [61, 64, 59, 66, 63, 60, 65, 62];
  const b = [82, 85, 80, 84, 83, 81, 86, 79, 84, 82];
  assert.ok(permutationP(a, b, 1) < 0.001);
  assert.equal(permutationP(a, b, 7), permutationP(a, b, 7));
  assert.ok(permutationP([1, 5, 3, 4, 2], [3, 2, 4, 1, 5], 1) > 0.5);
});

test("false discovery control: one small value among many is not enough, a clear group is", () => {
  const noise = Array.from({ length: 200 }, (_, i) => (i + 1) / 200);
  assert.ok(benjaminiHochberg(noise, 0.02).every((pass) => !pass));
  const withSignal = [0.0001, 0.0001, 0.0002, ...noise];
  const passes = benjaminiHochberg(withSignal, 0.02);
  assert.deepEqual(passes.slice(0, 3), [true, true, true]);
  assert.equal(passes.filter(Boolean).length, 3);
});

test("rank correlation follows the order, not the size", () => {
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [10, 20, 30, 400, 5000]) - 1) < 1e-9);
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) + 1) < 1e-9);
});

// ---------- the miner, on tables made by hand ----------

const day = (i: number) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);

/** An empty table of `n` days with the columns given. */
function table(n: number, cols: Partial<Record<FeatureKey, (number | null)[]>>): FeatureTable {
  const days = Array.from({ length: n }, (_, i) => day(i));
  return {
    days,
    weekdays: days.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()),
    cols: Object.fromEntries(
      FEATURE_KEYS.map((k) => [k, cols[k] ?? new Array<number | null>(n).fill(null)]),
    ) as FeatureTable["cols"],
    cutoff: "23:00",
    usualBedtime: "00:00",
    usualWake: "07:30",
  };
}

test("a planted relation is found: late phone, then a lower sleep score the next morning", () => {
  const next = seeded(11);
  const n = 40;
  const late = Array.from({ length: n }, () => (next() < 0.35 ? 35 + next() * 30 : next() * 8));
  // The score sits on the morning after: 64 after a late night, 83 otherwise, with some spread.
  const score = Array.from({ length: n }, (_, i) =>
    i === 0 ? null : ((late[i - 1] ?? 0) >= 30 ? 64 : 83) + (next() - 0.5) * 12,
  );
  const mined = mine(table(n, { late_phone_min: late, sleep_score: score }));
  assert.equal(mined.links.length, 1);
  const link = mined.links[0];
  assert.deepEqual([link?.x.key, link?.y, link?.lag], ["late_phone_min", "sleep_score", 1]);
  assert.ok((link?.cmp.diff ?? 0) < -10);
  assert.ok((link?.cmp.held ?? 0) / (link?.cmp.seen ?? 1) >= 0.9);
  assert.equal(mined.chains.length, 0);
});

test("noise yields nothing: 34 unrelated columns over 60 days, five times over", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const next = seeded(seed);
    const cols = Object.fromEntries(
      FEATURES.map((f) => [
        f.key,
        Array.from({ length: 60 }, () =>
          f.format === "flag" ? (next() < 0.4 ? 1 : 0) : Math.round(next() * 100),
        ),
      ]),
    );
    const mined = mine(table(60, cols));
    assert.ok(mined.tested > 200, `seed ${seed}: ${mined.tested} pairs tested`);
    assert.deepEqual(
      [mined.links.length, mined.chains.length, mined.watching.length],
      [0, 0, 0],
      `seed ${seed}`,
    );
  }
});

test("too few days: a strong candidate is watched, never called a pattern", () => {
  // Nine days, three late nights, each followed by a clearly worse night.
  const late = [40, 2, 3, 45, 1, 4, 2, 50, 3];
  const score = [null, 62, 84, 82, 60, 85, 83, 81, 61];
  const mined = mine(table(9, { late_phone_min: late, sleep_score: score }));
  assert.equal(mined.links.length, 0);
  assert.equal(mined.watching.length, 1);
  assert.deepEqual([mined.watching[0]?.cmp.seen, mined.watching[0]?.cmp.held], [3, 3]);

  // The same three late nights with nights that did not move: nothing.
  const flat = [null, 82, 84, 82, 83, 85, 83, 81, 84];
  assert.equal(mine(table(9, { late_phone_min: late, sleep_score: flat })).watching.length, 0);

  // One late night and one bad night after it is not something to watch.
  const once = mine(
    table(9, {
      late_phone_min: [40, 2, 3, 4, 1, 4, 2, 5, 3],
      sleep_score: [null, 62, 84, 82, 83, 85, 83, 81, 84],
    }),
  );
  assert.equal(once.watching.length, 0);
});

test("only named candidates are watched; every one names real columns", () => {
  for (const candidate of WATCH_CANDIDATES) {
    const [x, y] = candidate.split("@")[0]?.split(">") ?? [];
    assert.ok(FEATURES.find((f) => f.key === x)?.cause, candidate);
    assert.ok(FEATURES.find((f) => f.key === y)?.outcome, candidate);
  }
});

// ---------- from events ----------

const month = plantedMonth({ firstDay: "2026-10-15", days: 30, seed: 7 });
const input = {
  events: asEvents(month.inputs),
  goals: month.goals,
  from: "2026-10-14T21:00:00Z",
  to: month.end,
  now: month.end,
};

test("daily table: evenings on their own day, the night on the morning it ends", () => {
  const t = buildFeatures(input);
  assert.equal(t.days[0], "2026-10-15");
  const lateDay = month.lateNights[0] ?? "";
  const i = t.days.indexOf(lateDay);
  assert.ok(i >= 0);
  // The late evening carries the phone minutes; the short night sits on the next row.
  assert.ok((t.cols.late_phone_min[i] ?? 0) >= 30, `late phone ${t.cols.late_phone_min[i]}`);
  assert.ok((t.cols.sleep_min[i + 1] ?? 999) < 360, `sleep ${t.cols.sleep_min[i + 1]}`);
  assert.equal(t.cols.short_night[i + 1], 1);
  assert.ok((t.cols.sleep_score[i + 1] ?? 100) < 70);
  assert.ok((t.cols.bedtime_min[i] ?? 0) > 24 * 60, "bedtime past midnight stays on the evening's day");
  // A working day's block: 90 planned minutes, and what was lost in it.
  const monday = t.days.indexOf("2026-10-19");
  assert.equal(t.cols.planned_min[monday], 90);
  assert.equal(t.cols.first_block_start_min[monday], 9 * 60);
  assert.ok((t.cols.lost_min[monday] ?? -1) >= 4);
  assert.equal((t.cols.spent_min[monday] ?? 0) + (t.cols.lost_min[monday] ?? 0), t.cols.planned_min[monday]);
  // The weekend has no block, so no figure, not a zero.
  assert.equal(t.cols.lost_min[t.days.indexOf("2026-10-17")], null);
  assert.equal(t.cols.recovery.filter((v) => v !== null).length, 30);
});

const study = buildInsights(input);
const ordered = (list: Insight[]) => {
  list.forEach((insight, n) => {
    const prev = list[n - 1];
    if (!prev) return;
    const rank = (i: Insight) => (i.status === "pattern" ? 0 : 1);
    assert.ok(rank(prev) <= rank(insight), insight.id);
    if (rank(prev) === rank(insight)) assert.ok(prev.strength >= insight.strength, insight.id);
  });
};

test("the founder's chain comes out of a month shaped that way", () => {
  const body = InsightsResponse.parse(study.response);
  const chain = body.insights[0];
  assert.equal(chain?.kind, "chain");
  assert.equal(chain?.status, "pattern");
  assert.match(chain?.id ?? "", /^chain:late_phone_min>sleep_(min|score)>(first_block_lost_min|lost_min)$/);
  assert.equal(chain?.steps.length, 3);
  // Phone minutes up, sleep down, lost minutes up: the trigger side against the other days.
  const [phone, sleep, lost] = chain?.steps ?? [];
  assert.ok((phone?.value_num ?? 0) > (phone?.usual_num ?? 0) + 30);
  assert.ok((sleep?.value_num ?? 0) < (sleep?.usual_num ?? 0));
  assert.ok((lost?.value_num ?? 0) > (lost?.usual_num ?? 0) + 10);
  // The trigger days are late evenings the month really had.
  for (const d of chain?.evidence.days ?? []) assert.ok(month.lateNights.includes(d), d);
  assert.ok((chain?.evidence.times_seen ?? 0) >= MINER_RULES.needed);
  assert.equal(chain?.fix.action?.kind, "instruction");
  assert.match(chain?.fix.text ?? "", /^Phone down at \d\d:\d\d\./);
  assert.deepEqual(chain?.sources, ["google-calendar", "apple-watch", "mac", "iphone"]);
  assert.equal(study.plans.get(chain?.id ?? "")?.kind, "instruction");
  assert.equal(pickInsight(study, "late_phone_min")?.id, chain?.id);
  assert.equal(pickInsight(study, "meal"), null);
});

test("the same events give the same insights", () => {
  assert.deepEqual(buildInsights(input).response, study.response);
});

test("every line keeps the voice and the contract's promises", () => {
  const body = InsightsResponse.parse(study.response);
  assert.ok(body.insights.length >= 2);
  ordered(body.insights);
  assert.equal(new Set(body.insights.map((i) => i.id)).size, body.insights.length);
  for (const i of body.insights) {
    for (const text of [i.title, i.line, i.fix.text, ...i.steps.flatMap((s) => [s.label, s.value])]) {
      assert.deepEqual(voiceProblems(text), [], text);
    }
    assert.doesNotMatch(i.title, /\.$/, i.title);
    assert.match(i.line, /\.$/, i.line);
    assert.match(i.fix.text, /\.$/, i.fix.text);
    assert.match(i.line, /^\d/, `number first: ${i.line}`);
    assert.equal(i.steps.length, i.kind === "chain" ? 3 : 2);
    assert.equal(i.evidence.history.length, i.evidence.days.length);
    assert.equal(i.evidence.history.filter(Boolean).length, i.evidence.times_held);
    assert.equal(i.last_seen, i.evidence.days.at(-1));
    for (const s of i.steps) if (s.usual_num !== undefined) assert.match(s.value, / against /);
  }
  assert.equal(body.studied.nights, 30);
  assert.equal(body.studied.needed_days, MINER_RULES.minDays);
  assert.ok(body.studied.data_points > 300);
  for (const s of body.series) assert.equal(s.points.length, study.table.days.length);
});

test("series: the night's readings sit on the morning the night ends", () => {
  const late = month.lateNights[0] ?? "";
  const morning = study.table.days[study.table.days.indexOf(late) + 1] ?? "";
  const point = (key: string, d: string) =>
    study.response.series.find((s) => s.key === key)?.points.find((p) => p.day === d)?.value ?? null;
  assert.ok((point("late_phone_min", late) ?? 0) >= 30);
  assert.ok((point("sleep_score", morning) ?? 100) < 70);
  assert.ok((point("recovery", morning) ?? 100) <= 50);
});

test("a month with the same columns filled independently gives no pattern", () => {
  for (const seed of [1, 2, 3]) {
    const m = plantedMonth({ firstDay: "2026-10-15", days: 30, seed, planted: false });
    const s = buildInsights({ ...input, events: asEvents(m.inputs), to: m.end, now: m.end });
    assert.deepEqual(
      s.response.insights.filter((i) => i.status === "pattern").map((i) => i.id),
      [],
      `seed ${seed}`,
    );
  }
});

test("a first week: an honest early state, real counts, nothing called a pattern", () => {
  const m = plantedMonth({ firstDay: "2026-11-01", days: 8, seed: 7 });
  const s = buildInsights({
    events: asEvents(m.inputs),
    goals: m.goals,
    from: "2026-10-31T22:00:00Z",
    to: m.end,
    now: m.end,
  });
  const body = InsightsResponse.parse(s.response);
  assert.equal(body.studied.nights, 8);
  assert.ok(body.studied.days < body.studied.needed_days);
  assert.ok(body.insights.every((i) => i.status === "watching"));
  for (const i of body.insights) {
    // A watched line says what was seen and leaves the count to the evidence.
    assert.doesNotMatch(i.line, /\bof (the )?\d+\b/, i.line);
    assert.doesNotMatch(i.line, /I need/, i.line);
  }

  const none = buildInsights({ events: [], goals: [], from: "2026-11-01T00:00:00Z", to: m.end, now: m.end });
  assert.deepEqual(none.response.insights, []);
  assert.deepEqual(
    [none.response.studied.days, none.response.studied.nights, none.response.studied.data_points],
    [0, 0, 0],
  );
  assert.deepEqual(none.response.studied.sources, []);
});
