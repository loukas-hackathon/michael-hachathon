import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "@michael/shared";
import { phoneSessions, sessionGaps } from "./cadence";
import { APPS, dataOf, mac, macNotification, phone, report, sleep, T } from "./testkit";
import { buildTimeline } from "./timeline";

const DAYS = ["2026-11-10", "2026-11-11", "2026-11-12"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Sessions of one minute every 20 minutes from 09:00 to 12:00: 10 a day, every gap 19 minutes. */
function regularDay(day: string): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < 10; i++) {
    const minute = 9 * 60 + i * 20;
    const start = `${day} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    const end = `${day} ${pad(Math.floor((minute + 1) / 60))}:${pad((minute + 1) % 60)}`;
    // 7 of 10 pick ups start with the chat app; 4 of 10 are opened from a notification.
    out.push(
      phone(i < 7 ? APPS.chat : APPS.social, T(start), T(end), i < 4 ? "notification" : "home_screen"),
    );
  }
  return out;
}

test("session rule: under 30 seconds apart is one session, 30 seconds is a new one", () => {
  const tl = buildTimeline(
    [
      phone(APPS.chat, T("2026-11-10 09:00:00"), T("2026-11-10 09:00:10")),
      phone(APPS.social, T("2026-11-10 09:00:39"), T("2026-11-10 09:01:00")), // 29 s later: same session
      phone(APPS.chat, T("2026-11-10 09:01:30"), T("2026-11-10 09:02:00")), // 30 s later: new session
    ],
    Date.parse(T("2026-11-10 00:00")),
    Date.parse(T("2026-11-11 00:00")),
  );
  const sessions = phoneSessions(tl.iphone);
  assert.deepEqual(
    sessions.map((s) => [(s.end - s.start) / 1000, s.segments.length, s.first?.name]),
    [
      [60, 2, "WhatsApp"],
      [30, 1, "WhatsApp"],
    ],
  );
});

test("the first app of a session skips the home screen", () => {
  const tl = buildTimeline(
    [
      phone(APPS.home, T("2026-11-10 09:00:00"), T("2026-11-10 09:00:05")),
      phone(APPS.social, T("2026-11-10 09:00:05"), T("2026-11-10 09:02:00"), "home_screen"),
    ],
    Date.parse(T("2026-11-10 00:00")),
    Date.parse(T("2026-11-11 00:00")),
  );
  const [session] = phoneSessions(tl.iphone);
  assert.equal(session?.first?.name, "Instagram");
});

test("gaps: sleep and anything over 3 hours are not waking gaps", () => {
  const at = (s: string) => Date.parse(T(s));
  const sessions = [
    { start: at("2026-11-10 22:00"), end: at("2026-11-10 22:05") },
    { start: at("2026-11-10 23:00"), end: at("2026-11-10 23:05") }, // 55 min gap, awake
    { start: at("2026-11-11 01:00"), end: at("2026-11-11 01:05") }, // 1h55 gap, but asleep in it
    { start: at("2026-11-11 08:00"), end: at("2026-11-11 08:05") }, // 6h55 gap: away
  ];
  const sleeps = [{ start: at("2026-11-10 23:30"), end: at("2026-11-11 00:45") }];
  assert.deepEqual(
    sessionGaps(sessions, sleeps).map((g) => [(g.end - g.start) / 60000, g.waking]),
    [
      [55, true],
      [115, false],
      [415, false],
    ],
  );
  // Without the sleep record the 1h55 gap counts; the 6h55 one still does not.
  assert.deepEqual(
    sessionGaps(sessions, []).map((g) => g.waking),
    [true, true, false],
  );
});

test("cadence with known gaps: 10 pick ups a day, every gap 19 minutes", () => {
  const r = report(DAYS.flatMap(regularDay), "2026-11-10 00:00", "2026-11-13 00:00");
  const d = dataOf(r.phone_cadence);
  assert.equal(d.days_with_data, 3);
  assert.equal(d.sessions, 30);
  assert.equal(d.screen_only_sessions, 0);
  assert.equal(d.sessions_per_day, 10);
  // 9 gaps a day inside the day; the 2 overnight gaps (21 hours) are left out.
  assert.equal(d.gaps, 27);
  assert.equal(d.median_gap_minutes, 19);
  assert.deepEqual(d.typical_gap_minutes, { p25: 19, p75: 19 });
  // Working window 09:00 to 18:00 = 540 minutes, 10 sessions: one every 54 minutes on average.
  assert.deepEqual(d.window, {
    start_hour: 9,
    end_hour: 18,
    sessions_per_day: 10,
    average_interval_minutes: 54,
    gaps: 27,
    median_gap_minutes: 19,
  });
  assert.equal(d.checks_share, 0); // every session lasts 60 seconds
  assert.equal(d.median_session_seconds, 60);
  assert.deepEqual(d.opened, { notification: 12, own_hand: 18, unknown: 0, notification_share: 0.4 });
  assert.deepEqual(
    d.first_apps.map((f) => [f.app.name, f.sessions, f.share]),
    [
      ["WhatsApp", 21, 0.7],
      ["Instagram", 9, 0.3],
    ],
  );
  // 09:00, 09:20 and 09:40 start in hour 9, in Athens time.
  const nine = d.by_hour[9];
  assert.deepEqual(nine, { hour: 9, sessions: 9, sessions_per_day: 3, median_gap_minutes: 19 });
  // The only gap that starts in hour 12 is the overnight one, so hour 12 has no median.
  assert.equal(d.by_hour[12]?.median_gap_minutes, null);
  assert.equal(d.by_hour[7]?.sessions, 0); // 09:00 Athens is 07:00 UTC: must not land here
  assert.deepEqual(
    d.daily.map((x) => [x.day, x.complete, x.sessions, x.median_gap_minutes, x.minutes]),
    DAYS.map((day) => [day, true, 10, 19, 10]),
  );
  assert.equal(
    r.phone_cadence.summary,
    "An app opened on the phone every 54 minutes between 09:00 and 18:00: 10 phone sessions a day in that window, median gap 19 minutes. 70% of phone sessions start with WhatsApp. 0% last under 30 seconds. 40% were opened from a notification, the rest by hand.",
  );
  assert.equal(r.phone_cadence.evidence.length, 20);
});

test("a lit lock screen with no app opened is not a pick up", () => {
  const events = DAYS.flatMap(regularDay);
  // The screen wakes for 10 seconds twice a day, between two real sessions. No app is opened.
  for (const day of DAYS) {
    events.push(phone(APPS.home, T(`${day} 09:10:00`), T(`${day} 09:10:10`)));
    events.push(phone("com.apple.springboard.lock-screen", T(`${day} 09:30:00`), T(`${day} 09:30:10`)));
  }
  const d = dataOf(report(events, "2026-11-10 00:00", "2026-11-13 00:00").phone_cadence);
  assert.equal(d.screen_only_sessions, 6);
  // The rhythm is untouched: still 10 pick ups a day, every gap 19 minutes.
  assert.equal(d.sessions, 30);
  assert.equal(d.sessions_per_day, 10);
  assert.equal(d.median_gap_minutes, 19);
});

test("checks: sessions under 30 seconds", () => {
  const events = DAYS.flatMap(regularDay);
  // Add 10 short glances a day at half past each hour block: 20 seconds each.
  for (const day of DAYS) {
    for (let i = 0; i < 10; i++) {
      events.push(
        phone(
          APPS.chat,
          T(`${day} ${pad(13 + Math.floor(i / 2))}:${i % 2 ? "40" : "10"}:00`),
          T(`${day} ${pad(13 + Math.floor(i / 2))}:${i % 2 ? "40" : "10"}:20`),
        ),
      );
    }
  }
  const d = dataOf(report(events, "2026-11-10 00:00", "2026-11-13 00:00").phone_cadence);
  assert.equal(d.sessions, 60);
  assert.equal(d.checks_share, 0.5);
  assert.equal(d.daily[0]?.checks, 10);
  // Half the sessions carry no open reason: they are unknown, not counted as by hand.
  assert.equal(d.opened.unknown, 30);
  assert.equal(d.opened.notification_share, 0.4);
});

test("a day cut short by the range is left out of the per day average", () => {
  // The range ends at 10:10 on the third day: that day has 4 sessions so far.
  const d = dataOf(report(DAYS.flatMap(regularDay), "2026-11-10 00:00", "2026-11-12 10:10").phone_cadence);
  assert.equal(d.sessions, 24);
  assert.equal(d.sessions_per_day, 10); // (10 + 10) / 2 complete days, not 24 / 3
  assert.equal(d.daily[2]?.complete, false);
});

test("too little phone data gives a reason, not a number", () => {
  const twoDays = report(
    DAYS.slice(0, 2).flatMap(regularDay),
    "2026-11-10 00:00",
    "2026-11-13 00:00",
  ).phone_cadence;
  assert.equal(twoDays.status, "not_enough_data");
  assert.equal(twoDays.data, null);
  assert.equal(twoDays.summary, null);
  assert.equal(twoDays.reason, "not enough data: needs at least 3 days of phone usage, found 2");

  // Three days, but one pick up each: 2 gaps, both overnight.
  const sparse = report(
    DAYS.map((day) => phone(APPS.chat, T(`${day} 09:00`), T(`${day} 09:01`))),
    "2026-11-10 00:00",
    "2026-11-13 00:00",
  ).phone_cadence;
  assert.equal(sparse.data, null);
  assert.equal(
    sparse.reason,
    "not enough data: needs at least 20 waking gaps between phone sessions, found 0",
  );
});

test("a recorded sleep removes its gap from the rhythm", () => {
  const events = DAYS.flatMap(regularDay);
  // A late pick up and an early one, 2 hours apart, with a sleep between them.
  events.push(phone(APPS.chat, T("2026-11-10 23:00"), T("2026-11-10 23:01")));
  events.push(phone(APPS.chat, T("2026-11-11 01:01"), T("2026-11-11 01:02")));
  const awake = dataOf(report(events, "2026-11-10 00:00", "2026-11-13 00:00").phone_cadence);
  events.push(sleep(T("2026-11-10 23:10"), T("2026-11-11 00:50")));
  const asleep = dataOf(report(events, "2026-11-10 00:00", "2026-11-13 00:00").phone_cadence);
  assert.equal(awake.gaps, 28);
  assert.equal(asleep.gaps, 27);
});

// ---------- Mac ----------

/** Five rounds of 10 minutes in the editor then a 20 second look at the chat app, from 09:00. */
function macDay(day: string): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < 5; i++) {
    const base = 9 * 3600 + i * 620;
    const clock = (s: number) =>
      `${day} ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    out.push(mac(APPS.editor, T(clock(base)), T(clock(base + 600))));
    out.push(mac(APPS.chat, T(clock(base + 600)), T(clock(base + 620))));
  }
  return out;
}

