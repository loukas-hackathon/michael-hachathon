"use client";

import { useState } from "react";
import { HEART_COOKIE } from "@/lib/health";

/**
 * The heart rate entry in the Timeline key doubles as its switch: one tap hides or shows the lane.
 * It flips `data-hr` on the day's container (no reload) and remembers the choice for a year.
 */
export function HeartToggle({ target, hidden, range }: { target: string; hidden: boolean; range: string }) {
  const [shown, setShown] = useState(!hidden);
  const flip = () => {
    const next = !shown;
    setShown(next);
    const el = document.getElementById(target);
    if (el) el.dataset.hr = next ? "on" : "off";
    // biome-ignore lint/suspicious/noDocumentCookie: one small preference, read on the server.
    document.cookie = `${HEART_COOKIE}=${next ? "on" : "off"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={shown}
      className={`hit press inline-flex items-center gap-1.5 ${shown ? "" : "line-through opacity-60"}`}
    >
      <svg aria-hidden="true" width="16" height="12" viewBox="0 0 16 12" className="text-label-2">
        <polyline
          points="1,8 4,8 6,3 9,10 11,6 15,6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      Heart rate {range}
      <span className="sr-only">{shown ? ", tap to hide" : ", tap to show"}</span>
    </button>
  );
}
