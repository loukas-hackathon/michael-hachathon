"use client";

import type { TimeWindow } from "@michael/shared";
import { useEffect, useSyncExternalStore } from "react";
import type { MichaelState } from "@/components/michael";
import { readQuietHours } from "./mi-mood-actions";
import { inQuietHours } from "./quiet-hours";

// What the Mi button shows (#319). Pleased lifts once when the user ticks an outcome done;
// concerned while a screen says a goal is behind pace; asleep in the user's quiet hours.
// Otherwise idle. Pleased wins over concerned, concerned over asleep.

const PLEASED_MS = 900;

let pleasedUntil = 0;
let concerned = 0;
// The API's default (DEFAULT_PROFILE) until the user's own window arrives.
let quiet: TimeWindow = { start: "22:00", end: "07:00" };
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

function read(): MichaelState {
  if (Date.now() < pleasedUntil) return "pleased";
  if (concerned > 0) return "concerned";
  return inQuietHours(quiet) ? "asleep" : "idle";
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!loaded) {
    loaded = true;
    readQuietHours()
      .then((q) => {
        if (q) quiet = q;
        notify();
      })
      .catch(() => {
        // Offline or signed out: the default window stands, try again on the next page load.
        loaded = false;
      });
  }
  // The clock moves into and out of quiet hours on its own.
  const clock = setInterval(l, 60_000);
  return () => {
    clearInterval(clock);
    listeners.delete(l);
  };
}

export function useMiState(): MichaelState {
  return useSyncExternalStore(subscribe, read, () => "idle");
}

/** The Mi mark lifts once: the user just ticked an outcome done. */
export function miPleased() {
  pleasedUntil = Date.now() + PLEASED_MS;
  notify();
  setTimeout(notify, PLEASED_MS);
}

/** Rendered beside a line that says a goal is behind pace: the Mi button shows concerned meanwhile. */
export function MiConcerned() {
  useEffect(() => {
    concerned++;
    notify();
    return () => {
      concerned--;
      notify();
    };
  }, []);
  return null;
}
