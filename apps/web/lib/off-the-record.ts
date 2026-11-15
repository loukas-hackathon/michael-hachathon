"use client";

import { useSyncExternalStore } from "react";
import { readPrivacy, saveOffTheRecord } from "./privacy-actions";

// Off the record: one tap stops all collection, and the state shows on every tab.
// The API holds the truth (PUT /v1/privacy/off-the-record), so it also stops ingest from the
// collectors. The browser keeps a copy so the first paint is right, then syncs with the API once.

const KEY = "michael.offTheRecord";
type State = { on: boolean; since: string | null; failed: boolean };
const OFF: State = { on: false, since: null, failed: false };

let cache: State | null = null;
let synced = false;
const listeners = new Set<() => void>();

function set(next: State) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ on: next.on, since: next.since }));
  } catch {
    // Private mode or blocked storage: the state still holds for this session.
  }
  for (const l of listeners) l();
}

function read(): State {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? { ...OFF, ...(JSON.parse(raw) as Partial<State>), failed: false } : OFF;
  } catch {
    cache = OFF;
  }
  return cache;
}

function sync() {
  if (synced) return;
  synced = true;
  readPrivacy()
    .then((p) => {
      // Usually the local copy was already right: then no listener needs to render again.
      const now = read();
      if (now.on === p.off_the_record && now.since === p.since && !now.failed) return;
      set({ on: p.off_the_record, since: p.since, failed: false });
    })
    .catch(() => {
      // Offline or signed out: keep the local copy, try again on the next page load.
      synced = false;
    });
}

export function setOffTheRecord(on: boolean) {
  const before = read();
  set({ on, since: on ? new Date().toISOString() : null, failed: false });
  saveOffTheRecord(on)
    .then((p) => set({ on: p.off_the_record, since: p.since, failed: false }))
    .catch(() => set({ ...before, failed: true }));
}

function subscribe(l: () => void) {
  listeners.add(l);
  sync();
  return () => listeners.delete(l);
}

export function useOffTheRecord(): State {
  return useSyncExternalStore(subscribe, read, () => OFF);
}
