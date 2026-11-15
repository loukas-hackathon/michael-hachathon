"use server";

import { SourcesStatusResponse } from "@michael/shared";
import type { WatchedConnection } from "@/components/setup/first-data";
import { get } from "./api";
import { isDemoVisitor } from "./caller";
import { connection } from "./connections";

// The live first data check (#306): when did this connection's newest event arrive. Reads the same
// GET /v1/sources/status as the Connections rows, so the setup page and You never disagree.

export type LastData = { ok: true; at: string | null } | { ok: false };

export async function lastDataAt(id: WatchedConnection): Promise<LastData> {
  // The shared demo account is not the visitor's own data: nothing to watch.
  if (await isDemoVisitor()) return { ok: false };
  try {
    const status = SourcesStatusResponse.parse(await get<unknown>("/v1/sources/status"));
    const mine = connection(id).sources;
    const at =
      status.sources
        .filter((s) => mine.includes(s.source))
        .map((s) => s.last_event_at)
        .filter((t): t is string => t !== null)
        .sort()
        .at(-1) ?? null;
    return { ok: true, at };
  } catch {
    // Not signed in on this device (a QR setup page), or the API is down: the watch stays quiet.
    return { ok: false };
  }
}
