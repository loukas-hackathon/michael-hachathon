"use client";

import type { CheckIn, CheckInValue } from "@michael/shared";
import { type FormEvent, useState, useTransition } from "react";
import { answerCheckInAction } from "@/app/chat/check-in-actions";
import { AFTER, DONE } from "@/lib/check-in-data";
import { Bubble, label } from "./check-in";

/**
 * Michael's check in from the API (#187): today's questions one at a time, each answer kept on the
 * server, with the follow up the answer calls for. The sample card (check-in.tsx) stays for when
 * there are no questions yet.
 */
export function LiveCheckIn({ initial }: { initial: CheckIn[] }) {
  const [questions, setQuestions] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Shown while open, and for the rest of the visit once finished.
  const [openedHere] = useState(initial.some((q) => q.answer === null));
  const current = questions.find((q) => q.answer === null);
  const asked = questions.filter((q) => q.answer !== null);

  const reply = (q: CheckIn, value: CheckInValue) =>
    startTransition(async () => {
      setError(null);
      const res = await answerCheckInAction(q.id, value);
      if (!res.ok) return setError(res.error);
      setText("");
      setQuestions((list) => {
        const next = list.map((x) => (x.id === q.id ? { ...x, answer: value } : x));
        if (!res.followUp) return next;
        const at = next.findIndex((x) => x.id === q.id);
        return [...next.slice(0, at + 1), res.followUp, ...next.slice(at + 1)];
      });
    });
  const onText = (e: FormEvent) => {
    e.preventDefault();
    if (current && text.trim()) reply(current, text.trim());
  };

  if (!openedHere) return null;
  const roots = initial.filter((q) => !q.follow_up_of).length;

  return (
    <section aria-label="Check in" className="pt-4">
      <ol className="flex flex-col gap-2">
        <Bubble from="michael">{`${roots === 1 ? "1 question" : `${roots} questions`} about today. About a minute.`}</Bubble>
        {asked.map((q) => (
          <li key={q.id} className="flex flex-col gap-2">
            <ol className="flex flex-col gap-2">
              <Bubble from="michael">{q.question}</Bubble>
              <Bubble from="you">{label(q.answer as CheckInValue)}</Bubble>
            </ol>
          </li>
        ))}
        {current ? (
          <Bubble from="michael">{current.question}</Bubble>
        ) : (
          <>
            <Bubble from="michael">{AFTER}</Bubble>
            <Bubble from="michael">{DONE}</Bubble>
          </>
        )}
      </ol>

      {current ? (
        <div className="mt-3 flex flex-col gap-2">
          {current.answer_type === "scale" ? (
            <fieldset className="flex gap-2" disabled={pending}>
              <legend className="sr-only">1 to 5</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => reply(current, n)}
                  className="press grid size-11 place-items-center rounded-full bg-fill text-body font-semibold tnum disabled:opacity-40"
                >
                  {n}
                </button>
              ))}
            </fieldset>
          ) : current.answer_type === "yes_no" ? (
            <fieldset className="flex gap-2" disabled={pending}>
              <legend className="sr-only">Yes or no</legend>
              {(["yes", "no"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => reply(current, v)}
                  className="press min-h-11 rounded-full bg-fill px-5 text-body font-semibold disabled:opacity-40"
                >
                  {label(v)}
                </button>
              ))}
            </fieldset>
          ) : null}
          <form onSubmit={onText} className="flex items-center gap-2 rounded-card bg-fill p-1.5 pl-4">
            <label htmlFor="live-check-in-text" className="sr-only">
              Answer in your own words
            </label>
            <input
              id="live-check-in-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={280}
              placeholder={current.answer_type === "text" ? "A few words" : "Or in your own words"}
              className="min-h-9 flex-1 bg-transparent text-body outline-none placeholder:text-label-2"
            />
            <button
              type="submit"
              disabled={!text.trim() || pending}
              className="press h-9 shrink-0 rounded-full px-3 text-subhead font-semibold text-tint-text disabled:opacity-40"
            >
              Answer
            </button>
          </form>
          {error ? (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
