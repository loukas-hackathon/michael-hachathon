import {
  type Event,
  FOCUS_EXTEND_MINUTES,
  FOCUS_MAX_MINUTES,
  type FocusActiveResponse,
  FocusEnd,
  FocusExtend,
  type FocusSession,
  FocusStart,
  type Goal,
  goalKind,
  type Nudge,
  type NudgeStatus,
  type Source,
} from "@michael/shared";
import {
  executeLiveBlock,
  executeRecommendation,
  resizeLiveBlock,
  undoRecommendation,
} from "../actions/calendar";
import { type LogVia, logTime, matchGoal, settleBlock } from "../actions/log";
import { guardMacApps } from "../actions/mac-apps";
import { runAsUser } from "../context";
import { HttpError, parse } from "../http";
import { primaryChannel } from "../nudges/channels";
import { DEFAULT_TIMEZONE } from "../patterns";
import { Zone } from "../patterns/time";
import { readProfile } from "../routes/profile";
import { goalBlockTitle, goalForEvent } from "../score/match";
import { type StoredFocusSession, store } from "../store";

// Focus now (#397): one tap turns an intention into protected time. Rules, in one place (the REST
// routes, the chat tool and the MCP tool all come through here):
//   - one active session per user (per demo visitor on the demo account); the state is on the
//     server, so the phone can leave the app and come back to the same countdown;
//   - it runs in the user's own block: the goal block already running now, or a new block from
//     this minute (the same create_focus_block path as the Timeline, source "user");
//   - with the Mac connected (data in the last 48 hours) distracting apps are muted for the
//     window through a focus guard; without it nothing is said about the Mac;
//   - +15 moves the end (and the block Michael made, and the guard); at most 4 hours in all;
//   - on time: the whole length counts, and the watch buzzes "Done. 45 min for University." on the
//     push and Telegram channels. The user set this timer, so the buzz never counts towards the 5
//     a day or the 20 minute gap (countsTowardsCap); quiet hours still hold (stored suppressed);
//   - End early: "Count 30 min?" Yes counts the minutes so far, No counts nothing (a block Michael
//     made is then marked as not done); the block Michael made is cut to the minute it ended and
//     the guard is lifted at once;
//   - counted time is logged with the done time path (log_time, undoable for 24 hours) unless the
//     devices already show that span, so it is confirmed goal time and Today and Goals move at once.

const zone = () => new Zone(DEFAULT_TIMEZONE);
const iso = (ms: number) => new Date(ms).toISOString();
const MINUTE = 60_000;

/** The default length when none is named. */
export const DEFAULT_FOCUS_MINUTES = 45;
/** Mac data this recent means the collector is running, so a guard will be applied. */
export const MAC_FRESH_MS = 48 * 3600_000;
/** How long a stopped session is still shown when the screen comes back. */
export const LAST_SHOWN_MS = 15 * MINUTE;
/** Within this of the planned end, stopping counts as on time. */
export const ON_TIME_SLACK_MS = 30_000;
/** A goal block running now is reused when at least this much of it is left. */
const MIN_LEFT_MS = 5 * MINUTE;
/**
 * A block that starts this soon may be named too: "Start focus" on the block about to start nudge
 * (2 to 15 minutes ahead) runs the session from now to the block's end.
 */
export const BLOCK_AHEAD_MS = 15 * MINUTE;

// Chat, social and video (ten, the most a guard names): the apps people lose a focus block to. Mail, Slack and music
// stay open; some people work in them.
export const FOCUS_APPS = [
  "WhatsApp",
  "Telegram",
  "Messages",
  "Messenger",
  "Discord",
  "Instagram",
  "X",
  "Reddit",
  "TikTok",
  "Netflix",
];

// Attention the devices report: when it covers most of the span, the score reads the devices.
const DEVICE_SOURCES: Source[] = ["macos_usage", "iphone_usage", "activitywatch", "chrome"];
const DEVICE_TYPES = new Set(["app_usage", "web_visit", "screen"]);

// ---------- pure rules ----------

/** Minutes counted when a session stops at `stoppedAt`: none when the user said not to count it. */
export function countedMinutes(
  s: Pick<StoredFocusSession, "start_at" | "end_at">,
  stoppedAt: number,
  count: boolean,
): number {
  if (!count) return 0;
  const end = Math.min(stoppedAt, Date.parse(s.end_at));
  return Math.max(0, Math.round((end - Date.parse(s.start_at)) / MINUTE));
}

