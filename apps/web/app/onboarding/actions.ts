"use server";

import {
  GoalCategory,
  GoalWordsRequest,
  type GoalWordsResponse,
  HeardGoal,
  MemoryCreate,
  OnboardingTurnRequest,
  type OnboardingTurnResponse,
  ProfileUpdate,
} from "@michael/shared";
import { revalidatePath } from "next/cache";
import {
  acceptGoalSuggestion,
  createGoal,
  getGoals,
  goalsFromWords,
  onboardingTurn,
  patchGoal,
  putProfile,
  rememberNote,
} from "@/lib/api";
import { isDemoVisitor } from "@/lib/caller";

// Server functions behind the onboarding talk. Only the server talks to the API, with the signed in
// user's token. Everything here comes from the browser, so it is parsed first.

export type GoalAnswer = { category: GoalCategory; weekly_minutes: number };
/** A goal Michael found in the calendar (#134), kept with the hours the user left on it. */
export type KeptSuggestion = { id: string; weekly_minutes: number };
/** A goal in the user's own words (Manolis, #190): Business, a time goal, hours changed on Goals. */
export type OwnGoal = { title: string; weekly_minutes: number };
export type Answers = {
  goals?: GoalAnswer[];
  own?: OwnGoal;
  /** Calendar suggestions to keep, by id. */
  kept?: KeptSuggestion[];
  /** Goals heard in the talk, as the user left them on the review screen. */
  heard?: HeardGoal[];
  /** How the user works, in their words, kept as memories. */
  notes?: string[];
  /** Usual week and quiet hours are no longer asked: the API defaults stand until You changes them. */
  profile?: Omit<ProfileUpdate, "onboarded_at">;
};

const MAX_WEEK = 7 * 24 * 60;

function parseGoals(input: unknown): GoalAnswer[] {
  if (!Array.isArray(input) || input.length > 5) throw new Error("Invalid goals");
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
  personal: { title: "Time for yourself", target: { kind: "time", label: "fun" } },
  work: { title: "Deep work", target: { calendar_titles: ["Deep work", "Focus", "Study"] } },
  gym: { title: "Training", target: { calendar_titles: ["Gym", "Run", "Swim", "Training"] } },
  rest: { title: "Sleep", target: {} },
  food: { title: "Proper meals", target: { calendar_titles: ["Breakfast", "Lunch", "Dinner"] } },
};

function parseOwn(input: unknown): OwnGoal | null {
  if (input === undefined || input === null) return null;
  const o = input as Partial<OwnGoal>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const weekly = o.weekly_minutes;
  if (!title || title.length > 60) throw new Error("Invalid goal name");
  if (typeof weekly !== "number" || !Number.isInteger(weekly) || weekly < 0 || weekly > MAX_WEEK) {
    throw new Error("Invalid weekly minutes");
  }
  return { title, weekly_minutes: weekly };
}

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
const HeardList = HeardGoal.array().max(5);
/** Notes are memories: the same rules POST /v1/memories applies. */
const Notes = MemoryCreate.shape.text.array().max(4);

/**
 * What Michael heard in the talk: the answers, as they came, read into goals by the API. Nothing is
 * saved. Null when the API could not answer; the screen then offers the list of usual goals.
 */
export async function hearGoals(text: string): Promise<GoalWordsResponse | null> {
  const parsed = GoalWordsRequest.safeParse({ text: typeof text === "string" ? text.slice(0, 4000) : "" });
  if (!parsed.success) return null;
  return goalsFromWords(parsed.data.text);
}

/**
 * Michael's next line in the talk, from the API. Null when it cannot answer (not deployed yet, no
 * model, slow, down): the screen then asks its own script. Nothing is saved.
 */
export async function nextTurn(turns: unknown): Promise<OnboardingTurnResponse | null> {
  const parsed = OnboardingTurnRequest.safeParse({ turns });
  if (!parsed.success) return null;
  return onboardingTurn(parsed.data);
}

export async function finishOnboarding(input: Answers): Promise<{ ok: boolean }> {
  const goals = parseGoals(input?.goals ?? []);
  const heard = HeardList.parse(input?.heard ?? []);
  const notes = Notes.parse(input?.notes ?? []);
  const kept = parseKept(input?.kept);
  const own = parseOwn(input?.own);
  const profile = ProfileUpdate.parse({ ...input?.profile, onboarded_at: new Date().toISOString() });
  // The demo week is read mostly: a visitor walks the whole talk, nothing is written (#239).
  if (await isDemoVisitor()) return { ok: true };
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
    // Own words: never twice under the same name (Redo setup), never touching an existing goal.
    if (own && !current.some((x) => x.active && x.title.toLowerCase() === own.title.toLowerCase())) {
      await createGoal({
        category: "business",
        title: own.title,
        target: { kind: "time" },
        weekly_budget_minutes: own.weekly_minutes,
      });
    }
    // Heard in the talk: never twice under the same name (Redo setup), never touching an existing goal.
    const taken = new Set(current.filter((x) => x.active).map((x) => x.title.toLowerCase()));
    for (const h of heard) {
      if (taken.has(h.title.toLowerCase())) continue;
      taken.add(h.title.toLowerCase());
      await createGoal({
        category: h.category,
        title: h.title,
        description: h.evidence ? `In your words: ${h.evidence}` : null,
        target: h.target,
        weekly_budget_minutes: h.weekly_budget_minutes,
      });
    }
    // Best effort: a note not kept never stops the goals.
    for (const n of notes) await rememberNote(n);
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
  if (await isDemoVisitor()) return { ok: true };
  try {
    await putProfile({ onboarded_at: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}
