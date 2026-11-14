import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { EventInput, Goal } from "@michael/shared";
import type { z } from "zod";
import { addDays, at, athensMidnight, iso, localDate, weekday } from "./time";

// The demo account's week: a believable seven days for a founder at a hackathon, ending now.
//
// The device lanes (Mac, iPhone, Chrome, Claude Code) are Manolis' real anonymised days (PR #111,
// compacted into templates.json by scripts/build-demo-templates.mjs), replayed onto this week's
// dates, a little shifted and thinned so no two days look the same. Around them we generate what
// the real days lack, in the shapes the ingest webhooks produce: Apple Watch sleep, workouts and
// heart rate (Health Auto Export), Google Calendar (his own recurring blocks from the Build Hub
// entry "goals-manolis" plus meetings with other people), conversation summaries (Omi, meetings
// mode only) and a few meals.
//
// Everything is deterministic for a given date, so regenerating later the same day yields the same
// events (same external ids) plus whatever has happened since. Nothing after `now` is produced,
// except calendar events, which are planned ahead to the end of the current Monday to Sunday week.
// No real private names: titles are generic or the user's own block names.

export type EventRow = z.output<typeof EventInput>;

/** Every demo event's external_id starts with this, so a reseed only ever touches its own rows. */
export const DEMO_PREFIX = "demo:";
export const DEMO_DAYS = 7;

// ---------- deterministic randomness ----------

function seeded(key: string) {
  let a = createHash("sha256").update(key).digest().readUInt32LE(0);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T,
  };
}