/** The new end after +`minutes`; refused once the session would pass 4 hours. */
export function extendedEnd(s: Pick<StoredFocusSession, "start_at" | "end_at">, minutes: number): string {
  const start = Date.parse(s.start_at);
  const next = Date.parse(s.end_at) + minutes * MINUTE;
  if (next - start > FOCUS_MAX_MINUTES * MINUTE)
    throw new HttpError("conflict", `A session runs at most ${FOCUS_MAX_MINUTES / 60} hours`);
  return iso(next);
}

/** True when stopping now is the end on time (the client's timer and the server's both fire). */
export const isOnTime = (s: Pick<StoredFocusSession, "end_at">, now: number) =>
  now >= Date.parse(s.end_at) - ON_TIME_SLACK_MS;

/** The goal as a nudge names it: its first five words, no dash or exclamation mark. */
export function shortGoal(title: string): string {
  const words = title
    .replace(/[‐-―!]|\s-\s/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 5).join(" ") || "your goal";
}

/** The buzz on the watch: "Done. 45 min for University." */
export const doneLine = (minutes: number, goal: string) => `Done. ${minutes} min for ${shortGoal(goal)}.`;

/** What End early says once the answer is in. */
export const earlyLine = (minutes: number, goal: string) =>
  minutes > 0
    ? `Counted ${minutes} min for ${shortGoal(goal)}.`
    : `Ended. Nothing counted for ${shortGoal(goal)}.`;

