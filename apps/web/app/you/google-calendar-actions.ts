"use server";

import { revalidatePath } from "next/cache";
import { disconnectGoogleCalendar, syncGoogleCalendar } from "@/lib/integrations";

export async function syncCalendar() {
  try {
    await syncGoogleCalendar();
  } catch {
    // The row shows the integration's own error after the refresh.
  }
  revalidatePath("/you");
}

export async function disconnectCalendar() {
  await disconnectGoogleCalendar();
  revalidatePath("/you");
}
