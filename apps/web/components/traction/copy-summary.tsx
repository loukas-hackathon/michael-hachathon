"use client";

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/components/haptics";

const TINTED = "bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] text-tint-text";

/** The empty list's one action: copy the /join link, answered under the button with one tick. */
export function CopyJoinLink() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join`);
      setCopied(true);
      haptic();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Blocked clipboard: the address is in the sentence above.
    }
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={copy}
        className={`hit press min-h-11 rounded-full px-5 text-body font-semibold ${TINTED}`}
      >
        Copy link
      </button>
      <p key={String(copied)} role="status" className="m-swap mt-2 min-h-[18px] text-footnote text-label-2">
        {copied ? "Copied. Share it where founders read." : ""}
      </p>
    </div>
  );
}

/**
 * "Copy for investors": the plain text summary onto the clipboard, answered in place. The label
 * stays; the line under it says what was copied, with one tick, for two seconds. If the browser
 * blocks the clipboard, the text itself opens below, already selected.
 */
export function CopySummary({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const block = useRef<HTMLPreElement>(null);
  const lines = text.split("\n").filter((l) => l.trim()).length;

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (state !== "blocked" || !block.current) return;
    const range = document.createRange();
    range.selectNodeContents(block.current);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [state]);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      haptic();
      timer.current = setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 2000);
    } catch {
      setState("blocked");
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={copy}
        className={`hit press min-h-11 rounded-full px-5 text-body font-semibold ${TINTED}`}
      >
        Copy for investors
      </button>
      <p
        key={state}
        role={state === "blocked" ? "alert" : "status"}
        className="m-swap mt-2 min-h-[18px] text-footnote text-label-2"
      >
        {state === "copied"
          ? `Copied. ${lines} lines, ready to paste.`
          : state === "blocked"
            ? "Select the text below and copy it."
            : ""}
      </p>
      {state === "blocked" ? (
        <pre
          ref={block}
          className="mt-2 rounded-group bg-fill px-4 py-3 font-sans text-footnote whitespace-pre-wrap select-all"
        >
          {text}
        </pre>
      ) : null}
    </div>
  );
}
