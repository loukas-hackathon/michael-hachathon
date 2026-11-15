"use client";

import type { MomentKind } from "@michael/shared";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Thinking } from "@/components/thinking";
import { formatTime } from "@/lib/format";

// The moment card never waits for the model (#378). The server renders the template line (or a
// line already written) at once; while the API says a better line is being written
// (`phrase_pending`), Michael shows he is thinking in the row's corner and this asks
// GET /moment/:kind for it. The line then fades in where the old one was: opacity only, and the
// preview keeps two lines of room, so nothing below moves.

/** `fresh`: the line arrived after the first paint. `woke`: the thinking line has just gone. */
type Phrase = { headline: string; thinking: boolean; fresh: boolean; woke: boolean };

const PhraseContext = createContext<Phrase>({ headline: "", thinking: false, fresh: false, woke: false });

/** Held at least this long, so "Reading your day" never flashes for a line that came at once. */
const MIN_THINKING_MS = 600;

export function MomentPhrase({
  kind,
  headline,
  pending,
  children,
}: {
  kind: MomentKind;
  headline: string;
  pending: boolean;
  children: ReactNode;
}) {
  const [phrase, setPhrase] = useState<Phrase>({ headline, thinking: pending, fresh: false, woke: false });

  useEffect(() => {
    if (!pending) return;
    const abort = new AbortController();
    const started = performance.now();
    const settle = (line: string | null) => {
      const wait = Math.max(0, MIN_THINKING_MS - (performance.now() - started));
      setTimeout(() => {
        if (abort.signal.aborted) return;
        setPhrase((p) =>
          line && line !== p.headline
            ? { headline: line, thinking: false, fresh: true, woke: true }
            : { ...p, thinking: false, woke: true },
        );
      }, wait);
    };
    fetch(`/moment/${kind}`, { cache: "no-store", signal: abort.signal })
      .then((res) => (res.status === 200 ? res.json() : null))
      .then((m: { headline?: string; phrased_by?: string } | null) =>
        settle(m?.phrased_by === "model" && m.headline ? m.headline : null),
      )
      .catch(() => settle(null));
    return () => abort.abort();
  }, [kind, pending]);

  return <PhraseContext.Provider value={phrase}>{children}</PhraseContext.Provider>;
}

/** The moment's headline; a line that arrived after the first paint fades in. */
export function MomentHeadline() {
  const { headline, fresh } = useContext(PhraseContext);
  return (
    <span key={headline} className={fresh ? "m-swap" : undefined}>
      {headline}
    </span>
  );
}

/** The row's corner: "Reading your day" while the line is being written, then when it was made. */
export function MomentMeta({ at }: { at: string }) {
  const { thinking, woke } = useContext(PhraseContext);
  return thinking ? (
    <Thinking />
  ) : (
    <time dateTime={at} className={woke ? "m-swap" : undefined}>
      {formatTime(at)}
    </time>
  );
}
