import { readFileSync } from "node:fs";
import { sleepScore } from "@michael/shared";
import { addDays, athensMidnight, DEMO_TZ, iso, localDate, weekday } from "./time";
import {
  DEMO_DAYS,
  DEMO_PREFIX,
  DEVICE,
  type EventRow,
  formatMinutes,
  seeded,
  slug,
  stableUuid,
} from "./week";

// The weeks before this one: history for the stage account, so the pattern engine has months of
// one person to learn from. 77 days before the seven of demo/week.ts, twelve weeks in all.
//
// week.ts stays the source for the last seven days. These older days are lighter, a few dozen
// events each: the night with its stages and score, recovery, resting heart rate and heart rate
// variability, the workout, his recurring blocks and the day's meetings, the stretches on the
// Mac and the phone that matter (the working day, the phone inside the first goal block, the
// evening and the phone in bed) and meals.
//
// What is measured and what is worked out:
//   - history-facts.json holds Manolis' own numbers per day, read from this Mac and reduced to
//     dates, minutes, clock times, counts, and the names of well known apps and sites: Chrome
//     (from 17 August), Claude Code, the Mac's and the iPhone's Screen Time (from mid October)
//     and the calendar's meeting load. Where a day has them, the day is built from them: minutes
//     after 23:00 on the phone and the Mac, the hours on the Mac, AI coding time, meetings.
//   - Where a day has no number, one is drawn inside his measured range.
//   - The body's answer is worked out from a small model with noise (`night`, `body`, `focus`
//     below), so the relations are there to be found and never perfect: about one time in five
//     the usual consequence does not follow, and about one day in eight nothing holds.
//
// Everything is a pure function of the date, so a day reads the same whenever it is built and
// whichever days are built with it. External ids start with "demo:past:", so the one reseed of
// demo/sync.ts covers them and no id can collide with the week's.

/** Days of history before the week of demo/week.ts. */
export const HISTORY_DAYS = 77;
/** Every history event's external_id starts with this (and so with DEMO_PREFIX). */
export const HISTORY_PREFIX = `${DEMO_PREFIX}past:`;
/** True for an event of the stage account's history. */
export const isDemoHistory = (e: { external_id?: string | null }) =>
  !!e.external_id?.startsWith(HISTORY_PREFIX);
/** Under this many minutes asleep a night is short (6h 40). */
export const SHORT_NIGHT_MINUTES = 400;
/** The slow trend is counted in weeks before this Monday (the pitch). */
const TREND_ANCHOR = "2026-11-16";

const MIN = 60_000;
const HOUR = 60 * MIN;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const hm = (clock: string) => {
  const [h = 0, m = 0] = clock.split(":").map(Number);
  return h * 60 + m;
};

const clockFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEMO_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const clockOf = (ms: number) => clockFmt.format(ms);

/**
 * The instant of a wall clock minute of a local date. Minutes past 1440 run into the next day
 * (1500 is 01:00). Right on the two days a year the clock changes too.
 */
function wall(date: string, minutes: number): number {
  const day = addDays(date, Math.floor(minutes / 1440));
  const m = ((minutes % 1440) + 1440) % 1440;
  const t = athensMidnight(day) + m * MIN;
  let off = m - hm(clockOf(t));
  if (off > 720) off -= 1440;
  if (off < -720) off += 1440;
  return t + off * MIN;
}

// ---------- his own numbers ----------

interface Facts {
  chrome?: { min: number; first: string; last: string; late_min: number; sites: Record<string, number> };
  ai?: { min: number; stretches: number; first: string; last: string; late_min: number };
  mac?: {
    min: number;
    opens: number;
    first: string;
    last: string;
    late_min: number;
    apps: Record<string, number>;
  };
  phone?: {
    min: number;
    opens: number;
    first: string;
    last: string;
    late_min: number;
    late_opens: number;
    block_min: number;
    block_opens: number;
    apps: Record<string, number>;
  };
  calendar?: { meetings: number; meeting_min: number; own_blocks: number; own_min: number };
}

let factsCache: Record<string, Facts> | null = null;
function facts(): Record<string, Facts> {
  factsCache ??= JSON.parse(readFileSync(new URL("./history-facts.json", import.meta.url), "utf8")) as Record<
    string,
    Facts
  >;
  return factsCache;
}

/** Which of his own sources a history day was built from, for the report and the tests. */
export function measuredSources(date: string): string[] {
  const f = facts()[date];
  return f ? Object.keys(f) : [];
}

// ---------- the plan: his recurring blocks ----------

interface Planned {
  title: string;
  from: number;
  to: number;
  /** Number of other people; 0 means his own block. */
  attendees: number;
  location?: string;
  fixed?: boolean;
  /** University teaching: only while the term runs. */
  term?: boolean;
  /** A block of the company goal with work on the Mac in it. */
  work?: "outreach" | "desk";
  training?: boolean;
}
const block = (title: string, from: string, to: string, rest: Partial<Planned> = {}): Planned => ({
  title,
  from: hm(from),
  to: hm(to),
  attendees: 0,
  ...rest,
});

