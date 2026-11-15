"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/action-button";
import { formatTime } from "@/lib/format";
import { disconnectGoogleCalendar, syncGoogleCalendar } from "@/lib/integrations";

export async function syncCalendar(): Promise<ActionResult> {
  let result: ActionResult;
  try {
    await syncGoogleCalendar();
    result = { ok: true, message: `Synced at ${formatTime(new Date())}.` };
  } catch {
    result = { ok: false, message: "I could not reach Google. Try again in a minute." };
  }
  revalidatePath("/you", "layout");
  return result;
}

export async function disconnectCalendar(): Promise<ActionResult> {
  try {
    await disconnectGoogleCalendar();
  } catch {
    return { ok: false, message: "I could not disconnect. Nothing changed." };
  }
  revalidatePath("/you", "layout");
  return { ok: true, message: "Disconnected." };
}
