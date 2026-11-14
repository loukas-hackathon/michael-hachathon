import type { DayView } from "../day";

// SAMPLE DATA, not the user's. A Wednesday shaped like the demo user's week (the company, university,
// 70.3 training), built so every number adds up: planned goal time 310 minutes; at 15:20 spent 213,
// lost 47, 50 still ahead, so 82% of goal time so far. Replaced by real days as the endpoints land.

const d = (hhmm: string) => `2026-11-11T${hhmm}:00+02:00`;

export const sampleDay: DayView = {
  date: "2026-11-11",
  now: d("15:20"),
  moment: "today",
  sample: true,
  week: { scorePct: 64, line: "Thursday decides it." },
  blocks: [
    {
      id: "b1",
      goalId: "10000000-0000-4000-8000-000000000001",
      title: "The company",
      start: d("09:00"),
      end: d("11:00"),
      interruptions: [
        { at: d("09:42"), minutes: 4, what: "WhatsApp" },
        { at: d("10:31"), minutes: 5, what: "Mail" },
      ],
    },
    {
      id: "b2",
      goalId: "10000000-0000-4000-8000-000000000001",
      title: "The company",
      start: d("11:30"),
      end: d("12:30"),
      interruptions: [{ at: d("12:05"), minutes: 19, what: "Instagram" }],
    },
    {
      id: "b3",
      goalId: "10000000-0000-4000-8000-000000000005",
      title: "University",
      start: d("14:00"),
      end: d("15:30"),
      interruptions: [
        { at: d("14:12"), minutes: 2, what: "WhatsApp" },
        { at: d("14:31"), minutes: 11, what: "WhatsApp" },
        { at: d("14:50"), minutes: 2, what: "Instagram" },
        { at: d("15:02"), minutes: 1, what: "WhatsApp" },
        { at: d("15:09"), minutes: 2, what: "Safari" },
        { at: d("15:15"), minutes: 1, what: "WhatsApp" },
      ],
      movedEnd: d("15:41"),
    },
    {
      id: "b4",
      goalId: "10000000-0000-4000-8000-000000000002",
      title: "70.3 training",
      start: d("18:00"),
      end: d("18:40"),
      interruptions: [],
    },
  ],
  wonBackMinutes: 47,
  record: { tick: 21, line: "91%, your best Business week since you started. Do it again." },
  balance: {
    overall: 64,
    target: 65,
    areas: { business: 91, health: 63, personal: 12 },
    floors: { business: 50, health: 50, personal: 50 },
  },
  lead: {
    at: d("15:12"),
    insight: [
      { text: "Your phone opened " },
      { text: "every 21 minutes", strong: true },
      { text: " since 11:00." },
    ],
    evidence: {
      kind: "cadence",
      from: d("11:00"),
      to: d("15:20"),
      sessions: [
        "11:00",
        "11:19",
        "11:41",
        "12:00",
        "12:23",
        "12:41",
        "13:04",
        "13:26",
        "13:45",
        "14:08",
        "14:27",
        "14:49",
        "15:11",
      ].map(d),
      gapMinutes: 21,
    },
    fix: [
      { text: "I moved tomorrow's study block to " },
      { text: "09:00", strong: true },
      { text: ", before your phone wakes up." },
    ],
    action: { label: "Undo until 09:00", done: "Undone. Study stays at 14:00." },
  },
  nudge: {
    at: d("14:52"),
    channel: "watch",
    text: "WhatsApp took 11 minutes of your study block. I've pushed the end to 15:41.",
  },
};

/** Morning, sparse: the plan is set, the first block has just started. */
export const sampleMorning: DayView = {
  ...sampleDay,
  now: d("09:20"),
  moment: "morning",
  week: { scorePct: 61, line: "Thursday decides it." },
  wonBackMinutes: 0,
  lead: {
    at: d("07:24"),
    insight: [
      { text: "Today: " },
      { text: "3 hours", strong: true },
      { text: " on the company, " },
      { text: "90 minutes", strong: true },
      { text: " of study, a " },
      { text: "40 minute", strong: true },
      { text: " run at 18:00." },
    ],
    evidence: { kind: "none" },
    fix: [{ text: "Watch 11:00 to 13:00, that's where WhatsApp usually wins." }],
    action: null,
  },
  nudge: null,
};

/** Before the first block: nothing to score yet. */
export const sampleEarly: DayView = { ...sampleMorning, now: d("07:30") };

/** Evening, dense: the whole plan is in the past. */
export const sampleEvening: DayView = {
  ...sampleDay,
  now: d("21:40"),
  moment: "evening",
  week: { scorePct: 66, line: "Thursday decides it." },
  lead: {
    at: d("21:30"),
    insight: [
      { text: "We lost " },
      { text: "47 minutes", strong: true },
      { text: ", most of it between " },
      { text: "12:00 and 15:00", strong: true },
      { text: "." },
    ],
    evidence: { kind: "none" },
    fix: [
      { text: "Tomorrow the hardest work goes first, before your phone wakes up. " },
      { text: "Already moved.", strong: true },
    ],
    action: { label: "Undo until 09:00", done: "Undone. Tomorrow stays as planned." },
  },
};

/** No plan, no data: the first day. */
export const sampleEmpty: DayView = {
  ...sampleDay,
  blocks: [],
  wonBackMinutes: 0,
  lead: null,
  nudge: null,
};

/** A missed block: Michael names the cause and offers the smallest block that still counts (#167). */
export const sampleMissed: DayView = {
  ...sampleDay,
  record: null,
  lead: {
    at: d("15:31"),
    insight: [
      { text: "Meetings ate the study block. " },
      { text: "Take 25 minutes at 16:00.", strong: true },
      { text: " Still counts." },
    ],
    evidence: { kind: "none" },
    fix: [],
    action: null,
    recovery: { slotStart: d("16:00"), slotEnd: d("16:25"), undoUntil: d("16:00") },
  },
};
