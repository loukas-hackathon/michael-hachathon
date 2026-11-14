import assert from "node:assert/strict";
import { test } from "node:test";
import { type Event, PatternReport } from "@michael/shared";
import { buildPatternReport } from "./index";
import {
  APPS,
  aiSession,
  dataOf,
  mac,
  phone,
  recovery,
  report,
  sleep,
  syntheticMonth,
  T,
  web,
} from "./testkit";

const DETECTORS = [
  "phone_cadence",
  "mac_app_cadence",
  "focus_disruptions",
  "recovery_cost",
  "repeat_offenders",
  "drift",
  "late_screens",
  "context_switching",
  "time_by_app",
  "ai_tool_use",
] as const;

test("no events: every detector says why, none makes up a number", () => {
  const r = report([], "2026-11-07 00:00", "2026-11-14 00:00");
  PatternReport.parse(r);
  for (const key of DETECTORS) {
    const d = r[key];
    assert.equal(d.status, "not_enough_data", key);
    assert.equal(d.data, null, key);
    assert.equal(d.summary, null, key);
    assert.match(d.reason ?? "", /^not enough data: /, key);
    assert.ok(d.minimum.length > 0, key);
    assert.deepEqual(d.evidence, [], key);
  }
  assert.deepEqual(r.headlines, []);
  assert.equal(r.days.length, 7);
  assert.equal(r.timezone, "Europe/Athens");
});

