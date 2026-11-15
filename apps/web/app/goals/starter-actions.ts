"use server";

import { revalidatePath } from "next/cache";
import { createGoal, getGoals } from "@/lib/api";
import { isDemoVisitor } from "@/lib/caller";
import { STARTER_GOALS } from "@/lib/starter-goals";

// One tap goals for an account with none yet (#478). The browser sends only the starter's key; the
// title, area and weekly budget come from the list on the server.

export async function addStarterGoal(key: unknown): Promise<{ ok: boolean; message: string | null }> {
  const starter = STARTER_GOALS.find((s) => s.key === key);
  if (!starter) return { ok: false, message: "I don't know that goal." };
  // The demo week is read mostly (#239): nothing is written for a visitor.
  if (await isDemoVisitor()) return { ok: true, message: null };
  try {
    // Never twice: a second tap on a goal already kept does nothing.
    const current = await getGoals();
    if (!current.some((g) => g.active && g.title.toLowerCase() === starter.title.toLowerCase())) {
      await createGoal({
        category: starter.category,
        title: starter.title,
        target: starter.target,
        weekly_budget_minutes: starter.minutes,
      });
    }
    revalidatePath("/goals");
    revalidatePath("/");
    return { ok: true, message: null };
  } catch (err) {
    console.error("starter goal:", err);
    return { ok: false, message: "I could not save that goal. Nothing changed." };
  }
}
