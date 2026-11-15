"use client";

import type { ChatStep } from "@michael/shared";
import { useEffect, useId, useState } from "react";
import { Collapse } from "@/components/motion-ui";
import { Thinking } from "@/components/thinking";

// How Michael is working it out (#410): the live step while he answers, then one quiet line under
// the reply that opens to the list. Steps come from the `step` events of /v1/chat/stream.

/** The step to show now: the latest still running, else the latest one. */
export function currentStep(steps: ChatStep[]): ChatStep | null {
  return steps.findLast((s) => s.status === "running") ?? steps.at(-1) ?? null;
}

/** Only tool steps count and show: the opening "Reading your day" is not part of the work. */
export const workedSteps = (steps: ChatStep[]) => steps.filter((s) => s.id !== "open");

// The steps behind answers given in this tab, by reply id, so a reload keeps the line under them.
const STORE_KEY = "michael.chat.worked";
const MAX_KEPT = 50;

function readKept(): Record<string, ChatStep[]> {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ChatStep[]>) : {};
  } catch {
    return {};
  }
}

/** Keeps an answer's tool steps for this tab (sessionStorage); quietly does nothing without it. */
export function keepSteps(replyId: string, steps: ChatStep[]) {
  const list = workedSteps(steps).map(({ id, label }) => ({ id, label, status: "done" as const }));
  if (!list.length) return;
  try {
    const kept = Object.entries({ ...readKept(), [replyId]: list }).slice(-MAX_KEPT);
    sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Private mode or full storage: the line just does not survive a reload.
  }
}

/** An answer's steps: the live ones when given, else those kept in this tab (after mount only). */
function useSteps(replyId: string | undefined, steps: ChatStep[] | undefined): ChatStep[] {
  const [kept, setKept] = useState<ChatStep[] | null>(null);
  useEffect(() => {
    if (steps?.length || !replyId) return;
    const found = readKept()[replyId];
    if (Array.isArray(found)) {
      setKept(found.filter((s) => s && typeof s.id === "string" && typeof s.label === "string"));
    }
  }, [replyId, steps]);
  return steps?.length ? steps : (kept ?? []);
}

/** The breathing mark and the current step, crossfading as the step changes. */
export function LiveStep({
  steps,
  fallback = "Reading your day",
  className,
}: {
  steps: ChatStep[];
  fallback?: string;
  /** Type and colour, as Thinking's. */
  className?: string;
}) {
  const label = currentStep(steps)?.label ?? fallback;
  return (
    <span key={label} className="m-swap inline-flex">
      <Thinking text={label} className={className} />
    </span>
  );
}

/**
 * "How I worked it out · 3 steps" under a finished reply; a tap shows each tool step with its
 * tick. Counts tool steps only, and hides when there were none.
 */
export function WorkedSteps({ replyId, steps }: { replyId?: string; steps?: ChatStep[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const list = workedSteps(useSteps(replyId, steps));
  if (!list.length) return null;
  return (
    <div className="mt-0.5 px-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="hit press inline-flex min-h-7 items-center gap-1 text-caption text-label-2 tnum"
      >
        How I worked it out · {list.length} {list.length === 1 ? "step" : "steps"}
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`size-2.5 transition-transform duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path
            d="m3 4.5 3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <Collapse open={open} id={id}>
        <ol className="flex flex-col gap-1 pt-1 pb-0.5">
          {list.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 text-caption text-label-2">
              <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0">
                <path
                  d="m2.5 6.2 2.3 2.3 4.7-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{s.label}</span>
              <span className="sr-only">{s.status === "done" ? ", done" : ", running"}</span>
            </li>
          ))}
        </ol>
      </Collapse>
    </div>
  );
}
