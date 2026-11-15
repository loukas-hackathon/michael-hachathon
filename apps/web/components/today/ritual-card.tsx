"use client";

import type { ChecklistItem, RitualResult, RitualSuggestion, RitualToday } from "@michael/shared";
import { useState, useTransition } from "react";
import { saveEvening, saveMorning, skipHalf } from "@/app/ritual-actions";
import { haptic } from "@/components/haptics";
import { hm } from "@/lib/format";

// The daily ritual on Today (#318). Morning: "What would make today a win?" Up to three
// outcomes in your own words, each optionally for a goal, with a rough estimate; Michael suggests
// one or two. Evening: "What did you get done?" Done, partly or not; carry the rest to tomorrow;
// log the time for the goal; then one line with the maths. "Not today" hides it; no streaks.

const MAX = 3;
const separator = "absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator";
const chip = (on: boolean) =>
  `press min-h-8 shrink-0 rounded-full px-3 text-footnote font-semibold ${
    on ? "bg-label text-bg" : "bg-[color-mix(in_srgb,var(--m-label)_7%,transparent)] text-label"
  }`;
const save =
  "press min-h-11 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-5 text-subhead font-semibold text-tint-text disabled:opacity-60";
const quiet = "press min-h-11 px-2 text-subhead font-semibold text-label-2 disabled:opacity-60";
const ESTIMATES = [30, 60, 90, 120];

type Draft = { key: number; text: string; goal_id: string | null; estimate_minutes: number | null };
let nextKey = 0;
const blank = (): Draft => ({ key: ++nextKey, text: "", goal_id: null, estimate_minutes: null });

