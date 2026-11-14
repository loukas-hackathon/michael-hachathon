"use client";

import type { Source, SourceSetting } from "@michael/shared";
import { useEffect, useState } from "react";
import { SOURCE_LABEL } from "@/lib/connections";
import { saveSource } from "@/lib/privacy-actions";

// Privacy switches for the given sources. Each connection's page shows its own, so there is one
// place per source; You keeps the few no connection owns. Switch one off and I stop reading it.
export function SourceSwitches({ initial, sources }: { initial: SourceSetting[]; sources: Source[] }) {
  const [enabled, setEnabled] = useState(() => new Map(initial.map((s) => [s.source, s.enabled])));
  const [failed, setFailed] = useState<Source | null>(null);
  const [native, setNative] = useState(true);
  useEffect(() => setNative("switch" in HTMLInputElement.prototype), []);

  function toggle(source: Source, on: boolean) {
    const was = enabled.get(source) ?? false;
    setFailed(null);
    setEnabled((m) => new Map(m).set(source, on));
    saveSource(source, on)
      .then((s) => setEnabled((m) => new Map(m).set(s.source, s.enabled)))
      .catch(() => {
        setEnabled((m) => new Map(m).set(source, was));
        setFailed(source);
      });
  }

  return (
    <ul className="overflow-hidden rounded-group bg-fill">
      {sources.map((source, i) => {
        const [name, what] = SOURCE_LABEL[source] ?? [source, ""];
        const on = enabled.get(source) ?? false;
        const id = `source-${source}`;
        return (
          <li key={source} className="relative">
            {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
            <label htmlFor={id} className="flex min-h-14 items-center justify-between gap-4 px-4 py-2">
              <span className="flex flex-col">
                <span className="text-body">{name}</span>
                <span className="text-footnote text-label-2">
                  {failed === source ? "I could not save that. Try again." : what}
                </span>
              </span>
              <input
                id={id}
                type="checkbox"
                // @ts-expect-error: `switch` is a valid boolean attribute in Safari, not yet in React's types
                switch=""
                checked={on}
                onChange={(e) => toggle(source, e.target.checked)}
                className={native ? "h-[31px] w-[51px] shrink-0 accent-[var(--m-tint)]" : "m-switch shrink-0"}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
