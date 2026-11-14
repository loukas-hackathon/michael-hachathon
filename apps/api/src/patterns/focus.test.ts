import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "@michael/shared";
import {
  APPS,
  calendar,
  dataOf,
  goal,
  mac,
  macNotification,
  phone,
  report,
  screenOff,
  search,
  T,
  web,
} from "./testkit";

/**
 * The textbook case. Editor for 30 minutes, a 2 minute look at the chat app, then the terminal
 * (4 min), the finder (3 min) and only then the editor again:
 *
 *   09:00 editor | 09:30 chat | 09:32 terminal | 09:36 finder | 09:39 editor ... 10:10
 *
 * The check took 2 minutes. Being back in the editor took 9.
 */
const textbook = (day: string): Event[] => [
  mac(APPS.editor, T(`${day} 09:00`), T(`${day} 09:30`)),
  mac(APPS.chat, T(`${day} 09:30`), T(`${day} 09:32`)),
  mac(APPS.terminal, T(`${day} 09:32`), T(`${day} 09:36`)),
  mac(APPS.finder, T(`${day} 09:36`), T(`${day} 09:39`)),
  mac(APPS.editor, T(`${day} 09:39`), T(`${day} 10:10`)),
];
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];

test("a 2 minute check that costs 9 minutes", () => {
  const r = report(textbook("2026-11-10"), "2026-11-10 00:00", "2026-11-11 00:00");
  const d = dataOf(r.focus_disruptions);
  assert.equal(d.mode, "inferred");
  assert.equal(d.stretches, 1);
  assert.equal(d.focus_minutes, 70); // 09:00 to 10:10
  assert.equal(d.disruptions, 1);
  assert.equal(d.disruptions_per_day, 1);
  assert.equal(d.minutes_lost, 2);
  // Uninterrupted work: 09:00 to 09:30, then 09:32 to 10:10 (the finder is neutral, not a break).
  assert.equal(d.longest_uninterrupted_minutes, 38);
  const [item] = d.items;
  assert.ok(item);
  assert.deepEqual(
    {
      mode: item.mode,
      day: item.day,
      start: item.start_at,
      end: item.end_at,
      device: item.device,
      trigger: item.trigger.name,
      left: item.left?.name,
      lost: item.minutes_lost,
      back: item.minutes_until_back,
      ended: item.ended_stretch,
      notified: item.opened_by_notification,
    },
    {
      mode: "inferred",
      day: "2026-11-10",
      start: "2026-11-10T07:30:00.000Z",
      end: "2026-11-10T07:32:00.000Z", // back at work (the terminal)
      device: "mac",
      trigger: "WhatsApp",
      left: "VS Code",
      lost: 2,
      back: 9, // 09:30 to 09:39
      ended: false,
      notified: null, // the Mac logged no notification from this app, so unknown
    },
  );
  assert.equal(r.focus_disruptions.evidence.length, 1);
});

test("recovery cost: medians and a daily total over five such days", () => {
  const r = report(WEEK.flatMap(textbook), "2026-11-09 00:00", "2026-11-14 00:00");
  const d = dataOf(r.recovery_cost);
  assert.equal(d.measured, 5);
  assert.equal(d.not_returned, 0);
  assert.equal(d.median_minutes_lost, 2);
  assert.equal(d.median_minutes_until_back, 9);
  assert.equal(d.multiplier, 4.5);
  assert.equal(d.total_minutes_until_back, 45);
  assert.equal(d.minutes_until_back_per_day, 9);
  // One disruption a day: the day shows its total but no median of one sample.
  assert.deepEqual(d.daily[0], {
    day: "2026-11-09",
    measured: 1,
    total_minutes_until_back: 9,
    median_minutes_until_back: null,
  });
  assert.equal(
    r.recovery_cost.summary,
    "A disruption of 2 minutes costs 9 minutes before the app that was left is back in front (medians over 5 disruptions). That adds up to 9 minutes a day.",
  );
});

test("recovery cost refuses to speak from fewer than 5 disruptions", () => {
  const r = report(WEEK.slice(0, 4).flatMap(textbook), "2026-11-09 00:00", "2026-11-14 00:00");
  assert.equal(r.recovery_cost.data, null);
  assert.equal(
    r.recovery_cost.reason,
    "not enough data: needs at least 5 disruptions with a return to the app that was left, found 4",
  );
});

