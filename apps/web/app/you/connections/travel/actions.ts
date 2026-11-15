"use server";

import { LocationSignal } from "@michael/shared";
import { revalidatePath } from "next/cache";
import { sendLocationSignals } from "@/lib/api";

// Server functions behind location (#267): the phone's position. Inputs come from the browser,
// so they are parsed first.

export type PositionResult = { ok: true; at: string | null } | { ok: false };

/** One phone position. Demo visitors and off the record get nothing back; that is fine. */
export async function sendPosition(point: unknown): Promise<PositionResult> {
  const parsed = LocationSignal.safeParse(point);
  if (!parsed.success || parsed.data.kind !== "point") return { ok: false };
  try {
    const r = await sendLocationSignals([parsed.data]);
    return r && r.recorded > 0 ? { ok: true, at: r.at } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** After the one tap ask: refresh the page so the status line shows where you are. */
export async function refreshLocation() {
  revalidatePath("/you/connections/travel");
  revalidatePath("/you");
  revalidatePath("/timeline");
}
