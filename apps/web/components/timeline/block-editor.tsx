"use client";

import { type FormEvent, useState } from "react";
import { formatTime } from "@/lib/format";
import type { Plan } from "@/lib/timeline";
import { input, Row, Segmented } from "../form-controls";

// The editable half of the Timeline's detail sheet (#271): a new block, or one of the user's own
// solo blocks that has not started. Title, start, length or end, goal, and Delete for blocks made in
// Michael. Saving is optimistic: the sheet closes and the day shows the change at once.

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

export type GoalChip = { id: string; title: string };

/** "HH:MM" on the shown day back to an instant. Athens days are 24 hours except at the clock change. */
const toMs = (dayStart: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return dayStart + ((h ?? 0) * 60 + (m ?? 0)) * MIN;
};

export function BlockEditor({
  formId,
  plan,
  isNew,
  goals,
  dayStart,
  removing,
  onSave,
  onRemove,
}: {
  formId: string;
  plan: Plan;
  isNew: boolean;
  goals: GoalChip[];
  dayStart: number;
  removing: boolean;
  onSave: (next: Plan) => void;
  onRemove?: () => void;
}) {
  const [title, setTitle] = useState(isNew ? "" : plan.title);
  const [start, setStart] = useState(formatTime(iso(plan.start)));
  const [end, setEnd] = useState(formatTime(iso(plan.end)));
  const [length, setLength] = useState<"30" | "60">((plan.end - plan.start) / MIN <= 30 ? "30" : "60");
  const [goalId, setGoalId] = useState<string | null>(plan.goalId ?? null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = toMs(dayStart, start);
    // A new start with the end untouched keeps the length, as Calendar does.
    const endUntouched = end === formatTime(iso(plan.end));
    const en = isNew
      ? s + Number(length) * MIN
      : endUntouched
        ? s + (plan.end - plan.start)
        : toMs(dayStart, end);
    if (s <= Date.now()) return setError("That time has passed. Pick a time ahead.");
    if (en - s < 15 * MIN) return setError("A block needs at least 15 minutes.");
    const goal = goals.find((g) => g.id === goalId);
    onSave({
      ...plan,
      start: s,
      end: en,
      title: title.trim() || goal?.title || "Focus block",
      goalId,
    });
  };

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-5 tnum">
      <div className="overflow-hidden rounded-group bg-fill">
        <Row label="Title" htmlFor={`${formId}-title`}>
          <input
            id={`${formId}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            autoComplete="off"
            enterKeyHint="done"
            // A new block is named first: the keyboard is up as the sheet arrives.
            // biome-ignore lint/a11y/noAutofocus: the sheet opened for exactly this field
            autoFocus={isNew}
            placeholder={isNew ? "What is it for?" : "Title"}
            className={`${input} placeholder:text-label-2/50`}
          />
        </Row>
        <Row label="Starts" htmlFor={`${formId}-start`}>
          <input
            id={`${formId}-start`}
            type="time"
            step={900}
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={input}
          />
        </Row>
        {isNew ? null : (
          <Row label="Ends" htmlFor={`${formId}-end`}>
            <input
              id={`${formId}-end`}
              type="time"
              step={900}
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={input}
            />
          </Row>
        )}
      </div>

      {isNew ? (
        <Segmented<"30" | "60">
          name="length"
          value={length}
          onChange={setLength}
          options={[
            { value: "30", label: "30 min" },
            { value: "60", label: "60 min" },
          ]}
        />
      ) : null}

      {goals.length > 0 ? (
        <fieldset>
          <legend className="px-1 text-footnote font-semibold text-label-2">Goal</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {[{ id: null as string | null, title: "No goal" }, ...goals].map((g) => {
              const on = goalId === g.id;
              return (
                <button
                  key={g.id ?? "none"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setGoalId(g.id)}
                  className={`press min-h-9 rounded-full px-3.5 text-subhead font-semibold transition-[background-color,color] duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] ${
                    on ? "bg-tint text-on-tint" : "bg-fill text-label"
                  }`}
                >
                  {g.title}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="px-1 text-subhead text-danger">
          {error}
        </p>
      ) : null}

      {onRemove ? (
        <div className="overflow-hidden rounded-group bg-fill">
          <button
            type="button"
            disabled={removing}
            aria-busy={removing}
            onClick={onRemove}
            className="press flex min-h-11 w-full items-center px-4 text-body text-danger disabled:opacity-60"
          >
            {removing ? "Deleting" : "Delete this block"}
          </button>
        </div>
      ) : null}

      <p className="px-1 text-footnote text-label-2">
        {isNew
          ? "Only your own time. Undo it until it starts."
          : "Drag it on the day to move it, or its bottom edge to change the end. Undo until it starts."}
      </p>
    </form>
  );
}
