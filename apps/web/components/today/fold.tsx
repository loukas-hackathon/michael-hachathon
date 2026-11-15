"use client";

import { createContext, type ReactNode, useContext, useId, useState, useSyncExternalStore } from "react";
import { Collapse } from "@/components/motion-ui";

// Today's supporting detail ("More from Michael"): one inset group of quiet rows. Each row shows a
// title and one line, and opens in place: the body eases open under it while the preview line folds
// away, and the rows below slide down (Collapse). Server components can render it as before.

// On a laptop (1280 px and up) Today has room for the detail, so the rows of "More from Michael"
// start open there (#285). CSS opens them from the first paint ([data-wide-open] in globals.css),
// so nothing moves when the page hydrates; the state follows once the media query is known.
const WIDE = "(min-width: 1280px)";
const WideOpen = createContext(false);

function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True on a laptop wide enough for Today's three columns. False on the server and on phones. */
function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * The "More from Michael" section. Hides itself when no row inside rendered anything, so an empty
 * group never leaves a lonely heading behind. `wideOpen`: its rows start open on a laptop.
 */
export function MoreFromMichael({
  children,
  wideOpen = false,
  className = "",
}: {
  children: ReactNode;
  wideOpen?: boolean;
  className?: string;
}) {
  return (
    <section aria-label="More from Michael" className={`m-reveal mt-8 has-[>div:empty]:hidden ${className}`}>
      <h2 className="mb-2 text-title3 font-bold">More from Michael</h2>
      <WideOpen value={wideOpen}>
        <div className="overflow-hidden rounded-group bg-fill">{children}</div>
      </WideOpen>
    </section>
  );
}

/** One row: title, optional time on the right, one line of preview; the body opens under it. */
export function Fold({
  title,
  preview,
  meta,
  label,
  wideOpen = false,
  children,
}: {
  title: string;
  preview?: ReactNode;
  meta?: ReactNode;
  /** Accessible name when the title alone is not enough. */
  label?: string;
  /** Starts open on a laptop inside "More from Michael": short rows (moment, watch, brief). Long
   * ones (suggestions, drafts) and forms stay shut, so the right column stays in proportion. */
  wideOpen?: boolean;
  children: ReactNode;
}) {
  const wideGroup = useContext(WideOpen) && wideOpen;
  const wide = useWide();
  // Null until the first tap: from then on the row is the user's, on any screen.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (wideGroup && wide);
  const body = useId();
  return (
    <div
      data-collapse-group=""
      data-wide-open={toggled === null && wideGroup ? "" : undefined}
      className="relativenot-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-[0.5px] not-first:before:bg-separator not-first:before:content-['']"
    >
      <button
        type="button"
        aria-label={label ? `${label}: ${title}` : undefined}
        aria-expanded={open}
        aria-controls={body}
        onClick={() => setToggled(!open)}
        className="press flex min-h-[60px] w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="text-body font-semibold">{title}</span>
            {meta ? <span className="ml-auto text-footnote text-label-2 tnum">{meta}</span> : null}
          </span>
          {preview ? (
            <Collapse as="span" open={!open} className="m-fold-preview">
              <span className="line-clamp-2 text-footnote text-label-2">{preview}</span>
            </Collapse>
          ) : null}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`m-fold-chevron size-4 shrink-0 text-label-2 transition-transform duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        >
          <path
            d="m9 5 7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <Collapse id={body} open={open} className="m-fold-body">
        <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
      </Collapse>
    </div>
  );
}
