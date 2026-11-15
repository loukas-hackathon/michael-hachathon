"use server";

import { type FocusActiveResponse, type FocusSession, FocusStart } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { demoRefusal } from "@/lib/demo-refusal";
import { type FocusResult, focusCall, getFocusActive } from "@/lib/focus";

// Focus now (#397) from any screen: start, +15, end, and the session as it is now. Ids and lengths
// come from the browser, so they are checked first. Each answer is the session or one line in
// Michael's words for the control to show.

export type FocusActionResult = { ok: true; session: FocusSession } | { ok: false; error: string };

const ID = /^[0-9a-f-]{36}$/i;
const NOTHING = "I could not do that. Nothing changed.";

async function answer(r: FocusResult, changed: boolean): Promise<FocusActionResult> {
  if (r.ok) {
    if (changed) {
      // Today, Goals and the Timeline read the new block and the counted time at once.
      revalidatePath("/");
      revalidatePath("/goals");
      revalidatePath("/timeline");
    }
    return { ok: true, session: r.session };
  }
  const refused = await demoRefusal(r.status);
  if (refused) return { ok: false, error: refused };
  if (r.status === 0) return { ok: false, error: "I could not reach the server. Nothing changed." };
  if ((r.status === 409 || r.status === 404 || r.status === 400) && r.message)
    return { ok: false, error: `${r.message.replace(/\.$/, "")}.` };
  if (r.status === 501) return { ok: false, error: "Focus now needs the live API. Nothing changed." };
  return { ok: false, error: "That did not work on my side. Nothing changed. Try again in a minute." };
}

export async function startFocusAction(input: {
  goalId?: string;
  minutes?: number;
  eventId?: string;
}): Promise<FocusActionResult> {
  const body = {
    ...(input.goalId ? { goal_id: input.goalId } : {}),
    ...(input.minutes ? { minutes: input.minutes } : {}),
    ...(input.eventId ? { event_id: input.eventId } : {}),
  };
  if (!FocusStart.safeParse(body).success) return { ok: false, error: NOTHING };
  return answer(await focusCall("/v1/focus/start", body), true);
}

export async function extendFocusAction(id: string): Promise<FocusActionResult> {
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, error: NOTHING };
  return answer(await focusCall(`/v1/focus/${id}/extend`, {}), true);
}

/** End the session: on time, or early with the minutes so far counted (`count`) or not. */
export async function endFocusAction(id: string, count: boolean): Promise<FocusActionResult> {
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, error: NOTHING };
  return answer(await focusCall(`/v1/focus/${id}/end`, { count: count === true }), true);
}

/** The running session and the one that just stopped, for the screen that reattaches. */
export async function focusActiveAction(): Promise<FocusActiveResponse | null> {
  return getFocusActive();
}
