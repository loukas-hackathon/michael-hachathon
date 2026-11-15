"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// A small card over the screen that invites the person to ask Claude about their data. Claude
// reads Michael through MCP, so it can explain any number in plain words. It waits until the
// person has scrolled and 10 seconds have passed, shows once a day per place on this device, and
// goes with one tap until the next day.

const KEY = "michael.askClaude";
const today = () => new Date().toISOString().slice(0, 10);

function seenToday(place: string) {
  try {
    const raw = window.localStorage.getItem(KEY);
    return (raw ? (JSON.parse(raw) as Record<string, string>) : {})[place] === today();
  } catch {
    return false;
  }
}

function markSeen(place: string) {
  try {
    const raw = window.localStorage.getItem(KEY);
    const seen = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    window.localStorage.setItem(KEY, JSON.stringify({ ...seen, [place]: today() }));
  } catch {
    // Private mode: it simply shows again next time.
  }
}

/** Claude with the question already typed in; the person only presses send. */
export const askClaudeUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

const TINTED = "bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] text-tint-text";

export function AskClaudePopup({
  place,
  connected,
  prompt,
  delayMs = 10_000,
}: {
  /** Where it shows ("today", "number:sleep_score"): each place has its own once a day. */
  place: string;
  connected: boolean;
  prompt: string;
  delayMs?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (seenToday(place)) return;
    // Never on the stage view or inside it.
    if (window.self !== window.top || window.location.pathname.startsWith("/stage")) return;
    // It never covers the first look: only once the person has scrolled AND the wait is over.
    let waited = false;
    let scrolled = false;
    const maybe = () => {
      if (waited && scrolled) setOpen(true);
    };
    const t = setTimeout(() => {
      waited = true;
      maybe();
    }, delayMs);
    const onScroll = () => {
      if (window.scrollY < 40) return;
      scrolled = true;
      window.removeEventListener("scroll", onScroll);
      maybe();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, [place, delayMs]);
  if (!open) return null;
  const close = () => {
    markSeen(place);
    setOpen(false);
  };

  return (
    <aside
      aria-label="Ask Claude about your data"
      className="m-pop-in fixed inset-x-4 bottom-[calc(var(--m-tabbar-h)+32px+env(safe-area-inset-bottom))] z-40 rounded-card bg-bg px-4 pt-3 pb-3.5 shadow-[0_8px_30px_rgb(0_0_0/0.16),inset_0_0_0_0.5px_var(--m-separator)] xl:inset-x-auto xl:right-8 xl:bottom-8 xl:w-[360px]"
    >
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-subhead">
          {/* (Brand) */}
          {connected ? (
            <>
              <b className="font-semibold">Not sure what a number means? Ask Claude.</b>{" "}
              <span className="text-label-2">
                Claude is connected to Michael through MCP, so it reads your data and explains it in plain
                words.
              </span>
            </>
          ) : (
            <>
              <b className="font-semibold">Want your numbers explained? Connect Claude.</b>{" "}
              <span className="text-label-2">
                One tap links Claude to Michael through MCP. Then ask it anything about your data.
              </span>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={close}
          aria-label="Not now"
          className="press -mt-1 -mr-2 grid size-9 shrink-0 place-items-center rounded-full text-label-2"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {connected ? (
          <a
            href={askClaudeUrl(prompt)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className={`press inline-flex min-h-9 items-center rounded-full px-4 text-subhead font-semibold ${TINTED}`}
          >
            Ask Claude
          </a>
        ) : (
          <Link
            href="/agents"
            onClick={close}
            className={`press inline-flex min-h-9 items-center rounded-full px-4 text-subhead font-semibold ${TINTED}`}
          >
            Connect Claude
          </Link>
        )}
        <button
          type="button"
          onClick={close}
          className="press min-h-9 px-2 text-subhead font-semibold text-label-2"
        >
          Not now
        </button>
      </div>
    </aside>
  );
}

/** The same invitation as one quiet line inside a screen, for the detail pages. */
export function AskClaudeLine({ connected, prompt }: { connected: boolean; prompt: string }) {
  return connected ? (
    <a
      href={askClaudeUrl(prompt)}
      target="_blank"
      rel="noopener noreferrer"
      className="press mt-6 flex items-start justify-between gap-3 rounded-group bg-fill px-4 py-3 text-subhead"
    >
      <span>
        <b className="font-semibold">Ask Claude about this.</b>{" "}
        <span className="text-label-2">It reads your data through Michael and explains it.</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-label-2">
        ›
      </span>
    </a>
  ) : (
    <Link
      href="/agents"
      className="press mt-6 flex items-start justify-between gap-3 rounded-group bg-fill px-4 py-3 text-subhead"
    >
      <span>
        <b className="font-semibold">Connect Claude to ask about this.</b>{" "}
        <span className="text-label-2">One tap, then it explains your data in plain words.</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-label-2">
        ›
      </span>
    </Link>
  );
}
