import {
  type Event,
  type Goal,
  isSleepGoal,
  LATE_PHONE_KEY,
  type Nudge,
  type NudgeTestTrigger,
  nudgeRuleKey,
  nudgeTrigger,
  PHONE_DRIFT_SUFFIX,
  voiceDuration,
} from "@michael/shared";
import type { LiveSignal } from "../ingest/phone-live";
import { phoneSessions } from "../patterns/cadence";
import { RULES as PATTERN_RULES } from "../patterns/context";
import { goalBlocks } from "../patterns/focus";
import { HOUR, MINUTE, SECOND } from "../patterns/time";
import { type AppUse, buildTimeline, parseAppUsage, preferRecord } from "../patterns/timeline";
import { type Span, union } from "../patterns/util";
import { isTrainingGoal } from "../score/purpose";
import type { Candidate, World } from "./engine";

// The two nudges that speak at the moment something happens (#438):
//
//   the phone inside a block   5 phone opens inside a running goal block. A second trigger of
//                              `focus_drift`, under the block's own key, so a block gets one drift
//                              nudge whether the Mac or the phone gave it away.
//   the phone before sleep     40 minutes of phone after the late cut off (23:00, or one hour
//                              before the usual bedtime, the rule of patterns/late.ts). A second
//                              trigger of `wind_down`, under its own key, once a night.
//
// Same kinds on purpose: one voice, one cap of 5 a day, no new column value on the day of the pitch.
// Pure, like the engine: the clock, the events and the live signals are passed in.
//
// What "opened" means. Where Apple's own log covers the hour (the Biome backfill, about a day
// behind) an open is a pick up, the rule Today already shows (patterns/cadence.ts). Otherwise, and
// so nearly always for the present, it is one run of the iPhone shortcut: an app the user chose
// came to the front. Opens less than 30 seconds apart count once (the same hand, moving between
// apps).

export const REALTIME = {
  /** The phone inside a block speaks from this many opens. */
  blockOpens: 5,
  /** Opens closer together than this are one. */
  openGapMs: PATTERN_RULES.sessionGapMs,
  /** The phone before sleep speaks from this much use after the cut off... */
  lateMinutes: 40,
  /** ...while the phone was in use this recently (never to a phone that was put down long ago). */
  lateRecentMs: 10 * MINUTE,
  lateCutoffMinutes: PATTERN_RULES.lateCutoffMinutes,
  nightLengthMinutes: PATTERN_RULES.nightLengthMinutes,
  /**
   * The app in front right now has no end yet (the shortcut only reports opens). It counts up to
   * now, but never longer than this: a phone put down without another open stops counting.
   */
  liveOpenMaxMs: 45 * MINUTE,
  /** The line before the night (wind_down) and the one inside it never land closer than this. */
  apartMs: 30 * MINUTE,
} as const;

/** What the route adds for these rules (nudges/realtime-io.ts). All optional: the rules still run on stored events. */
export interface RealtimeInput {
  /** The shortcut's signals of the last hours, oldest first. */
  live?: LiveSignal[];
  /** Keys of the nudges of last evening, so a night is nudged once on both sides of midnight. */
  earlierKeys?: string[];
  /** The start of the first goal block after tonight, ISO. */
  firstBlockAt?: string | null;
  /**
   * What Michael has learnt about each trigger, when he has (apps/api/src/insights). `line` is a
   * whole short sentence for the nudge ("It costs you 14 sleep points."), `reason` the evidence
   * ("held 9 of 11 times").
   */
  learnt?: { phone_block?: Learnt | null; late_phone?: Learnt | null };
  /** The stage's test nudge: one trigger, from the first open or the first minute, at any hour. */
  test?: RealtimeTrigger;
}

export interface Learnt {
  line?: string;
  reason: string;
}

export type RealtimeTrigger = NudgeTestTrigger;

// Which trigger a nudge is, read from its key (packages/shared: `nudgeTrigger`), never from its
// line: the copy can change, the key cannot.

/** The phone before sleep, among the `wind_down` nudges: its key is `late_phone:<night>`. */
export const isLatePhone = (n: { key: string }) =>
  nudgeTrigger({ kind: "wind_down", key: n.key }) === "late_phone";

/** The phone inside a block, among the `focus_drift` nudges: its key ends with `:phone`. */
export const isPhoneBlock = (n: { kind: string; key: string }) =>
  n.kind === "focus_drift" && nudgeTrigger({ kind: "focus_drift", key: n.key }) === "phone_block";

/**
 * The key a nudge is deduplicated by. Both drifts of a block (the Mac's `focus_drift:<event>` and
 * the phone's `focus_drift:<event>:phone`) share one, so a block gets one drift nudge.
 */
