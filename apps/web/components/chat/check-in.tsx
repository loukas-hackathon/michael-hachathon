"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useArrival } from "@/components/motion";
import { answer, finish, useCheckIn } from "@/lib/check-in";
import { AFTER, type Answer, DONE, OPENING, type Question, queue } from "@/lib/check-in-data";

export function Bubble({
  from,
  arrive = false,
  children,
}: {
  from: "michael" | "you";
  /** True when it just appeared because of an answer: it grows from its own corner. */
  arrive?: boolean;
  children: React.ReactNode;
}) {
  const pop = from === "you" ? "m-pop-in [--m-origin:100%_100%]" : "m-pop-in [--m-origin:0_100%]";
  return (
    <li className={`flex ${from === "you" ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] rounded-card px-3.5 py-2 text-body ${
          from === "you" ? "bg-tint text-on-tint" : "bg-fill text-label"
        } ${arrive ? pop : ""}`}
      >
        {children}
      </p>
    </li>
  );
}

export const label = (a: Answer) => (a === "yes" ? "Yes" : a === "no" ? "No" : String(a));

/** Michael's questions about the day, one at a time: quick answers or the user's own words. */
export function CheckIn({ questions, sample }: { questions: Question[]; sample: boolean }) {
  const { answers, done } = useCheckIn();
  const [text, setText] = useState("");
  const arriving = useArrival();
  const list = queue(questions, answers);
  const current = list.find((q) => answers[q.id] === undefined);
  const asked = list.filter((q) => answers[q.id] !== undefined);
  // Shown while open, and for the rest of the visit once finished; gone on the next visit.
  const [openedHere] = useState(!done);
  useEffect(() => {
    if (!current && !done && asked.length > 0) finish();
  }, [current, done, asked.length]);

  const reply = (q: Question, value: Answer) => {
    answer(q.id, value);
    setText("");
  };
  const onText = (e: FormEvent) => {
    e.preventDefault();
    if (current && text.trim()) reply(current, text.trim());
  };

  if (!openedHere && done) return null;

  return (
    <section aria-label="Check in" className="pt-4">
      <ol className="flex flex-col gap-2">
        <Bubble from="michael">{OPENING}</Bubble>
        {asked.map((q) => (
          <li key={q.id} className="flex flex-col gap-2">
            <ol className="flex flex-col gap-2">
              <Bubble from="michael" arrive={arriving(`q:${q.id}`)}>
                {q.text}
              </Bubble>
              <Bubble from="you" arrive={arriving(`a:${q.id}`)}>
                {label(answers[q.id] as Answer)}
              </Bubble>
            </ol>
          </li>
        ))}
        {current ? (
          <Bubble from="michael" arrive={arriving(`q:${current.id}`)}>
            {current.text}
          </Bubble>
        ) : null}
        {!current ? (
          <>
            <Bubble from="michael" arrive={arriving("after")}>
              {AFTER}
            </Bubble>
            <Bubble from="michael" arrive={arriving("done")}>
              {DONE}
            </Bubble>
          </>
        ) : null}
      </ol>

      {current ? (
        <div className="mt-3 flex flex-col gap-2">
          {current.kind === "scale" ? (
            <fieldset className="flex gap-2">
              <legend className="sr-only">1 to 5</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => reply(current, n)}
                  className="press grid size-11 place-items-center rounded-full bg-fill text-body font-semibold tnum"
                >
                  {n}
                </button>
              ))}
            </fieldset>
          ) : (
            <fieldset className="flex gap-2">
              <legend className="sr-only">Yes or no</legend>
              {(["yes", "no"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => reply(current, v)}
                  className="press min-h-11 rounded-full bg-fill px-5 text-body font-semibold"
                >
                  {label(v)}
                </button>
              ))}
            </fieldset>
          )}
          <form onSubmit={onText} className="flex items-center gap-2 rounded-card bg-fill p-1.5 pl-4">
            <label htmlFor="check-in-text" className="sr-only">
              Answer in your own words
            </label>
            <input
              id="check-in-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={280}
              placeholder="Or in your own words"
              className="min-h-9 flex-1 bg-transparent text-body outline-none placeholder:text-label-2"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="press h-9 shrink-0 rounded-full px-3 text-subhead font-semibold text-tint-text disabled:opacity-40"
            >
              Answer
            </button>
          </form>
        </div>
      ) : null}
      {sample ? (
        <p className="mt-3 text-footnote text-label-2">Sample questions until Michael's check in is live.</p>
      ) : null}
    </section>
  );
}
