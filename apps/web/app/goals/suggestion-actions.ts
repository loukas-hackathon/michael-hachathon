"use server";

import { type GoalSuggestion, GoalSuggestionAccept } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { acceptGoalSuggestion, getGoalSuggestions } from "@/lib/api";

// Goals from the calendar (#134): read the suggestions, keep one. Used by onboarding's goals step,
// the Goals tab and the calendar row on You.

export async function loadGoalSuggestions(): Promise<GoalSuggestion[]> {
  return getGoalSuggestions();
}

export async function keepGoalSuggestion(
  id: string,
  edits: unknown,
): Promise<{ ok: boolean; message: string | null }> {
  if (typeof id !== "string" || id.length === 0 || id.length > 120)
    return { ok: false, message: "Unknown goal." };
  const parsed = GoalSuggestionAccept.safeParse(edits ?? {});
  if (!parsed.success) return { ok: false, message: "Hours a week should be between 0 and 168." };
  const res = await acceptGoalSuggestion(id, parsed.data);
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath("/goals");
  revalidatePath("/");
  return { ok: true, message: null };
}
