"use client";

import type { CheckIn, CheckInValue } from "@michael/shared";
import { type FormEvent, useState, useTransition } from "react";
import { answerCheckInAction } from "@/app/chat/check-in-actions";
import { haptic } from "@/components/haptics";
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

  // The answer shows as the user's bubble at once (michael-feedback R2). Michael's next line waits
  // for the server, since a follow up may come first; a failure takes the bubble back and keeps the
  // text with Michael's line.
  const setAnswer = (id: string, answer: CheckInValue | null) =>
    setQuestions((list) => list.map((x) => (x.id === id ? { ...x, answer } : x)));
  const reply = (q: CheckIn, value: CheckInValue) => {
    if (pending) return;
    const typed = text;
    setError(null);
    setText("");
    setAnswer(q.id, value);
    startTransition(async () => {
      const res = await answerCheckInAction(q.id, value).catch(() => ({
        ok: false as const,
        error: "I could not reach the server. Nothing changed.",
      }));
      if (!res.ok) {
        setAnswer(q.id, null);
        setText(typed);
        setError(res.error);
        return;
      }
      haptic();
      if (res.followUp) {
        const followUp = res.followUp;
        setQuestions((list) => {
          const at = list.findIndex((x) => x.id === q.id);
          return [...list.slice(0, at + 1), followUp, ...list.slice(at + 1)];
        });
      }
    });
  };
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
        {pending ? null : current ? (
          <Bubble from="michael">{current.question}</Bubble>
        ) : (
          <>
            <Bubble from="michael">{AFTER}</Bubble>
            <Bubble from="michael">{DONE}</Bubble>
          </>
        )}
      </ol>

      {current && !pending ? (
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
