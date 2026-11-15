import {
  CHECKLIST_MAX_OPEN,
  type ChecklistItem,
  type Event,
  type Goal,
  goalArea,
  goalKind,
  type RitualEveningInput,
  type RitualEveningResponse,
  type RitualKind,
  type RitualMorningInput,
  type RitualState,
  type RitualSuggestion,
  type RitualToday,
  voiceShortDuration,
} from "@michael/shared";
import type { z } from "zod";
import { freePosition, linkedGoal, todayOf, zone } from "../checklist/items";
import { offerGoalActions } from "../checklist/offers";
import { HttpError } from "../http";
import {
  type BehindGoal,
  behindGoals,
  type EngineInput,
  engineWindow,
  momentTimes,
  quietFromProfile,
} from "../nudges/engine";
import { type GoalBlock, goalBlocks } from "../patterns/focus";
import { readProfile } from "../routes/profile";
import { goalForEvent } from "../score/match";
import { type DayRitual, store } from "../store";
import { logDoneTime } from "./log";

// The daily ritual (#318): one morning plan and one evening log, on Today, in chat and on MCP.
//
//   Morning   From waking (the end of last night's sleep, else 08:00, as the Morning moment) or
//             the morning nudge, until saved or "Not today": "What do you want to get done
//             today?" Up to three outcomes in the user's words, each for any goal, with an
//             estimate. Michael suggests one or two from today's calendar and the goals behind
//             their pace. Saving writes checklist items for today in the user's checklist goal,
//             made silently as "Today's outcomes" when there is none.
//   Evening   From an hour before the usual bedtime (as the Evening moment) or the evening nudge,
//             on a day with outcomes, until saved or "Not today": each outcome done, partly or
//             not; unfinished ones carried to tomorrow in one tap; time logged for its goal
//             (ritual/log.ts, the seam to #317). Then one line with the maths.
//
// No streaks and no guilt: a skipped half is simply skipped. The ritual adds no nudge of its own:
// the Morning and Evening nudges (#169) open Today, where the card is (ritual/nudge.ts words them).

export const OUTCOMES_TITLE = "Today's outcomes";

const FULL = "Three outcomes is the most for one day. Finish, drop or move one first.";

// Event types the morning reads: sleep for waking and bedtime, the rest for each goal's week.
const TYPES: Event["type"][] = ["sleep", "calendar_event", "workout", "focus_session", "meal"];

/** The checklist goal that holds the outcomes: "Today's outcomes", else the first active one. */
export async function outcomesGoal(create: boolean): Promise<Goal | null> {
  const goals = await store.listGoals();
  const lists = goals.filter((g) => g.active && goalKind(g) === "checklist");
  const found = lists.find((g) => g.title === OUTCOMES_TITLE) ?? lists[0] ?? null;
  if (found || !create) return found;
  return store.createGoal({
    category: "personal",
    title: OUTCOMES_TITLE,
    description: "The day's one to three outcomes, set each morning and logged each evening.",
    target: { kind: "checklist" },
    weekly_budget_minutes: null,
    active: true,
  });
}

// ---------- pure rules ----------

/** Which half shows now: the evening from its time (or nudge), the morning from waking (or nudge). */
export function ritualPhase(input: {
  now: number;
  morningAt: number;
  eveningAt: number;
  nudged: { morning: boolean; evening: boolean };
}): RitualKind | null {
  if (input.now >= input.eveningAt || input.nudged.evening) return "evening";
  if (input.now >= input.morningAt || input.nudged.morning) return "morning";
  return null;
}

/**
 * Each half's state. The morning is done once saved, or once the user wrote an outcome for today
 * themselves (a carried one does not count: the morning still asks, with it already listed). The
 * evening is due only on a day with outcomes.
 */
export function ritualStates(input: {
  phase: RitualKind | null;
  items: ChecklistItem[];
  rows: DayRitual[];
}): { morning: RitualState; evening: RitualState } {
  const row = (kind: RitualKind) => input.rows.find((r) => r.kind === kind)?.state ?? null;
  const planned = input.items.some((i) => !i.carried_from);
  const morning: RitualState =
    row("morning") ?? (planned ? "done" : input.phase === null ? "not_yet" : "due");
  const evening: RitualState =
    row("evening") ?? (input.items.length > 0 && input.phase === "evening" ? "due" : "not_yet");
  return { morning, evening };
}