function Header({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return (
    <div className="mb-2">
      <p className="text-footnote font-semibold text-label-2">{eyebrow}</p>
      <h2 className="text-title3 font-bold">{title}</h2>
      {note ? <p className="mt-0.5 text-subhead text-label-2">{note}</p> : null}
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="mt-2 px-1 text-subhead text-danger">
      {message}
    </p>
  ) : null;
}

/** The goal's title for an outcome, or null. */
const goalTitle = (ritual: RitualToday, id: string | null | undefined) =>
  id ? (ritual.goals.find((g) => g.id === id)?.title ?? null) : null;

// ---------- morning ----------

function MorningPlan({ ritual }: { ritual: RitualToday }) {
  const kept = ritual.items.filter((i) => i.status === "open");
  const room = Math.max(0, MAX - kept.length);
  const [drafts, setDrafts] = useState<Draft[]>([blank()]);
  const [open, setOpen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [skipping, startSkip] = useTransition();

  const filled = drafts.filter((d) => d.text.trim());
  const rows = drafts.slice(0, room);
  const suggestions = ritual.suggestions.filter(
    (s) => !drafts.some((d) => d.text.trim().toLowerCase() === s.text.toLowerCase()),
  );

  const change = (n: number, patch: Partial<Draft>) =>
    setDrafts((list) => {
      const next = list.map((d, i) => (i === n ? { ...d, ...patch } : d));
      // A new empty row appears once the last one has words, up to the day's room.
      const last = next.at(-1);
      if (last?.text.trim() && next.length < room) next.push(blank());
      return next;
    });

  const take = (s: RitualSuggestion) => {
    const at = drafts.findIndex((d) => !d.text.trim());
    const n = at === -1 ? drafts.length : at;
    if (n >= room) return;
    setDrafts((list) => {
      const next = [...list];
      next[n] = {
        key: next[n]?.key ?? ++nextKey,
        text: s.text,
        goal_id: s.goal_id,
        estimate_minutes: s.estimate_minutes,
      };
      if (next.length < room && next.every((d) => d.text.trim())) next.push(blank());
      return next;
    });
    setOpen(n);
  };

  const submit = () => {
    if (filled.length === 0 || pending) return;
    start(async () => {
      const res = await saveMorning({
        outcomes: filled.map((d) => ({
          text: d.text.trim(),
          goal_id: d.goal_id,
          estimate_minutes: d.estimate_minutes,
        })),
      }).catch(() => ({ ok: false as const, message: "I lost the line. Nothing changed." }));
      if (res.ok) haptic();
      setError(res.ok ? null : res.message);
    });
  };

  return (
    <section aria-label="Morning plan" className="mt-6" data-ritual="morning">
      <Header
        eyebrow="Morning"
        title="What would make today a win?"
        note={room === MAX ? "Up to three, in your own words." : `Room for ${room} more. Three is plenty.`}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ul className="overflow-hidden rounded-group bg-fill">
          {kept.map((i, n) => (
            <li key={i.id} className="relative flex min-h-12 items-center gap-3 px-4 py-2.5">
              {n > 0 ? <span className={separator} /> : null}
              <span className="min-w-0 flex-1 text-body">{i.text}</span>
              <span className="shrink-0 text-footnote text-label-2">
                {i.carried_from ? "From yesterday" : "Set"}
              </span>
            </li>
          ))}
          {rows.map((d, n) => (
            <li key={d.key} className="relative px-4 py-1">
              {n > 0 || kept.length > 0 ? <span className={separator} /> : null}
              <label htmlFor={`outcome-${n}`} className="sr-only">
                Outcome {kept.length + n + 1}
              </label>
              <input
                id={`outcome-${n}`}
                value={d.text}
                maxLength={200}
                disabled={pending}
                onChange={(e) => change(n, { text: e.target.value })}
                onFocus={() => setOpen(n)}
                onKeyDown={(e) => {
                  // Return moves to the next outcome while there is one; on the last it keeps them.
                  const next = document.getElementById(`outcome-${n + 1}`);
                  if (e.key === "Enter" && next) {
                    e.preventDefault();
                    next.focus();
                  }
                }}
                enterKeyHint={n === rows.length - 1 ? "done" : "next"}
                placeholder={
                  kept.length + n === 0 ? "The one that would make today count" : "Another outcome"
                }
                // The caret shows focus inside the grouped list, as in the chat field.
                style={{ outline: "none" }}
                className="min-h-11 w-full bg-transparent text-body text-label placeholder:text-label-2"
              />
              {open === n && d.text.trim() ? (
                <div className="flex flex-col gap-2 pb-2.5">
                  {ritual.goals.length ? (
                    <fieldset
                      className="-mx-4 min-w-0 flex gap-1.5 overflow-x-auto px-4"
                      aria-label="For a goal"
                    >
                      {ritual.goals.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          aria-pressed={d.goal_id === g.id}
                          onClick={() => change(n, { goal_id: d.goal_id === g.id ? null : g.id })}
                          className={chip(d.goal_id === g.id)}
                        >
                          {g.title}
                        </button>
                      ))}
                    </fieldset>
                  ) : null}
                  <fieldset
                    className="-mx-4 min-w-0 flex gap-1.5 overflow-x-auto px-4"
                    aria-label="About how long"
                  >
                    {ESTIMATES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={d.estimate_minutes === m}
                        onClick={() => change(n, { estimate_minutes: d.estimate_minutes === m ? null : m })}
                        className={`${chip(d.estimate_minutes === m)} tnum`}
                      >
                        {hm(m)}
                      </button>
                    ))}
                  </fieldset>
                </div>
              ) : d.text.trim() && (d.goal_id || d.estimate_minutes) ? (
                <p className="-mt-1 pb-2 text-footnote text-label-2">
                  {[
                    goalTitle(ritual, d.goal_id),
                    d.estimate_minutes ? `about ${hm(d.estimate_minutes)}` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {suggestions.length && filled.length < room ? (
          <div className="mt-3">
            <h3 className="mb-1.5 px-1 text-footnote font-semibold text-label-2">I would add</h3>
            <ul className="overflow-hidden rounded-group bg-fill">
              {suggestions.map((s, n) => (
                <li key={s.text} className="relative flex min-h-12 items-center gap-3 py-2 pr-2 pl-4">
                  {n > 0 ? <span className={separator} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block text-body">{s.text}</span>
                    <span className="block text-footnote text-label-2">{s.reason}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => take(s)}
                    className="press min-h-11 shrink-0 px-2 text-subhead font-semibold text-tint-text"
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="submit"
            disabled={pending || filled.length === 0}
            aria-busy={pending}
            className={`${save} min-w-36`}
          >
            {pending ? "Saving" : filled.length > 1 ? `Keep these ${filled.length}` : "Keep it"}
          </button>
          <button
            type="button"
            disabled={skipping || pending}
            onClick={() =>
              startSkip(async () => {
                const res = await skipHalf("morning").catch(() => null);
                setError(res?.ok ? null : (res?.message ?? "I lost the line. Nothing changed."));
              })
            }
            className={quiet}
          >
            Not today
          </button>
        </div>
      </form>
      <ErrorLine message={error} />
    </section>
  );
}

// ---------- evening ----------

type Answer = { result: RitualResult | null; carry: boolean; minutes: number | null };

const RESULTS: { value: RitualResult; label: string }[] = [
  { value: "done", label: "Done" },
  { value: "partly", label: "Partly" },
  { value: "not", label: "Not" },
];

const answerOf = (i: ChecklistItem): Answer => ({
  result:
    i.status === "done" ? "done" : i.status === "partly" ? "partly" : i.status === "dropped" ? "not" : null,
  carry: false,
  minutes: i.logged_minutes ?? null,
});

function minuteOptions(estimate: number | null | undefined) {
  const base = [15, 30, 60];
  return estimate && !base.includes(estimate) ? [...base, estimate].sort((a, b) => a - b) : base;
}

function EveningLog({ ritual }: { ritual: RitualToday }) {
  const items = ritual.items;
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(items.map((i) => [i.id, answerOf(i)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [skipping, startSkip] = useTransition();

  const set = (id: string, patch: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [id]: { ...(a[id] as Answer), ...patch } }));
  const answered = items.filter((i) => answers[i.id]?.result);

  const submit = () => {
    if (answered.length === 0 || pending) return;
    start(async () => {
      const res = await saveEvening({
        results: answered.map((i) => {
          const a = answers[i.id] as Answer;
          return {
            item_id: i.id,
            result: a.result as RitualResult,
            carry: a.result !== "done" && a.carry,
            minutes: a.result !== "not" ? a.minutes : null,
          };
        }),
      }).catch(() => ({ ok: false as const, message: "I lost the line. Nothing changed." }));
      if (res.ok) haptic();
      setError(res.ok ? null : res.message);
    });
  };

  return (
    <section aria-label="Evening log" className="mt-6" data-ritual="evening">
      <Header
        eyebrow="Evening"
        title="What did you get done?"
        note="One tap each. An honest no beats a hopeful yes."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ul className="overflow-hidden rounded-group bg-fill">
          {items.map((i, n) => {
            const a = answers[i.id] as Answer;
            const goal = goalTitle(ritual, i.linked_goal_id);
            return (
              <li key={i.id} className="relative flex flex-col gap-2 px-4 py-3">
                {n > 0 ? <span className={separator} /> : null}
                <div>
                  <p className="text-body">{i.text}</p>
                  {goal || i.estimate_minutes ? (
                    <p className="text-footnote text-label-2">
                      {[
                        goal ? `For ${goal}` : null,
                        i.estimate_minutes ? `about ${hm(i.estimate_minutes)}` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                <fieldset className="flex min-w-0 gap-1.5" aria-label={`${i.text}: how did it go`}>
                  {RESULTS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      aria-pressed={a.result === r.value}
                      onClick={() =>
                        set(i.id, {
                          result: r.value,
                          minutes:
                            r.value === "done" && a.minutes === null && i.linked_goal_id
                              ? (i.estimate_minutes ?? null)
                              : a.minutes,
                        })
                      }
                      className={`${chip(a.result === r.value)} flex-1`}
                    >
                      {r.label}
                    </button>
                  ))}
                </fieldset>
                {a.result && a.result !== "not" && i.linked_goal_id ? (
                  <fieldset
                    className="-mx-4 flex min-w-0 items-center gap-1.5 overflow-x-auto px-4"
                    aria-label={`Time on it, counts for ${goal ?? "the goal"}`}
                  >
                    <span className="shrink-0 text-footnote text-label-2">Time</span>
                    {minuteOptions(i.estimate_minutes).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={a.minutes === m}
                        onClick={() => set(i.id, { minutes: a.minutes === m ? null : m })}
                        className={`${chip(a.minutes === m)} tnum`}
                      >
                        {hm(m)}
                      </button>
                    ))}
                  </fieldset>
                ) : null}
                {a.result && a.result !== "done" ? (
                  <button
                    type="button"
                    aria-pressed={a.carry}
                    onClick={() => set(i.id, { carry: !a.carry })}
                    className={`${chip(a.carry)} self-start`}
                  >
                    {a.carry ? "Carried to tomorrow" : "Carry to tomorrow"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="submit"
            disabled={pending || answered.length === 0}
            aria-busy={pending}
            className={`${save} min-w-36`}
          >
            {pending ? "Logging" : "Log the day"}
          </button>
          <button
            type="button"
            disabled={skipping || pending}
            onClick={() =>
              startSkip(async () => {
                const res = await skipHalf("evening").catch(() => null);
                setError(res?.ok ? null : (res?.message ?? "I lost the line. Nothing changed."));
              })
            }
            className={quiet}
          >
            Not today
          </button>
        </div>
      </form>
      <ErrorLine message={error} />
    </section>
  );
}

// ---------- evening, logged ----------

const MARK: Record<ChecklistItem["status"], string> = {
  open: "Open",
  done: "Done",
  partly: "Partly",
  dropped: "Not done",
  moved: "Tomorrow",
};

function EveningLogged({ ritual }: { ritual: RitualToday }) {
  return (
    <section aria-label="Evening log" className="mt-6" data-ritual="logged">
      <Header eyebrow="Evening" title="The day, logged." />
      <p role="status" className="m-swap text-body">
        {ritual.summary}
      </p>
      {ritual.items.length ? (
        <ul className="mt-3 overflow-hidden rounded-group bg-fill">
          {ritual.items.map((i, n) => (
            <li key={i.id} className="relative flex min-h-11 items-center gap-3 px-4 py-2">
              {n > 0 ? <span className={separator} /> : null}
              <span className={`min-w-0 flex-1 text-subhead ${i.status === "done" ? "" : "text-label-2"}`}>
                {i.text}
              </span>
              <span className="shrink-0 text-footnote text-label-2 tnum">
                {i.logged_minutes ? `${hm(i.logged_minutes)}, ` : ""}
                {MARK[i.status]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Morning plan, evening log, or the logged evening; Today decides when (lib/ritual.ts). */
export function RitualCard({ ritual }: { ritual: RitualToday }) {
  if (ritual.phase === "morning") return <MorningPlan key={ritual.day} ritual={ritual} />;
  if (ritual.evening === "done") return <EveningLogged ritual={ritual} />;
  return <EveningLog key={ritual.day} ritual={ritual} />;
}
