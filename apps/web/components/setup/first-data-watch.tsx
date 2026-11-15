"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { lastDataAt } from "@/lib/first-data-actions";
import {
  type FirstData,
  firstDataLine,
  firstDataState,
  GIVE_UP_AFTER_MS,
  POLL_MS,
  type WatchedConnection,
} from "./first-data";
import { tabMemory } from "./parts";

// The live check under a setup's steps (#306, #307): once the person has started, it waits for the
// first event from this connection and says "Connected. Last data just now.", or after two minutes
// exactly which step to recheck. It is the end to end test: data reached Michael, or it did not.
// Signed-in pages only (the QR setup page on the phone has no session; the laptop shows it there).

type Started = { baseline: string | null; startedAt: number };

const memoryOf = (c: WatchedConnection) => `first-data-${c}`;

/** The note from this tab, unless it is older than the watch lasts (then it starts afresh). */
function savedStart(c: WatchedConnection): Started | null {
  try {
    const s = JSON.parse(tabMemory.get(memoryOf(c)) ?? "null") as Started | null;
    return s && Date.now() - s.startedAt < GIVE_UP_AFTER_MS ? s : null;
  } catch {
    return null;
  }
}

/** True while this tab is watching for the first data (the setup was started here). */
export const hasFirstDataNote = (c: WatchedConnection) => savedStart(c) !== null;

/**
 * Notes the newest arrival before the person jumps into the other app, so data that lands while
 * they are away still counts as new. Safe to call again: the first note wins.
 */
export async function startFirstData(connection: WatchedConnection): Promise<void> {
  if (savedStart(connection)) return;
  const r = await lastDataAt(connection);
  if (!r.ok) return;
  tabMemory.set(memoryOf(connection), JSON.stringify({ baseline: r.at, startedAt: Date.now() }));
}

export function FirstDataWatch({ connection, active }: { connection: WatchedConnection; active: boolean }) {
  const router = useRouter();
  const [started, setStarted] = useState<Started | null>(null);
  const [state, setState] = useState<FirstData | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const memory = memoryOf(connection);

  // Start: note the newest arrival so far. A reload after a jump into another app resumes.
  useEffect(() => {
    if (!active || started) return;
    const saved = savedStart(connection);
    if (saved) {
      setStarted(saved);
      return;
    }
    let cancelled = false;
    void lastDataAt(connection).then((r) => {
      if (cancelled || !r.ok) return;
      const s = { baseline: r.at, startedAt: Date.now() };
      tabMemory.set(memory, JSON.stringify(s));
      setStarted(s);
    });
    return () => {
      cancelled = true;
    };
  }, [active, started, connection, memory]);

  // Ask every few seconds, and at once when the person comes back from the other app.
  useEffect(() => {
    if (!started) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      clearTimeout(timer);
      const r = await lastDataAt(connection);
      if (stop) return;
      const t = Date.now();
      const next = r.ok ? firstDataState(started?.baseline ?? null, r.at, started?.startedAt ?? t, t) : null;
      setNow(t);
      if (next) setState(next);
      if (next?.kind === "arrived") {
        // The status line at the top of the page turns to Connected too.
        startTransition(() => router.refresh());
        return;
      }
      if (next?.kind === "stopped") return;
      timer = setTimeout(check, POLL_MS);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [started, connection, router]);

  if (!active || !started) return null;
  const s = state ?? { kind: "waiting" as const };
  return (
    <p
      role="status"
      className={`m-swap mt-4 min-h-11 rounded-group bg-bg px-4 py-3 text-subhead tnum ${
        s.kind === "arrived" ? "font-semibold" : s.kind === "waiting" ? "text-label-2" : ""
      }`}
    >
      {firstDataLine(connection, s, now)}
    </p>
  );
}