// By weekday (0 Sunday): the same recurring blocks as the week of demo/week.ts, at the times his
// own calendar holds them. Saturday is free.
const PLAN: Record<number, Planned[]> = {
  1: [
    block("Weekly sync", "09:30", "10:00", { attendees: 1, location: "Google Meet" }),
    block("Meeting Preparation", "11:00", "12:30", { work: "desk" }),
    block("Φροντιστήριο", "17:00", "19:00", { location: "University", fixed: true, term: true }),
    block("Gym", "20:30", "22:30", { location: "Gym", training: true }),
  ],
  2: [
    block("Cold Outreach / Sales", "10:30", "12:00", { work: "outreach" }),
    block("Lecture: Pricing Strategy", "14:00", "16:00", {
      attendees: 40,
      location: "University",
      term: true,
    }),
    block("Swimming", "20:00", "21:30", { location: "Gym", training: true }),
  ],
  3: [
    block("Weekly marketing material", "10:30", "12:00", { work: "desk" }),
    block("Study", "14:00", "16:00", { term: true }),
    block("Yoga", "19:00", "20:00", { training: true }),
  ],
  4: [
    block("Cold Outreach / Sales", "10:30", "12:00", { work: "outreach" }),
    block("Φροντιστήριο", "17:00", "19:00", { location: "University", fixed: true, term: true }),
    block("Gym", "20:30", "22:30", { location: "Gym", training: true }),
  ],
  5: [
    block("Run", "08:30", "09:30", { training: true }),
    block("Cold Outreach / Sales", "10:30", "12:00", { work: "outreach" }),
    block("Lecture: Accounting II", "12:30", "14:00", { attendees: 40, location: "University", term: true }),
    block("Meeting Preparation", "16:00", "16:45", { work: "desk" }),
  ],
  6: [],
  0: [block("Rhefuel", "09:00", "10:30", { training: true })],
};

/** The university's teaching weeks: early October to late January, late February to early June. */
function inTerm(date: string): boolean {
  const md = date.slice(5);
  return md >= "10-05" || md <= "01-20" || (md >= "02-20" && md <= "06-10");
}

interface Training {
  name: string;
  from: string;
  to: string;
  kcal: number;
  avg: number;
  max: number;
  km?: number;
  /** Strength work: hard enough to cost deep sleep when it ends late. */
  hard?: boolean;
}
// As demo/week.ts, a few weeks earlier: Friday is still a run (the bike came with the sore knee).
const TRAINING: Record<number, Training> = {
  1: {
    name: "Traditional Strength Training",
    from: "20:42",
    to: "22:10",
    kcal: 520,
    avg: 118,
    max: 162,
    hard: true,
  },
  2: { name: "Pool Swim", from: "20:06", to: "21:22", kcal: 610, avg: 132, max: 158, km: 2.4 },
  3: { name: "Yoga", from: "19:04", to: "19:58", kcal: 190, avg: 92, max: 121 },
  4: {
    name: "Traditional Strength Training",
    from: "20:38",
    to: "22:15",
    kcal: 560,
    avg: 121,
    max: 166,
    hard: true,
  },
  5: { name: "Outdoor Run", from: "08:38", to: "09:27", kcal: 540, avg: 151, max: 174, km: 8.2 },
  0: { name: "Outdoor Cycle", from: "09:12", to: "10:48", kcal: 980, avg: 138, max: 176, km: 41.6 },
};
const SATURDAY_RUN: Training = {
  name: "Outdoor Run",
  from: "10:05",
  to: "11:20",
  kcal: 760,
  avg: 146,
  max: 171,
  km: 12.6,
};
/** A workout that ends after this is a late one. */
const LATE_WORKOUT = hm("21:30");

const MEETING_TITLES = [
  "Customer call",
  "Team sync",
  "Client call",
  "Partner call",
  "Supplier call",
  "Product review",
  "Investor intro call",
  "Onboarding call",
] as const;
// Where a meeting can start, and never across one of his own blocks.
const MEETING_STARTS = ["09:00", "12:15", "13:15", "15:00", "16:15", "17:15", "18:15", "14:15"].map(hm);

// ---------- what drives a day (measured, or drawn in his range) ----------

interface Workout {
  plan: Training;
  from: number;
  to: number;
  /** Ended after 21:30 and hard. */
  lateHard: boolean;
  /** Done before noon. */
  morning: boolean;
}

interface Drivers {
  date: string;
  /** 0 Sunday. */
  wd: number;
  workday: boolean;
  /** One day in eight is ordinary: nothing follows from anything. */
  ordinary: boolean;
  meetings: number;
  /** Three or more calendar entries with other people. */
  heavy: boolean;
  /** The training block of the day as it sits on the calendar (moved earlier on some gym days). */
  trainingBlock: Planned | null;
  workout: Workout | null;
  /** Minutes of AI coding in the day, and after 23:00. */
  aiMin: number;
  aiLate: number;
  /** Minutes on the Mac after 23:00. */
  macLate: number;
  /** Minutes on the phone from 20:00 to 23:00, and after 23:00 (in bed). */
  eveningPhone: number;
  latePhone: number;
}

