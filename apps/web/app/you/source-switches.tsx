"use client";

import type { Source, SourceSetting } from "@michael/shared";
import { useEffect, useState } from "react";
import { ActionError } from "@/components/action-feedback";
import { SOURCE_LABEL } from "@/lib/connections";
import { saveSource } from "@/lib/privacy-actions";
import { useAction } from "@/lib/use-action";

const SAVE_ERROR = "I could not save that. It is as it was.";

/** One source's switch: flips at once, flips back with a reason and a retry if the save fails. */
function SourceSwitch({ source, initial, native }: { source: Source; initial: boolean; native: boolean }) {
  const [on, setOn] = useState(initial);
  const [name, what] = SOURCE_LABEL[source] ?? [source, ""];
  const id = `source-${source}`;
  const save = useAction((next: boolean) => saveSource(source, next), {
    optimistic: (next) => {
      setOn(next);
      return () => setOn(!next);
    },
    onSuccess: (s) => setOn(s.enabled),
    errorMessage: SAVE_ERROR,
  });

  return (
    <>
      <label htmlFor={id} className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        <span className="flex flex-col">
          <span className="text-body">{name}</span>
          <span className="text-footnote text-label-2">{what}</span>
        </span>
        <input
          id={id}
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
      <ActionError error={save.error} onRetry={save.retry} className="-mt-1 px-4 pb-2.5" />
    </>
  );
}

// Privacy switches for the given sources. Each connection's page shows its own, so there is one
// place per source; You keeps the few no connection owns. Switch one off and I stop reading it.
export function SourceSwitches({ initial, sources }: { initial: SourceSetting[]; sources: Source[] }) {
  const [native, setNative] = useState(true);
  useEffect(() => setNative("switch" in HTMLInputElement.prototype), []);
  const enabled = new Map(initial.map((s) => [s.source, s.enabled]));

  return (
    <ul className="overflow-hidden rounded-group bg-fill">
      {sources.map((source, i) => (
        <li key={source} className="relative">
          {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
          <SourceSwitch source={source} initial={enabled.get(source) ?? false} native={native} />
        </li>
      ))}
    </ul>
  );
}