test("Mac cadence: a chat app brought to the front after every 10 minutes of Mac use", () => {
  const events = DAYS.flatMap(macDay);
  // The Mac showed a chat notification 30 seconds before 3 of the 15 visits.
  for (const day of DAYS) events.push(macNotification(APPS.chat, T(`${day} 09:09:30`)));
  const r = report(events, "2026-11-10 00:00", "2026-11-13 00:00");
  const d = dataOf(r.mac_app_cadence);
  const chat = d.apps.find((a) => a.app.name === "WhatsApp");
  assert.deepEqual(chat, {
    app: { kind: "app", key: APPS.chat, name: "WhatsApp", category: "communication" },
    activations: 15,
    days: 3,
    activations_per_day: 5,
    // 5 rounds of 620 seconds a day = 51.7 minutes of Mac use, 5 visits: one every 10.3 minutes.
    minutes_of_mac_use_per_activation: 10.3,
    // Between two visits there are always exactly 10 minutes of editor time, even overnight:
    // the gap is measured in minutes of Mac use, so the closed lid does not count.
    median_gap_active_minutes: 10,
    checks_share: 1,
    median_visit_seconds: 20,
    after_notification_share: 0.2,
  });
  const editor = d.apps.find((a) => a.app.name === "VS Code");
  assert.equal(editor?.activations, 15);
  assert.equal(editor?.after_notification_share, null); // no notification from it was ever logged
  assert.equal(
    r.mac_app_cadence.summary,
    "On the Mac, WhatsApp comes to the front 5 times a day. That is once every 10 minutes of Mac use, with a median gap of 10 minutes. 100% of those visits last under 30 seconds. 20% follow a notification within 60 seconds.",
  );
});

