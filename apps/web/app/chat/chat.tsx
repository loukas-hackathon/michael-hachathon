"use client";

import type { ChatMessage } from "@michael/shared";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { formatTime } from "@/lib/format";
import { streamChat } from "./stream-chat";

const STARTERS = [
  "How is my day going?",
  "Where did my time go today?",
  "Am I on track for the gym this week?",
  "When should I train tomorrow?",
];

type Line = Pick<ChatMessage, "id" | "role" | "content"> & { created_at: string | null };

export function Chat({ initial }: { initial: ChatMessage[] }) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Keep the newest line (or the thinking bubble) in view, as in Messages.
  const tail = lines.length + (pending ? 1 : 0);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: tail > initial.length ? "smooth" : "auto" });
  }, [tail, initial.length]);

  function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    const tempId = `pending-${Date.now()}`;
    setError(null);
    setDraft("");
    setLines((l) => [...l, { id: tempId, role: "user", content: message, created_at: null }]);
    const replyId = `${tempId}-reply`;
    startTransition(async () => {
      // Michael's answer grows in its own bubble as it is written, then swaps for the stored pair.
      let streamed = "";
      const res = await streamChat(message, (text) => {
        streamed += text;
        const content = streamed;
        setLines((l) => [
          ...l.filter((x) => x.id !== replyId),
          { id: replyId, role: "assistant", content, created_at: null },
        ]);
        end.current?.scrollIntoView({ block: "end" });
      });
      const temp = (x: Line) => x.id !== tempId && x.id !== replyId;
      if (res.ok) {
        setLines((l) => [...l.filter(temp), res.data.message, res.data.reply]);
      } else {
        // Nothing was stored: take the line back and put it in the box so it can be sent again.
        setLines((l) => l.filter(temp));
        setDraft(message);
        setError(res.error);
        input.current?.focus();
      }
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pt-4" aria-live="polite">
        {lines.length === 0 ? (
          <div className="pt-6">
            <p className="text-insight font-semibold">Ask me about your day.</p>
            <p className="mt-1 text-subhead text-label-2">
              I answer from your timeline, your goals and your week. Short answers, real numbers.
            </p>
            <ul className="mt-5 flex flex-col items-start gap-2">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => send(s)}
                    disabled={pending}
                    className="press min-h-11 rounded-full bg-fill px-4 text-subhead font-semibold text-tint-text"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {lines.map((m) => (
              <li key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-card px-3.5 py-2 text-body ${
                    m.role === "user" ? "bg-tint text-on-tint" : "bg-fill text-label"
                  }`}
                >
                  {m.content}
                </p>
                {m.role === "assistant" && m.created_at ? (
                  <span className="mt-0.5 px-1 text-caption text-label-2 tnum">
                    {formatTime(m.created_at)}
                  </span>
                ) : null}
              </li>
            ))}
            {pending && lines.at(-1)?.role === "user" ? (
              <li className="flex items-start">
                <p className="rounded-card bg-fill px-3.5 py-2 text-body text-label-2">
                  Looking at your day…
                </p>
              </li>
            ) : null}
          </ol>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-[calc(var(--m-tabbar-h)+24px+env(safe-area-inset-bottom))] mt-4 bg-bg pt-2 lg:bottom-6"
      >
        {error ? (
          <p role="alert" className="mb-2 px-1 text-footnote text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex items-end gap-2 rounded-card bg-fill p-1.5 pl-4">
          <label htmlFor="chat-input" className="sr-only">
            Message Michael
          </label>
          <textarea
            id="chat-input"
            ref={input}
            rows={1}
            value={draft}
            maxLength={2000}
            placeholder="Ask Michael"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-body outline-none [field-sizing:content] placeholder:text-label-2"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="press h-9 shrink-0 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
