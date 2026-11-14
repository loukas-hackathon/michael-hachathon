"use server";

import { revalidatePath } from "next/cache";
import { postTestNudge } from "@/lib/api";
import { disconnectTelegram } from "@/lib/integrations";

export async function disconnectTelegramChat() {
  await disconnectTelegram();
  revalidatePath("/you", "layout");
}

/** The test nudge goes to every device and the chat; the message arriving is the feedback. */
export async function sendTelegramTest() {
  try {
    await postTestNudge();
  } catch {
    // Nothing to show: the row stays as it is.
  }
}
