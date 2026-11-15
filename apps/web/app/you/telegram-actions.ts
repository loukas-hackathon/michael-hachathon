"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/action-button";
import { postTestNudge } from "@/lib/api";
import { disconnectTelegram } from "@/lib/integrations";

export async function disconnectTelegramChat(): Promise<ActionResult> {
  try {
    await disconnectTelegram();
  } catch {
    return { ok: false, message: "I couldn't disconnect. Nothing changed." };
  }
  revalidatePath("/you", "layout");
  return { ok: true, message: "Disconnected." };
}

/** The test nudge goes to every device and the chat. */
export async function sendTelegramTest(): Promise<ActionResult> {
  try {
    await postTestNudge();
    return { ok: true, message: "Sent. Check Telegram." };
  } catch {
    return { ok: false, message: "I couldn't send it. Try again in a minute." };
  }
}
