"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/action-button";
import { postTestNudge } from "@/lib/api";
import { disconnectTelegram, telegramConnectUrl } from "@/lib/integrations";

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

/**
 * The t.me link with a one-time start token, for the installed app: it opens Telegram itself
 * (tg://) instead of loading the /integrations/telegram/connect redirect in its own window.
 */
export async function telegramLink(): Promise<{ url: string } | { error: string }> {
  try {
    return { url: await telegramConnectUrl() };
  } catch {
    return { error: "I could not reach Telegram. Try again in a minute." };
  }
}
