import "server-only";
import { cookies } from "next/headers";

// "I don't use a Mac": said once, on Today's Get started card, the Connections hub or the Mac
// page. From then on the Mac is optional: never the next step, never missing progress. Connecting
// the iPhone without a Mac does the same on its own (connections-status.ts, first-run.ts).

export const NO_MAC_COOKIE = "michael_no_mac";

/** True once the person said they do not use a Mac (on this device). */
export async function saidNoMac(): Promise<boolean> {
  try {
    return (await cookies()).get(NO_MAC_COOKIE)?.value === "1";
  } catch {
    return false;
  }
}
