"use client";

import { useSyncExternalStore } from "react";

// Off the record: one tap stops all collection, and the state shows on every tab.
// Kept in the browser until PUT /v1/privacy/off-the-record is live (docs/api.md, status stub).
// TODO(#50): call the privacy API through a server action and read its `since`.

const KEY = "michael.offTheRecord";
type State = { on: boolean; since: string | null };
const OFF: State = { on: false, since: null };

let cache: State | null = null;
const listeners = new Set<() => void>();

function read(): State {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as State) : OFF;
  } catch {
    cache = OFF;
  }
  return cache;
}

export function setOffTheRecord(on: boolean) {
  cache = on ? { on: true, since: new Date().toISOString() } : OFF;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode or blocked storage: the state still holds for this session.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useOffTheRecord(): State {
  return useSyncExternalStore(subscribe, read, () => OFF);
}
