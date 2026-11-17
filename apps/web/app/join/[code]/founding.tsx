"use client";

import { useId, useRef, useState } from "react";
import { setFoundingMember } from "../actions";

// Founding member, asked here where intent is highest: an inset group row with a switch. On at
// once (optimistic), saved with PATCH /v1/waitlist/:code; on a failure it goes back with one line.

export function Founding({ code, initial }: { code: string; initial: boolean }) {
  const id = useId();
  const [on, setOn] = useState(initial);
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null);
  const inFlight = useRef(false);

  async function toggle(next: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    const before = on;
    setOn(next);
    setLine(next ? { text: "Done. You're a founding member.", error: false } : null);
    try {
      const res = await setFoundingMember(code, next);
      if (!res.ok) throw new Error("not saved");
    } catch {
      setOn(before);
      setLine({ text: "I could not save that. Nothing changed. Try again in a minute.", error: true });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div>
      <div className="rounded-group bg-fill">
        <label htmlFor={id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold">Get in first</span>
            <span className="block text-subhead text-label-2">
              €15 a month for life when you're in. No payment now.
            </span>
          </span>
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={on}
            aria-checked={on}
            aria-label="Founding member"
            onChange={(e) => void toggle(e.currentTarget.checked)}
            className="hit m-switch shrink-0"
          />
        </label>
      </div>
      <p
        key={line?.text ?? "none"}
        role={line?.error ? "alert" : "status"}
        className={`m-swap mt-2 min-h-[18px] px-4 text-footnote ${line?.error ? "text-danger" : "text-label-2"}`}
      >
        {line?.text ?? ""}
      </p>
    </div>
  );
}