export const dedupeKey = (key: string): string => {
  const rule = nudgeRuleKey(key);
  return rule.startsWith("focus_drift:") && rule.endsWith(PHONE_DRIFT_SUFFIX)
    ? rule.slice(0, -PHONE_DRIFT_SUFFIX.length)
    : rule;
};

// ---------- the phone, live ----------

const iphone = (events: Event[], from: number, to: number): AppUse[] =>
  preferRecord(parseAppUsage(events).filter((u) => u.device === "iphone"))
    .kept.filter((u) => u.end > from && u.start <= to)
    .sort((a, b) => a.start - b.start);

/** Hours Apple's own log covers: there a live signal steps aside (the rule of `preferRecord`). */
const recordHours = (uses: AppUse[]): Set<number> => {
  const hours = new Set<number>();
  for (const u of uses) {
    if (u.backup) continue;
    for (let h = Math.floor(u.start / HOUR); h * HOUR < u.end; h++) hours.add(h);
  }
  return hours;
};

/** When the phone was opened inside [from, to], oldest first. The rule is at the top of the file. */
export function phoneOpens(events: Event[], live: LiveSignal[], from: number, to: number): number[] {
  const uses = iphone(events, from - HOUR, to);
  const covered = recordHours(uses);
  const starts = [
    ...phoneSessions(uses.filter((u) => !u.backup))
      .filter((s) => s.first !== null)
      .map((s) => s.start),
    ...uses.filter((u) => u.backup).map((u) => u.start),
    ...live.filter((s) => s.action === "open" && !covered.has(Math.floor(s.at / HOUR))).map((s) => s.at),
  ]
    .filter((t) => t >= from && t <= to)
    .sort((a, b) => a - b);
  const opens: number[] = [];
  for (const t of starts) {
    const last = opens[opens.length - 1];
    if (last === undefined || t - last >= REALTIME.openGapMs) opens.push(t);
  }
  return opens;
}

/**
 * Phone use inside [from, to] as spans, no overlaps: the stored app intervals (the same ones the
 * Timeline shows) plus the live signals. A live open lasts until the next signal; the last one has
 * no end yet, so it runs to `to`, capped (REALTIME.liveOpenMaxMs).
 */
export function phoneUse(events: Event[], live: LiveSignal[], from: number, to: number): Span[] {
  const spans: Span[] = buildTimeline(events, from, to).iphone.map((s) => ({ start: s.start, end: s.end }));
  const covered = recordHours(iphone(events, from, to));
  const signals = live.filter((s) => s.at <= to);
  signals.forEach((s, i) => {
    if (s.action !== "open" || covered.has(Math.floor(s.at / HOUR))) return;
    const next = signals[i + 1];
    const start = Math.max(s.at, from);
    const end = Math.min(next ? next.at : to, s.at + REALTIME.liveOpenMaxMs, to);
    if (end > start) spans.push({ start, end });
  });
  return union(spans);
}

// ---------- the phone inside a block ----------

/**
 * At most this many words name the block, so the line stays under 15 words: the goal's own title
 * when it is that short, else the block by its start, the way the voice sheet says it ("in the
 * 10:30 block").
 */
