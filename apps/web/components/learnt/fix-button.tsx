"use client";

import { useState, useTransition } from "react";
import { applyFix } from "@/app/learnt/actions";
import type { InsightFix } from "@/lib/insights";

const tinted =
  "hit press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60";

/**
 * The fix under a pattern and its one tap. Once taken it reads as done, in Michael's words, with
 * no button. A refusal (the demo week, or the API) shows as one line under it.
 */
export function FixRow({ id, fix, preview }: { id: string; fix: InsightFix; preview: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(Boolean(fix.applied_at));
  const [error, setError] = useState<string | null>(null);
  const action = fix.action;

  return (
    <div className="mt-4 rounded-[14px] bg-bg px-3.5 py-3 shadow-[inset_0_0_0_0.5px_var(--m-separator)]">
      <p className="text-footnote font-semibold text-label-2">The fix</p>
      <p className="mt-0.5 text-subhead font-semibold">{fix.text}</p>
      {action ? (
        done ? (
          <p className="mt-2 flex items-center gap-2 text-subhead text-label-2" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0 text-label">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {action.done_label}
          </p>
        ) : (
          <button
            type="button"
            disabled={pending}
            className={`${tinted} mt-2.5`}
            onClick={() =>
              start(async () => {
                const r = await applyFix(id, preview);
                if (r.ok) setDone(true);
                setError(r.ok ? null : r.message);
              })
            }
          >
            {pending ? "Setting it" : action.label}
          </button>
        )
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-footnote text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
