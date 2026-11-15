"use client";

import { useEffect, useState } from "react";
import { ActionError } from "@/components/action-feedback";
import { formatTime } from "@/lib/format";
import { setOffTheRecord, useOffTheRecord } from "@/lib/off-the-record";
import { useAction } from "@/lib/use-action";

const SAVE_ERROR = "I couldn't save that. Nothing changed.";

export function OffTheRecordSwitch() {
  const { on, since } = useOffTheRecord();
  // Safari draws <input switch> natively, with the system haptic. Elsewhere we draw the same switch.
  const [native, setNative] = useState(true);
  useEffect(() => setNative("switch" in HTMLInputElement.prototype), []);
  // The store flips every tab at once and flips back on failure; this adds pending and a retry.
  const save = useAction(setOffTheRecord, {
    failure: (r) => (r === true ? null : r || SAVE_ERROR),
  });

  return (
    <>
      <label htmlFor="off-the-record" className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span className="flex flex-col">
          <span className="text-body">Off the record</span>
          <span className="text-footnote text-label-2 tnum" aria-live="polite">
            {on
              ? `Nothing is being collected${since ? ` since ${formatTime(since)}` : ""}.`
              : "Collecting from your connections."}
          </span>
        </span>
        <input
          id="off-the-record"
          type="checkbox"
          // @ts-expect-error: `switch` is a valid boolean attribute in Safari, not yet in React's types
          switch=""
          checked={on}
          aria-busy={save.pending || undefined}
          onChange={(e) => {
            if (!save.pending) void save.run(e.target.checked);
          }}
          className={native ? "h-[31px] w-[51px] shrink-0 accent-[var(--m-tint)]" : "m-switch shrink-0"}
        />
      </label>
      {/* A refusal (the demo week) is not worth a retry: only a failed save gets one. */}
      <ActionError
        error={save.error}
        onRetry={save.error === SAVE_ERROR ? save.retry : undefined}
        className="-mt-1 px-4 pb-2.5"
      />
    </>
  );
}
