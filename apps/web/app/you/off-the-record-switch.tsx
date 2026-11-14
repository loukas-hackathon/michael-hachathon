"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { setOffTheRecord, useOffTheRecord } from "@/lib/off-the-record";

export function OffTheRecordSwitch() {
  const { on, since, failed } = useOffTheRecord();
  // Safari draws <input switch> natively, with the system haptic. Elsewhere we draw the same switch.
  const [native, setNative] = useState(true);
  useEffect(() => setNative("switch" in HTMLInputElement.prototype), []);

  return (
    <label htmlFor="off-the-record" className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
      <span className="flex flex-col">
        <span className="text-body">Off the record</span>
        <span className="text-footnote text-label-2 tnum">
          {failed
            ? "I could not save that. Try again."
            : on
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
        onChange={(e) => setOffTheRecord(e.target.checked)}
        className={native ? "h-[31px] w-[51px] shrink-0 accent-[var(--m-tint)]" : "m-switch shrink-0"}
      />
    </label>
  );
}
