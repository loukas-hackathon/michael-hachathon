"use server";

import { GoalCategory, ProfileUpdate } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { acceptGoalSuggestion, createGoal, getGoals, patchGoal, putProfile } from "@/lib/api";

// Server functions behind the onboarding talk. Only the server talks to the API, with the signed in
// user's token. Everything here comes from the browser, so it is parsed first.

export type GoalAnswer = { category: GoalCategory; weekly_minutes: number };
/** A goal Michael found in the calendar (#134), kept with the hours the user left on it. */
export type KeptSuggestion = { id: string; weekly_minutes: number };
export type Answers = {
  goals: GoalAnswer[];
  /** Calendar suggestions to keep, by id. */
  kept?: KeptSuggestion[];
  /** Usual week and quiet hours are no longer asked: the API defaults stand until You changes them. */
  profile?: Omit<ProfileUpdate, "onboarded_at">;
};

const MAX_WEEK = 7 * 24 * 60;

function parseGoals(input: unknown): GoalAnswer[] {
  if (!Array.isArray(input) || input.length > 4) throw new Error("Invalid goals");
  return input.map((g: Partial<GoalAnswer> | null) => {
    const weekly = g?.weekly_minutes;
    if (typeof weekly !== "number" || !Number.isInteger(weekly) || weekly < 0 || weekly > MAX_WEEK) {
      throw new Error("Invalid weekly minutes");
    }
    return { category: GoalCategory.parse(g?.category), weekly_minutes: weekly };
  });
}

// What each goal is called and which calendar titles count towards it (docs/api.md, Goals).
const GOAL_TEMPLATE: Record<GoalCategory, { title: string; target: Record<string, unknown> }> = {
  business: { title: "Deep work", target: { calendar_titles: ["Deep work", "Focus", "Study"] } },
  health: { title: "Training", target: { calendar_titles: ["Gym", "Run", "Swim", "Training"] } },
  personal: { title: "Personal time", target: {} },
  work: { title: "Deep work", target: { calendar_titles: ["Deep work", "Focus", "Study"] } },
  gym: { title: "Training", target: { calendar_titles: ["Gym", "Run", "Swim", "Training"] } },
  rest: { title: "Sleep", target: {} },
  food: { title: "Proper meals", target: { calendar_titles: ["Breakfast", "Lunch", "Dinner"] } },
};

function parseKept(input: unknown): KeptSuggestion[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 6) throw new Error("Invalid suggestions");
  return input.map((k: Partial<KeptSuggestion> | null) => {
    const id = k?.id;
    const weekly = k?.weekly_minutes;
    if (typeof id !== "string" || id.length === 0 || id.length > 120) throw new Error("Invalid id");
    if (typeof weekly !== "number" || !Number.isInteger(weekly) || weekly < 0 || weekly > MAX_WEEK) {
      throw new Error("Invalid weekly minutes");
    }
    return { id, weekly_minutes: weekly };
  });
}

function targetFor(g: GoalAnswer, gymDays: number): Record<string, unknown> {
  const base = GOAL_TEMPLATE[g.category].target;
  if (g.category === "rest") return { sleep_hours: Math.round((g.weekly_minutes / 7 / 60) * 2) / 2 };
  if (g.category === "gym" && gymDays > 0) return { ...base, sessions_per_week: gymDays };
  return base;
}

/**
 * Saves the answers, then the profile. One goal per category: a category the user already has gets
 * its weekly budget updated (Redo setup), never a duplicate. Goals left unpicked are not touched:
 * Michael never deletes.
 */
export async function finishOnboarding(input: Answers): Promise<{ ok: boolean }> {
  const goals = parseGoals(input?.goals);
  const kept = parseKept(input?.kept);
  const profile = ProfileUpdate.parse({ ...input?.profile, onboarded_at: new Date().toISOString() });
  try {
    for (const k of kept) {
      const res = await acceptGoalSuggestion(k.id, { weekly_budget_minutes: k.weekly_minutes });
      if (!res.ok) throw new Error(res.message ?? "Could not keep a suggestion");
    }
    const current = await getGoals();
    for (const g of goals) {
      const mine = current.find((x) => x.category === g.category && x.active);
      if (mine) {
        if (mine.weekly_budget_minutes !== g.weekly_minutes) {
          const res = await patchGoal(mine.id, { weekly_budget_minutes: g.weekly_minutes });
          if (!res.ok) throw new Error(res.message);
        }
        continue;
      }
      await createGoal({
        category: g.category,
        title: GOAL_TEMPLATE[g.category].title,
        target: targetFor(g, profile.gym_days?.length ?? 0),
        weekly_budget_minutes: g.weekly_minutes,
      });
    }
    await putProfile(profile);
    revalidatePath("/");
    revalidatePath("/goals");
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

/** Skip: keep the defaults and never ask again from Today. */
export async function skipOnboarding(): Promise<{ ok: boolean }> {
  try {
    await putProfile({ onboarded_at: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}