const NAME_WORDS = 3;
const blockName = (goal: Goal, start: string): string => {
  const words = goal.title
    .replace(/[-–—!]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.length <= NAME_WORDS ? words.join(" ") : `the ${start} block`;
};

const times = (n: number) => `${n} ${n === 1 ? "time" : "times"}`;

export function phoneInBlock(w: World): Candidate | null {
  const test = w.realtime.test === "phone_block";
  // Any goal's block but training: a phone on the gym floor is a timer and a playlist.
  const block = goalBlocks(w.events, w.goals, w.dayStart, w.dayEnd).find(
    (b) => !isTrainingGoal(b.goal) && b.start <= w.now && w.now < b.end,
  );
  if (!block) return null;
  const opens = phoneOpens(w.events, w.realtime.live ?? [], block.start, w.now);
  if (opens.length < (test ? 1 : REALTIME.blockOpens)) return null;
  const since = w.zone.clock(block.start);
  const until = w.zone.clock(block.end);
  const learnt = w.realtime.learnt?.phone_block;
  return {
    kind: "focus_drift",
    // The block's drift key plus the trigger: the engine dedupes both drifts of a block as one
    // (`dedupeKey`), so a block gets one drift nudge, from the Mac or from the phone.
    key: `focus_drift:${block.eventId}${PHONE_DRIFT_SUFFIX}`,
    goal_id: block.goal.id,
    // The voice sheet's own shape ("Your phone opened 9 times in the 10:30 block."), then the fix.
    // Do Not Disturb is the nudge's button, and what its tap offers on an iPhone (#447).
    text: `Your phone opened ${times(opens.length)} in ${blockName(block.goal, since)}. Put it down until ${until}.`,
    reason: [
      `Your phone opened ${times(opens.length)} since ${since}, the last at ${w.zone.clock(opens[opens.length - 1] as number)}; the block runs ${since} to ${until} for ${block.goal.title}.`,
      ...(learnt ? [learnt.reason] : []),
    ].join(" "),
  };
}

// ---------- the phone before sleep ----------

export interface Night {
  /** The local day the night's evening is on. */
  day: string;
  /** The late cut off, and the end of the night six hours later. */
  from: number;
  to: number;
  /** Where the cut off comes from, for the reason line. */
  source: "default" | "usual_bedtime";
}

/**
 * The night `now` is in, or null in the day. `bedtime`: the usual bedtime in minutes after midnight
 * (it may pass 1440), or null when too few nights are known; the cut off is an hour before it.
 */
export function nightOf(w: Pick<World, "now" | "zone" | "day">, bedtime: number | null): Night | null {
  const cutoff = bedtime === null ? REALTIME.lateCutoffMinutes : bedtime - 60;
  for (const day of [w.zone.nextDay(w.day, -1), w.day]) {
    const from = w.zone.at(day, cutoff);
    const to = from + REALTIME.nightLengthMinutes * MINUTE;
    if (w.now >= from && w.now < to) {
      return { day, from, to, source: bedtime === null ? "default" : "usual_bedtime" };
    }
  }
  return null;
}

/** Whole words under the engine's limit of 15, no dashes: the same check the engine runs. */
const fits = (text: string) => text.trim().split(/\s+/).length < 15 && !/[-–—!]/.test(text);

export function latePhone(w: World, bedtime: number | null): Candidate | null {
  const test = w.realtime.test === "late_phone";
  const real = nightOf(w, bedtime);
  // The stage's test: the last hour at least, so the line has a number at any hour.
  const night: Night | null = test
    ? {
        day: w.day,
        source: "default",
        to: w.now + SECOND,
        ...real,
        from: Math.min(real?.from ?? w.now, w.now - HOUR),
      }
    : real;
  if (!night) return null;
  const key = `${LATE_PHONE_KEY}${night.day}`;
  if (w.realtime.earlierKeys?.includes(key)) return null;
  const use = phoneUse(w.events, w.realtime.live ?? [], night.from, w.now);
  const first = use[0];
  const last = use[use.length - 1];
  if (!first || !last) return null;
  const minutes = Math.floor(use.reduce((a, s) => a + s.end - s.start, 0) / MINUTE);
  if (minutes < (test ? 1 : REALTIME.lateMinutes)) return null;
  if (!test && w.now - last.end > REALTIME.lateRecentMs) return null;

  const rest = w.goals.find((g) => g.category === "rest" || isSleepGoal(g)) ?? null;
  const since = w.zone.clock(first.start);
  const head = `${voiceDuration(minutes)} on your phone since ${since}. Stop here.`;
  const learnt = w.realtime.learnt?.late_phone;
  const firstBlock = w.realtime.firstBlockAt ? Date.parse(w.realtime.firstBlockAt) : Number.NaN;
  // What it costs, most concrete first; the first line that stays under 15 words is the nudge.
  const tails = [
    learnt?.line,
    Number.isFinite(firstBlock) ? `First block at ${w.zone.clock(firstBlock)}.` : undefined,
    rest ? "Sleep is a goal too." : undefined,
  ].filter((t): t is string => Boolean(t));
  const text = [...tails.map((t) => `${head} ${t}`), head].find(fits) ?? head;
  const cutoff = w.zone.clock(night.from);
  const why =
    night.source === "usual_bedtime"
      ? `an hour before your usual bedtime of ${w.zone.clock(night.from + HOUR)}`
      : "the late cut off";
  return {
    kind: "wind_down",
    key,
    goal_id: rest?.id ?? null,
    text,
    reason: [
      `${voiceDuration(minutes)} on your phone since ${cutoff}, ${why}; the last at ${w.zone.clock(last.end)}.`,
      ...(learnt ? [learnt.reason] : []),
    ].join(" "),
  };
}

// ---------- living with the other rules ----------

type Sent = Pick<Nudge, "key" | "created_at">;

/**
 * The line before the night ("Screens off by 22:00") and the line inside it never both land in
 * the same half hour: whichever went out first holds the other back.
 */
export function keepApart<C extends { key: string }>(fresh: C[], sent: Sent[], now: number): C[] {
  const recent = sent.filter((n) => now - Date.parse(n.created_at) < REALTIME.apartMs);
  const windDown = recent.some((n) => n.key === "wind_down");
  const late = recent.some(isLatePhone);
  return fresh.filter((c) => !(windDown && isLatePhone(c)) && !(late && c.key === "wind_down"));
}