const clockOf = (ms: number) => zone.clock(ms);
const quarter = (minutes: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(minutes / 15) * 15));
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * At most two suggestions for the morning: the goals furthest behind their pace (keep today's
 * block when there is one, else one block), then today's own goal blocks still ahead. Never a goal
 * an outcome already serves, never twice the same goal.
 */
export function morningSuggestions(input: {
  now: number;
  behind: BehindGoal[];
  blocks: GoalBlock[];
  items: ChecklistItem[];
}): RitualSuggestion[] {
  const out: RitualSuggestion[] = [];
  const used = new Set(input.items.flatMap((i) => (i.linked_goal_id ? [i.linked_goal_id] : [])));
  const ahead = input.blocks.filter((b) => b.start > input.now);
  const taken = (text: string) => input.items.some((i) => sameText(i.text, text));
  const push = (s: RitualSuggestion) => {
    if (out.length >= 2 || (s.goal_id && used.has(s.goal_id)) || taken(s.text)) return;
    if (s.goal_id) used.add(s.goal_id);
    out.push(s);
  };
  for (const b of input.behind) {
    const block = ahead.find((x) => x.goal.id === b.goal.id);
    const gap = voiceShortDuration(b.gap);
    push(
      block
        ? {
            text: `${block.title} at ${clockOf(block.start)}`,
            goal_id: b.goal.id,
            estimate_minutes: Math.round((block.end - block.start) / 60_000),
            reason: `${b.goal.title} is ${gap} behind this week. Keep the ${clockOf(block.start)} block.`,
            source: "calendar",
          }
        : {
            text: `One ${b.goal.title} block`,
            goal_id: b.goal.id,
            estimate_minutes: quarter(b.gap, 30, 90),
            reason: `${b.goal.title} is ${gap} behind this week. One block today?`,
            source: "behind",
          },
    );
  }
  for (const block of ahead) {
    push({
      text: `${block.title} at ${clockOf(block.start)}`,
      goal_id: block.goal.id,
      estimate_minutes: Math.round((block.end - block.start) / 60_000),
      reason: `On your calendar at ${clockOf(block.start)}, for ${block.goal.title}.`,
      source: "calendar",
    });
  }
  return out;
}

/** "University at 09:00": tomorrow's first own goal block, else its first event. */
export function tomorrowLine(events: Event[], goals: Goal[]): string | null {
  const calendar = events
    .filter((e) => e.type === "calendar_event")
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const active = goals.filter((g) => g.active && goalKind(g) !== "checklist");
  for (const e of calendar) {
    const match = goalForEvent(e, active);
    if (match) return `${match.goal.title} at ${clockOf(Date.parse(e.start_at))}`;
  }
  const first = calendar[0];
  return first ? `${first.title} at ${clockOf(Date.parse(first.start_at))}` : null;
}

/**
 * The evening's one line, with the maths and no guilt:
 * "2 of 3 done. 40 min logged for Training. One carried to tomorrow. Tomorrow starts with University at 09:00."
 */
export function eveningSummary(input: {
  items: Pick<ChecklistItem, "status">[];
  logged: { title: string; minutes: number }[];
  carried: number;
  tomorrow: string | null;
}): string {
  const set = input.items.length;
  const done = input.items.filter((i) => i.status === "done").length;
  const partly = input.items.filter((i) => i.status === "partly").length;
  const parts = [`${done} of ${set} done${partly ? `, ${partly} partly` : ""}.`];
  const logged = new Map<string, number>();
  for (const l of input.logged) logged.set(l.title, (logged.get(l.title) ?? 0) + l.minutes);
  if (logged.size) {
    const lines = [...logged].map(([title, m]) => `${voiceShortDuration(m)} for ${title}`);
    const [first, ...rest] = lines;
    parts.push(`${first?.replace(" for ", " logged for ")}${rest.length ? `, ${rest.join(", ")}` : ""}.`);
  }
  if (input.carried === 1) parts.push("One carried to tomorrow.");
  else if (input.carried > 1) parts.push(`${input.carried} carried to tomorrow.`);
  if (input.tomorrow) parts.push(`Tomorrow starts with ${input.tomorrow}.`);
  return parts.join(" ");
}

// ---------- reading the day ----------

