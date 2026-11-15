"use server";

import type { Dnd } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { demoRefusal } from "@/lib/demo-refusal";
import { endDnd, sendLatePhoneNudge, startDnd } from "@/lib/dnd-server";

// Do Not Disturb (#447): the tap and the end, from the hand over page. Ids come from the browser,
// so they are checked first. Each answer is the Do Not Disturb or one line in Michael's words.

export type DndActionResult = { ok: true; dnd: Dnd } | { ok: false; error: string };

const ID = /^[0-9a-f-]{36}$/i;
const NOTHING = "I could not do that. Nothing changed.";

async function refusal(status: number, message: string): Promise<string> {
  const demo = await demoRefusal(status);
  if (demo) return demo;
  if (status === 0) return "I could not reach the server. Nothing changed.";
  if ((status === 409 || status === 404 || status === 400 || status === 403) && message)
    return `${message.replace(/\.$/, "")}.`;
  if (status === 501) return "Do Not Disturb needs the live API. Nothing changed.";
  return "That did not work on my side. Nothing changed. Try again in a minute.";
}

/** Switch it on for a nudge: until its block ends, or until the night's quiet hours end. */
export async function startDndAction(nudgeId: string): Promise<DndActionResult> {
  if (typeof nudgeId !== "string" || !ID.test(nudgeId)) return { ok: false, error: NOTHING };
  const r = await startDnd({ nudge_id: nudgeId });
  if (!r.ok) return { ok: false, error: await refusal(r.status, r.message) };
  // Today shows it among what Michael did, with its Undo.
  revalidatePath("/");
  return { ok: true, dnd: r.dnd };
}

/** End it now. */
export async function endDndAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof id !== "string" || !ID.test(id)) return { ok: false, error: NOTHING };
  const r = await endDnd(id);
  if (!r.ok) return { ok: false, error: await refusal(r.status, r.message) };
  revalidatePath("/");
  return { ok: true };
}

/**
 * Try it from the set up step: sends the phone before sleep nudge now, to this person's own
 * devices. The line that went out, for the page to show.
 */
export async function tryDndNudgeAction(): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  const text = await sendLatePhoneNudge();
  if (!text) return { ok: false, error: "I could not send it. Check that nudges are on for this device." };
  return { ok: true, text };
}