const driversCache = new Map<string, Drivers>();
function drivers(date: string): Drivers {
  const hit = driversCache.get(date);
  if (hit) return hit;
  const f = facts()[date];
  const rnd = seeded(`past:day:${date}`);
  // Drawn up front, so tuning one rule never moves another.
  const u = Array.from({ length: 20 }, () => rnd.next());
  const d = (i: number) => u[i] ?? 0;
  const wd = weekday(date);
  const workday = wd >= 1 && wd <= 5;
  const ordinary = d(0) < 0.12;

  let meetings = 0;
  if (f?.calendar) meetings = f.calendar.meetings;
  else if (workday) {
    // His calendar holds none to five a working day, two on most.
    const share = [0.14, 0.44, 0.68, 0.84, 0.95, 1];
    meetings = share.findIndex((s) => d(1) < s);
  }
  // Heavy: three or more calendar entries with other people, a lecture among them in term.
  const taught = (PLAN[wd] ?? []).filter((b) => b.attendees > 0 && b.term && inTerm(date)).length;
  const heavy = meetings + taught >= 3;

  // Training: the gym evenings sometimes move earlier, and now and then a session is skipped.
  const planned = (PLAN[wd] ?? []).find((b) => b.training) ?? null;
  const plan = TRAINING[wd];
  let trainingBlock = planned;
  let workout: Workout | null = null;
  if (planned && plan) {
    const skipped = d(2) < (plan.hard ? 0.1 : 0.07);
    const early = plan.hard && !skipped && d(2) < 0.32;
    if (early) trainingBlock = { ...planned, from: hm("19:15"), to: hm("20:45") };
    if (!skipped) {
      const shift = early ? hm("19:22") - hm(plan.from) : 0;
      const from = hm(plan.from) + shift + Math.floor(d(3) * 7) - 3;
      const to = hm(plan.to) + shift + Math.floor(d(4) * 9) - 4 - (early ? 8 : 0);
      workout = { plan, from, to, lateHard: !!plan.hard && to > LATE_WORKOUT, morning: to < hm("12:00") };
    }
  }

  // About every other Saturday, a long run with no block on the calendar.
  if (wd === 6 && d(2) < 0.5) {
    const from = hm("10:05") + Math.floor(d(3) * 20);
    workout = {
      plan: SATURDAY_RUN,
      from,
      to: from + 68 + Math.floor(d(4) * 14),
      lateHard: false,
      morning: true,
    };
  }

  // AI coding and the Mac after 23:00: his own minutes where measured.
  let aiMin: number;
  let aiLate: number;
  let macLate: number;
  if (f) {
    macLate = Math.min(150, f.mac?.late_min ?? f.chrome?.late_min ?? 0);
    aiMin = Math.min(300, f.ai?.min ?? 0);
    // Transcripts written with nobody at the Mac are agents working alone, not a late night.
    aiLate = Math.min(120, f.ai?.late_min ?? 0, macLate);
  } else {
    aiMin = workday
      ? d(5) < 0.2
        ? 0
        : Math.round(40 + d(6) * 200)
      : d(5) < 0.6
        ? 0
        : Math.round(20 + d(6) * 80);
    aiLate = d(7) < (workday ? 0.16 : 0.08) ? Math.round(30 + d(8) * 70) : 0;
    macLate = aiLate + (d(9) < 0.15 ? Math.round(10 + d(10) * 30) : 0);
  }

  // The phone in the evening: longer after a heavy meeting day, four times in five.
  let eveningPhone = Math.round(16 + d(11) * 26);
  if (wd === 0) eveningPhone = Math.round(12 + d(11) * 70);
  if (wd === 6) eveningPhone = Math.round(15 + d(11) * 45);
  if (heavy && d(12) >= 0.2) eveningPhone += Math.round(22 + d(13) * 14);
  if (ordinary) eveningPhone = Math.round(10 + d(11) * 55);

  // The phone after 23:00: his own minutes where Screen Time has them, else in his range
  // (about every second night runs past half an hour).
  const latePhone = f?.phone
    ? Math.min(160, f.phone.late_min)
    : d(14) < 0.5 + (eveningPhone >= 50 ? 0.12 : 0)
      ? Math.round(26 + d(15) * 72)
      : Math.round(d(15) * 12);

  const out: Drivers = {
    date,
    wd,
    workday,
    ordinary,
    meetings,
    heavy,
    trainingBlock,
    workout,
    aiMin,
    aiLate,
    macLate,
    eveningPhone,
    latePhone,
  };
  driversCache.set(date, out);
  return out;
}

// ---------- the model: night, body, focus ----------

interface Span {
  from: number;
  to: number;
  app: string;
}

const PHONE_APPS: Record<string, string> = {
  Instagram: "com.burbn.instagram",
  TikTok: "com.zhiliaoapp.musically",
  Netflix: "com.netflix.Netflix",
  YouTube: "com.google.ios.youtube",
};
const MAC_APPS: Record<string, string> = {
  "VS Code": "com.microsoft.VSCode",
  Chrome: "com.google.Chrome",
  WhatsApp: "net.whatsapp.WhatsApp",
  Claude: "com.anthropic.claudefordesktop",
};

/** Which app a phone stretch is: his own mix of the day where measured, else his usual one. */
function phoneApp(date: string, roll: number): string {
  const own = facts()[date]?.phone?.apps ?? {};
  const weights = Object.keys(PHONE_APPS).map((name) => own[name] ?? 0);
  const usual = [60, 15, 12, 13];
  const w = weights.some((x) => x > 0) ? weights : usual;
  let left = roll * w.reduce((a, b) => a + b, 0);
  for (const [i, name] of Object.keys(PHONE_APPS).entries()) {
    left -= w[i] ?? 0;
    if (left <= 0) return name;
  }
  return "Instagram";
}

/**
 * After 23:00 on a date, in minutes from that date's midnight: the Mac first, then the phone in
 * bed. `end` is when the last screen went dark, or null on a night without one.
 */
