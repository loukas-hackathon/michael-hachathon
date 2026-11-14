"use client";

import type { AnalysisRun } from "@michael/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { askForBrief } from "@/lib/analysis-actions";
import { formatTime } from "@/lib/format";

const tinted =
  "press min-h-9 self-start rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60";

/** "Ask Michael for a brief": runs the analysis, then shows the summary, his question and when. */
export function BriefView({
  initial,
  initialSuggestions,
}: {
  initial: AnalysisRun | null;
  initialSuggestions: number;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function ask() {
    setBusy(true);
    setError(null);
    const r = await askForBrief();
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRun(r.run);
    setSuggestions(r.suggestions);
    // Today reads the new suggestions.
    startTransition(() => router.refresh());
  }

  return (
    <article
      aria-label="Michael's brief"
      aria-busy={busy}
      className="mt-5 flex flex-col gap-2.5 rounded-card bg-fill px-4 pt-3.5 pb-4"
    >
      <header className="flex items-center text-footnote font-semibold">
        <span>Michael's brief</span>
        {run?.finished_at ? (
          <time className="ml-auto font-medium text-label-2 tnum" dateTime={run.finished_at}>
            {formatTime(run.finished_at)}
          </time>
        ) : null}
      </header>

      {run?.summary ? (
        <p className="whitespace-pre-line text-body">{run.summary}</p>
      ) : (
        <p className="text-subhead text-label-2">I read your day and tell you what matters now.</p>
      )}
      {run?.question ? <p className="text-subhead font-semibold">{run.question}</p> : null}
      {run && suggestions > 0 ? (
        <p className="text-footnote text-label-2">
          {suggestions === 1 ? "One suggestion" : `${suggestions} suggestions`} under Michael suggests.
        </p>
      ) : null}
      {run ? <p className="text-caption text-label-2">Written by {run.model}.</p> : null}

      {error ? (
        <p role="alert" className="text-subhead text-danger">
          {error}
        </p>
      ) : null}

      <button type="button" className={tinted} disabled={busy} onClick={ask}>
        {busy ? "Reading your day" : run ? "Ask for a fresh brief" : "Ask Michael for a brief"}
      </button>
    </article>
  );
}
