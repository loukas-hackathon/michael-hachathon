"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { nudgeAction, nudgeFromHash, type OpenedNudge } from "@/lib/nudge-open";
import { DEEP_LINK_EVENT } from "./deep-link-focus";

/**
 * "From your nudge": tapping a notification opens the app on this card at once, painted from the
 * notification itself (public/sw.js puts it in the URL fragment, which never leaves the device),
 * so the person sees what they tapped while the day streams in underneath.
 *
 * With the app already open the worker does not reload it: it posts the nudge here and this card
 * routes inside the app (a soft navigation from the router cache) and refreshes the data behind it.
 */
export function NudgeOpened() {
  const router = useRouter();
  const pathname = usePathname();
  const [nudge, setNudge] = useState<OpenedNudge | null>(null);

  useEffect(() => {
    const fromHash = () => {
      const n = nudgeFromHash(location.hash);
      if (n) setNudge(n);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);

    const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "nudge-open" || typeof data.url !== "string") return;
      event.ports[0]?.postMessage("ok");
      const target = new URL(data.url, location.href);
      const n = nudgeFromHash(target.hash);
      if (n) setNudge(n);
      const path = target.pathname + target.search;
      if (path !== location.pathname + location.search) {
        router.push(path);
        // The exact block or card (#399) is found once the new screen has rendered.
        window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT, { detail: target.search }));
      } else router.refresh();
    };
    sw?.addEventListener("message", onMessage);
    sw?.startMessages?.();
    return () => {
      window.removeEventListener("hashchange", fromHash);
      sw?.removeEventListener("message", onMessage);
    };
  }, [router]);

  const dismiss = useCallback(() => {
    setNudge(null);
    if (location.hash.startsWith("#nudge="))
      history.replaceState(history.state, "", location.pathname + location.search);
  }, []);

  if (!nudge) return null;
  const action = nudgeAction(nudge.kind);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 pt-[var(--m-safe-top)] lg:pl-64">
      <section
        aria-label="From your nudge"
        data-testid="nudge-opened"
        className="pointer-events-auto mx-auto mt-2 w-[calc(100%-32px)] max-w-[528px] rounded-group bg-bg px-4 py-3 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.35)] ring-1 ring-separator"
      >
        <p className="text-footnote font-semibold text-label-2">
          From your nudge
          {nudge.at ? (
            <>
              {" "}
              at <time className="tnum">{formatTime(new Date(nudge.at))}</time>
            </>
          ) : null}
        </p>
        <p className="mt-0.5 text-body font-semibold">{nudge.text}</p>
        <div className="mt-2 flex items-center gap-2">
          {action && action.href !== pathname ? (
            <Link
              href={action.href}
              onClick={dismiss}
              className="hit press inline-flex min-h-9 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
            >
              {action.label}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            className="hit press inline-flex min-h-9 items-center rounded-full bg-fill px-4 text-subhead font-semibold"
          >
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}