test("nested disruptions do not count the same minutes twice in the total", () => {
  // editor | chat 2 | terminal 2 | social 2 | terminal 2 | editor: the editor is away for 8
  // minutes, the terminal for 2 inside those 8.
  const day = (d: string): Event[] => [
    mac(APPS.editor, T(`${d} 09:00`), T(`${d} 09:30`)),
    mac(APPS.chat, T(`${d} 09:30`), T(`${d} 09:32`)),
    mac(APPS.terminal, T(`${d} 09:32`), T(`${d} 09:34`)),
    mac(APPS.tv, T(`${d} 09:34`), T(`${d} 09:36`)),
    mac(APPS.terminal, T(`${d} 09:36`), T(`${d} 09:38`)),
    mac(APPS.editor, T(`${d} 09:38`), T(`${d} 10:00`)),
  ];
  const d = dataOf(
    report(WEEK.slice(0, 3).flatMap(day), "2026-11-09 00:00", "2026-11-14 00:00").recovery_cost,
  );
  assert.equal(d.measured, 6);
  // Per day: [09:30, 09:38] and [09:34, 09:36] overlap, so 8 minutes, not 10.
  assert.equal(d.daily[0]?.total_minutes_until_back, 8);
  assert.equal(d.total_minutes_until_back, 24);
});

test("repeat offenders: the same app on several days", () => {
  const events = [
    ...WEEK.flatMap(textbook),
    // A second offender, on one day only: it must not be listed as a repeat offender.
    mac(APPS.editor, T("2026-11-09 14:00"), T("2026-11-09 14:20")),
    mac(APPS.tv, T("2026-11-09 14:20"), T("2026-11-09 14:23")),
    mac(APPS.editor, T("2026-11-09 14:23"), T("2026-11-09 14:40")),
  ];
  const r = report(events, "2026-11-09 00:00", "2026-11-14 00:00");
  const d = dataOf(r.repeat_offenders);
  assert.equal(d.days_with_focus, 5);
  assert.deepEqual(d.offenders, [
    {
      subject: { kind: "app", key: APPS.chat, name: "WhatsApp", category: "communication" },
      devices: ["mac"],
      disruptions: 5,
      minutes_lost: 10,
      days: 5,
      ended_stretches: 0,
    },
  ]);
  assert.equal(
    r.repeat_offenders.summary,
    "WhatsApp broke focus 5 times on 5 of 5 days with focus, 10 minutes in total.",
  );

  const oneDay = report(textbook("2026-11-10"), "2026-11-10 00:00", "2026-11-11 00:00").repeat_offenders;
  assert.equal(oneDay.data, null);
  assert.equal(
    oneDay.reason,
    "not enough data: no app or site disrupted focus on 2 or more days (1 disruption found)",
  );
});