/** A stable uuid (v4 layout) for a string, so the in-memory store's ids survive regeneration. */
export function stableUuid(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  const variant = ((Number.parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------- the real day templates ----------

type TemplateRow = [number, number | null, string, string, string, Record<string, unknown>];
type TemplateDay = "2026-10-29" | "2026-11-01" | "2026-11-12" | "2026-11-14";

let templateCache: Record<TemplateDay, TemplateRow[]> | null = null;
function templates() {
  templateCache ??= JSON.parse(readFileSync(new URL("./templates.json", import.meta.url), "utf8")) as Record<
    TemplateDay,
    TemplateRow[]
  >;
  return templateCache;
}

interface DayPlan {
  /** The real day whose Mac, Chrome and Claude Code lanes are replayed. */
  base: TemplateDay;
  /** The real day whose iPhone lane is replayed (defaults to `base`). */
  phone?: TemplateDay;
  /** Minutes every replayed event moves by. */
  shift: number;
  /** Share of replayed events left out, so repeated templates differ. */
  thin: number;
}

// By weekday (0 Sunday). 29 Oct is the heavy phone, broken focus day; 12 Nov the full workday;
// 14 Nov the hackathon Saturday (no iPhone yet, so it borrows the light Sunday's phone).
const PLANS: Record<number, DayPlan> = {
  1: { base: "2026-10-29", shift: 0, thin: 0 },
  2: { base: "2026-11-12", shift: 0, thin: 0 },
  3: { base: "2026-11-12", shift: 35, thin: 0.12 },
  4: { base: "2026-10-29", shift: -25, thin: 0.1 },
  5: { base: "2026-11-12", shift: -30, thin: 0.15 },
  6: { base: "2026-11-14", phone: "2026-11-01", shift: 0, thin: 0 },
  0: { base: "2026-11-01", shift: 0, thin: 0 },
};

const SESSION_TITLES = [
  "Build the timeline view",
  "Score endpoint and goal matching",
  "Fix the Health Auto Export webhook",
  "Patterns: phone cadence detector",
  "Wire the MCP server tools",
  "Today screen polish",
  "Supabase migration for agents",
  "Pitch deck numbers from the API",
  "Refactor the collector cursor",
  "Debug the Railway deploy",
] as const;

/** The replayed device lanes of one date. */
function replayLanes(date: string): EventRow[] {
  const plan = PLANS[weekday(date)] as DayPlan;
  const rnd = seeded(`lanes:${date}`);
  const t = templates();
  const midnight = athensMidnight(date);
  const rows: { row: TemplateRow; from: TemplateDay; i: number }[] = [];
  t[plan.base].forEach((row, i) => {
    if (plan.phone && row[2] === "iphone_usage") return;
    rows.push({ row, from: plan.base, i });
  });
  if (plan.phone)
    t[plan.phone].forEach((row, i) => {
      if (row[2] === "iphone_usage") rows.push({ row, from: plan.phone as TemplateDay, i });
    });

  const sessionIds = new Map<string, { id: string; title: string }>();
  const session = (key: string) => {
    let s = sessionIds.get(key);
    if (!s) {
      s = { id: stableUuid(`session:${date}:${key}`), title: rnd.pick(SESSION_TITLES) };
      sessionIds.set(key, s);
    }
    return s;
  };

  const out: EventRow[] = [];
  for (const { row, from, i } of rows) {
    const [offset, duration, source, type, title, data] = row;
    // Thin out everything but Claude Code, whose prompts and sessions must stay consistent.
    if (plan.thin && source !== "claude_code" && rnd.next() < plan.thin) continue;
    const startOffset = offset + plan.shift * 60;
    if (startOffset < 0 || startOffset >= 86_400) continue;
    const start = midnight + startOffset * 1000;
    const out_data: Record<string, unknown> = { ...data };
    let outTitle = title;
    if (source === "claude_code" && typeof data.session_id === "string") {
      const s = session(`${from}:${data.session_id}`);
      out_data.session_id = s.id;
      out_data.project = "michael";
      if (type === "ai_session") outTitle = s.title;
    }
    out.push({
      source: source as EventRow["source"],
      type: type as EventRow["type"],
      start_at: iso(start),
      end_at: duration === null ? null : iso(start + duration * 1000),
      title: outTitle,
      data: out_data,
      external_id: `${DEMO_PREFIX}${date}:${from}:${i}`,
    });
  }
  return out;
}

// ---------- calendar ----------

interface Block {
  title: string;
  from: string;
  to: string;
  /** Number of other people; 0 means the user's own block. */
  attendees: number;
  location?: string;
}

// His own recurring blocks come from the Build Hub ("goals-manolis"); meetings are made up and
// carry no names. University has fewer planned hours than its budget: that is the story.
const CALENDAR: Record<number, Block[]> = {
  1: [
    { title: "Weekly sync", from: "09:30", to: "10:00", attendees: 1, location: "Google Meet" },
    { title: "Φροντιστήριο", from: "17:00", to: "19:00", attendees: 0 },
    { title: "Gym", from: "20:30", to: "22:30", attendees: 0 },
  ],
  2: [
    { title: "Cold Outreach / Sales", from: "10:30", to: "12:00", attendees: 0 },
    { title: "Lecture: Pricing Strategy", from: "14:00", to: "16:00", attendees: 40, location: "University" },
    { title: "Swimming", from: "20:00", to: "21:30", attendees: 0 },
  ],
  3: [
    { title: "Weekly marketing material", from: "10:30", to: "12:00", attendees: 0 },
    { title: "Investor intro call", from: "16:00", to: "16:30", attendees: 2, location: "Zoom" },
    { title: "Yoga", from: "19:00", to: "20:00", attendees: 0 },
  ],
  4: [
    { title: "Cold Outreach / Sales", from: "10:30", to: "12:00", attendees: 0 },
    { title: "Customer call", from: "15:00", to: "15:45", attendees: 3, location: "Google Meet" },
    { title: "Φροντιστήριο", from: "17:00", to: "19:00", attendees: 0 },
    { title: "Gym", from: "20:30", to: "22:30", attendees: 0 },
  ],
  5: [
    { title: "Run", from: "08:30", to: "09:30", attendees: 0 },
    { title: "Cold Outreach / Sales", from: "10:30", to: "12:00", attendees: 0 },
    { title: "Lecture: Accounting II", from: "12:30", to: "14:00", attendees: 40, location: "University" },
    { title: "Meeting Preparation", from: "16:00", to: "16:45", attendees: 0 },
  ],
  6: [
    { title: "Hackathon kickoff", from: "12:00", to: "13:00", attendees: 40, location: "Hackathon venue" },
    { title: "Mentor check in", from: "17:00", to: "17:30", attendees: 2, location: "Hackathon venue" },
  ],
  0: [
    { title: "Rhefuel", from: "09:00", to: "10:30", attendees: 0 },
    { title: "Finalists announced", from: "20:00", to: "21:00", attendees: 40, location: "Hackathon venue" },
  ],
};

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");

function calendar(date: string): EventRow[] {
  return (CALENDAR[weekday(date)] ?? []).map((b) => ({
    source: "google_calendar",
    type: "calendar_event",
    start_at: iso(at(date, b.from)),
    end_at: iso(at(date, b.to)),
    title: b.title,
    data: {
      calendar: "primary",
      attendees: b.attendees,
      ...(b.location ? { location: b.location } : {}),
      status: "confirmed",
      all_day: false,
    },
    external_id: `${DEMO_PREFIX}${date}:calendar:${slug(b.title)}`,
  }));
}

// ---------- Apple Watch (Health Auto Export) ----------

interface Workout {
  name: string;
  from: string;
  to: string;
  kcal: number;
  avg: number;
  max: number;
  km?: number;
}

// Matches the calendar, not perfectly: Friday's run became the bike (knee), Saturday is the hackathon.
const WORKOUTS: Record<number, Workout> = {
  1: { name: "Traditional Strength Training", from: "20:42", to: "22:10", kcal: 520, avg: 118, max: 162 },
  2: { name: "Pool Swim", from: "20:06", to: "21:22", kcal: 610, avg: 132, max: 158, km: 2.4 },
  3: { name: "Yoga", from: "19:04", to: "19:58", kcal: 190, avg: 92, max: 121 },
  4: { name: "Traditional Strength Training", from: "20:38", to: "22:15", kcal: 560, avg: 121, max: 166 },
  5: { name: "Indoor Cycle", from: "08:41", to: "09:32", kcal: 480, avg: 141, max: 171, km: 24.1 },
  0: { name: "Outdoor Cycle", from: "09:12", to: "10:48", kcal: 980, avg: 138, max: 176, km: 41.6 },
};

// Titles and `data` follow src/ingest/health-auto-export.ts exactly, so a demo event and a real
// one look the same to every screen; only the external id differs ("demo:" instead of "hae:").
const DEVICE = "Apple Watch";

/** "7h15m", "42m": as formatMinutes in src/ingest/common.ts (not imported: that module needs the store). */
const formatMinutes = (minutes: number) => {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

function workout(date: string): EventRow | null {
  const w = WORKOUTS[weekday(date)];
  if (!w) return null;
  const start = at(date, w.from);
  const end = at(date, w.to);
  const minutes = Math.round((end - start) / 60_000);
  return {
    source: "health_auto_export",
    type: "workout",
    start_at: iso(start),
    end_at: iso(end),
    title: [`${w.name} ${formatMinutes(minutes)}`, w.km ? `${w.km} km` : null].filter(Boolean).join(", "),
    data: {
      name: w.name,
      duration_min: minutes,
      active_kcal: w.kcal,
      ...(w.km ? { distance: w.km, distance_units: "km" } : {}),
      avg_hr: w.avg,
      max_hr: w.max,
      device: DEVICE,
    },
    external_id: `${DEMO_PREFIX}${date}:workout`,
  };
}

const HOUR = 3600_000;

/** One hourly bucket, as the Health Auto Export webhook stores a metric. */
function hourly(
  date: string,
  hour: number,
  metric: string,
  label: string,
  units: string,
  value: { min: number; avg: number; max: number } | { total: number },
  samples: number,
): EventRow {
  const unit = units && units !== "count" ? ` ${units}` : "";
  const title =
    "total" in value
      ? `${label} ${value.total.toLocaleString("en-GB")}${unit}`
      : `${label} ${value.avg}${unit}${value.min !== value.max ? `, ${value.min} to ${value.max}` : ""}`;
  return {
    source: "health_auto_export",
    type: "biometric",
    start_at: iso(hour),
    end_at: iso(hour + HOUR),
    title,
    data: { metric, units, samples, ...value },
    external_id: `${DEMO_PREFIX}${date}:${metric}:${iso(hour).slice(0, 13)}`,
  };
}

/**
 * The night that ends on `date`: in bed a few minutes after the last screen of the small hours
 * (or around 23:40 when the phone went quiet before midnight), up a little before the first screen
 * or workout of the morning.
 */
function sleepFor(date: string, lanes: EventRow[], train: EventRow | null) {
  const rnd = seeded(`sleep:${date}`);
  const midnight = athensMidnight(date);
  // Only apps in front count: background browser tabs stay open for hours.
  const used = lanes.filter((e) => e.type === "app_usage");
  const starts = used.map((e) => Date.parse(e.start_at));
  const lastLate = Math.max(...starts.filter((s) => s < midnight + 4.5 * 3600_000), -Infinity);
  const firstMorning = Math.min(
    ...starts.filter((s) => s >= midnight + 5 * 3600_000),
    train ? Date.parse(train.start_at) : Infinity,
    midnight + 10 * 3600_000,
  );
  const lateEnd = Math.max(
    ...used
      .filter((e) => Date.parse(e.start_at) === lastLate)
      .map((e) => (e.end_at ? Date.parse(e.end_at) : lastLate)),
    lastLate,
  );
  const bed = Number.isFinite(lastLate)
    ? lateEnd + rnd.int(4, 18) * 60_000
    : midnight - rnd.int(10, 35) * 60_000;
  const wake = firstMorning - rnd.int(12, 28) * 60_000;
  return { bed, wake, rnd };
}

function nightEvents(date: string, bed: number, wake: number, rnd: ReturnType<typeof seeded>): EventRow[] {
  const inBed = Math.round((wake - bed) / 60_000);
  const awake = rnd.int(12, 34);
  const asleep = inBed - awake;
  const deep = Math.round(asleep * (0.12 + rnd.next() * 0.06));
  const rem = Math.round(asleep * (0.19 + rnd.next() * 0.06));
  // Short nights cost HRV and push the resting heart rate up.
  const debt = Math.max(0, 450 - asleep) / 60;
  const hrv = Math.round(64 - debt * 6 + rnd.int(-4, 4));
  const resting = Math.round(51 + debt * 2 + rnd.int(-1, 2));
  // The watch writes HRV and resting heart rate in the night's last hour.
  const lastHour = Math.floor((wake - 1) / HOUR) * HOUR;
  return [
    {
      source: "health_auto_export",
      type: "sleep",
      start_at: iso(bed),
      end_at: iso(wake),
      title: `Sleep ${formatMinutes(asleep)}`,
      data: {
        duration_min: asleep,
        deep_min: deep,
        rem_min: rem,
        core_min: asleep - deep - rem,
        awake_min: awake,
        in_bed_min: inBed,
        device: DEVICE,
      },
      external_id: `${DEMO_PREFIX}${date}:sleep`,
    },
    hourly(
      date,
      lastHour,
      "heart_rate_variability",
      "HRV",
      "ms",
      { min: hrv - rnd.int(8, 15), avg: hrv, max: hrv + rnd.int(10, 22) },
      rnd.int(2, 5),
    ),
    hourly(
      date,
      lastHour,
      "resting_heart_rate",
      "Resting heart rate",
      "bpm",
      { min: resting, avg: resting, max: resting },
      1,
    ),
  ];
}

/** Hourly heart rate and the day's steps, from waking up to bed (or now). */
function dayBiometrics(
  date: string,
  wake: number,
  bed: number,
  train: EventRow | null,
  now: number,
): EventRow[] {
  const rnd = seeded(`hr:${date}`);
  const out: EventRow[] = [];
  const end = Math.min(bed, now);
  const trainFrom = train ? Date.parse(train.start_at) : 0;
  const trainTo = train?.end_at ? Date.parse(train.end_at) : 0;
  const trainAvg = (train?.data?.avg_hr as number | undefined) ?? 0;
  // Complete hours only, like the webhook.
  for (let h = Math.ceil(wake / HOUR) * HOUR; h + HOUR <= end; h += HOUR) {
    const training = train && h < trainTo && h + HOUR > trainFrom;
    const avg = training ? trainAvg - rnd.int(0, 10) : rnd.int(64, 82);
    const min = avg - rnd.int(8, 16);
    const max = avg + (training ? rnd.int(18, 30) : rnd.int(12, 30));
    out.push(hourly(date, h, "heart_rate", "Heart rate", "bpm", { min, avg, max }, rnd.int(8, 14)));
    const steps = training ? rnd.int(600, 4200) : rnd.int(150, 900);
    out.push(hourly(date, h, "step_count", "Steps", "count", { total: steps }, rnd.int(10, 30)));
  }
  return out;
}

// ---------- conversations, memories and meals ----------

function conversations(date: string): EventRow[] {
  const day = weekday(date);
  const convo = (
    from: string,
    to: string,
    title: string,
    summary: string,
    action_items: string[],
  ): EventRow => ({
    // Same shape as src/ingest/omi.ts (meetings mode: started by the user, summary only).
    source: "omi",
    type: "conversation",
    start_at: iso(at(date, from)),
    end_at: iso(at(date, to)),
    title,
    data: {
      summary,
      category: "work",
      action_items,
      action_items_done: 0,
      duration_min: Math.round((at(date, to) - at(date, from)) / 60_000),
    },
    external_id: `${DEMO_PREFIX}${date}:omi:${slug(title)}`,
  });
  // Notes the user typed into Michael themself.
  const memory = (time: string, title: string, category: string): EventRow => ({
    source: "manual",
    type: "note",
    start_at: iso(at(date, time)),
    end_at: null,
    title,
    data: { category },
    external_id: `${DEMO_PREFIX}${date}:note:${slug(title)}`,
  });
  if (day === 1)
    return [
      convo(
        "09:31",
        "09:58",
        "Weekly sync: priorities for the week",
        "Agreed the hackathon build comes first this week; outreach keeps its three blocks; no new features for existing pilots.",
        ["Send three outreach emails a day", "Book the venue for Saturday"],
      ),
    ];
  if (day === 4)
    return [
      convo(
        "15:02",
        "15:44",
        "Customer call: onboarding feedback",
        "The pilot team likes the weekly view but finds setup too long. They would pay for a one tap calendar connect.",
        ["Write up the onboarding steps they skipped", "Follow up with pricing by Monday"],
      ),
    ];
  if (day === 5) return [memory("09:40", "Knee still sore on runs; bike instead until it settles", "gym")];
  if (day === 6)
    return [
      convo(
        "13:05",
        "13:50",
        "Hackathon planning: scope for the demo",
        "One timeline from every source, the Claude connector as the headline moment, Apple Watch buzzing on stage.",
        ["Seed a realistic demo week", "Rehearse the pitch on Sunday evening"],
      ),
      memory("23:10", "Wants screens off by 23:00 after the hackathon", "rest"),
    ];
  return [];
}

const LUNCHES = [
  "Lunch: chicken, rice and greek salad",
  "Lunch: souvlaki and salad",
  "Lunch: lentil soup and feta",
  "Lunch: tuna pasta",
  "Lunch: omelette and toast",
] as const;
const DINNERS = ["Dinner: salmon and potatoes", "Dinner: beef burger", "Dinner: pizza at the venue"] as const;

function meals(date: string): EventRow[] {
  const rnd = seeded(`meals:${date}`);
  const day = weekday(date);
  const lunchAt = day === 6 ? "13:00" : `13:${String(rnd.int(10, 50)).padStart(2, "0")}`;
  const out: EventRow[] = [
    {
      source: "manual",
      type: "meal",
      start_at: iso(at(date, lunchAt)),
      end_at: iso(at(date, lunchAt) + 30 * 60_000),
      title: rnd.pick(LUNCHES),
      data: { estimated_kcal: rnd.int(650, 950), protein_g: rnd.int(30, 55) },
      external_id: `${DEMO_PREFIX}${date}:meal:lunch`,
    },
  ];
  if (day !== 1 && day !== 4) {
    const dinner = day === 6 ? DINNERS[2] : rnd.pick(DINNERS.slice(0, 2));
    out.push({
      source: "manual",
      type: "meal",
      start_at: iso(at(date, "19:30") + rnd.int(0, 90) * 60_000),
      end_at: iso(at(date, "20:05") + rnd.int(0, 90) * 60_000),
      title: dinner,
      data: { estimated_kcal: rnd.int(700, 1200), protein_g: rnd.int(25, 50) },
      external_id: `${DEMO_PREFIX}${date}:meal:dinner`,
    });
  }
  return out;
}

// ---------- the week ----------

export interface DemoWeek {
  /** Athens local dates covered, oldest first; the last one is today. */
  days: string[];
  events: EventRow[];
}

const overlapsAny = (e: EventRow, spans: { from: number; to: number }[]) => {
  const s = Date.parse(e.start_at);
  const end = e.end_at ? Date.parse(e.end_at) : s;
  return spans.some((x) => s < x.to && end > x.from);
};

/**
 * The demo week: the seven Athens days ending with today, filled up to `now`, with the calendar
 * planned to the end of this Monday to Sunday week.
 */
export function buildDemoWeek(now: Date = new Date()): DemoWeek {
  const nowMs = now.getTime();
  const today = localDate(nowMs);
  const days = Array.from({ length: DEMO_DAYS }, (_, i) => addDays(today, i - (DEMO_DAYS - 1)));
  const events: EventRow[] = [];

  // Lanes and workouts first: sleep is placed around them.
  const lanes = new Map(days.map((d) => [d, replayLanes(d)]));
  const trains = new Map(days.map((d) => [d, workout(d)]));
  const nights = days.map((d) => ({ date: d, ...sleepFor(d, lanes.get(d) ?? [], trains.get(d) ?? null) }));

  // A screen is never on while asleep or mid workout (the watch is on, the phone is in the bag).
  const quiet = [
    ...nights.map((n) => ({ from: n.bed, to: n.wake })),
    ...[...trains.values()].flatMap((w) =>
      w?.end_at ? [{ from: Date.parse(w.start_at), to: Date.parse(w.end_at) }] : [],
    ),
  ];

  days.forEach((date, i) => {
    const night = nights[i] as (typeof nights)[number];
    const nextBed = nights[i + 1]?.bed ?? at(date, "24:30");
    for (const e of lanes.get(date) ?? []) {
      // A "Screen off" spanning the night is consistent with sleep; everything else is dropped.
      const screenOff = e.type === "screen" && e.data?.state === "off";
      if (screenOff || !overlapsAny(e, quiet)) events.push(e);
    }
    const train = trains.get(date) ?? null;
    if (train) events.push(train);
    events.push(...nightEvents(date, night.bed, night.wake, night.rnd));
    events.push(...dayBiometrics(date, night.wake, nextBed, train, nowMs));
    events.push(...conversations(date), ...meals(date));
  });

  // Nothing from the future, and nothing still running: collectors send finished things.
  const past = events.filter((e) => Date.parse(e.end_at ?? e.start_at) <= nowMs);

  // The calendar is planned: this week's days to Sunday, plus the window's earlier days.
  const sunday = addDays(today, (7 - weekday(today)) % 7);
  const calendarDays = [...days];
  for (let d = addDays(today, 1); d <= sunday; d = addDays(d, 1)) calendarDays.push(d);
  past.push(...calendarDays.flatMap(calendar));

  past.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return { days, events: past };
}

// ---------- goals (Build Hub, "goals-manolis") ----------

const CREATED = "2026-11-09T00:00:00.000Z";
const goal = (n: number, g: Omit<Goal, "id" | "created_at" | "updated_at" | "active">): Goal => ({
  id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  active: true,
  created_at: CREATED,
  updated_at: CREATED,
  ...g,
});

// Ids 1 to 4 are the mock goals' ids (same categories), so the mock recommendations still point at
// a goal of the right kind. `calendar_titles` is how the score matches his own blocks to goals.
export const demoGoals: Goal[] = [
  goal(1, {
    category: "work",
    title: "The company",
    description: "Outreach, marketing and meeting preparation. Meetings with other people do not count.",
    target: {
      calendar_titles: ["Cold Outreach", "Weekly marketing material", "Meeting Preparation", "Call Leads"],
    },
    weekly_budget_minutes: 480,
  }),
  goal(2, {
    category: "gym",
    title: "70.3",
    description: "IRONMAN 70.3 in autumn 2027: gym, swim, yoga, run and the long ride.",
    target: { calendar_titles: ["Gym", "Swimming", "Yoga", "Run", "Rhefuel"] },
    weekly_budget_minutes: 540,
  }),
  goal(3, {
    category: "rest",
    title: "Sleep",
    description: "7h 30 a night, screens off by 23:00.",
    target: { sleep_hours: 7.5, screens_off_by: "23:00" },
    weekly_budget_minutes: 3150,
  }),
  goal(4, {
    category: "food",
    title: "Weight to 90 kg",
    description: "From 99 kg to about 90 kg while keeping muscle.",
    target: { weight_kg_from: 99, weight_kg_to: 90 },
    weekly_budget_minutes: null,
  }),
  goal(5, {
    category: "work",
    title: "University",
    description: "Eight exams from 1 to 18 December.",
    target: { calendar_titles: ["Study", "Φροντιστήριο"] },
    weekly_budget_minutes: 360,
  }),
];
