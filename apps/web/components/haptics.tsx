"use client";

import { useEffect } from "react";

// Primary buttons (filled pink) and anything marked data-haptic give a tiny tick when pressed.
const SELECTOR = "button.bg-tint, a.bg-tint, [data-haptic]";

let iosSwitch: HTMLLabelElement | null = null;

/**
 * One light tap. Android and Chrome: the Vibration API. iPhone Safari has no such API, but since
 * iOS 18 toggling an <input switch> plays the system selection haptic, so we toggle a hidden one.
 * Elsewhere it does nothing.
 */
export function haptic() {
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
    return;
  }
  if (!/iP(hone|ad|od)/.test(navigator.userAgent)) return;
  if (!iosSwitch) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.append(input);
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

/** Two ticks 90ms apart: Michael did not catch it, or something failed (never a buzz). */
export function hapticTwice() {
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate([8, 90, 8]);
    return;
  }
  haptic();
  setTimeout(haptic, 90);
}

/** Mounted once in the root layout: listens for presses on primary buttons anywhere in the app. */
export function Haptics() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
      if (target && !target.matches(":disabled, [aria-disabled='true']")) haptic();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