test("one event is not a pattern", () => {
  const r = report(
    [mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:05"))],
    "2026-11-07 00:00",
    "2026-11-14 00:00",
  );
  PatternReport.parse(r);
  // The simple total exists; everything that needs a sample stays silent.
  assert.equal(dataOf(r.time_by_app).totals.active_seconds, 300);
  for (const key of DETECTORS.filter((k) => k !== "time_by_app")) assert.equal(r[key].data, null, key);
});

test("the report is pure: same input, same output, and `now` is only echoed", () => {
  const events = [mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:30"))];
  const options = { from: T("2026-11-10 00:00"), to: T("2026-11-11 00:00"), now: T("2026-11-12 08:00") };
  const a = buildPatternReport(events, options);
  const b = buildPatternReport(events, options);
  assert.deepEqual(a, b);
  assert.equal(a.generated_at, "2026-11-12T06:00:00.000Z");
});

test("bad ranges are errors", () => {
  assert.throws(() => report([], "2026-11-14 00:00", "2026-11-07 00:00"), RangeError);
  assert.throws(() =>
    buildPatternReport([], { from: "nonsense", to: T("2026-11-07 00:00"), now: T("2026-11-07 00:00") }),
  );
});

// ---------- totals ----------

test("an interval that crosses midnight is split by local day", () => {
  const r = report(
    [mac(APPS.editor, T("2026-11-10 23:30"), T("2026-11-11 00:30"))],
    "2026-11-10 00:00",
    "2026-11-12 00:00",
  );
  const d = dataOf(r.time_by_app);
  assert.deepEqual(
    d.daily.map((x) => [x.day, x.active_seconds]),
    [
      ["2026-11-10", 1800],
      ["2026-11-11", 1800],
    ],
  );
  assert.equal(d.totals.active_seconds, 3600);
});

test("local midnight, not UTC midnight: 01:00 Athens belongs to the new day", () => {
  // 23:30 UTC on the 10th is 01:30 on the 11th in Athens.
  const r = buildPatternReport([mac(APPS.editor, "2026-11-10T23:00:00Z", "2026-11-10T23:30:00Z")], {
    from: "2026-11-09T22:00:00Z",
    to: "2026-11-11T22:00:00Z",
    now: "2026-11-11T22:00:00Z",
  });
  assert.deepEqual(
    dataOf(r.time_by_app).daily.map((x) => x.day),
    ["2026-11-11"],
  );
});

test("the day the clocks go back has 25 hours", () => {
  // In front from 23:00 on 24 October (summer time) to 01:00 on 26 October (winter time).
  const r = buildPatternReport([mac(APPS.editor, "2026-10-24T23:00:00+03:00", "2026-10-26T01:00:00+02:00")], {
    from: "2026-10-24T00:00:00+03:00",
    to: "2026-10-27T00:00:00+02:00",
    now: "2026-10-27T00:00:00+02:00",
  });
  const d = dataOf(r.time_by_app);
  assert.deepEqual(
    d.daily.map((x) => [x.day, x.active_seconds / 3600, x.complete]),
    [
      ["2026-10-24", 1, true],
      ["2026-10-25", 25, true],
      ["2026-10-26", 1, true],
    ],
  );
  assert.equal(d.totals.active_seconds, 27 * 3600);
});

test("totals add up: apps = categories = devices = active time, with the phone over the Mac counted once", () => {
  const events = [
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 10:00")),
    mac(APPS.chat, T("2026-11-10 10:00"), T("2026-11-10 10:10")),
    mac(APPS.unknown, T("2026-11-10 10:10"), T("2026-11-10 10:15")),
    phone(APPS.social, T("2026-11-10 09:30"), T("2026-11-10 09:33")), // while the Mac shows the editor
    phone(APPS.chat, T("2026-11-10 12:00"), T("2026-11-10 12:02")),
  ];
  const d = dataOf(report(events, "2026-11-10 00:00", "2026-11-11 00:00").time_by_app);
  const day = d.daily[0];
  assert.ok(day);
  // Wall time with a screen in front: 75 minutes of Mac + 2 of phone alone. The 3 minutes of
  // phone inside the editor hour replace Mac time, they do not add to it.
  assert.equal(day.active_seconds, 77 * 60);
  assert.equal(day.mac_seconds, 72 * 60);
  assert.equal(day.iphone_seconds, 5 * 60);
  assert.equal(day.overlap_seconds, 3 * 60);
  assert.equal(day.mac_seconds + day.iphone_seconds, day.active_seconds);
  assert.equal(
    day.by_category.reduce((t, c) => t + c.seconds, 0),
    day.active_seconds,
  );
  assert.equal(day.apps.reduce((t, a) => t + a.seconds, 0) + day.other_apps_seconds, day.active_seconds);
  assert.deepEqual(day.by_category, [
    { category: "work", seconds: 57 * 60 },
    { category: "communication", seconds: 12 * 60 },
    { category: "other", seconds: 5 * 60 },
    { category: "social", seconds: 3 * 60 },
  ]);
  // The same app on two devices stays two rows.
  assert.deepEqual(
    day.apps.map((a) => [a.subject.name, a.device, a.seconds / 60]),
    [
      ["VS Code", "mac", 57],
      ["WhatsApp", "mac", 10],
      ["Mystery", "mac", 5],
      ["Instagram", "iphone", 3],
      ["WhatsApp", "iphone", 2],
    ],
  );
  assert.equal(d.active_minutes_per_day, 77);
});

// ---------- context switching ----------

test("context switching: switches per active hour and time in fragments", () => {
  const events = [
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:15")),
    mac(APPS.editor, T("2026-11-10 09:15"), T("2026-11-10 09:30")), // same app again: one stay
    mac(APPS.chat, T("2026-11-10 09:30"), T("2026-11-10 09:31")), // 60 s fragment
    mac(APPS.editor, T("2026-11-10 09:31"), T("2026-11-10 10:00")),
    mac(APPS.finder, T("2026-11-10 10:00:00"), T("2026-11-10 10:01:30")), // 90 s fragment
    mac(APPS.editor, T("2026-11-10 10:01:30"), T("2026-11-10 10:30")),
    // After a long break the first app is not a "switch". Stays: 30, 1, 29, 1.5, 28.5 and 30
    // minutes, so the median stay is 28.75 minutes.
    mac(APPS.chat, T("2026-11-10 15:00"), T("2026-11-10 15:30")),
  ];
  const r = report(events, "2026-11-10 00:00", "2026-11-11 00:00");
  const d = dataOf(r.context_switching);
  assert.equal(d.switches, 4);
  assert.equal(d.active_minutes, 120);
  assert.equal(d.switches_per_active_hour, 2);
  assert.equal(d.fragment_share, 0.02); // 2.5 of 120 minutes
  assert.deepEqual(d.daily, [
    {
      day: "2026-11-10",
      complete: true,
      active_minutes: 120,
      switches: 4,
      switches_per_active_hour: 2,
      fragment_share: 0.02,
    },
  ]);
  assert.equal(
    r.context_switching.summary,
    "2 app switches per active hour. 2% of screen time is spent in stays shorter than 2 minutes (median stay 29 minutes).",
  );
});

test("moving between sites inside the browser is not an app switch", () => {
  const events = [
    mac(APPS.browser, T("2026-11-10 09:00"), T("2026-11-10 10:00")),
    web("github.com", T("2026-11-10 09:00"), T("2026-11-10 09:20")),
    web("youtube.com", T("2026-11-10 09:20"), T("2026-11-10 09:40")),
    web("github.com", T("2026-11-10 09:40"), T("2026-11-10 10:00")),
  ];
  const d = dataOf(report(events, "2026-11-10 00:00", "2026-11-11 00:00").context_switching);
  assert.equal(d.switches, 0);
  assert.equal(d.median_stay_seconds, 3600);
});

test("context switching needs an hour of device time", () => {
  const r = report(
    [mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:59"))],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  );
  assert.equal(r.context_switching.data, null);
  assert.equal(
    r.context_switching.reason,
    "not enough data: needs at least 60 minutes of device time, found 59",
  );
});

// ---------- late screens ----------

const lateWeek = (): Event[] => [
  // Daytime use on four days, so each of the four nights counts as observed.
  ...["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((d) =>
    mac(APPS.editor, T(`${d} 12:00`), T(`${d} 12:10`)),
  ),
  mac(APPS.tv, T("2026-11-10 23:30"), T("2026-11-11 00:15")), // night of the 10th: 45 min
  phone(APPS.social, T("2026-11-12 23:10"), T("2026-11-12 23:14")), // night of the 12th: 4 min, under the bar
  mac(APPS.chat, T("2026-11-14 01:00"), T("2026-11-14 01:20")), // night of the 13th: 20 min after midnight
  mac(APPS.chat, T("2026-11-13 22:00"), T("2026-11-13 22:50")), // before the cut off: not late
];

test("late screens: minutes after 23:00 per night, the night belongs to its evening", () => {
  const r = report(
    [...lateWeek(), recovery(T("2026-11-11 07:00"), 55)],
    "2026-11-10 00:00",
    "2026-11-14 06:00",
  );
  const d = dataOf(r.late_screens);
  assert.equal(d.cutoff, "23:00");
  assert.equal(d.cutoff_source, "default");
  assert.equal(d.usual_bedtime, null);
  assert.equal(d.nights_observed, 4);
  assert.equal(d.late_nights, 2);
  assert.equal(d.median_late_minutes, 32.5);
  assert.deepEqual(
    d.nights.map((n) => [
      n.night,
      n.minutes,
      n.mac_minutes,
      n.iphone_minutes,
      n.top?.name ?? null,
      n.next_recovery_pct,
    ]),
    [
      ["2026-11-10", 45, 45, 0, "TV", 55],
      ["2026-11-11", 0, 0, 0, null, null],
      ["2026-11-12", 4, 0, 4, "Instagram", null],
      ["2026-11-13", 20, 20, 0, "WhatsApp", null],
    ],
  );
  assert.equal(d.nights[0]?.last_seen_at, "2026-11-10T22:15:00.000Z");
  assert.equal(d.recovery_comparison, null); // one recovery value is not a comparison
  assert.equal(
    r.late_screens.summary,
    "Screens on after 23:00 on 2 of 4 nights, a median of 33 minutes. Most used then: TV.",
  );
});

test("late screens: with sleep data the cut off is one hour before the usual bedtime", () => {
  const sleeps = [
    sleep(T("2026-11-11 00:30"), T("2026-11-11 07:30")),
    sleep(T("2026-11-12 00:10"), T("2026-11-12 07:00")),
    sleep(T("2026-11-13 00:50"), T("2026-11-13 08:00")),
    sleep(T("2026-11-12 15:00"), T("2026-11-12 15:40")), // a nap: not a bedtime
  ];
  const d = dataOf(report([...lateWeek(), ...sleeps], "2026-11-10 00:00", "2026-11-14 06:00").late_screens);
  assert.equal(d.usual_bedtime, "00:30");
  assert.equal(d.cutoff, "23:30");
  assert.equal(d.cutoff_source, "usual_bedtime");
  // The 4 minutes at 23:10 on the 12th now fall before the cut off.
  assert.deepEqual(
    d.nights.map((n) => [n.night, n.minutes, n.next_sleep_minutes]),
    [
      ["2026-11-10", 45, 420],
      ["2026-11-11", 0, 410],
      ["2026-11-12", 0, 430],
      ["2026-11-13", 20, null],
    ],
  );
});

test("late screens: fewer than 3 observed nights gives a reason", () => {
  const r = report(lateWeek(), "2026-11-10 00:00", "2026-11-12 06:00");
  assert.equal(r.late_screens.data, null);
  assert.equal(r.late_screens.reason, "not enough data: needs at least 3 nights with device data, found 2");
});

test("late screens: recovery after late nights against the others needs 3 of each", () => {
  const days = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  const next = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];
  const events: Event[] = [];
  days.forEach((d, i) => {
    events.push(mac(APPS.editor, T(`${d} 12:00`), T(`${d} 12:10`)));
    // The first three nights are late (40 min), the next three are not.
    if (i < 3) events.push(mac(APPS.tv, T(`${d} 23:10`), T(`${d} 23:50`)));
    events.push(recovery(T(`${next[i]} 07:00`), i < 3 ? 50 + i : 70 + i));
  });
  const r = report(events, "2026-11-03 00:00", "2026-11-09 12:00");
  assert.deepEqual(dataOf(r.late_screens).recovery_comparison, {
    late_nights: 3,
    late_avg_recovery_pct: 51,
    other_nights: 3,
    other_avg_recovery_pct: 74,
  });
});

// ---------- AI tools ----------

test("AI sessions side by side: session time is summed, clock time is not", () => {
  const r = report(
    [
      aiSession(T("2026-11-10 10:00"), T("2026-11-10 11:00"), 600),
      aiSession(T("2026-11-10 10:30"), T("2026-11-10 11:30"), 1200),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  );
  const d = dataOf(r.ai_tool_use);
  assert.equal(d.sessions, 2);
  assert.equal(d.sessions_per_day, 2);
  assert.equal(d.session_minutes, 120);
  assert.equal(d.wall_minutes, 90);
  assert.equal(d.waiting_minutes, 30);
  assert.equal(d.waiting_share, 0.25);
  assert.deepEqual(d.by_tool, [
    { tool: "claude_code", sessions: 2, session_minutes: 120, waiting_share: 0.25 },
  ]);
  assert.deepEqual(d.daily, [{ day: "2026-11-10", sessions: 2, session_minutes: 120, wall_minutes: 90 }]);
});

test("AI waiting can never exceed the session, and is unknown when not reported", () => {
  const capped = dataOf(
    report(
      [aiSession(T("2026-11-10 10:00"), T("2026-11-10 10:10"), 99999)],
      "2026-11-10 00:00",
      "2026-11-11 00:00",
    ).ai_tool_use,
  );
  assert.equal(capped.waiting_share, 1);
  assert.equal(capped.waiting_minutes, 10);

  const silent = dataOf(
    report([aiSession(T("2026-11-10 10:00"), T("2026-11-10 10:10"))], "2026-11-10 00:00", "2026-11-11 00:00")
      .ai_tool_use,
  );
  assert.equal(silent.waiting_share, null);
  assert.equal(silent.waiting_minutes, null);
});

// ---------- the report as a whole ----------

test("28 days and tens of thousands of events compute in linear time", () => {
  const window = (days: number, to: string) => ({
    events: syntheticMonth(days),
    options: { from: "2026-10-17T00:00:00+03:00", to, now: to },
  });
  const week = window(7, "2026-10-24T00:00:00+03:00");
  const month = window(28, "2026-11-14T00:00:00+02:00");
  assert.ok(month.events.length > 40_000, `only ${month.events.length} events`);
  // CPU time of this process, not wall time: other processes on the machine do not inflate it.
  const time = (w: ReturnType<typeof window>) => {
    const started = process.cpuUsage();
    buildPatternReport(w.events, w.options);
    const used = process.cpuUsage(started);
    return (used.user + used.system) / 1000;
  };
  time(week); // warm up
  time(month);
  // A fixed limit failed whenever CI or parallel test files shared the CPU (a 200 ms run took 3 s
  // under load). Compare a month with a week instead, interleaved so both see the same conditions:
  // linear work is about 4x (measured 3.3x), an accidental quadratic step about 16x.
  let weekBest = Number.POSITIVE_INFINITY;
  let monthBest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 5; i++) {
    weekBest = Math.min(weekBest, time(week));
    monthBest = Math.min(monthBest, time(month));
  }
  const ratio = monthBest / weekBest;
  assert.ok(ratio < 9, `4x the data took ${ratio.toFixed(1)}x the time (${Math.round(monthBest)} ms)`);

  const r = buildPatternReport(month.events, month.options);
  PatternReport.parse(r);
  assert.equal(r.days.length, 28);
  for (const key of DETECTORS) assert.equal(r[key].status, "ok", `${key}: ${r[key].reason}`);
});

test("a full report holds together: valid shape, capped evidence, consistent totals", () => {
  const r = buildPatternReport(syntheticMonth(8), {
    from: "2026-10-17T00:00:00+03:00",
    to: "2026-10-25T00:00:00+03:00",
    now: "2026-10-25T00:00:00+03:00",
  });
  PatternReport.parse(r);
  assert.equal(r.headlines.length, DETECTORS.length);
  for (const key of DETECTORS) assert.ok(r[key].evidence.length <= 20, key);

  const totals = dataOf(r.time_by_app);
  for (const day of totals.daily) {
    assert.equal(day.mac_seconds + day.iphone_seconds, day.active_seconds, day.day);
    assert.equal(
      day.by_category.reduce((t, c) => t + c.seconds, 0),
      day.active_seconds,
      day.day,
    );
    assert.equal(
      day.apps.reduce((t, a) => t + a.seconds, 0) + day.other_apps_seconds,
      day.active_seconds,
      day.day,
    );
    assert.ok(day.active_seconds <= 86_400, day.day);
  }
  assert.equal(
    totals.daily.reduce((t, d) => t + d.active_seconds, 0),
    totals.totals.active_seconds,
  );
  // Context switching measures the same active time as the totals.
  assert.equal(dataOf(r.context_switching).active_minutes, Math.round(totals.totals.active_seconds / 6) / 10);
  // Half the visits come from the extension, in every hour, so every history visit is superseded.
  assert.equal(r.inputs.web_visits, 8 * 125);
  assert.equal(r.inputs.web_visits_superseded, 8 * 125);
  // Disruptions cannot outnumber the switches they are made of.
  assert.ok(dataOf(r.focus_disruptions).disruptions <= dataOf(r.context_switching).switches);
});

test("copy rules: summaries carry no dashes, exclamation marks, emoji, 12 hour times or banned words", () => {
  const r = buildPatternReport(syntheticMonth(8), {
    from: "2026-10-17T00:00:00+03:00",
    to: "2026-10-25T00:00:00+03:00",
    now: "2026-10-25T00:00:00+03:00",
  });
  assert.ok(r.headlines.length > 0);
  for (const line of r.headlines) {
    assert.doesNotMatch(line, /[-–—!]/, line);
    assert.doesNotMatch(line, /\b(productivity|optimi[sz]e|wellness)\b/i, line);
    assert.doesNotMatch(line, /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i, line);
    assert.doesNotMatch(line, /\p{Extended_Pictographic}/u, line);
    assert.match(line, /\d/, line); // numbers, always
  }
  for (const key of DETECTORS) {
    assert.doesNotMatch(r[key].minimum, /[–—!]/, key);
  }
});

test("privacy: a host that is not on the public list never appears in a summary, and no search term anywhere", () => {
  const r = buildPatternReport(syntheticMonth(8), {
    from: "2026-10-17T00:00:00+03:00",
    to: "2026-10-25T00:00:00+03:00",
    now: "2026-10-25T00:00:00+03:00",
  });
  for (const line of r.headlines) assert.equal(line.includes("private.example"), false, line);
  assert.equal(JSON.stringify(r).includes("a made up search"), false);
  assert.equal(JSON.stringify(r).includes("A page title"), false);
});