function lateEvening(date: string): { mac: Span[]; phone: Span[]; end: number | null } {
  const dr = drivers(date);
  const rnd = seeded(`past:late:${date}`);
  let t = 23 * 60 + rnd.int(0, 8);
  const mac: Span[] = [];
  const phone: Span[] = [];
  let left = dr.macLate;
  while (left >= 3) {
    const len = Math.min(left, rnd.int(35, 70));
    mac.push({ from: t, to: t + len, app: dr.aiLate >= 10 || rnd.next() < 0.5 ? "VS Code" : "Chrome" });
    t += len;
    left -= len;
  }
  if (mac.length) t += rnd.int(2, 6);
  left = dr.latePhone;
  while (left >= 1) {
    const len = Math.min(left, rnd.int(6, 24));
    phone.push({ from: t, to: t + len, app: phoneApp(date, rnd.next()) });
    t += len;
    left -= len;
    if (left >= 1 && rnd.next() < 0.3) t += rnd.int(1, 3);
  }
  return { mac, phone, end: mac.length || phone.length ? t : null };
}

/** A usual wake up by weekday, minutes after midnight: earlier before Friday's run. */
const WAKE: Record<number, number> = { 1: 470, 2: 472, 3: 474, 4: 470, 5: 452, 6: 530, 0: 488 };

export interface Night {
  /** The morning it ends on. */
  date: string;
  bed: number;
  wake: number;
  asleep: number;
  deep: number;
  rem: number;
  awake: number;
  inBed: number;
  score: number;
}

const nightCache = new Map<string, Night>();
/**
 * The night that ends on `date`. Phone minutes after 23:00 push bed back and take deep sleep; a
 * late hard workout takes deep sleep too; a morning workout gives a little back; a late night of
 * AI coding moves the alarm. One night in five the phone costs nothing; one in ten is rough for
 * no reason anyone could name.
 */
export function night(date: string): Night {
  const hit = nightCache.get(date);
  if (hit) return hit;
  const prev = addDays(date, -1);
  const p = drivers(prev);
  const late = lateEvening(prev);
  const rnd = seeded(`past:night:${date}`);
  const u = Array.from({ length: 10 }, () => rnd.next());
  const d = (i: number) => u[i] ?? 0;
  const wd = weekday(date);

  let bedMin =
    late.end !== null ? late.end + 4 + Math.floor(d(0) * 15) : 23 * 60 + 22 + Math.floor(d(0) * 36);
  let wakeMin = (WAKE[wd] ?? 480) + Math.floor(d(1) * 30) - 10;
  // Friday and Saturday evenings often end late with no screen in it, and the morning moves with
  // them: a late bedtime that costs nothing.
  if ((p.wd === 5 || p.wd === 6) && d(8) < 0.55) {
    const later = Math.max(0, 24 * 60 + 20 + Math.floor(d(9) * 60) - bedMin);
    bedMin += later;
    wakeMin += later;
  }
  // After a late night of AI coding the morning starts later (not before a morning workout).
  if (p.aiLate >= 30 && wd !== 5 && wd !== 0) wakeMin += 30 + Math.floor(d(2) * 20);
  if (bedMin > 1440 + 75) wakeMin += 15;
  wakeMin = Math.max(wakeMin, bedMin - 1440 + 270);
  // Up in time for a morning workout, whatever the night was.
  const upBy: Record<number, number> = { 5: hm("07:55"), 6: hm("09:15"), 0: hm("08:27") };
  wakeMin = Math.min(wakeMin, upBy[wd] ?? wakeMin);

  let phone = clamp((p.latePhone - 12) / 33, 0, 1);
  if (d(3) < 0.2) phone *= 0.15;
  if (p.ordinary) phone = 0;
  const rough = d(4) < 0.1;
  const lateHard = !!p.workout?.lateHard;

  const inBed = wakeMin + 1440 - bedMin;
  const awake = Math.round(20 + d(5) * 10 + 12 * phone + (lateHard ? 3 : 0) + (rough ? 10 : 0));
  const asleep = inBed - awake;
  const deepShare =
    0.154 +
    (d(6) - 0.5) * 0.022 -
    0.04 * phone -
    (lateHard ? 0.022 : 0) +
    (p.workout?.morning ? 0.012 : 0) -
    (rough ? 0.03 : 0);
  const remShare = 0.2 + (d(7) - 0.5) * 0.03 - 0.02 * phone - (p.macLate >= 45 ? 0.01 : 0);
  const deep = Math.round(asleep * Math.max(0.08, deepShare));
  const rem = Math.round(asleep * remShare);
  const out: Night = {
    date,
    bed: wall(prev, bedMin),
    wake: wall(date, wakeMin),
    asleep,
    deep,
    rem,
    awake,
    inBed,
    // The one rule every reader uses for a night without a score (sleepScore in @michael/shared),
    // so the 77 days and the week's own nights read on one scale.
    score: sleepScore({ duration_min: asleep, deep_min: deep, rem_min: rem, awake_min: awake }) ?? 0,
  };
  nightCache.set(date, out);
  return out;
}

