import { type ChecklistItem, type Goal, goalKind, type RitualResult } from "@michael/shared";
import { zone } from "../checklist/items";
import { eveningSummary, OUTCOMES_TITLE, tomorrowLine } from "../ritual/ritual";
import type { Store } from "../store";
import { demoGoals } from "./week";

// The daily ritual on the demo week (#318): today's morning plan is filled and the two evenings
// before it are logged, so the ritual shows on stage at any hour. Written once per day: a day that
// already has outcomes or a ritual row is left alone, so a demo edit survives the refresh. Private
// names stay out: the outcomes are generic.

type Seed = { text: string; goal: string | null; estimate?: number; result?: RitualResult; minutes?: number };

const TWO_DAYS_AGO: Seed[] = [
  { text: "Send the outreach emails", goal: "The company", estimate: 45, result: "done", minutes: 45 },
  { text: "Revise chapter 3", goal: "University", estimate: 90, result: "partly", minutes: 60 },
  { text: "Book the bike service", goal: null, result: "not" },
];
const YESTERDAY: Seed[] = [
  { text: "Finish the marketing post", goal: "The company", estimate: 60, result: "done", minutes: 50 },
  { text: "Long swim", goal: "70.3", estimate: 60, result: "done", minutes: 60 },
  // Carried to today.
  { text: "Statistics past paper", goal: "University", estimate: 90, result: "not" },
];
const TODAY: Seed[] = [
  { text: "Call three leads", goal: "The company", estimate: 45 },
  { text: "Yoga before bed", goal: "70.3", estimate: 30 },
];

const STATUS = { done: "done", partly: "partly", not: "dropped" } as const;

async function outcomesGoal(store: Store): Promise<Goal> {
  const goals = await store.listGoals();
  const found = goals.find((g) => g.active && goalKind(g) === "checklist" && g.title === OUTCOMES_TITLE);
  return (
    found ??
    store.createGoal({
      category: "personal",
      title: OUTCOMES_TITLE,
      description: "The day's one to three outcomes, set each morning and logged each evening.",
      target: { kind: "checklist" },
      weekly_budget_minutes: null,
      active: true,
    })
  );
}

const goalId = (title: string | null) => demoGoals.find((g) => g.title === title)?.id ?? null;

/** `days` oldest first, the last one today (buildDemoWeek). */
export async function seedDemoRitual(store: Store, days: string[]) {
  const today = days.at(-1);
  const yesterday = days.at(-2);
  const before = days.at(-3);
  if (!today || !yesterday || !before) return;
  const rows = await store.listRituals({ from: before, to: today });
  const items = await store.listChecklist({ from: before, to: today });
  const goal = await outcomesGoal(store);
  const fresh = (day: string) =>
    !rows.some((r) => r.day === day) && !items.some((i) => i.date === day && i.goal_id === goal.id);
  const settledAt = (day: string) => new Date(`${day}T19:30:00Z`).toISOString();
  let carried: ChecklistItem | null = null;

  for (const [day, seeds, carry] of [
    [before, TWO_DAYS_AGO, false],
    [yesterday, YESTERDAY, true],
  ] as const) {
    if (!fresh(day)) continue;
    const made: ChecklistItem[] = [];
    for (const [position, s] of seeds.entries()) {
      const item = await store.createChecklistItem({
        goal_id: goal.id,
        date: day,
        text: s.text,
        position,
        linked_goal_id: goalId(s.goal),
        estimate_minutes: s.estimate ?? null,
      });
      const moved = carry && s.result === "not";
      const done = await store.updateChecklistItem(item.id, {
        status: moved ? "moved" : STATUS[s.result ?? "not"],
        settled_at: settledAt(day),
        settled_by: "user",
        ...(s.minutes ? { logged_minutes: s.minutes } : {}),
      });
      if (moved) carried = done;
      made.push(done ?? item);
    }
    const next = zone.nextDay(day);
    const nextEvents = await store.listEvents({
      from: new Date(zone.startOfDay(next)).toISOString(),
      to: new Date(zone.startOfDay(zone.nextDay(next))).toISOString(),
      type: ["calendar_event"],
    });
    const summary = eveningSummary({
      items: made,
      logged: seeds.flatMap((s) => (s.minutes && s.goal ? [{ title: s.goal, minutes: s.minutes }] : [])),
      carried: carry ? 1 : 0,
      tomorrow: tomorrowLine(nextEvents, await store.listGoals()),
    });
    await store.saveRitual({ day, kind: "morning", state: "done", summary: null });
    await store.saveRitual({ day, kind: "evening", state: "done", summary });
  }

  if (!fresh(today)) return;
  const plan: Seed[] = [
    ...(carried ? [{ text: carried.text, goal: "University", estimate: 90 }] : []),
    ...TODAY,
  ];
  for (const [position, s] of plan.entries()) {
    await store.createChecklistItem({
      goal_id: goal.id,
      date: today,
      text: s.text,
      position,
      linked_goal_id: goalId(s.goal),
      estimate_minutes: s.estimate ?? null,
      ...(position === 0 && carried ? { carried_from: carried.id } : {}),
    });
  }
  await store.saveRitual({ day: today, kind: "morning", state: "done", summary: null });
}
