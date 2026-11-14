"use client";

import { useState } from "react";
import { saveAgent } from "@/lib/agents-actions";

type Answer = "once" | "always" | "no";

/**
 * An agent waiting for approval: one tap to answer (PATCH /v1/agents/:id). Feedback stays in the
 * card. "Once" approves like "Always" for now; there is no expiry on the API yet.
 */
export function ApprovalCard({
  id,
  name,
  wants,
  scopes,
}: {
  id: string;
  name: string;
  wants: string;
  scopes: string[];
}) {
  const [answer, setAnswerState] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);
  const result: Record<Answer, string> = {
    once: `Allowed. You can revoke ${name} any time below.`,
    always: `Always allowed. You can change it any time below.`,
    no: `Refused. ${name} sees nothing, and I've told it so.`,
  };
  function setAnswer(a: Answer) {
    setAnswerState(a);
    setFailed(false);
    saveAgent(id, { status: a === "no" ? "revoked" : "approved" }).catch(() => {
      setAnswerState(null);
      setFailed(true);
    });
  }

  return (
    <section
      aria-label={`${name} asks for access`}
      className="mt-5 flex flex-col gap-3 rounded-card bg-fill px-4 pt-3.5 pb-4"
    >
      <p className="text-title3 font-semibold tracking-[-0.01em]">
        {name} wants to know <span className="font-normal text-label-2">{wants}</span>
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {scopes.map((s) => (
          <li key={s} className="rounded-full bg-bg px-2.5 py-[3px] text-footnote font-semibold">
            {s}
          </li>
        ))}
      </ul>
      {failed ? <p className="text-footnote text-danger">I could not save that. Try again.</p> : null}
      {answer ? (
        <p role="status" className="flex min-h-9 items-center text-subhead text-label-2">
          {result[answer]}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAnswer("once")}
            className="press min-h-9 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
          >
            Allow once
          </button>
          <button
            type="button"
            onClick={() => setAnswer("always")}
            className="press min-h-9 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text"
          >
            Always
          </button>
          <button
            type="button"
            onClick={() => setAnswer("no")}
            className="press min-h-9 rounded-full px-3 text-subhead font-semibold text-tint-text"
          >
            No
          </button>
        </div>
      )}
    </section>
  );
}
