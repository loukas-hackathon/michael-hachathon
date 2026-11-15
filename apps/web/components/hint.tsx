"use client";

import { type ReactNode, useSyncExternalStore } from "react";

// One time hints: a calm line that points at something a first look would miss (Talk, editing the
// timeline). It goes for good once the person uses the thing or taps Got it, on this device.

const KEY = "michael.hintsSeen";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** The person found it: the hint never shows again on this device. */
export function markHintSeen(id: string) {
  const seen = read();
  if (seen.includes(id)) return;
  cache = [...seen, id];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode: hidden for this session only.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while the hint should show. The server and first paint say no, so nothing flashes. */
export function useHint(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !read().includes(id),
    () => false,
  );
}

/** The hint line: footnote grey, one Got it. Shown only until used or dismissed. */
export function Hint({
  id,
  children,
  className = "",
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const show = useHint(id);
  if (!show) return null;
  return (
    <div data-testid={`hint-${id}`} className={`m-swap flex items-center gap-2 ${className}`}>
      <p className="min-w-0 flex-1 text-footnote text-label-2">{children}</p>
      <button
        type="button"
        onClick={() => markHintSeen(id)}
        className="press -my-2 h-11 shrink-0 px-2 text-footnote font-semibold text-tint-text"
      >
        Got it
      </button>
    </div>
  );
}
