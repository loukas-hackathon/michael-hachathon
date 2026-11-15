"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { type ConnectionId, connection } from "@/lib/connections";
import type { ConnectionState } from "@/lib/connections-status";
import {
  arrivedFrom,
  FRESH_MS,
  isOn,
  type LiveConnection,
  landed,
  POLL_MS,
  WAIT_MS,
} from "@/lib/live-connections";

// Connections that update the moment they land (#466). Loukas connected and saw nothing change
// until he reloaded. Now:
//   - A flow that finishes elsewhere (Telegram /start, the Mac, the watch or iPhone shortcut,
//     Claude) puts its row in a waiting state: "Waiting for Telegram…" with the Mi mark breathing.
//     While waiting and the page is visible, GET /live/connections every 2 s for up to 2 minutes,
//     and again on focus and visibilitychange, so coming back from Telegram flips it at once.
//   - A flow that comes back to the app (the Google return, push permission, location) shows
//     Connected at once.
//   - Either way the row pops from Not connected to Connected, it is said once to a screen reader,
//     the server data refreshes behind it, and for a minute the line says what arrived.
// The waiting state lives in sessionStorage, so it survives the hop to a setup page or a reload.

const WAITING_KEY = "michael.connect.waiting";
/** Coming back to the page checks at once; while nothing is on its way, at most every 5 s. */
const QUIET_RETURN_MS = 5_000;

type Ctx = {
  live: ReadonlyMap<ConnectionId, LiveConnection>;
  waiting: ConnectionId | null;
  /** Landed while on screen: the row pops in and says what arrived. */
  arrived: ReadonlySet<ConnectionId>;
  wait: (id: ConnectionId) => void;
  arrive: (id: ConnectionId) => void;
};

const NONE: Ctx = {
  live: new Map(),
  waiting: null,
  arrived: new Set(),
  wait: () => {},
  arrive: () => {},
};

const LiveContext = createContext<Ctx>(NONE);

function readWaiting(): { id: ConnectionId; until: number } | null {
  try {
    const raw = sessionStorage.getItem(WAITING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: string; until?: number };
    return typeof v.id === "string" && typeof v.until === "number"
      ? { id: v.id as ConnectionId, until: v.until }
      : null;
  } catch {
    return null;
  }
}