/** Today's outcomes (the outcomes goal's items, moved ones left out), by position. */
function outcomesOf(items: ChecklistItem[], goal: Goal | null, day: string) {
  return goal ? items.filter((i) => i.goal_id === goal.id && i.date === day && i.status !== "moved") : [];
}

async function tomorrowFor(day: string, goals: Goal[]): Promise<string | null> {
  const next = zone.nextDay(day);
  const events = await store.listEvents({
    from: new Date(zone.startOfDay(next)).toISOString(),
    to: new Date(zone.startOfDay(zone.nextDay(next))).toISOString(),
    type: ["calendar_event"],
  });
  return tomorrowLine(events, goals);
}

export async function ritualFor(now = Date.now(), opts: { phase?: RitualKind } = {}): Promise<RitualToday> {
  const nowIso = new Date(now).toISOString();
  const win = engineWindow(nowIso);
  const day = todayOf(now);
  const [goals, events, nudges, profile, items, rows] = await Promise.all([
    store.listGoals(),
    store.listEvents({ from: win.from, to: win.dayEnd, type: TYPES }),
    store.listNudges({ from: win.dayStart, to: win.dayEnd }).catch(() => []),
    readProfile().catch(() => null),
    store.listChecklist({ from: day, to: day }),
    store.listRituals({ from: day, to: day }),
  ]);
  const input: EngineInput = {
    now: nowIso,
    goals,
    events,
    today: nudges,
    quiet: quietFromProfile(profile?.quiet_hours),
  };
  const timing = momentTimes(input);
  const sent = (kind: RitualKind) => nudges.some((n) => n.key === kind && n.status !== "suppressed");
  const phase =
    opts.phase ??
    ritualPhase({
      now,
      morningAt: timing.morningAt,
      eveningAt: timing.eveningAt,
      nudged: { morning: sent("morning"), evening: sent("evening") },
    });
  const lists = goals.filter((g) => g.active && goalKind(g) === "checklist");
  const goal = lists.find((g) => g.title === OUTCOMES_TITLE) ?? lists[0] ?? null;
  const today = outcomesOf(items, goal, day);
  const states = ritualStates({ phase, items: today, rows });

  let suggestions: RitualSuggestion[] = [];
  if (phase === "morning" && states.morning === "due") {
    const blocks = goalBlocks(events, goals, now, Date.parse(win.dayEnd));
    suggestions = morningSuggestions({ now, behind: behindGoals(input), blocks, items: today });
  }
  const evening = rows.find((r) => r.kind === "evening");
  return {
    day,
    phase,
    morning: states.morning,
    evening: states.evening,
    goal_id: goal?.id ?? null,
    items: today,
    suggestions,
    goals: goals
      .filter((g) => g.active && goalKind(g) !== "checklist")
      .map((g) => ({ id: g.id, title: g.title, area: goalArea(g.category) })),
    summary: evening?.summary ?? null,
    tomorrow: phase === "evening" ? await tomorrowFor(day, goals).catch(() => null) : null,
  };
}

// ---------- writing it ----------

/** The morning: today's outcomes as checklist items. Outcomes already on today stay. */
export async function planMorning(
  input: z.output<typeof RitualMorningInput>,
  now = Date.now(),
): Promise<RitualToday> {
  const day = todayOf(now);
  const goal = await outcomesGoal(true);
  if (!goal) throw new HttpError("conflict", "Could not keep today's outcomes.");
  const items = await store.listChecklist({ from: day, to: day });
  const open = items.filter((i) => i.goal_id === goal.id && i.status === "open");
  const fresh = input.outcomes.filter(
    (o, n, all) =>
      !open.some((i) => sameText(i.text, o.text)) && all.findIndex((x) => sameText(x.text, o.text)) === n,
  );
  if (open.length + fresh.length > CHECKLIST_MAX_OPEN) throw new HttpError("conflict", FULL);
  // Check every goal first, so a bad id writes nothing.
  const linked = await Promise.all(
    fresh.map(async (o) => (o.goal_id && o.goal_id !== goal.id ? (await linkedGoal(o.goal_id)).id : null)),
  );
  let day_items = items;
  for (const [n, o] of fresh.entries()) {
    const position = freePosition(day_items, goal.id, day);
    if (position === null) throw new HttpError("conflict", FULL);
    const item = await store.createChecklistItem({
      goal_id: goal.id,
      date: day,
      text: o.text.trim(),
      position,
      linked_goal_id: linked[n] ?? null,
      estimate_minutes: o.estimate_minutes ?? null,
    });
    day_items = [...day_items, item];
  }
  await store.saveRitual({ day, kind: "morning", state: "done", summary: null });
  // The first open outcome gets an offered hour, as when it is added from the list (#238).
  await offerGoalActions({ now }).catch((err) => console.error("ritual: offers", err));
  return ritualFor(now);
}

