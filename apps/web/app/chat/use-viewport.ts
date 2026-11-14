"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// How close to the bottom still counts as "reading the latest".
const NEAR_END_PX = 96;

const distanceToEnd = () => document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);

/**
 * Whether the user is at the latest line, and a way to go there. The page scrolls (not a box), so
 * the address bar and the tab bar behave as on every other screen.
 */
export function useLatest() {
  const [atEnd, setAtEnd] = useState(true);
  const atEndRef = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      const near = distanceToEnd() < NEAR_END_PX;
      atEndRef.current = near;
      setAtEnd(near);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const toEnd = useCallback((smooth = true) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: smooth && !reduce ? "smooth" : "auto",
    });
  }, []);

  return { atEnd, atEndRef, toEnd };
}

/**
 * The height the on screen keyboard covers, in CSS pixels (0 when it is closed). iPhone Safari
 * keeps the layout viewport and lays the keyboard over it, so a bottom bar must be lifted by hand.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop);
      // Small differences are the address bar collapsing, not a keyboard.
      setInset(covered > 120 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
