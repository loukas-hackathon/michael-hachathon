"use client";

import { useSyncExternalStore } from "react";

// A laptop wide enough for the dashboards (#285): Today's three columns, You and Chat in two panes.
// The same breakpoint as Tailwind's xl and .m-dash in globals.css.
const WIDE = "(min-width: 1280px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True on a laptop 1280 px and up. False on the server and on phones. */
export function useWide() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}