function writeWaiting(v: { id: ConnectionId; until: number } | null) {
  try {
    if (v) sessionStorage.setItem(WAITING_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(WAITING_KEY);
  } catch {}
}

export function ConnectionsLive({
  initial,
  children,
}: {
  /** What the server rendered: the baseline a change is measured against. */
  initial: { id: ConnectionId; state: ConnectionState }[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [live, setLive] = useState<ReadonlyMap<ConnectionId, LiveConnection>>(() => new Map());
  const [waiting, setWaiting] = useState<ConnectionId | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<ConnectionId>>(() => new Set());
  const [said, setSaid] = useState("");

  const baseline = useRef(new Map(initial.map((r) => [r.id, r.state])));
  const liveRef = useRef(live);
  const arrivedRef = useRef(arrived);
  const waitingRef = useRef<ConnectionId | null>(null);
  // Poll every 2 s until this moment (waiting, or the first minute after it landed).
  const until = useRef(0);
  // Shown as Connected before the server says so (push, location): kept until it agrees.
  const optimistic = useRef(new Set<ConnectionId>());
  const inflight = useRef(false);
  const lastCheck = useRef(0);

  const announce = useCallback((ids: ConnectionId[]) => {
    const fresh = ids.filter((id) => !arrivedRef.current.has(id));
    if (!fresh.length) return;
    const next = new Set(arrivedRef.current);
    for (const id of fresh) next.add(id);
    arrivedRef.current = next;
    setArrived(next);
    setSaid(fresh.map((id) => `${connection(id).name} connected.`).join(" "));
    until.current = Math.max(until.current, Date.now() + FRESH_MS);
  }, []);

  const stopWaiting = useCallback(() => {
    waitingRef.current = null;
    setWaiting(null);
    writeWaiting(null);
  }, []);

  const check = useCallback(async () => {
    // Nothing to follow (the demo week, a preview): never poll.
    if (inflight.current || baseline.current.size === 0) return;
    inflight.current = true;
    lastCheck.current = Date.now();
    try {
      const res = await fetch("/live/connections", { cache: "no-store" });
      if (res.status !== 200) return;
      const { rows } = (await res.json()) as { rows: LiveConnection[] };
      const now = Date.now();
      const before = baseline.current;
      const changed = rows.some((r) => before.get(r.id) !== r.state);
      const newly = landed(before, rows);
      baseline.current = new Map(rows.map((r) => [r.id, r.state]));

      const next = new Map<ConnectionId, LiveConnection>();
      for (const r of rows) {
        if (optimistic.current.has(r.id)) {
          if (isOn(r.state)) optimistic.current.delete(r.id);
          else if (now < until.current) {
            next.set(r.id, { ...r, state: "on", fresh: liveRef.current.get(r.id)?.fresh ?? null });
            continue;
          } else optimistic.current.delete(r.id);
        }
        next.set(r.id, r);
      }
      liveRef.current = next;
      setLive(next);
      announce(newly);

      const w = waitingRef.current;
      if (w && isOn(next.get(w)?.state)) stopWaiting();
      // The rest of the screen (counts, the connection's own page) follows, keeping what is shown.
      if (changed) startTransition(() => router.refresh());
    } catch {
      // Offline or asleep: keep what is on screen, the next tick tries again.
    } finally {
      inflight.current = false;
    }
  }, [announce, router, stopWaiting]);

  const wait = useCallback((id: ConnectionId) => {
    const v = { id, until: Date.now() + WAIT_MS };
    waitingRef.current = id;
    setWaiting(id);
    until.current = Math.max(until.current, v.until);
    writeWaiting(v);
  }, []);

  const arrive = useCallback(
    (id: ConnectionId) => {
      optimistic.current.add(id);
      until.current = Math.max(until.current, Date.now() + FRESH_MS);
      const prev = liveRef.current.get(id);
      const next = new Map(liveRef.current).set(id, { id, state: "on", fresh: prev?.fresh ?? null });
      liveRef.current = next;
      setLive(next);
      if (!isOn(baseline.current.get(id))) announce([id]);
      if (waitingRef.current === id) stopWaiting();
      void check();
    },
    [announce, check, stopWaiting],
  );

  // A server render (router.refresh, a server action) is the newest truth: it becomes the
  // baseline, and live values that disagree with it are dropped, unless shown optimistically.
  const initialKey = initial.map((r) => `${r.id}:${r.state}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for `initial`.
  useEffect(() => {
    const server = new Map(initial.map((r) => [r.id, r.state]));
    baseline.current = server;
    const kept = new Map<ConnectionId, LiveConnection>();
    for (const [id, r] of liveRef.current) {
      if (server.get(id) === r.state || optimistic.current.has(id)) kept.set(id, r);
    }
    liveRef.current = kept;
    setLive(kept);
  }, [initialKey]);

  // On arrival: back from Google (?connected=...), or a wait that was running before a reload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount.
  useEffect(() => {
    const url = new URL(window.location.href);
    const back = arrivedFrom(url.searchParams.get("connected"));
    if (back) {
      // The server already says Connected; the row pops, it is said once, and a reload does not
      // replay it. The data behind it refreshes over the next minute.
      arrive(back);
      announce([back]);
      url.searchParams.delete("connected");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const w = readWaiting();
    if (w && w.until > Date.now()) {
      if (isOn(baseline.current.get(w.id))) {
        // It landed while we were away (the Telegram app, the Mac): say so now.
        writeWaiting(null);
        announce([w.id]);
      } else {
        waitingRef.current = w.id;
        setWaiting(w.id);
        until.current = Math.max(until.current, w.until);
        void check();
      }
    } else if (w) writeWaiting(null);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (now >= until.current) {
        if (waitingRef.current) stopWaiting();
        return;
      }
      if (document.visibilityState === "visible") void check();
    };
    const id = setInterval(tick, POLL_MS);
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      const gap = Date.now() < until.current ? 500 : QUIET_RETURN_MS;
      if (Date.now() - lastCheck.current > gap) void check();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    window.addEventListener("pageshow", onBack);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("pageshow", onBack);
    };
  }, [check, stopWaiting]);

  const value = useMemo<Ctx>(
    () => ({ live, waiting, arrived, wait, arrive }),
    [live, waiting, arrived, wait, arrive],
  );

  return (
    <LiveContext.Provider value={value}>
      {children}
      {/* Said once, quietly: no toast, the row itself shows it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </LiveContext.Provider>
  );
}

/** One connection as it is right now: the server's word, unless a newer one arrived. */
export function useLiveConnection(id: ConnectionId, serverState: ConnectionState, serverFresh?: string) {
  const ctx = useContext(LiveContext);
  const l = ctx.live.get(id);
  const state = l?.state ?? serverState;
  return {
    state,
    fresh: l?.fresh ?? serverFresh ?? null,
    waiting: ctx.waiting === id && !isOn(state),
    arrived: ctx.arrived.has(id) && isOn(state),
    wait: () => ctx.wait(id),
    arrive: () => ctx.arrive(id),
  };
}

/** For a flow that comes back to the app (push permission, location): call it when it worked. */
export function useArriveConnection(id: ConnectionId) {
  const { arrive } = useContext(LiveContext);
  return useCallback(() => arrive(id), [arrive, id]);
}
