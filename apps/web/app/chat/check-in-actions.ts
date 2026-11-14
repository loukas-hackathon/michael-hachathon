"use server";

import { type CheckIn, CheckInValue } from "@michael/shared";
import { answerCheckIn } from "@/lib/api";

export type CheckInAnswerResult = { ok: true; followUp: CheckIn | null } | { ok: false; error: string };

const ID = /^[0-9a-f-]{36}$/i;

/** Keeps one check in answer (#187). The id and value come from the browser, so both are checked. */
export async function answerCheckInAction(id: string, value: unknown): Promise<CheckInAnswerResult> {
  const v = CheckInValue.safeParse(value);
  if (!ID.test(id) || !v.success) return { ok: false, error: "That answer did not go through. Try again." };
  try {
    const res = await answerCheckIn(id, v.data);
    return { ok: true, followUp: res.follow_up };
  } catch (err) {
    console.error("check in answer:", err);
    return { ok: false, error: "I could not keep that answer. Try again." };
  }
}