/** Inside the night's quiet hours ("22:00" to "07:00", across midnight), in Athens time. */
export function inQuietHours(now: number, quiet: { start: string; end: string }): boolean {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const minute = zone().minuteOfDay(now);
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** True when device attention (or a workout) covers at least half of [start, end). */
export function coveredByDevices(events: Event[], start: number, end: number): boolean {
  if (end <= start) return false;
  const spans = events
    .filter((e) => e.type === "workout" || (DEVICE_SOURCES.includes(e.source) && DEVICE_TYPES.has(e.type)))
    .map((e) => {
      const s = Math.max(start, Date.parse(e.start_at));
      const t = Math.min(end, e.end_at ? Date.parse(e.end_at) : Date.parse(e.start_at));
      return [s, t] as const;
    })
    .filter(([s, t]) => t > s)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cursor = start;
  for (const [s, t] of spans) {
    const from = Math.max(s, cursor);
    if (t > from) {
      covered += t - from;
      cursor = t;
    }
  }
  return covered >= (end - start) / 2;
}

// ---------- reading ----------

async function goalOf(id: string): Promise<Goal | null> {
  return store.getGoal(id).catch(() => null);
}

/** The contract's shape, with the goal's title as it is now. */
async function toSession(s: StoredFocusSession, goal?: Goal | null): Promise<FocusSession> {
  const g = goal === undefined ? await goalOf(s.goal_id) : goal;
  return {
    id: s.id,
    goal_id: s.goal_id,
    goal_title: g?.title ?? "your goal",
    status: s.status,
    start_at: s.start_at,
    end_at: s.end_at,
    ended_at: s.ended_at,
    minutes: Math.round((Date.parse(s.end_at) - Date.parse(s.start_at)) / MINUTE),
    counted_minutes: s.counted_minutes,
    event_id: s.event_id,
    guarded: s.guard_recommendation_ids.length > 0,
    apps: s.apps,
    log_recommendation_id: s.log_recommendation_id,
    message: s.message,
    created_at: s.created_at,
  };
}

/** The line a session Michael started by himself carries while it runs (the result line replaces it). */
export const autoLine = (title: string, end: number) =>
  `Your ${shortGoal(title)} block started. Focus is on until ${zone().clock(end)}.`;

/**
 * Focus turns itself on: when the user's own goal block from the synced calendar is running now and
 * no session runs, the session starts without a tap, to the block's end. Once per block: a session
 * that already ran or was ended during this block (by the user, or on time) means the user decided,
 * so nothing starts again. Never off the record. Best effort: any refusal leaves things as they were.
 */
export async function autoStartFocus(
  now = Date.now(),
  latest?: StoredFocusSession | null,
): Promise<StoredFocusSession | null> {
  try {
    if ((await store.privacyRules()).offTheRecord) return null;
    const found = await runningBlock(await store.listGoals(), now);
    if (!found) return null;
    const blockStart = Date.parse(found.block.start_at);
    const last = latest === undefined ? await store.latestFocusSession() : latest;
    if (last && (last.event_id === found.block.id || Date.parse(last.ended_at ?? last.start_at) >= blockStart))
      return null;
    const s = await startFocus({ event_id: found.block.id }, "app");
    return store.updateFocusSession(s.id, {
      message: autoLine(found.goal.title, Date.parse(s.end_at)),
    });
  } catch (err) {
    // A session started a moment ago elsewhere (409) or a block that just ended: nothing to do.
    if (!(err instanceof HttpError)) console.error("[focus] auto start skipped", err);
    return null;
  }
}

/** GET /v1/focus/active: the running session (finished first when its end has passed), and the last one. */
export async function activeFocus(
  now = Date.now(),
  opts: { autoStart?: boolean } = {},
): Promise<FocusActiveResponse> {
  let active = await store.getActiveFocusSession();
  if (active && Date.parse(active.end_at) <= now) {
    await endFocus(active.id, {}, "app").catch((err) => console.error("[focus] finish failed", err));
    active = await store.getActiveFocusSession();
  }
  // Only the app's own check (GET /v1/focus/active) starts one; chat and agents just read.
  if (!active && opts.autoStart)
    active = (await autoStartFocus(now)) ?? (await store.getActiveFocusSession());
  const latest = active ? null : await store.latestFocusSession();
  const recent =
    latest &&
    latest.status !== "active" &&
    latest.ended_at &&
    now - Date.parse(latest.ended_at) <= LAST_SHOWN_MS
      ? latest
      : null;
  return {
    now: iso(now),
    session: active ? await toSession(active) : null,
    last: recent ? await toSession(recent) : null,
  };
}

// ---------- starting ----------

const isOthers = (e: Event) => e.data.with_others === true || Number(e.data.attendees ?? 0) >= 2;

/** The user's own goal block running now with at least five minutes left, of this goal if given. */
async function runningBlock(
  goals: Goal[],
  now: number,
  goalId?: string,
): Promise<{ block: Event; goal: Goal } | null> {
  const events = await store.listEvents({ from: iso(now), to: iso(now + 1000), type: ["calendar_event"] });
  const open = goals.filter((g) => g.active && goalKind(g) === "time");
  for (const e of events) {
    if (isOthers(e) || !e.end_at) continue;
    if (Date.parse(e.start_at) > now || Date.parse(e.end_at) - now < MIN_LEFT_MS) continue;
    const match = goalForEvent(e, open);
    if (match && (!goalId || match.goal.id === goalId)) return { block: e, goal: match.goal };
  }
  return null;
}

async function macConnected(now: number): Promise<boolean> {
  const [rules, last] = await Promise.all([store.privacyRules(), store.lastEventAtBySource()]);
  if (rules.offTheRecord) return false;
  const at = last.macos_usage ?? last.activitywatch;
  return Boolean(at && now - Date.parse(at) <= MAC_FRESH_MS);
}

/** Mutes the focus apps on the Mac for [start, end); null when there is no Mac or it was refused. */
async function guard(goal: Goal, start: string, end: string): Promise<string | null> {
  try {
    if (!(await macConnected(Date.now()))) return null;
    const rec = await guardMacApps({
      apps: FOCUS_APPS,
      start_at: start,
      end_at: end,
      goal_id: goal.id,
      back_to: shortGoal(goal.title).slice(0, 80),
      requested_by: "Focus now",
      // Part of the session the user started: not a suggestion of its own on Today.
      source: "user",
      title: `Muted distracting apps until ${zone().clock(Date.parse(end))}`,
    });
    return rec.id;
  } catch (err) {
    console.error("[focus] guard skipped", err);
    return null;
  }
}

/** POST /v1/focus/start: the block, the guard and the session, in that order. */
export async function startFocus(raw: unknown, _via: LogVia): Promise<FocusSession> {
  const input = parse(FocusStart, raw);
  const now = Date.now();
  const running = await store.getActiveFocusSession();
  if (running && Date.parse(running.end_at) <= now) await endFocus(running.id, {}, "app").catch(() => null);
  const still = await store.getActiveFocusSession();
  if (still) {
    const g = await goalOf(still.goal_id);
    throw new HttpError(
      "conflict",
      `You are already focusing on ${shortGoal(g?.title ?? "a goal")} until ${zone().clock(Date.parse(still.end_at))}. End it first.`,
    );
  }

  // Off the record keeps nothing, so there is no block to protect and nothing to count.
  if ((await store.privacyRules()).offTheRecord)
    throw new HttpError(
      "conflict",
      "You are off the record, so I keep nothing. Turn it off on You to focus with me.",
    );
  const goals = await store.listGoals();
  let goal: Goal;
  let block: Event | null = null;
  if (input.event_id) {
    const e = await store.getEvent(input.event_id);
    if (e?.type !== "calendar_event" || !e.end_at)
      throw new HttpError("not_found", "That block is not on the timeline");
    if (isOthers(e))
      throw new HttpError("conflict", "That block has other people in it. I only advise on those.");
    if (Date.parse(e.start_at) > now + BLOCK_AHEAD_MS || Date.parse(e.end_at) - now < MIN_LEFT_MS)
      throw new HttpError("conflict", "That block is not happening now");
    const byBlock = goalForEvent(
      e,
      goals.filter((g) => g.active && goalKind(g) === "time"),
    )?.goal;
    goal = input.goal_id || input.goal ? matchGoal(goals, input) : (byBlock ?? matchGoal(goals, {}));
    block = e;
  } else {
    goal = matchGoal(goals, input);
    block = (await runningBlock(goals, now, goal.id))?.block ?? null;
  }

  const start = now;
  const minutes =
    input.minutes ??
    (block?.end_at
      ? Math.max(5, Math.floor((Date.parse(block.end_at) - now) / MINUTE))
      : DEFAULT_FOCUS_MINUTES);
  const end = start + minutes * MINUTE;
  const startIso = iso(start);
  const endIso = iso(end);

  let eventId: string | null = block?.id ?? null;
  let blockRec: string | null = null;
  if (!block) {
    const rec = await store.createRecommendation({
      goal_id: goal.id,
      title: `Focus on ${shortGoal(goal.title)} until ${zone().clock(end)}`,
      rationale: "You started Focus now.",
      action: {
        kind: "create_focus_block",
        payload: { start_at: startIso, end_at: endIso, title: goalBlockTitle(goal), goal_id: goal.id },
        involves_others: false,
        undo_until: startIso,
      },
      source: "user",
    });
    try {
      const { execution } = await executeLiveBlock(rec.id);
      eventId = (execution as { timeline_event_id?: string | null } | null)?.timeline_event_id ?? null;
      blockRec = rec.id;
    } catch (err) {
      await store.updateRecommendationStatus(rec.id, "dismissed").catch(() => null);
      throw err;
    }
  }

  const guardRec = await guard(goal, startIso, endIso);
  const stored = await store.createFocusSession({
    goal_id: goal.id,
    start_at: startIso,
    end_at: endIso,
    event_id: eventId,
    owns_block: !block,
    block_recommendation_id: blockRec,
    guard_recommendation_ids: guardRec ? [guardRec] : [],
    apps: guardRec ? FOCUS_APPS : [],
  });
  return toSession(stored, goal);
}

// ---------- +15 ----------

async function activeOrRefuse(id: string): Promise<StoredFocusSession> {
  const s = await store.getFocusSession(id);
  if (!s) throw new HttpError("not_found", "No focus session with that id");
  if (s.status !== "active") throw new HttpError("conflict", "That session has ended");
  return s;
}

/** POST /v1/focus/:id/extend: +15 minutes (or the minutes given) on the session, its block and its guard. */
export async function extendFocus(id: string, raw: unknown): Promise<FocusSession> {
  const p = parse(FocusExtend, raw ?? {});
  const s = await activeOrRefuse(id);
  const minutes = p.minutes ?? FOCUS_EXTEND_MINUTES;
  const end = extendedEnd(s, minutes);
  if (s.owns_block && s.event_id) await resizeLiveBlock(s.event_id, end);
  const goal = await goalOf(s.goal_id);
  const guards = [...s.guard_recommendation_ids];
  if (guards.length && goal) {
    const more = await guard(goal, s.end_at, end);
    if (more) guards.push(more);
  }
  const updated = await store.updateFocusSession(
    id,
    { end_at: end, guard_recommendation_ids: guards },
    { onlyActive: true },
  );
  if (!updated) throw new HttpError("conflict", "That session has ended");
  return toSession(updated, goal);
}

// ---------- the end ----------

/** The watch buzz at the end on time. Quiet hours store it as suppressed; off the record, nothing. */
async function buzz(
  s: StoredFocusSession,
  goal: Goal | null,
  text: string,
  now: number,
): Promise<Nudge | null> {
  const rules = await store.privacyRules();
  if (rules.offTheRecord) return null;
  const profile = await readProfile().catch(() => null);
  const quiet = inQuietHours(now, profile?.quiet_hours ?? { start: "22:00", end: "07:00" });
  const channel = primaryChannel();
  const z = zone();
  const nudge = await store.createNudge({
    recommendation_id: null,
    goal_id: goal?.id ?? null,
    kind: "focus_done",
    key: `focus_done:${s.id}`,
    day: z.dayOf(now),
    channel: channel.name,
    text,
    reason: `You started Focus now at ${z.clock(Date.parse(s.start_at))} and it ran to ${z.clock(Date.parse(s.end_at))}.`,
    status: quiet ? "suppressed" : "queued",
  });
  if (!nudge || quiet) return nudge;
  let status: NudgeStatus;
  try {
    status = await channel.deliver(nudge);
  } catch (err) {
    console.error("[focus] buzz failed", err);
    status = "failed";
  }
  return status === nudge.status ? nudge : ((await store.updateNudgeStatus(nudge.id, status)) ?? nudge);
}

/** Logs the counted span as done time unless the devices show it already. The log_time recommendation id. */
async function confirm(s: StoredFocusSession, minutes: number, via: LogVia): Promise<string | null> {
  if (minutes <= 0) return null;
  const start = Date.parse(s.start_at);
  const end = start + minutes * MINUTE;
  const events = await store.listEvents({ from: s.start_at, to: iso(end) });
  if (coveredByDevices(events, start, end)) return null;
  const out = await logTime(
    { goal_id: s.goal_id, start_at: s.start_at, end_at: iso(end) },
    via,
    executeRecommendation,
  );
  return out.recommendation.id;
}

/**
 * POST /v1/focus/:id/end. On time (at or after the planned end): the whole length counts and the
 * watch buzzes. Early: `count` (default true) counts the minutes so far, false counts nothing.
 * A session that already stopped is returned as it is, so the client's timer and the server's
 * finisher can both call it.
 */
export async function endFocus(
  id: string,
  raw: unknown,
  via: LogVia,
  now = Date.now(),
): Promise<FocusSession> {
  const p = parse(FocusEnd, raw ?? {});
  const s = await store.getFocusSession(id);
  if (!s) throw new HttpError("not_found", "No focus session with that id");
  if (s.status !== "active") return toSession(s);

  const onTime = isOnTime(s, now);
  const stoppedAt = onTime ? Date.parse(s.end_at) : now;
  const count = onTime || p.count !== false;
  const minutes = countedMinutes(s, stoppedAt, count);
  // Claimed first: whoever flips it from active does the rest, exactly once.
  const claimed = await store.updateFocusSession(
    id,
    { status: onTime ? "done" : "ended", ended_at: iso(stoppedAt), counted_minutes: minutes },
    { onlyActive: true },
  );
  if (!claimed) return toSession((await store.getFocusSession(id)) ?? s);

  const goal = await goalOf(s.goal_id);
  if (!onTime) {
    // The block Michael made ends now (at least a minute long); the apps open again at once.
    if (s.owns_block && s.event_id) {
      const cut = Math.max(stoppedAt, Date.parse(s.start_at) + MINUTE);
      await resizeLiveBlock(s.event_id, iso(cut)).catch((err) => console.error("[focus] cut block", err));
    }
    for (const g of s.guard_recommendation_ids)
      await undoRecommendation(g).catch((err) => console.error("[focus] lift guard", err));
  }

  let logRec: string | null = null;
  if (minutes > 0)
    logRec = await confirm(s, minutes, via).catch((err) => {
      console.error("[focus] log failed", err);
      return null;
    });
  else if (s.owns_block && s.event_id && goal && goalKind(goal) === "time")
    await settleBlock(
      { event_id: s.event_id, did: false, reason: "Ended early, not counted" },
      via,
      executeRecommendation,
    ).catch((err) => console.error("[focus] settle failed", err));

  const title = goal?.title ?? "your goal";
  const message = onTime ? doneLine(minutes, title) : earlyLine(minutes, title);
  if (onTime) await buzz(claimed, goal, message, now).catch((err) => console.error("[focus] buzz", err));
  const saved = await store.updateFocusSession(id, { log_recommendation_id: logRec, message });
  return toSession(saved ?? claimed, goal);
}

/**
 * The background finisher (scheduler.ts, every 30 seconds): each session whose end has passed is
 * ended on time as its own user (and demo visitor), so the watch buzzes with the app closed.
 */
export async function finishDueFocusSessions(now = Date.now()): Promise<number> {
  const due = await store.dueFocusSessions(iso(now));
  let finished = 0;
  for (const d of due) {
    try {
      await runAsUser(
        d.user_id,
        () => endFocus(d.id, {}, "app", now),
        "script",
        undefined,
        d.visitor_id ?? undefined,
      );
      finished++;
    } catch (err) {
      console.error(`[focus] finishing ${d.id} failed`, err);
    }
  }
  return finished;
}
