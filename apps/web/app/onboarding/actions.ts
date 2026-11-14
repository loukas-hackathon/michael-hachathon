"use server";

import { GoalCategory, type GoalCreate, goalKind, ProfileUpdate } from "@michael/shared";
import { API_URL, createGoal, getGoals, patchGoal, putProfile } from "@/lib/api";
import { authHeaders, isDemoVisitor } from "@/lib/caller";
import type { InstructionKind } from "@/lib/instructions";

// Server functions behind the onboarding talk. Only the server talks to the API, with the signed in
// user's token. Everything here comes from the browser, so it is parsed first.

type Key = "company" | "training" | "sleep" | "personal" | "own";
export type GoalAnswer = { key: Key; weekly_minutes: number; title?: string };
export type RuleAnswer = { kind: InstructionKind; text: string; days?: number[]; time?: string };
export type Answers = {
  goals: GoalAnswer[];
  rules?: RuleAnswer[];
  profile: Omit<ProfileUpdate, "onboarded_at">;
};

const MAX_WEEK = 7 * 24 * 60;
const KEYS: Key[] = ["company", "training", "sleep", "personal", "own"];
const NEW_CATEGORIES = (GoalCategory.options as readonly string[]).includes("personal");

// What each starter is called, which category it is stored in, and which calendar titles count
// (docs/api.md, Goals). Training and Sleep keep the old readable values (gym, rest), which map to
// Health; the company is work (Business) until the contract takes the new names (#131).
const TEMPLATE: Record<
  Exclude<Key, "own">,
  { title: string; category: string; target: Record<string, unknown> }
> = {
  company: {
    title: "The company",
    category: NEW_CATEGORIES ? "business" : "work",
    target: { kind: "time", calendar_titles: ["Deep work", "Focus", "Sales", "Outreach"] },
  },
  training: {
    title: "Training",
    category: "gym",
    target: { kind: "time", calendar_titles: ["Gym", "Run", "Swim", "Training"] },
  },
  sleep: { title: "Sleep", category: "rest", target: {} },
  personal: { title: "Time for yourself", category: "personal", target: { kind: "time", label: "fun" } },
};

function parseGoals(input: unknown): GoalAnswer[] {
  if (!Array.isArray(input) || input.length > 5) throw new Error("Invalid goals");
  return input.map((g: Partial<GoalAnswer> | null) => {
    const weekly = g?.weekly_minutes;
    if (typeof weekly !== "number" || !Number.isInteger(weekly) || weekly < 0 || weekly > MAX_WEEK) {
      throw new Error("Invalid weekly minutes");
    }
    if (!g?.key || !KEYS.includes(g.key)) throw new Error("Invalid goal");
    if (g.key === "personal" && !NEW_CATEGORIES) throw new Error("Personal goals are not available yet");
    const title = typeof g.title === "string" ? g.title.trim().slice(0, 60) : undefined;
    if (g.key === "own" && !title) throw new Error("Own goal needs a name");
    return { key: g.key, weekly_minutes: weekly, title };
  });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function parseRules(input: unknown): RuleAnswer[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 6) throw new Error("Invalid rules");
  return input.map((r: Partial<RuleAnswer> | null) => {
    const kind = r?.kind;
    const text = typeof r?.text === "string" ? r.text.trim().slice(0, 140) : "";
    if (!text || !(kind === "clear_day" || kind === "home_by" || kind === "custom"))
      throw new Error("Invalid rule");
    const days = Array.isArray(r?.days)
      ? r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : undefined;
    const time = typeof r?.time === "string" && HHMM.test(r.time) ? r.time : undefined;
    return { kind, text, days, time };
  });
}

/**
 * House rules go to /v1/instructions (#131). Until that endpoint is live this answers false and the
 * onboarding carries on without them; already set rules (same text) are not added twice.
 */
async function saveRules(rules: RuleAnswer[]): Promise<void> {
  const headers = { ...(await authHeaders()), "content-type": "application/json" };
  const res = await fetch(`${API_URL}/v1/instructions`, { headers, cache: "no-store" }).catch(() => null);
  if (!res?.ok) return;
  const body = (await res.json().catch(() => ({ instructions: [] }))) as {
    instructions?: { text: string }[];
  };
  const have = new Set((body.instructions ?? []).map((i) => i.text));
  for (const r of rules) {
    if (have.has(r.text)) continue;
    await fetch(`${API_URL}/v1/instructions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...r, active: true }),
      cache: "no-store",
    }).catch(() => null);
  }
}

function targetFor(g: GoalAnswer, gymDays: number): Record<string, unknown> {
  if (g.key === "own") return { kind: "time" };
  if (g.key === "sleep") return { sleep_hours: Math.round((g.weekly_minutes / 7 / 60) * 2) / 2 };
  const base = TEMPLATE[g.key].target;
  if (g.key === "training" && gymDays > 0) return { ...base, sessions_per_week: gymDays };
  return base;
}

/**
 * Saves the goals, the house rules, then the profile. One goal per starter: one the user already
 * has gets its weekly budget updated (Redo setup), never a duplicate. Goals left unpicked are not
 * touched: Michael never deletes. Rules already set are not added twice; if the instructions API is
 * not live yet, the rules are skipped and the rest still saves.
 */
export async function finishOnboarding(input: Answers): Promise<{ ok: boolean }> {
  const goals = parseGoals(input?.goals);
  const rules = parseRules(input?.rules);
  const profile = ProfileUpdate.parse({ ...input?.profile, onboarded_at: new Date().toISOString() });
  // The demo week is read mostly: a visitor walks the whole talk, nothing is written (#239).
  if (await isDemoVisitor()) return { ok: true };
  try {
    const current = await getGoals();
    for (const g of goals) {
      const category = g.key === "own" ? (NEW_CATEGORIES ? "business" : "work") : TEMPLATE[g.key].category;
      const title = g.key === "own" ? (g.title as string) : TEMPLATE[g.key].title;
      const mine = current.find(
        (x) =>
          x.active &&
          goalKind(x) === "time" &&
          (g.key === "own" ? x.title === title : x.category === category),
      );
      if (mine) {
        if (mine.weekly_budget_minutes !== g.weekly_minutes) {
          const res = await patchGoal(mine.id, { weekly_budget_minutes: g.weekly_minutes });
          if (!res.ok) throw new Error(res.message);
        }
        continue;
      }
      await createGoal({
        category: category as GoalCreate["category"],
        title,
        target: targetFor(g, profile.gym_days?.length ?? 0),
        weekly_budget_minutes: g.weekly_minutes,
      });
    }
    if (rules.length) await saveRules(rules);
    await putProfile(profile);
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