/** "Not today": hides that half for the rest of the day. */
export async function skipRitual(kind: RitualKind, now = Date.now()): Promise<RitualToday> {
  await store.saveRitual({ day: todayOf(now), kind, state: "skipped", summary: null });
  return ritualFor(now);
}

const STATUS = { done: "done", partly: "partly", not: "dropped" } as const;

/** The evening: settle each outcome, carry the unfinished, log the time, keep the line. */
export async function logEvening(
  input: z.output<typeof RitualEveningInput>,
  now = Date.now(),
): Promise<RitualEveningResponse> {
  const settledAt = new Date(now).toISOString();
  const found = await Promise.all(input.results.map((r) => store.getChecklistItem(r.item_id)));
  const pairs = input.results.map((r, n) => {
    const item = found[n];
    if (!item) throw new HttpError("not_found", "Checklist item not found");
    return { r, item };
  });
  // The day the outcomes belong to: today, or yesterday when logged after midnight.
  const day =
    pairs
      .map((p) => p.item.date)
      .sort()
      .at(-1) ?? todayOf(now);
  const next = zone.nextDay(day);

  // Room on tomorrow for everything carried, checked before anything is written.
  const carrying = pairs.filter((p) => p.r.carry && p.r.result !== "done" && p.item.status !== "moved");
  let tomorrow = await store.listChecklist({ from: next, to: next });
  for (const goalId of new Set(carrying.map((p) => p.item.goal_id))) {
    const room =
      CHECKLIST_MAX_OPEN - tomorrow.filter((i) => i.goal_id === goalId && i.status === "open").length;
    if (carrying.filter((p) => p.item.goal_id === goalId).length > room) {
      throw new HttpError("conflict", "Tomorrow already has three outcomes. Carry fewer.");
    }
  }

  const goals = new Map((await store.listGoals()).map((g) => [g.id, g]));
  const carried: ChecklistItem[] = [];
  const logged: { goal_id: string; minutes: number }[] = [];
  for (const { r, item } of pairs) {
    if (item.status === "moved") continue;
    const carry = Boolean(r.carry) && r.result !== "done";
    if (carry) {
      const position = freePosition(tomorrow, item.goal_id, next);
      if (position === null) throw new HttpError("conflict", "Tomorrow already has three outcomes.");
      const created = await store.createChecklistItem({
        goal_id: item.goal_id,
        date: next,
        text: item.text,
        position,
        carried_from: item.id,
        linked_goal_id: item.linked_goal_id,
        estimate_minutes: item.estimate_minutes,
      });
      tomorrow = [...tomorrow, created];
      carried.push(created);
    }
    const minutes = r.result !== "not" ? (r.minutes ?? null) : null;
    await store.updateChecklistItem(item.id, {
      status: carry && r.result === "not" ? "moved" : STATUS[r.result],
      settled_at: settledAt,
      settled_by: "user",
      ...(minutes ? { logged_minutes: minutes } : {}),
    });
    if (minutes && item.linked_goal_id && goals.has(item.linked_goal_id)) {
      await logDoneTime({ goal_id: item.linked_goal_id, minutes, day, note: item.text });
      logged.push({ goal_id: item.linked_goal_id, minutes });
    }
  }

  // The line counts every outcome of the day, the ones settled earlier too.
  const goal = await outcomesGoal(false);
  const dayItems = (await store.listChecklist({ from: day, to: day })).filter(
    (i) => i.goal_id === (goal?.id ?? pairs[0]?.item.goal_id),
  );
  const summary = eveningSummary({
    items: dayItems,
    logged: logged.map((l) => ({ title: goals.get(l.goal_id)?.title ?? "a goal", minutes: l.minutes })),
    carried: carried.length,
    tomorrow: await tomorrowFor(day, [...goals.values()]).catch(() => null),
  });
  await store.saveRitual({ day, kind: "evening", state: "done", summary });
  return { summary, carried, logged, ritual: await ritualFor(now) };
}
