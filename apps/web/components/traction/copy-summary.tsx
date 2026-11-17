"use client";

import { useState } from "react";

const TINTED = "bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] text-tint-text";

/**
 * "Copy for investors": the plain text summary onto the clipboard, answered in place. Copied for
 * two seconds; if the browser blocks the clipboard, the text itself shows, selectable.
 */
export function CopySummary({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 2000);
    } catch {
      setState("blocked");
    }
  }
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={copy}
        className={`hit press min-h-11 min-w-[180px] rounded-full px-5 text-body font-semibold ${TINTED}`}
      >
        {state === "copied" ? "Copied" : "Copy for investors"}
      </button>
      <p role="status" className="mt-1 min-h-[18px] text-footnote text-label-2">
        {state === "copied" ? "The summary is on your clipboard." : ""}
      </p>
      {state === "blocked" ? (
        <>
          <p role="alert" className="text-footnote text-danger">
            I could not reach the clipboard. Select the text below and copy it.
          </p>
          <pre className="mt-2 rounded-group bg-fill px-4 py-3 text-footnote whitespace-pre-wrap select-all">
            {text}
          </pre>
        </>
      ) : null}
    </div>
  );
}
