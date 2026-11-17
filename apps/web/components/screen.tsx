"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { useMiState } from "@/lib/mi-mood";
import { useOffTheRecord } from "@/lib/off-the-record";
import { useWakeArmed } from "@/lib/wake-word";
import { Michael } from "./michael";

/**
 * The Mi button: top right on every tab. Opens the You sheet. Dimmed while off the record. Its dot
 * lifts when an outcome is ticked done, tilts beside a goal behind pace, rests in quiet hours.
 */
export function MiButton({ size = 30 }: { size?: number }) {
  const { on } = useOffTheRecord();
  const mi = useMiState();
  // "Yo Michael" is listening for his name: a still ring 2px outside the circle, the privacy sign.
  const armed = useWakeArmed();
  return (
    <Link
      href="/you"
      aria-label={on ? "You, off the record" : armed ? "You. Listening for my name" : "You"}
      data-armed={armed || undefined}
      className="press grid shrink-0 place-items-center rounded-full"
      style={{
        width: Math.max(size, 44),
        height: Math.max(size, 44),
        margin: size < 44 ? -(44 - size) / 2 : 0,
      }}
    >
      <span
        data-testid={armed ? "wake-armed" : undefined}
        className={`grid place-items-center rounded-full transition-[background-color,color] duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] ${armed ? "m-armed" : ""} ${
          on ? "bg-label-2 text-bg" : "bg-label text-bg"
        }`}
        style={{ width: size, height: size }}
      >
        <span style={{ width: Math.round(size * 0.56) }} className="block">
          <Michael state={mi} className="block h-auto w-full" />
        </span>
      </span>
    </Link>
  );
}

/** The grey line every tab shows while collection is stopped. */
export function OffTheRecordLine() {
  const { on, since } = useOffTheRecord();
  if (!on) return null;
  return (
    <p className="mt-2 rounded-group bg-fill px-3 py-2 text-footnote text-label-2 tnum">
      Off the record{since ? ` since ${formatTime(since)}` : ""}. Nothing is being collected.
    </p>
  );
}

/** Context line + Mi button, then the large title, as in Apple's own apps. */
export function ScreenHeader({
  context,
  title,
  actions,
  pinned = false,
}: {
  context: ReactNode;
  title: string;
  /** Extra buttons left of the Mi button, as in Apple's navigation bars. */
  actions?: ReactNode;
  /**
   * The context line and the buttons stay at the top while the page scrolls (Chat: New chat and the
   * conversations are always one tap away). The large title scrolls away under them, and a hairline
   * shows once something is under the bar, as in Apple's navigation bars.
   */
  pinned?: boolean;
}) {
  const scrolled = useScrolled(pinned);
  return (
    // Pinned: the header is not a box, so the bar sticks for the whole screen, not only the header.
    <header className={pinned ? "contents" : "pt-2"}>
      <div
        data-scrolled={pinned ? scrolled : undefined}
        className={
          pinned
            ? "sticky top-0 z-20 -mx-4 -mt-[var(--m-safe-top)] flex min-h-11 items-center justify-between gap-3 bg-bg px-4 lg:mx-0 lg:px-0 pt-[calc(var(--m-safe-top)+8px)] shadow-[0_0.5px_0_transparent] transition-shadow duration-[var(--m-dur-ui)] data-[scrolled=true]:shadow-[0_0.5px_0_var(--m-separator)]"
            : "flex min-h-11 items-center justify-between gap-3"
        }
      >
        <p className="min-w-0 text-footnote font-semibold text-label-2 tnum">{context}</p>
        <div className="flex items-center gap-3.5">
          {actions}
          {/* Laptop: the Mi sits at the foot of the sidebar instead (components/tab-bar.tsx). */}
          <div className="contents lg:hidden">
            <MiButton />
          </div>
        </div>
      </div>
      <h1 className="text-large-title font-bold tracking-[0.01em]">{title}</h1>
      <OffTheRecordLine />
    </header>
  );
}

/** True once the page has scrolled past its top: a pinned bar's hairline. */
function useScrolled(on: boolean) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!on) return;
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [on]);
  return scrolled;
}
