"use server";

import { GoalBook } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { bookGoal, planWeek } from "@/lib/api";
import { demoRefusal } from "@/lib/demo-refusal";

// Book time from the Goals tab (#309). The id and length come from the browser, so both are
// checked first. Undo goes through the existing undoRecommendationAction.

export type BookResult =
  | { ok: true; id: string; start: string; end: string; undoUntil: string | null }
  | { ok: false; error: string };

const ID = /^[0-9a-f-]{36}$/i;

/** `nextWeek`: Plan next week on Your week (#376), the first free slot from next Monday. */
export async function bookGoalAction(goalId: string, minutes: number, nextWeek = false): Promise<BookResult> {
  const parsed = GoalBook.safeParse({ minutes });
  if (typeof goalId !== "string" || !ID.test(goalId) || !parsed.success)
    return { ok: false, error: "I couldn't book that. Nothing changed." };
  let r: Awaited<ReturnType<typeof bookGoal>>;
  try {
    r = await (nextWeek ? planWeek : bookGoal)(goalId, parsed.data.minutes);
  } catch {
    r = { ok: false, status: 0, message: "" };
  }
  if (!r.ok) {
    const refused = await demoRefusal(r.status);
    if (refused) return { ok: false, error: refused };
    if (r.status === 409 && r.message) return { ok: false, error: `${r.message.replace(/\.$/, "")}.` };
    if (r.status === 0) return { ok: false, error: "I lost the line. Nothing changed." };
    if (r.status === 501) return { ok: false, error: "Booking needs the live calendar. Nothing changed." };
    return { ok: false, error: "That did not work on my side. Nothing changed. Try again in a minute." };
  }
  const p = r.rec.action?.payload ?? {};
  revalidatePath("/");
  revalidatePath("/timeline");
  // Not /week (#376): a fresh review would read the move as already booked and take Undo away.
  return {
    ok: true,
    id: r.rec.id,
    start: String(p.start_at ?? ""),
    end: String(p.end_at ?? ""),
    undoUntil: r.rec.action?.undo_until ?? (typeof p.start_at === "string" ? p.start_at : null),
  };
}
