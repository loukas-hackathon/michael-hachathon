"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { addItem, carryItem, tickItem } from "@/app/checklist-actions";
import { haptic } from "@/components/haptics";
import type { ChecklistItem } from "@/lib/checklist";

const OFFLINE = "I lost the line. Nothing changed.";

/** A row to show while the server stores it; the stored one replaces it when the page reads again. */
function draft(goalId: string, text: string): ChecklistItem {
  const now = new Date().toISOString();
  return {
    id: `draft-${now}`,
    goal_id: goalId,
    date: now.slice(0, 10),
    text,
    position: 99,
    status: "open",
    settled_at: null,
    settled_by: null,
    carried_from: null,
    created_at: now,
    updated_at: now,
  };
}

/** Most items one goal takes in a day (#238). */
const MAX = 3;

const separator = "absolute inset-x-0 top-0 ml-12 h-[0.5px] bg-separator";

function Circle({ done }: { done: boolean }) {
  return done ? (
    <span className="grid size-[22px] place-items-center rounded-full bg-label text-bg">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[14px]">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  ) : (
    <span className="size-[22px] rounded-full shadow-[inset_0_0_0_1.5px_var(--m-label-2)]" />
  );
}

/**
 * The day's list for one checklist goal (#238): one tap ticks an item, up to three a day, and
 * yesterday's open items wait underneath to be carried over. Michael never ticks for the user.
 * Copy marked (Brand) is a placeholder until Brand signs it off on #238.
 */
export function TodayChecklist({
  goalId,
  title,
  items,
  suggestions,
}: {
  goalId: string;
  title: string;
  items: ChecklistItem[];
  suggestions: ChecklistItem[];
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Ticks, new items and carried items all show at once; the server's list replaces them when the
  // action lands, and a failure drops them again with Michael's line (michael-feedback R2).
  const [list, setOptimistic] = useOptimistic(
    items.filter((i) => i.status === "open" || i.status === "done"),
    (l, change: { id: string; done: boolean } | { add: ChecklistItem }) =>
      "add" in change
        ? [...l, change.add]
        : l.map((i) =>
            i.id === change.id
              ? { ...i, status: (change.done ? "done" : "open") as ChecklistItem["status"] }
              : i,
          ),
  );
  const [carried, setCarried] = useOptimistic<string[], string>([], (ids, id) => [...ids, id]);
  const done = list.filter((i) => i.status === "done").length;
  const room = list.length < MAX;

  const tick = (i: ChecklistItem) => {
    const next = i.status !== "done";
    start(async () => {
      setOptimistic({ id: i.id, done: next });
      const r = await tickItem(i.id, next).catch(() => ({ ok: false, message: OFFLINE }));
      setError(r.ok ? null : (r.message ?? OFFLINE));
      if (r.ok) haptic();
    });
  };

  const submit = () => {
    const t = text.trim();
    if (!t) {
      setAdding(false);
      return;
    }
    // The row appears at once and the field clears for the next one; a failure puts the text back.
    setText("");
    if (list.length + 1 >= MAX) setAdding(false);
    else inputRef.current?.focus();
    start(async () => {
      setOptimistic({ add: draft(goalId, t) });
      const r = await addItem(goalId, t).catch(() => ({ ok: false, message: OFFLINE }));
      if (!r.ok) {
        setText(t);
        setAdding(true);
      }
      setError(r.ok ? null : (r.message ?? OFFLINE));
    });
  };

  return (
    <section aria-label={title} className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-title3 font-bold">{title}</h2>
        {list.length ? (
          <p className="text-footnote text-label-2 tnum">
            {done} of {list.length} done
          </p>
        ) : null}
      </div>

      <ul className="overflow-hidden rounded-group bg-fill">
        {list.map((i, n) => (
          <li key={i.id} className="relative">
            {n > 0 ? <span className={separator} /> : null}
            <label className="press flex min-h-12 w-full cursor-pointer items-center gap-3.5 px-4 py-2.5 has-focus-visible:ring-2 has-focus-visible:ring-label has-focus-visible:ring-inset">
              <input
                type="checkbox"
                checked={i.status === "done"}
                onChange={() => tick(i)}
                className="peer sr-only"
              />
              <Circle done={i.status === "done"} />
              <span className={`min-w-0 flex-1 text-body ${i.status === "done" ? "text-label-2" : ""}`}>
                {i.text}
              </span>
              {i.carried_from ? (
                <span className="shrink-0 text-footnote text-label-2">From yesterday</span>
              ) : null}
            </label>
          </li>
        ))}

        {room ? (
          <li className="relative">
            {list.length ? <span className={separator} /> : null}
            {adding ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
                className="flex min-h-12 items-center gap-3.5 px-4"
              >
                <Circle done={false} />
                <label htmlFor={`add-${goalId}`} className="sr-only">
                  New item
                </label>
                <input
                  id={`add-${goalId}`}
                  ref={inputRef}
                  // biome-ignore lint/a11y/noAutofocus: opened by the user's own tap on "Add one"
                  autoFocus
                  value={text}
                  maxLength={200}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => {
                    if (!text.trim()) setAdding(false);
                  }}
                  enterKeyHint="done"
                  placeholder="One outcome for today"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-body text-label outline-none placeholder:text-label-2"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="press flex min-h-12 w-full items-center gap-3.5 px-4 text-body text-tint-text"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[22px]">
                  <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                {list.length === 0 ? "Add the first one" : "Add one"}
              </button>
            )}
          </li>
        ) : null}
      </ul>

      <p className="mt-2 px-4 text-footnote text-label-2">
        {
          list.length === 0
            ? "One to three outcomes that would make today count." /* (Brand) */
            : room
              ? `Room for ${MAX - list.length} more. Three is the most.` /* (Brand) */
              : "Three set. That's a full plate, so finish these first." /* (Brand) */
        }
      </p>

      {error ? (
        <p role="alert" className="mt-1 px-4 text-subhead text-danger">
          {error}
        </p>
      ) : null}

      {suggestions.length && room ? (
        <div className="mt-4">
          <h3 className="mb-2 px-4 text-footnote font-semibold text-label-2">Still open from yesterday</h3>
          <ul className="overflow-hidden rounded-group bg-fill">
            {suggestions
              .filter((s) => !carried.includes(s.id))
              .slice(0, MAX - list.length)
              .map((s, n) => (
                <li key={s.id} className="relative flex min-h-12 items-center gap-3 py-1.5 pr-2 pl-4">
                  {n > 0 ? <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" /> : null}
                  <span className="min-w-0 flex-1 text-body text-label-2">{s.text}</span>
                  <button
                    type="button"
                    onClick={() =>
                      start(async () => {
                        setCarried(s.id);
                        setOptimistic({ add: { ...s, status: "open", carried_from: s.id } });
                        const r = await carryItem(s.id).catch(() => ({ ok: false, message: OFFLINE }));
                        setError(r.ok ? null : (r.message ?? OFFLINE));
                      })
                    }
                    className="press min-h-11 shrink-0 px-2 text-subhead font-semibold text-tint-text"
                  >
                    Carry over
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
