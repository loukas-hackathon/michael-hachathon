"use client";

import { useEffect, useState } from "react";

// Chrome and Android fire this event when the app can be installed; iPhone Safari never does.
type InstallPromptEvent = Event & { prompt: () => Promise<void> };

// "Add Michael to your Home Screen": one tap on Android and desktop, a two step hint on iPhone.
// Hidden when already running as an installed app.
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");

  useEffect(() => {
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) return;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) setMode("ios");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (mode === "hidden") return null;

  if (mode === "ios") {
    return (
      <div className="rounded-group bg-fill px-4 py-3">
        <p className="text-body font-semibold">Put Michael on your Home Screen</p>
        <p className="text-subhead text-label-2">
          Tap Share, then Add to Home Screen. Nudges on iPhone need it.
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        await prompt?.prompt();
        setMode("hidden");
      }}
      className="press flex h-12 w-full items-center justify-center rounded-group bg-fill text-body font-semibold text-tint-text"
    >
      Install Michael
    </button>
  );
}