test("a distractor that ends the stretch: counted, flagged, capped at the 10 minute limit", () => {
  const r = report(
    [
      mac(APPS.editor, T("2026-11-10 14:00"), T("2026-11-10 14:20")),
      mac(APPS.chat, T("2026-11-10 14:20"), T("2026-11-10 14:45")), // 25 minutes, no return
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  );
  const d = dataOf(r.focus_disruptions);
  assert.equal(d.stretches, 1);
  assert.equal(d.focus_minutes, 20);
  assert.equal(d.disruptions, 1);
  assert.equal(d.daily[0]?.ended_stretches, 1);
  const [item] = d.items;
  assert.equal(item?.ended_stretch, true);
  assert.equal(item?.minutes_lost, 10);
  assert.equal(item?.minutes_until_back, null);
  // It ended the stretch, so there is no return to measure.
  assert.equal(r.recovery_cost.data, null);
});

test("leaving work for something neutral is not a disruption", () => {
  const d = dataOf(
    report(
      [
        mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:20")),
        mac(APPS.unknown, T("2026-11-10 09:20"), T("2026-11-10 09:25")), // unknown app: never guessed
        mac(APPS.editor, T("2026-11-10 09:25"), T("2026-11-10 09:45")),
      ],
      "2026-11-10 00:00",
      "2026-11-11 00:00",
    ).focus_disruptions,
  );
  assert.equal(d.disruptions, 0);
  assert.equal(d.focus_minutes, 45);
  assert.equal(d.longest_uninterrupted_minutes, 45);
});

test("an idle gap or a dark screen ends a stretch", () => {
  // Two 10 minute sittings 3 minutes apart: neither reaches 15 minutes, so there is no focus.
  const apart = report(
    [
      mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:10")),
      mac(APPS.editor, T("2026-11-10 09:13"), T("2026-11-10 09:23")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  ).focus_disruptions;
  assert.equal(apart.data, null);
  assert.equal(
    apart.reason,
    "not enough data: no focus stretch of at least 15 minutes and no planned goal block in 1 day of usage",
  );

  // One minute apart: one stretch of 21 minutes.
  const close = dataOf(
    report(
      [
        mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:10")),
        mac(APPS.editor, T("2026-11-10 09:11"), T("2026-11-10 09:21")),
      ],
      "2026-11-10 00:00",
      "2026-11-11 00:00",
    ).focus_disruptions,
  );
  assert.equal(close.stretches, 1);
  assert.equal(close.focus_minutes, 21);

  // An hour in the editor with the screen dark from 09:20 to 09:40: two stretches of 20 minutes.
  const dark = dataOf(
    report(
      [
        mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 10:00")),
        screenOff(T("2026-11-10 09:20"), T("2026-11-10 09:40")),
      ],
      "2026-11-10 00:00",
      "2026-11-11 00:00",
    ).focus_disruptions,
  );
  assert.equal(dark.stretches, 2);
  assert.equal(dark.focus_minutes, 40);
  assert.equal(dark.longest_uninterrupted_minutes, 20);
});

test("a stretch must be dominated by work apps", () => {
  // 4 minutes of editor around 16 minutes in an unknown app, twice: work holds 12 of 44 minutes.
  const r = report(
    [
      mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:04")),
      mac(APPS.unknown, T("2026-11-10 09:04"), T("2026-11-10 09:12")),
      mac(APPS.editor, T("2026-11-10 09:12"), T("2026-11-10 09:16")),
      mac(APPS.unknown, T("2026-11-10 09:16"), T("2026-11-10 09:24")),
      mac(APPS.editor, T("2026-11-10 09:24"), T("2026-11-10 09:28")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  );
  assert.equal(r.focus_disruptions.data, null);
});

test("a phone pick up during Mac work is a disruption, and says what opened it", () => {
  const d = dataOf(
    report(
      [
        mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 10:00")), // the Mac never left the editor
        phone(APPS.social, T("2026-11-10 09:30"), T("2026-11-10 09:33"), "notification"),
      ],
      "2026-11-10 00:00",
      "2026-11-11 00:00",
    ).focus_disruptions,
  );
  assert.equal(d.disruptions, 1);
  const [item] = d.items;
  assert.equal(item?.device, "iphone");
  assert.equal(item?.trigger.name, "Instagram");
  assert.equal(item?.opened_by_notification, true);
  assert.equal(item?.minutes_lost, 3);
  assert.equal(item?.minutes_until_back, 3);
  assert.equal(d.longest_uninterrupted_minutes, 30);
});

test("Mac: a notification from the app in the minute before marks it as opened by notification", () => {
  const events = [...textbook("2026-11-10"), macNotification(APPS.chat, T("2026-11-10 09:29:40"))];
  const d = dataOf(report(events, "2026-11-10 00:00", "2026-11-11 00:00").focus_disruptions);
  assert.equal(d.items[0]?.opened_by_notification, true);

  const late = [...textbook("2026-11-10"), macNotification(APPS.chat, T("2026-11-10 08:00"))];
  const d2 = dataOf(report(late, "2026-11-10 00:00", "2026-11-11 00:00").focus_disruptions);
  assert.equal(d2.items[0]?.opened_by_notification, false);
});

// ---------- with a calendar ----------

const WORK = goal("work", "10000000-0000-4000-8000-000000000001");
const GYM = goal("gym", "10000000-0000-4000-8000-000000000002");

test("calendar mode: a switch to a distractor inside a planned work block", () => {
  const block = calendar("Deep work", T("2026-11-10 10:00"), T("2026-11-10 11:00"), { goal_id: WORK.id });
  const r = report(
    [
      block,
      mac(APPS.editor, T("2026-11-10 10:00"), T("2026-11-10 10:20")),
      mac(APPS.chat, T("2026-11-10 10:20"), T("2026-11-10 10:25")),
      mac(APPS.editor, T("2026-11-10 10:25"), T("2026-11-10 11:00")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
    { goals: [WORK, GYM] },
  );
  const d = dataOf(r.focus_disruptions);
  assert.equal(r.inputs.goal_blocks, 1);
  assert.equal(d.mode, "calendar");
  assert.equal(d.blocks, 1);
  assert.equal(d.disruptions, 1);
  assert.equal(d.focus_minutes, 55);
  assert.equal(d.longest_uninterrupted_minutes, 35);
  const [item] = d.items;
  assert.equal(item?.mode, "calendar");
  assert.equal(item?.block_event_id, block.id);
  assert.equal(item?.goal_id, WORK.id);
  assert.equal(item?.minutes_lost, 5);
  assert.equal(item?.minutes_until_back, 5);
});

test("calendar mode: the block is matched by title, and work is off purpose in a gym block", () => {
  const r = report(
    [
      calendar("Gym: legs", T("2026-11-10 18:00"), T("2026-11-10 19:00")),
      phone(APPS.social, T("2026-11-10 18:10"), T("2026-11-10 18:20"), "home_screen"),
      mac(APPS.editor, T("2026-11-10 18:30"), T("2026-11-10 18:40")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
    { goals: [WORK, GYM] },
  );
  const d = dataOf(r.focus_disruptions);
  assert.deepEqual(
    d.items.map((i) => [i.trigger.name, i.goal_id, i.minutes_lost, i.opened_by_notification]).reverse(),
    [
      ["Instagram", GYM.id, 10, false],
      ["VS Code", GYM.id, 10, null],
    ],
  );
});

test("calendar mode: meetings with other people and blocks without a goal are not focus blocks", () => {
  const r = report(
    [
      calendar("Work: sync", T("2026-11-10 10:00"), T("2026-11-10 11:00"), { attendees: 3 }),
      calendar("Dentist", T("2026-11-10 12:00"), T("2026-11-10 13:00")),
      mac(APPS.chat, T("2026-11-10 10:10"), T("2026-11-10 10:20")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
    { goals: [WORK] },
  );
  assert.equal(r.inputs.goal_blocks, 0);
  assert.equal(r.focus_disruptions.data, null);
});

test("a planned block owns its time: the same switch is not counted again by the inferred mode", () => {
  const r = report(
    [
      calendar("Focus", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 10:20")), // starts an hour before the block
      mac(APPS.chat, T("2026-11-10 10:20"), T("2026-11-10 10:25")),
      mac(APPS.editor, T("2026-11-10 10:25"), T("2026-11-10 11:00")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
    { goals: [WORK] },
  );
  const d = dataOf(r.focus_disruptions);
  assert.equal(d.mode, "mixed");
  assert.equal(d.stretches, 1); // 09:00 to 10:00, outside the block
  assert.equal(d.disruptions, 1);
  assert.equal(d.items[0]?.mode, "calendar");
  assert.equal(d.focus_minutes, 115); // 60 before the block + 55 of work inside it
});

// ---------- drift ----------

test("drift: travel browsing inside a focus stretch, with the search that started it by id only", () => {
  const term = "cheap flights to somewhere private";
  const query = search(term, T("2026-11-10 09:30:10"));
  const visit = web("www.skyscanner.net", T("2026-11-10 09:30:30"), T("2026-11-10 09:37:30"));
  const r = report(
    [
      mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:30")),
      mac(APPS.browser, T("2026-11-10 09:30"), T("2026-11-10 09:38")),
      query,
      visit,
      mac(APPS.editor, T("2026-11-10 09:38"), T("2026-11-10 10:00")),
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  );
  const d = dataOf(r.drift);
  assert.equal(d.minutes, 7);
  assert.deepEqual(d.by_category, [{ category: "travel", minutes: 7, visits: 1, days: 1 }]);
  assert.deepEqual(d.items, [
    {
      day: "2026-11-10",
      start_at: "2026-11-10T07:30:30.000Z",
      site: { kind: "site", key: "skyscanner.net", name: "skyscanner.net", category: "travel" },
      minutes: 7,
      during: "focus_stretch",
      search_event_id: query.id,
      event_id: visit.id,
    },
  ]);
  assert.deepEqual(r.drift.evidence, [visit.id, query.id]);
  assert.equal(
    r.drift.summary,
    "7 minutes of off task browsing during focus on 1 day with focus: travel 7 minutes.",
  );
  // The term and the page title never leave the events table.
  const text = JSON.stringify(r);
  assert.equal(text.includes(term), false);
  assert.equal(text.includes("A page title"), false);

  // The same visit is also a disruption: 7 minutes on the site, and 7.5 minutes from the moment
  // the site came up (09:30:30) until the editor is back (09:38).
  const [item] = dataOf(r.focus_disruptions).items;
  assert.equal(item?.trigger.key, "skyscanner.net");
  assert.equal(item?.minutes_lost, 7);
  assert.equal(item?.minutes_until_back, 7.5);
});

test("drift: work browsing is not drift, and no browsing data means no answer", () => {
  const base = [
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:30")),
    mac(APPS.browser, T("2026-11-10 09:30"), T("2026-11-10 09:38")),
    mac(APPS.editor, T("2026-11-10 09:38"), T("2026-11-10 10:00")),
  ];
  const none = report(base, "2026-11-10 00:00", "2026-11-11 00:00").drift;
  assert.equal(none.data, null);
  assert.equal(none.reason, "not enough data: no browsing data in this range");

  const work = report(
    [...base, web("github.com", T("2026-11-10 09:30"), T("2026-11-10 09:38"))],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
  );
  assert.equal(dataOf(work.drift).minutes, 0);
  assert.equal(
    work.drift.summary,
    "No travel, shopping, video, social or news browsing during focus on 1 day with focus.",
  );
  // A listed work site keeps the stretch whole: 60 minutes of focus and no disruption.
  assert.equal(dataOf(work.focus_disruptions).disruptions, 0);
  assert.equal(dataOf(work.focus_disruptions).longest_uninterrupted_minutes, 60);
});

test("drift inside a planned work block", () => {
  const r = report(
    [
      calendar("Work: write", T("2026-11-10 10:00"), T("2026-11-10 11:00")),
      web("www.youtube.com", T("2026-11-10 10:10"), T("2026-11-10 10:22"), "extension"),
      web("www.youtube.com", T("2026-11-10 12:00"), T("2026-11-10 12:30"), "extension"), // after the block: free time
    ],
    "2026-11-10 00:00",
    "2026-11-11 00:00",
    { goals: [WORK] },
  );
  const d = dataOf(r.drift);
  assert.equal(d.minutes, 12);
  assert.equal(d.items[0]?.during, "work_block");
  assert.equal(d.items.length, 1);
});

test("passing through an app for under 3 seconds is neither a disruption nor a return to work", () => {
  const d = dataOf(
    report(
      [
        mac(APPS.editor, T("2026-11-10 09:00:00"), T("2026-11-10 09:20:00")),
        mac(APPS.chat, T("2026-11-10 09:20:00"), T("2026-11-10 09:20:02")), // 2 s on the way past
        mac(APPS.editor, T("2026-11-10 09:20:02"), T("2026-11-10 09:40:00")),
        // A real check, then a 1 s flash of the terminal, then the finder, then the editor.
        mac(APPS.chat, T("2026-11-10 09:40:00"), T("2026-11-10 09:41:00")),
        mac(APPS.terminal, T("2026-11-10 09:41:00"), T("2026-11-10 09:41:01")),
        mac(APPS.finder, T("2026-11-10 09:41:01"), T("2026-11-10 09:43:00")),
        mac(APPS.editor, T("2026-11-10 09:43:00"), T("2026-11-10 10:00:00")),
      ],
      "2026-11-10 00:00",
      "2026-11-11 00:00",
    ).focus_disruptions,
  );
  assert.equal(d.disruptions, 1);
  const [item] = d.items;
  assert.equal(item?.minutes_lost, 1);
  // The 1 second in the terminal does not end the disruption: work resumes at 09:43.
  assert.equal(item?.end_at, "2026-11-10T07:43:00.000Z");
  assert.equal(item?.minutes_until_back, 3);
  assert.equal(d.longest_uninterrupted_minutes, 40);
});

test("the focus summary says so when most screen time has no category", () => {
  const events = [
    mac(APPS.editor, T("2026-11-10 09:00"), T("2026-11-10 09:30")),
    mac(APPS.browser, T("2026-11-10 12:00"), T("2026-11-10 13:00")), // no page data: unknown
  ];
  const r = report(events, "2026-11-10 00:00", "2026-11-11 00:00");
  assert.equal(dataOf(r.focus_disruptions).uncategorised_share, 0.67);
  assert.equal(
    r.focus_disruptions.summary,
    "0 disruptions a day during focus, 0 seconds a day in the apps that caused them. Longest uninterrupted stretch: 30 minutes on a typical day with focus, 30 minutes at best. 67% of screen time is in apps and sites with no category (a browser without page data counts as unknown), so focus is under counted.",
  );
});
