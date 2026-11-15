"use client";

import { useEffect } from "react";
import { deepLinkSelector } from "@/lib/deep-link";

const WAIT_MS = 5000;
const MARK_MS = 2400;

/**
 * Tapping a nudge opens the exact card (#399): `/timeline?day=..&block=<event id>` or
 * `/?card=<recommendation id>`. This finds that block or card once it has rendered, brings it into
 * view and marks it briefly. Nothing happens without those parameters.
 */
export function DeepLinkFocus() {
  useEffect(() => {
    let stopCurrent = () => {};
    const run = (event?: Event) => {
      stopCurrent();
      const search = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : null;
      stopCurrent = focusDeepLink(search ?? window.location.search);
    };
    run();
    // A nudge tapped while the app is open routes inside it (components/nudge-opened.tsx), so the
    // layout does not mount again: it says so with this event.
    window.addEventListener(DEEP_LINK_EVENT, run);
    return () => {
      window.removeEventListener(DEEP_LINK_EVENT, run);
      stopCurrent();
    };
  }, []);
  return null;
}

/** Detail: the search string of the screen being opened ("?card=..."). */
export const DEEP_LINK_EVENT = "m-deep-link";

function focusDeepLink(search: string): () => void {
  const selector = deepLinkSelector(search);
  if (!selector) return () => {};
  let done = false;
  const find = () => {
    if (done) return;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    done = true;
    observer.disconnect();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    el.classList.add("m-deep-link");
    window.setTimeout(() => el.classList.remove("m-deep-link"), MARK_MS);
  };
  const observer = new MutationObserver(find);
  observer.observe(document.body, { childList: true, subtree: true });
  find();
  const stop = window.setTimeout(() => observer.disconnect(), WAIT_MS);
  return () => {
    done = true;
    observer.disconnect();
    window.clearTimeout(stop);
  };
}
