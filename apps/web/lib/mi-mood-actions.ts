"use server";

import type { TimeWindow } from "@michael/shared";
import { getProfile } from "./api";

/** The user's quiet hours for the Mi button, or null when the profile cannot be read. */
export async function readQuietHours(): Promise<TimeWindow | null> {
  return getProfile()
    .then((p) => p.quiet_hours)
    .catch(() => null);
}
