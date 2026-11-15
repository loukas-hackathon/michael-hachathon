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
    const selector = deepLinkSelector(window.location.search);
    if (!selector) return;
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
  }, []);
  return null;
}