/** Weeks before the pitch, 0 to 16: the slow trend runs on this. */
const weeksBefore = (date: string) =>
  clamp(
    (Date.parse(`${TREND_ANCHOR}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / (7 * 86_400_000),
    0,
    16,
  );

export interface Body {
  recovery: number;
  hrv: number;
  resting: number;
  /** This night and the one before were both short. */
  twoShort: boolean;
}

/**
 * The morning after: a low sleep score lowers recovery and heart rate variability and raises the
 * resting heart rate; two short nights in a row hit harder than one. Over the weeks of training
 * the resting heart rate drifts down and the variability up.
 */
export function body(date: string): Body {
  const n = night(date);
  const before = night(addDays(date, -1));
  const rnd = seeded(`past:body:${date}`);
  const [a = 0, b = 0, c = 0] = [rnd.next(), rnd.next(), rnd.next()];
  const twoShort = n.asleep < SHORT_NIGHT_MINUTES && before.asleep < SHORT_NIGHT_MINUTES;
  const w = weeksBefore(date);
  // On an ordinary day the body reads as if the night had been a usual one.
  const score = drivers(date).ordinary ? 80 + (a - 0.5) * 16 : n.score;
  const lateHard = !!drivers(addDays(date, -1)).workout?.lateHard;
  return {
    recovery: clamp(
      Math.round(64 + 1.45 * (score - 85) - (twoShort ? 9 : 0) - (lateHard ? 3 : 0) + (a - 0.5) * 10),
      8,
      97,
    ),
    hrv: Math.round(63 - 0.45 * w + 0.55 * (score - 85) - (twoShort ? 5 : 0) + (b - 0.5) * 6),
    resting: Math.round(51.8 + 0.25 * w - 0.16 * (score - 85) + (twoShort ? 2 : 0) + (c - 0.5) * 2),
    twoShort,
  };
}

export interface Focus {
  /** His first block of the company goal that day. */
  block: Planned;
  /** Minutes after the block's start before the Mac shows work. */
  delay: number;
  /** Minutes of the block that went to the phone, and how often it was picked up. */
  lost: number;
  opens: number;
}

/**
 * The first goal block of a working day. After a low sleep score more of it goes to the phone, in
 * more opens (four times in five); after two short nights more still. It starts late after a late
 * night of AI coding, and on a Monday after a long Sunday evening on the phone.
 */
export function focus(date: string): Focus | null {
  const dr = drivers(date);
  const first = (PLAN[dr.wd] ?? []).find((b) => b.work);
  if (!dr.workday || !first) return null;
  const rnd = seeded(`past:focus:${date}`);
  const u = Array.from({ length: 8 }, () => rnd.next());
  const d = (i: number) => u[i] ?? 0;
  const n = night(date);
  const before = drivers(addDays(date, -1));
  const low = clamp((84 - n.score) / 14, 0, 1.3);

  let delay = Math.floor(d(0) * 6);
  if (before.aiLate >= 30 && d(1) >= 0.2) delay += 22 + Math.floor(d(2) * 14);
  if (dr.wd === 1 && before.eveningPhone >= 50 && d(3) >= 0.2)
    delay += 14 + Math.round((before.eveningPhone - 50) * 0.4);

  let lost = 5 + d(4) * 6 + (d(5) < 0.2 ? 0 : 12 * low) + (body(date).twoShort ? 6 : 0);
  if (dr.ordinary) lost = 4 + d(4) * 20;
  lost = Math.round(Math.min(lost, (first.to - first.from - delay) * 0.55));
  return { block: first, delay, lost, opens: Math.max(1, Math.round(lost / 2.1 + d(6) * 2)) };
}

// ---------- events ----------

const id = (date: string, rest: string) => `${HISTORY_PREFIX}${date}:${rest}`;

function appUsage(date: string, device: "mac" | "iphone", app: string, from: number, to: number): EventRow {
  const bundle = device === "mac" ? MAC_APPS[app] : PHONE_APPS[app];
  return {
    source: device === "mac" ? "macos_usage" : "iphone_usage",
    type: "app_usage",
    start_at: iso(from),
    end_at: iso(to),
    title: app,
    data: { bundle_id: bundle, device, seconds: Math.round((to - from) / 1000) },
    external_id: id(date, `${device}:${iso(from).slice(11, 19)}`),
  };
}

function calendarEvent(date: string, b: Planned): EventRow {
  return {
    source: "google_calendar",
    type: "calendar_event",
    start_at: iso(wall(date, b.from)),
    end_at: iso(wall(date, b.to)),
    title: b.title,
    data: {
      calendar: "primary",
      attendees: b.attendees,
      ...(b.location ? { location: b.location } : {}),
      ...(b.fixed ? { fixed: true } : {}),
      status: "confirmed",
      all_day: false,
    },
    external_id: id(date, `calendar:${slug(b.title)}:${String(b.from).padStart(4, "0")}`),
  };
}

/** The day's calendar: his blocks (teaching only in term) and its meetings, clear of each other. */
function dayPlan(date: string): Planned[] {
  const dr = drivers(date);
  const own = (PLAN[dr.wd] ?? [])
    .filter((b) => !b.term || inTerm(date))
    .map((b) => (b.training && dr.trainingBlock ? dr.trainingBlock : b));
  const rnd = seeded(`past:plan:${date}`);
  const real = facts()[date]?.calendar;
  // The weekly sync is one of Monday's meetings.
  let wanted = dr.meetings - own.filter((b) => b.attendees > 0 && !b.term).length;
  const each =
    real && real.meetings > 0 ? clamp(Math.round(real.meeting_min / real.meetings / 15) * 15, 15, 60) : 0;
  const taken = own.map((b) => ({ from: b.from - 5, to: b.to + 5 }));
  const starts = [...MEETING_STARTS].sort(() => rnd.next() - 0.5);
  const titles = [...MEETING_TITLES].sort(() => rnd.next() - 0.5);
  const meetings: Planned[] = [];
  for (const from of starts) {
    if (wanted <= 0) break;
    const to = from + (each || rnd.pick([30, 30, 45, 60]));
    if (taken.some((t) => from < t.to && to > t.from)) continue;
    taken.push({ from: from - 5, to: to + 5 });
    meetings.push({
      title: titles[meetings.length % titles.length] ?? "Customer call",
      from,
      to,
      attendees: rnd.int(2, 4),
      location: rnd.pick(["Google Meet", "Zoom", "Google Meet"]),
    });
    wanted--;
  }
  return [...own, ...meetings].sort((a, b) => a.from - b.from);
}

function workoutEvent(date: string, w: Workout): EventRow {
  const rnd = seeded(`past:workout:${date}`);
  const start = wall(date, w.from);
  const end = wall(date, w.to);
  const minutes = Math.round((end - start) / MIN);
  const km = w.plan.km ? Math.round(w.plan.km * (0.92 + rnd.next() * 0.16) * 10) / 10 : undefined;
  return {
    source: "health_auto_export",
    type: "workout",
    start_at: iso(start),
    end_at: iso(end),
    title: [`${w.plan.name} ${formatMinutes(minutes)}`, km ? `${km} km` : null].filter(Boolean).join(", "),
    data: {
      name: w.plan.name,
      duration_min: minutes,
      active_kcal: Math.round(w.plan.kcal * (0.92 + rnd.next() * 0.16)),
      ...(km ? { distance: km, distance_units: "km" } : {}),
      avg_hr: w.plan.avg + rnd.int(-4, 4),
      max_hr: w.plan.max + rnd.int(-4, 4),
      device: DEVICE,
    },
    external_id: id(date, "workout"),
  };
}

/** The night and the morning's readings, in the shapes the watch's webhook writes. */
function nightEvents(date: string): EventRow[] {
  const n = night(date);
  const b = body(date);
  const rnd = seeded(`past:readings:${date}`);
  const lastHour = Math.floor((n.wake - 1) / HOUR) * HOUR;
  const metric = (
    name: string,
    label: string,
    units: string,
    value: { min: number; avg: number; max: number },
  ) => ({
    source: "health_auto_export" as const,
    type: "biometric" as const,
    start_at: iso(lastHour),
    end_at: iso(lastHour + HOUR),
    title: `${label} ${value.avg} ${units}${value.min !== value.max ? `, ${value.min} to ${value.max}` : ""}`,
    data: { metric: name, units, samples: value.min === value.max ? 1 : rnd.int(2, 5), ...value },
    external_id: id(date, `${name}:${iso(lastHour).slice(0, 13)}`),
  });
  return [
    {
      source: "health_auto_export",
      type: "sleep",
      start_at: iso(n.bed),
      end_at: iso(n.wake),
      title: `Sleep ${formatMinutes(n.asleep)}`,
      data: {
        duration_min: n.asleep,
        deep_min: n.deep,
        rem_min: n.rem,
        core_min: n.asleep - n.deep - n.rem,
        awake_min: n.awake,
        in_bed_min: n.inBed,
        device: DEVICE,
        score: n.score,
      },
      external_id: id(date, "sleep"),
    },
    {
      source: "health_auto_export",
      type: "recovery",
      start_at: iso(n.wake + 6 * MIN),
      end_at: null,
      title: `Recovery ${b.recovery}%`,
      data: { recovery_pct: b.recovery, hrv_ms: b.hrv, resting_hr: b.resting },
      external_id: id(date, "recovery"),
    },
    metric("heart_rate_variability", "HRV", "ms", {
      min: b.hrv - rnd.int(8, 15),
      avg: b.hrv,
      max: b.hrv + rnd.int(10, 22),
    }),
    metric("resting_heart_rate", "Resting heart rate", "bpm", {
      min: b.resting,
      avg: b.resting,
      max: b.resting,
    }),
  ];
}

const LUNCHES = [
  "Lunch: chicken, rice and greek salad",
  "Lunch: souvlaki and salad",
  "Lunch: lentil soup and feta",
  "Lunch: tuna pasta",
  "Lunch: omelette and toast",
] as const;
const DINNERS = [
  "Dinner: salmon and potatoes",
  "Dinner: beef burger",
  "Dinner: chicken and vegetables",
] as const;

/** Lunch every day, dinner on the evenings without the gym, as in the week. */
function meals(date: string): { rows: EventRow[]; lunch: number } {
  const rnd = seeded(`past:meals:${date}`);
  const wd = weekday(date);
  // Clear of Friday's lecture (12:30 to 14:00).
  const lunch = wd === 5 && inTerm(date) ? hm("14:05") + rnd.int(0, 15) : hm("13:10") + rnd.int(0, 40);
  const rows: EventRow[] = [
    {
      source: "manual",
      type: "meal",
      start_at: iso(wall(date, lunch)),
      end_at: iso(wall(date, lunch + 30)),
      title: rnd.pick(LUNCHES),
      data: { estimated_kcal: rnd.int(650, 950), protein_g: rnd.int(30, 55) },
      external_id: id(date, "meal:lunch"),
    },
  ];
  // Dinner: after yoga on a Wednesday, before the swim on a Tuesday, and on the gym evenings once
  // he is back (the week logs none then; over months he eats after training).
  const gym = wd === 1 || wd === 4;
  const trained = drivers(date).workout;
  const from = gym
    ? trained
      ? trained.to + 15 + rnd.int(0, 10)
      : hm("19:40") + rnd.int(0, 30)
    : wd === 3
      ? hm("20:15") + rnd.int(0, 30)
      : wd === 2
        ? hm("18:40") + rnd.int(0, 25)
        : hm("19:30") + rnd.int(0, 60);
  rows.push({
    source: "manual",
    type: "meal",
    start_at: iso(wall(date, from)),
    end_at: iso(wall(date, from + (gym ? 25 : 35))),
    title: rnd.pick(DINNERS),
    data: { estimated_kcal: rnd.int(700, 1200), protein_g: rnd.int(25, 50) },
    external_id: id(date, "meal:dinner"),
  });
  return { rows, lunch };
}

const SITE_TITLES: Record<string, [title: string, category: string]> = {
  "mail.google.com": ["Mail", "mail"],
  "claude.ai": ["AI tool", "ai"],
  "github.com": ["Developer site", "dev"],
  "youtube.com": ["Video site", "video"],
  "linkedin.com": ["Social site", "social"],
  "facebook.com": ["Social site", "social"],
  "instagram.com": ["Social site", "social"],
};

const SESSION_TITLE = "Claude Code session";

/** Free minutes of [from, to) outside `busy`, as spans of at least `least` minutes. */
function gaps(from: number, to: number, busy: { from: number; to: number }[], least: number) {
  const out: { from: number; to: number }[] = [];
  let cursor = from;
  for (const b of [...busy].sort((x, y) => x.from - y.from)) {
    if (b.from - cursor >= least) out.push({ from: cursor, to: Math.min(b.from, to) });
    cursor = Math.max(cursor, b.to);
    if (cursor >= to) break;
  }
  if (to - cursor >= least) out.push({ from: cursor, to });
  return out.filter((g) => g.to - g.from >= least);
}

/** The Mac and the phone through one day: the working day, the first block, the evening, bed. */
function deviceEvents(date: string, plan: Planned[], lunch: number): EventRow[] {
  const dr = drivers(date);
  const f = facts()[date];
  const fo = focus(date);
  const n = night(date);
  const rnd = seeded(`past:devices:${date}`);
  const out: EventRow[] = [];
  const at = (minutes: number) => wall(date, minutes);
  const mac = (app: string, from: number, to: number) =>
    out.push(appUsage(date, "mac", app, at(from), at(to)));
  const wakeMin = hm(clockOf(n.wake));

  // Away from the Mac: other people, teaching, training, lunch.
  const away = [
    ...plan
      .filter((b) => !b.work && !(b.title === "Study"))
      .map((b) => ({ from: b.from - 10, to: b.to + 10 })),
    ...(dr.workout ? [{ from: dr.workout.from - 15, to: dr.workout.to + 15 }] : []),
    { from: lunch - 2, to: lunch + 32 },
  ];

  // The first goal block: work on the Mac from a little after its start, the phone in between.
  if (fo) {
    const { block: b, delay, lost, opens } = fo;
    const start = b.from + delay;
    const room = b.to - start - 6;
    const each = (lost * 60) / opens;
    let cursor = at(start);
    for (let i = 0; i < opens; i++) {
      // Spread through the block, each at its own moment.
      const slot = start + 3 + (room * (i + 0.15 + rnd.next() * 0.6)) / opens;
      const from = Math.max(at(slot), cursor + 60_000);
      const to = from + Math.max(20, Math.round(each * (0.7 + rnd.next() * 0.6))) * 1000;
      if (to >= at(b.to)) break;
      mac(b.work === "outreach" ? "WhatsApp" : "VS Code", (cursor - at(0)) / MIN, (from - at(0)) / MIN);
      out.push(appUsage(date, "iphone", rnd.next() < 0.8 ? "Instagram" : "TikTok", from, to));
      cursor = to;
    }
    mac(b.work === "outreach" ? "WhatsApp" : "VS Code", (cursor - at(0)) / MIN, b.to);
    away.push({ from: b.from - 2, to: b.to + 2 });
  }

  // The rest of the working day, compact: his own hours on the Mac where measured.
  const own = f?.mac ?? f?.chrome;
  const first = own ? hm(own.first) : null;
  const last = own ? hm(own.last) : null;
  const dayStart = Math.max(
    wakeMin + 25,
    first !== null && first >= 5 * 60 ? first : dr.workday ? hm("09:35") : hm("11:30"),
  );
  const dayEnd =
    last !== null && last >= 15 * 60 && last <= 22 * 60 + 45
      ? last
      : hm(dr.workday ? "19:10" : "18:00") + rnd.int(0, 50);
  let budget = own
    ? Math.min(own.min, 480)
    : dr.workday
      ? rnd.int(230, 400)
      : rnd.next() < 0.5
        ? 0
        : rnd.int(20, 110);
  budget -= fo ? fo.block.to - fo.block.from - fo.delay : 0;
  budget -= dr.macLate;
  const work: { from: number; to: number }[] = [];
  for (const g of gaps(dayStart, Math.max(dayStart, dayEnd), away, 20)) {
    let t = g.from + rnd.int(0, 4);
    while (budget >= 15 && g.to - t >= 15 && work.length < 9) {
      const len = Math.min(budget, g.to - t, rnd.int(35, 75));
      const app = rnd.pick(["Chrome", "VS Code", "Chrome", "VS Code", "Claude"]);
      mac(app, t, t + len);
      work.push({ from: t, to: t + len });
      budget -= len;
      t += len + rnd.int(4, 12);
    }
  }

  // AI coding sessions run beside the work, and into the night when the Mac did.
  const late = lateEvening(date);
  const session = (from: number, to: number, key: string) =>
    out.push({
      source: "claude_code",
      type: "ai_session",
      start_at: iso(at(from)),
      end_at: iso(at(to)),
      title: SESSION_TITLE,
      data: {
        tool: "claude_code",
        session_id: stableUuid(`past:session:${date}:${key}`),
        model: "claude-opus-5-5",
        turns: Math.max(1, Math.round((to - from) / 9)),
        waiting_seconds: 0,
      },
      external_id: id(date, `ai:${key}`),
    });
  let ai = dr.aiMin - dr.aiLate;
  for (const [i, w] of work.entries()) {
    if (ai < 10 || i >= 3) break;
    const len = Math.min(ai, w.to - w.from);
    session(w.from, w.from + len, `day${i}`);
    ai -= len;
  }
  const lateMac = late.mac[0];
  if (dr.aiLate >= 10 && lateMac) session(lateMac.from, lateMac.from + dr.aiLate, "late");

  // The sites he was on most, where Chrome's history has the day.
  const sites = Object.entries(f?.chrome?.sites ?? {})
    .filter(([host, minutes]) => SITE_TITLES[host] && minutes >= 10)
    .slice(0, 2);
  for (const [i, [host, minutes]] of sites.entries()) {
    const w = work[i + 1] ?? work[i];
    const [title, category] = SITE_TITLES[host] ?? ["Website", "other"];
    if (!w) break;
    const seconds = Math.min(minutes, w.to - w.from) * 60;
    out.push({
      source: "chrome",
      type: "web_visit",
      start_at: iso(at(w.from)),
      end_at: iso(at(w.from) + seconds * 1000),
      title,
      data: { host, category, seconds, foreground: true, origin: "history" },
      external_id: id(date, `web:${host}`),
    });
  }

  // The phone: a scroll over lunch, the evening from 20:00 (around training), then bed.
  const phone = (app: string, from: number, to: number) =>
    out.push(appUsage(date, "iphone", app, at(from), at(to)));
  phone(phoneApp(date, rnd.next()), lunch + 4, lunch + 4 + rnd.int(5, 13));
  let evening = dr.eveningPhone;
  // Never inside the training block or the workout: the phone is in the bag.
  const training = [
    ...(dr.trainingBlock ? [{ from: dr.trainingBlock.from - 2, to: dr.trainingBlock.to + 2 }] : []),
    ...(dr.workout ? [{ from: dr.workout.from - 12, to: dr.workout.to + 14 }] : []),
  ];
  for (const g of gaps(hm("20:00") + rnd.int(0, 6), hm("22:57"), training, 6)) {
    let t = g.from;
    while (evening >= 3 && g.to - t >= 4) {
      const len = Math.min(evening, g.to - t, rnd.int(8, 22));
      phone(phoneApp(date, rnd.next()), t, t + len);
      evening -= len;
      t += len + rnd.int(1, 6);
    }
  }
  for (const s of late.mac) mac(s.app, s.from, s.to);
  for (const s of late.phone) phone(s.app, s.from, s.to);
  return out;
}

// ---------- the history ----------

export interface DemoHistory {
  /** Athens local dates covered, oldest first; the last one is the day before the week starts. */
  days: string[];
  events: EventRow[];
}

const dayCache = new Map<string, EventRow[]>();
/** Every event of one history day, the night that ended on it included. */
export function historyDay(date: string): EventRow[] {
  // A day never changes, and the stage account is refreshed every five minutes: built once.
  let rows = dayCache.get(date);
  if (!rows) {
    const dr = drivers(date);
    const plan = dayPlan(date);
    const food = meals(date);
    rows = [
      ...nightEvents(date),
      ...plan.map((b) => calendarEvent(date, b)),
      ...(dr.workout ? [workoutEvent(date, dr.workout)] : []),
      ...food.rows,
      ...deviceEvents(date, plan, food.lunch),
    ];
    dayCache.set(date, rows);
  }
  return rows.map((e) => ({ ...e, data: { ...e.data } }));
}

/**
 * The 77 Athens days before the week of buildDemoWeek(now), oldest first. All of it has already
 * happened. The last day stops at 22:30, or seven days before `now` when that is earlier: the
 * night after it belongs to the week, which places it from its own screens, and whatever reads
 * "the last seven days" to the minute finds only the week there, as before.
 */
export function buildDemoHistory(now: Date = new Date()): DemoHistory {
  const today = localDate(now.getTime());
  const first = addDays(today, -(DEMO_DAYS - 1) - HISTORY_DAYS);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(first, i));
  const last = days.at(-1) as string;
  const cut = Math.min(wall(last, hm("22:30")), now.getTime() - DEMO_DAYS * 24 * HOUR);
  const events: EventRow[] = [];
  for (const day of days) {
    for (const e of historyDay(day)) {
      if (day === last && Date.parse(e.end_at ?? e.start_at) > cut) continue;
      events.push(e);
    }
  }
  events.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return { days, events };
}
