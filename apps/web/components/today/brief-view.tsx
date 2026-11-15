"use client";

import type { AnalysisRun } from "@michael/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { askForBrief } from "@/lib/analysis-actions";
import { briefRow } from "./brief-row";
import { Fold } from "./fold";

const tinted =
  "hit press min-h-9 self-start rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60";

/**
 * "Ask Michael for a brief", a quiet row on Today: runs the analysis, then shows the summary, his
 * question and when. The first line of the summary is the preview.
 */
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
  // True once a brief written on this visit lands, so it eases in instead of snapping.
  const [fresh, setFresh] = useState(false);
  const [, startTransition] = useTransition();

  async function ask() {
    setBusy(true);
    setError(null);
    let r: Awaited<ReturnType<typeof askForBrief>>;
    try {
      r = await askForBrief();
    } catch {
      setError("I could not reach the server. Try again in a minute.");
      return;
    } finally {
      setBusy(false);
    }
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRun(r.run);
    setFresh(true);
    setSuggestions(r.suggestions);
    // Today reads the new suggestions.
    startTransition(() => router.refresh());
  }

  const row = briefRow(run);
  return (
    <Fold
      title="Michael's brief"
      label="Michael's brief"
      meta={run?.finished_at ? <time dateTime={run.finished_at}>{row.when}</time> : null}
      preview={row.preview}
    >
      <div aria-busy={busy} className="flex flex-col gap-2.5">
        {run?.summary ? (
          <p
            key={run.finished_at ?? run.summary}
            className={`whitespace-pre-line text-body ${fresh ? "m-swap" : ""}`}
          >
            {run.summary}
          </p>
        ) : null}
        {run?.question ? <p className="text-subhead font-semibold">{run.question}</p> : null}
        {run && suggestions > 0 ? (
          <p className="text-footnote text-label-2">
            {suggestions === 1 ? "One suggestion" : `${suggestions} suggestions`} on Today.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-subhead text-danger">
            {error}
          </p>
        ) : null}

        <button type="button" className={tinted} disabled={busy} onClick={ask}>
          {busy ? "Reading your day" : run ? "Ask for a fresh brief" : "Ask Michael for a brief"}
        </button>
      </div>
    </Fold>
  );
}
