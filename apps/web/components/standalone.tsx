"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// The installed app (Add to Home Screen) has no address bar and no back button. Anything that
// loads a file or another site in its own window leaves the person stuck there (Loukas, 15 Nov),
// so links that leave the app open a new page in standalone mode, and pages outside the tab bar
// get their own Close.

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** True inside the installed app. False on the server and until mounted, so the first render matches. */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => setStandalone(isStandalone()), []);
  return standalone;
}

/**
 * Close for a page the installed app can land on without the tab bar (the QR setup page). Back
 * where the person came from, or Today when this page was the first one. Nothing in a browser tab,
 * which has its own back button; the row keeps its height either way, so nothing jumps.
 */
export function StandaloneClose() {
  const standalone = useStandalone();
  const router = useRouter();
  return (
    <div className="flex min-h-11 items-center justify-end pt-2">
      {standalone ? (
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.replace("/"))}
          className="press -mr-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text"
        >
          Close
        </button>
      ) : null}
    </div>
  );
}
