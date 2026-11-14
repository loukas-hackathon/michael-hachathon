"use client";

import { useSyncExternalStore } from "react";

// Where the check in's answers live until the API (#187) takes them: this browser, so the Chat
// tab's dot can clear. Questions and copy are in check-in-data.ts.
// TODO(#187): post the answers to the API instead.

import type { Answer } from "./check-in-data";

const KEY = "michael.checkIn.sample";
type State = { answers: Record<string, Answer>; done: boolean };
const EMPTY: State = { answers: {}, done: false };
let cache: State | null = null;
const listeners = new Set<() => void>();

function read(): State {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as State) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: State) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the answers hold for this visit.
  }
  for (const l of listeners) l();
}

export function answer(id: string, value: Answer) {
  const s = read();
  write({ ...s, answers: { ...s.answers, [id]: value } });
}

export function finish() {
  write({ ...read(), done: true });
}

export function resetCheckIn() {
  write(EMPTY);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useCheckIn(): State {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
