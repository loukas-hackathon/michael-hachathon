"use client";

import type { GoalSuggestion } from "@michael/shared";
import { useEffect, useState, useTransition } from "react";
import { keepGoalSuggestion, loadGoalSuggestions } from "@/app/goals/suggestion-actions";
import { hm } from "@/lib/format";

// Goals from the calendar (#134): the recurring own blocks Michael found, one tap to keep each,
// minus and plus to change the hours first. Renders nothing when the calendar suggests nothing, so
// it can sit anywhere: onboarding's goals step, the Goals tab, the calendar row on You.
// Pass `initial` from a server component; without it, the suggestions load on mount.

const STEP = 30;
const MAX = 40 * 60;

const count = (n: number) =>
  n === 1 ? "one goal" : n === 2 ? "two goals" : n === 3 ? "three goals" : `${n} goals`;

export function CalendarGoals({
  initial,
  onKept,
  className = "",
}: {
  initial?: GoalSuggestion[];
  onKept?: (kept: number) => void;
  className?: string;
}) {
  const [list, setList] = useState<GoalSuggestion[] | null>(initial ?? null);
  const [minutes, setMinutes] = useState<Record<string, number>>({});
  const [kept, setKept] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (initial) return;
    let live = true;
    loadGoalSuggestions()
      .then((s) => live && setList(s))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [initial]);

  if (!list || list.length === 0) return null;
  const open = list.filter((s) => !kept.includes(s.id));
  const budget = (s: GoalSuggestion) => minutes[s.id] ?? s.weekly_budget_minutes;

  function keep(ids: string[]) {
    setNote(null);
    start(async () => {
      const done: string[] = [];
      for (const id of ids) {
        const s = list?.find((x) => x.id === id);
        if (!s) continue;
        const edited = budget(s) !== s.weekly_budget_minutes ? { weekly_budget_minutes: budget(s) } : {};
        const res = await keepGoalSuggestion(id, edited).catch(() => ({ ok: false, message: null }));
        if (res.ok) done.push(id);
        else setNote(res.message ?? "That did not save. Try again.");
      }
      if (done.length > 0) {
        const next = [...kept, ...done];
        setKept(next);
        onKept?.(next.length);
      }
    });
  }

  const btn =
    "press grid size-9 place-items-center rounded-full bg-bg text-body font-semibold disabled:opacity-30";

  return (
    <section className={className} aria-label="Goals from your calendar">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-subhead text-label-2">
          {open.length === 0
            ? "Kept. They count from today."
            : `From your calendar I see ${count(list.length)}. Keep ${list.length === 1 ? "it" : "them"}?`}
        </p>
        {open.length > 1 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => keep(open.map((s) => s.id))}
            className="press h-9 shrink-0 text-subhead font-semibold text-tint-text disabled:opacity-40"
          >
            Keep all
          </button>
        ) : null}
      </div>
      <ul className="overflow-hidden rounded-group bg-fill">
        {list.map((s, i) => {
          const on = kept.includes(s.id);
          const m = budget(s);
          return (
            <li key={s.id} className="relative px-4 py-3">
              {i > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="text-body font-semibold">{s.title}</span>
                  <span className="text-footnote text-label-2">{s.evidence}</span>
                </span>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={on || pending}
                  onClick={() => keep([s.id])}
                  className={`press h-9 shrink-0 rounded-full px-4 text-subhead font-semibold ${
                    on ? "text-label-2" : "bg-tint text-on-tint disabled:opacity-40"
                  }`}
                >
                  {on ? "Kept" : "Keep"}
                </button>
              </div>
              {on ? null : (
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    className={btn}
                    aria-label={`Less time for ${s.title}`}
                    disabled={m <= STEP}
                    onClick={() => setMinutes((x) => ({ ...x, [s.id]: Math.max(STEP, m - STEP) }))}
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <output aria-live="polite" className="font-num text-body font-bold tnum">
                    {hm(m)} a week
                  </output>
                  <button
                    type="button"
                    className={btn}
                    aria-label={`More time for ${s.title}`}
                    disabled={m >= MAX}
                    onClick={() => setMinutes((x) => ({ ...x, [s.id]: Math.min(MAX, m + STEP) }))}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {note ? (
        <p role="alert" className="mt-2 text-footnote text-danger">
          {note}
        </p>
      ) : null}
    </section>
  );
}
