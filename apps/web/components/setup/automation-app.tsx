"use client";

import { useState } from "react";
import { ActionError } from "@/components/action-feedback";
import { saveDefaultApp } from "@/lib/privacy-actions";
import { useAction } from "@/lib/use-action";

// "My automation is for" (#539): Apple passes an App automation no app name, so an open with none
// is stored as the app picked here (profile.default_app). Saves at once, optimistic.

export const AUTOMATION_APPS = [
  "Instagram",
  "TikTok",
  "WhatsApp",
  "YouTube",
  "X",
  "Facebook",
  "Snapchat",
  "Reddit",
] as const;
const OTHER = "__other";
const SAVE_ERROR = "I couldn't save that. It's as it was.";

export function AutomationApp({ initial }: { initial: string | null }) {
  const [app, setApp] = useState(initial);
  const listed = app === null || (AUTOMATION_APPS as readonly string[]).includes(app);
  const [other, setOther] = useState(!listed);
  const [draft, setDraft] = useState(listed ? "" : (app ?? ""));
  const save = useAction((next: string | null) => saveDefaultApp(next), {
    optimistic: (next) => {
      const before = app;
      setApp(next);
      return () => setApp(before);
    },
    failure: (r) => (r && typeof r === "object" ? r.refused : null),
    errorMessage: SAVE_ERROR,
  });

  const saveDraft = () => {
    const name = draft.trim();
    if (name && name !== app) void save.run(name.slice(0, 80));
  };

  return (
    <div className="mt-3 overflow-hidden rounded-group bg-fill">
      <label className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
        <span className="text-body">My automation is for</span>
        <select
          aria-label="My automation is for"
          value={other ? OTHER : (app ?? "")}
          aria-busy={save.pending || undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) {
              setOther(true);
              return;
            }
            setOther(false);
            void save.run(v === "" ? null : v);
          }}
          className="min-w-0 bg-transparent text-right text-body text-label-2"
        >
          <option value="">Not set</option>
          {AUTOMATION_APPS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </label>
      {other ? (
        <div className="px-4 pb-2">
          <input
            type="text"
            aria-label="App name"
            placeholder="App name"
            maxLength={80}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveDraft();
              }
            }}
            className="w-full rounded-lg bg-bg px-3 py-2 text-body"
          />
        </div>
      ) : null}
      <p className="px-4 pb-3 text-footnote text-label-2">
        Use this if one automation covers one app. Opens with no name show as this app.
      </p>
      <ActionError error={save.error} onRetry={save.retry} className="px-4 pb-2.5" />
    </div>
  );
}
