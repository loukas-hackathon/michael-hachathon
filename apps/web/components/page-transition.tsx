"use client";

import { type ReactNode, ViewTransition } from "react";

/**
 * Tab switches crossfade the screen with a small rise; the tab bar has its own transition name, so
 * it never moves. Only navigations tagged "tab" (components/tab-bar.tsx) animate: refreshes, sheets
 * and form actions stay instant. Browsers without the View Transitions API simply swap the screen,
 * and reduced motion turns it off (globals.css, "Motion").
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default={{ tab: "m-tab", default: "none" }}>
      <div>{children}</div>
    </ViewTransition>
  );
}
