"use client";

import type { ChatStep } from "@michael/shared";
import { useId, useState } from "react";
import { Collapse } from "@/components/motion-ui";
import { Thinking } from "@/components/thinking";

// How Michael is working it out (#410): the live step while he answers, then one quiet line under
// the reply that opens to the list. Steps come from the `step` events of /v1/chat/stream.

/** The step to show now: the latest still running, else the latest one. */
export function currentStep(steps: ChatStep[]): ChatStep | null {
  return steps.findLast((s) => s.status === "running") ?? steps.at(-1) ?? null;
}

/** Only tool steps count: the opening "Reading your day" alone is not worth a line. */
export const workedSteps = (steps: ChatStep[]) => (steps.some((s) => s.id !== "open") ? steps : []);

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

/** "How I worked it out · 3 steps" under a finished reply; a tap shows each step with its tick. */
export function WorkedSteps({ steps }: { steps: ChatStep[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const list = workedSteps(steps);
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