test("Mac visits: passing through for under 3 seconds is not a visit and does not split one", () => {
  const day = "2026-11-10";
  const events = [
    ...DAYS.flatMap(macDay),
    // Editor, a 2 second flash of the finder on the way, editor again: one editor visit.
    mac(APPS.editor, T(`${day} 15:00:00`), T(`${day} 15:05:00`)),
    mac(APPS.finder, T(`${day} 15:05:00`), T(`${day} 15:05:02`)),
    mac(APPS.editor, T(`${day} 15:05:02`), T(`${day} 15:10:00`)),
  ];
  const d = dataOf(report(events, "2026-11-10 00:00", "2026-11-13 00:00").mac_app_cadence);
  assert.equal(d.apps.find((a) => a.app.name === "VS Code")?.activations, 16);
  assert.equal(
    d.apps.find((a) => a.app.name === "Finder"),
    undefined,
  );
});

test("Mac cadence needs 3 days and an app with 10 activations", () => {
  const short = report(
    DAYS.slice(0, 2).flatMap(macDay),
    "2026-11-10 00:00",
    "2026-11-13 00:00",
  ).mac_app_cadence;
  assert.equal(short.data, null);
  assert.equal(short.reason, "not enough data: needs at least 3 days of Mac usage, found 2");

  const quiet = report(
    DAYS.map((day) => mac(APPS.editor, T(`${day} 09:00`), T(`${day} 10:00`))),
    "2026-11-10 00:00",
    "2026-11-13 00:00",
  ).mac_app_cadence;
  assert.equal(quiet.data, null);
  assert.equal(quiet.reason, "not enough data: no Mac app reached 10 activations on 2 or more days");
});
