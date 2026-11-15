"use client";

import { type ReactNode, useEffect, useState } from "react";
import { INSTALL_DISMISSED_KEY, type InstallPlatform, installPlatform } from "@/lib/install-platform";
import { Sheet } from "./sheet";

// "Get the app": one quiet line under "See the demo week" on /login, only in a browser tab.
// Safari on iPhone opens the three Home Screen steps; other iPhone browsers are sent to Safari;
// Chrome and Edge get their own install prompt; browsers that cannot install see nothing.

// Chrome and Edge fire this when Michael can be installed; Safari and Firefox never do.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {
    // Private mode or blocked storage: hidden for this visit only.
  }
}

const WHY = "Nudges and your Apple Watch only work from Michael on your Home Screen.";

export function InstallApp() {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const standalone = ["standalone", "fullscreen", "minimal-ui"].some(
      (m) => window.matchMedia(`(display-mode: ${m})`).matches,
    );
    const p = installPlatform({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone,
      iosStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
    setPlatform(p);
    setHidden(readDismissed());
    if (p !== "wait-for-prompt") return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    rememberDismissed();
    setOpen(false);
    setHidden(true);
  };

  const ios = platform === "ios-safari" || platform === "ios-other";
  const show = !hidden && (ios || (platform === "wait-for-prompt" && prompt !== null));

  const install = async () => {
    if (!prompt) return;
    // A prompt can only be shown once: drop it now, whatever the answer.
    setPrompt(null);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setHidden(true);
      else dismiss();
    } catch {
      // Chrome refused to show it again; the row has gone with the spent prompt.
    }
  };

  return (
    // The line's height is kept while it decides, so nothing below jumps; an installed app never
    // shows the row, so CSS frees the space there before any script runs.
    <div className="flex h-11 justify-center [@media(display-mode:standalone)]:hidden">
      {show ? (
        <button
          type="button"
          onClick={ios ? () => setOpen(true) : install}
          className="press m-swap flex h-11 items-center gap-1.5 px-3 text-subhead text-label-2"
        >
          <AddIcon className="size-[18px]" />
          {ios ? "Get the app" : "Install Michael"}
        </button>
      ) : null}
      {ios ? (
        <Sheet open={open} onClose={() => setOpen(false)} title="Get the app" closeLabel="Done">
          {platform === "ios-safari" ? <SafariSteps /> : <OpenInSafari />}
          <div className="mt-5 flex justify-center">
            <button type="button" onClick={dismiss} className="press h-11 px-3 text-subhead text-label-2">
              Don't show this again
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function SafariSteps() {
  return (
    <>
      <p className="text-subhead text-label-2">{WHY}</p>
      <ol className="mt-4 flex flex-col overflow-hidden rounded-group bg-fill">
        <Step icon={<ShareIcon className="size-[22px]" />}>
          Tap <span className="font-semibold">Share</span>
        </Step>
        <Step icon={<AddIcon className="size-[22px]" />}>
          Tap <span className="font-semibold">Add to Home Screen</span>
        </Step>
        <Step
          icon={
            // biome-ignore lint/performance/noImgElement: a 28px static icon, next/image buys nothing
            <img src="/icon-180.png" alt="" width={28} height={28} className="size-7 rounded-[7px]" />
          }
        >
          Open Michael from your Home Screen
        </Step>
      </ol>
      <p className="mt-3 text-footnote text-label-2">Notifications need iOS 16.4 or later.</p>
    </>
  );
}

function Step({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    // The separator starts after the icon, as iOS insets it (52px from the left).
    <li className="group flex items-center gap-3 pl-4">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center">
        {icon}
      </span>
      <span className="flex min-h-12 flex-1 items-center border-separator py-2 pr-4 text-body group-not-last:border-b-[0.5px]">
        <span>{children}</span>
      </span>
    </li>
  );
}

function OpenInSafari() {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(window.location.href), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState("copied");
    } catch {
      // Clipboard blocked in this in-app view: only then does the address show, to copy by hand.
      setState("blocked");
    }
  };

  return (
    <>
      <p className="text-body font-semibold">Open this page in Safari to install.</p>
      <p className="mt-1 text-subhead text-label-2">{WHY}</p>
      <div className="mt-4 flex items-center gap-2 rounded-group bg-fill py-1.5 pr-1.5 pl-4">
        {state === "blocked" ? (
          <code className="min-w-0 flex-1 truncate text-footnote select-all">{url}</code>
        ) : (
          <span role="status" className="min-w-0 flex-1 truncate text-subhead text-label-2">
            {state === "copied" ? "Copied. Paste it in Safari." : "Michael's link"}
          </span>
        )}
        <button
          type="button"
          onClick={copy}
          className="hit press min-h-9 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text"
        >
          {state === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>
    </>
  );
}

/** iOS's Share glyph: a tray with an arrow up. */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v12M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M8.5 10H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10h-2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** iOS's Add to Home Screen glyph: a plus in a rounded square. */
function AddIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className={className}
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}
