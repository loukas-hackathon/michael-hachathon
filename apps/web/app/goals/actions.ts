"use server";

import { GoalCategory, type GoalCreate } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { patchGoal, postGoal, removeGoalById } from "@/lib/api";
import type { Category } from "@/lib/categories";

// Goal setting from the Goals tab. Kinds follow #131: time, target, count, checklist.
// Until the contract accepts business, health and personal, they are written as the old values.

export type FormState = { ok: boolean; message: string | null };

const NEW_CATEGORIES = (GoalCategory.options as readonly string[]).includes("business");

function categoryFor(c: Category): GoalCreate["category"] | null {
  if (NEW_CATEGORIES) return c as GoalCreate["category"];
  if (c === "business") return "work";
  if (c === "health") return "gym";
  return null;
}

function parse(form: FormData): { goal: GoalCreate } | { error: string } {
  const category = String(form.get("category") ?? "business") as Category;
  const title = String(form.get("title") ?? "").trim();
  const kind = String(form.get("kind") ?? "time");
  if (!title) return { error: "Give the goal a name." };
  const cat = categoryFor(category);
  if (!cat) return { error: "Personal goals switch on later tonight, with the new categories." };

  const target: Record<string, unknown> = { kind };
  let weekly: number | null = null;
  if (kind === "time") {
    const hours = Number(String(form.get("hours") ?? "").replace(",", "."));
    if (!(hours > 0 && hours <= 112)) return { error: "Hours a week should be between 0.5 and 112." };
    weekly = Math.round(hours * 60);
    const titles = String(form.get("calendar_titles") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (titles.length) target.calendar_titles = titles;
  } else if (kind === "target") {
    const unit = String(form.get("unit") ?? "hours_a_day");
    const value = String(form.get("value") ?? "").trim();
    if (!value) return { error: "Set the target, for example 7.5 hours or 23:00." };
    target.unit = unit;
    target.value = unit === "by_time" ? value : Number(value.replace(",", "."));
  } else if (kind === "count") {
    const n = Number(form.get("per_week"));
    if (!(Number.isInteger(n) && n >= 1 && n <= 21))
      return { error: "Times a week should be between 1 and 21." };
    target.per_week = n;
  }
  if (category === "personal") {
    const label = String(form.get("label") ?? "").trim();
    if (label) target.label = label;
  }
  if (category === "business" && form.get("messages_count") === "on")
    target.work_categories = ["communication"];

  return {
    goal: { category: cat, title, description: null, target, weekly_budget_minutes: weekly, active: true },
  };
}

export async function addGoal(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parse(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const res = await postGoal(parsed.goal);
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/goals");
  revalidatePath("/");
  return { ok: true, message: `Added. ${parsed.goal.title} counts from today.` };
}

export async function editGoal(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parse(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const { active: _a, ...patch } = parsed.goal;
  const res = await patchGoal(id, patch);
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/goals");
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

export async function pauseGoal(id: string, active: boolean): Promise<FormState> {
  const res = await patchGoal(id, { active });
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/goals");
  return {
    ok: true,
    message: active ? "Back on." : "Paused. It stays out of the score until you resume it.",
  };
}

export async function removeGoal(id: string): Promise<FormState> {
  const res = await removeGoalById(id);
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/goals");
  revalidatePath("/");
  return { ok: true, message: "Deleted." };
}
