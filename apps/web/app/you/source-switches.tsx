"use client";

import type { Source, SourceSetting } from "@michael/shared";
import { useEffect, useState } from "react";
import { saveSource } from "@/lib/privacy-actions";

// What each source is called on the user's side. Sources the user does not collect from
// (manual entries, AI agents) are left out: agents have their own screen.
const LABEL: Partial<Record<Source, [name: string, what: string]>> = {
  health_auto_export: ["Apple Watch", "Sleep, workouts and heart rate"],
  whoop: ["WHOOP", "Sleep, strain and recovery"],
  google_calendar: ["Google Calendar", "Your plans and meetings"],
  macos_usage: ["Mac", "Which apps you use, and for how long"],
  iphone_usage: ["iPhone", "Screen Time by app"],
  chrome: ["Browser", "Sites you spend time on, never what you type"],
  claude_code: ["Claude Code", "Work sessions and prompt titles"],
  activitywatch: ["ActivityWatch", "Computer activity"],
  ios_shortcuts: ["Shortcuts", "Moments you log from your iPhone"],
  owntracks: ["Location", "Where you are, for gym and commute"],
  omi: ["Meetings", "Only when you start meetings mode"],
  maps: ["Travel times", "Traffic between your saved places and plans"],
};
const ORDER = Object.keys(LABEL) as Source[];

export function SourceSwitches({ initial }: { initial: SourceSetting[] }) {
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
      {ORDER.map((source, i) => {
        const [name, what] = LABEL[source] as [string, string];
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
