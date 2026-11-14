"use client";

import type { ChatMessage, Recommendation } from "@michael/shared";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { useArrival } from "@/components/motion";
import { PushToTalk } from "@/components/voice/push-to-talk";
import { speakReply } from "@/components/voice/speech";
import { formatTime } from "@/lib/format";
import { ActionChips } from "./action-chips";
import { MessageBubble } from "./message-bubble";
import { streamChat } from "./stream-chat";
import { useKeyboardInset, useLatest } from "./use-viewport";

// `key` keeps a bubble's identity when its temporary id is swapped for the stored one, so it does
// not pop in twice.
type Line = Pick<ChatMessage, "id" | "role" | "content"> & { created_at: string | null; key?: string };

/** Each stored answer's actions, by reply id, from the history's action_ids. */
function actedFrom(messages: ChatMessage[], actions: Recommendation[]) {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const out: Record<string, Recommendation[]> = {};
  for (const m of messages) {
    const list = (m.action_ids ?? []).flatMap((id) => byId.get(id) ?? []);
    if (list.length) out[m.id] = list;
  }
  return out;
}

export function Chat({
  initial,
  initialActions = [],
  starters,
  elevenlabs = false,
}: {
  initial: ChatMessage[];
  /** The recommendations named in the history's action_ids, as they stand now. */
  initialActions?: Recommendation[];
  /** Questions from the user's real day, shown while there is no history. */
  starters: string[];
  elevenlabs?: boolean;
}) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // What Michael did while answering, by reply id: shown as "Done. Undo" chips under that reply.
  const [acted, setActed] = useState<Record<string, Recommendation[]>>(() =>
    actedFrom(initial, initialActions),
  );
  const [listening, setListening] = useState(false);
  // Set when the line came from push to talk, so the reply is spoken back.
  const spoken = useRef(false);
  // New bubbles grow from their own corner, as in Messages; the history already there stays still.
  const arriving = useArrival();
  const { atEnd, atEndRef, toEnd } = useLatest();
  const keyboard = useKeyboardInset();

  // Open on the latest line, as Messages does.
  useEffect(() => {
    if (initial.length) toEnd(false);
  }, [initial.length, toEnd]);

  // Follow the answer as it grows, unless the user has scrolled up to read.
  const tail = lines.length + (pending ? 1 : 0) + (lines.at(-1)?.content.length ?? 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tail is the trigger, not an input.
  useEffect(() => {
    if (atEndRef.current) toEnd(false);
  }, [tail, atEndRef, toEnd]);

  // The keyboard opening keeps the latest line in view above the field.
  useEffect(() => {
    if (keyboard > 0 && atEndRef.current) toEnd(false);
  }, [keyboard, atEndRef, toEnd]);

  function send(text: string, viaVoice = false) {
    const message = text.trim();
    if (!message || pending) return;
    spoken.current = viaVoice;
    const tempId = `pending-${Date.now()}`;
    setError(null);
    setDraft("");
    setLines((l) => [...l, { id: tempId, role: "user", content: message, created_at: null }]);
    // Sending is a choice to read the answer: go to the end even if scrolled up.
    atEndRef.current = true;
    requestAnimationFrame(() => toEnd());
    const replyId = `${tempId}-reply`;
    startTransition(async () => {
      // Michael's answer grows in its own bubble as it is written, then swaps for the stored pair.
      let streamed = "";
      const res = await streamChat(message, (text) => {
        streamed += text;
        const content = streamed;
        setStreamingId(replyId);
        setLines((l) => [
          ...l.filter((x) => x.id !== replyId),
          { id: replyId, role: "assistant", content, created_at: null },
        ]);
      });
      setStreamingId(null);
      const temp = (x: Line) => x.id !== tempId && x.id !== replyId;
      if (res.ok) {
        setLines((l) => [
          ...l.filter(temp),
          { ...res.data.message, key: tempId },
          { ...res.data.reply, key: replyId },
        ]);
        const done = res.data.actions;
        if (done.length) setActed((a) => ({ ...a, [res.data.reply.id]: done }));
        // Spoken once the whole answer is in: a voice reading half sentences sounds broken.
        if (spoken.current) void speakReply(res.data.reply.content, elevenlabs);
      } else {
        // Nothing was stored: take the line back and put it in the box so it can be sent again.
        setLines((l) => l.filter(temp));
        setDraft(message);
        setError(res.error);
        if (spoken.current) void speakReply(res.error, false);
        else input.current?.focus();
      }
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  // Above the keyboard when it is open; above the floating tab bar otherwise.
  const lifted = keyboard > 0 ? { bottom: `${keyboard + 8}px` } : undefined;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 pt-4" aria-live="polite" aria-busy={pending}>
        {lines.length === 0 ? (
          <div className="pt-6">
            <p className="text-insight font-semibold">Ask me about your day.</p>
            <p className="mt-1 text-subhead text-label-2">
              I answer from your timeline, your goals and your week. Short answers, real numbers.
            </p>
            <ul className="mt-5 flex flex-col items-start gap-2">
              {starters.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => send(s)}
                    disabled={pending}
                    className="press min-h-11 rounded-full bg-fill px-4 text-left text-subhead font-semibold text-label tnum"
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
              <MessageBubble
                key={m.key ?? m.id}
                role={m.role}
                content={m.content}
                streaming={m.id === streamingId}
                arriving={arriving(m.key ?? m.id)}
              >
                {acted[m.id] ? <ActionChips actions={acted[m.id] ?? []} /> : null}
                {m.role === "assistant" && m.created_at ? (
                  <span className="mt-0.5 px-1 text-caption text-label-2 tnum">
                    {formatTime(m.created_at)}
                  </span>
                ) : null}
              </MessageBubble>
            ))}
            {pending && lines.at(-1)?.role === "user" ? (
              <li className="flex items-start">
                <p className="m-pop-in rounded-card bg-fill px-3.5 py-2 text-body text-label-2 [--m-origin:0_100%]">
                  Looking at your day…
                </p>
              </li>
            ) : null}
          </ol>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        style={lifted}
        // The paper under the field reaches the screen edge, so lines never show between it and the tab bar.
        className="sticky bottom-[calc(var(--m-tabbar-h)+24px+env(safe-area-inset-bottom))] z-10 mt-4 bg-bg pt-2 pb-0.5 after:absolute after:inset-x-0 after:top-full after:h-[calc(var(--m-tabbar-h)+24px+env(safe-area-inset-bottom))] after:bg-bg lg:bottom-6 lg:after:h-6"
      >
        {!atEnd && lines.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center">
            <button
              type="button"
              onClick={() => toEnd()}
              className="press m-pop-in pointer-events-auto min-h-9 rounded-full bg-bg px-3.5 text-footnote font-semibold text-label shadow-[0_0_0_0.5px_var(--m-separator),0_4px_12px_-6px_rgb(0_0_0/0.3)]"
            >
              Jump to latest
            </button>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mb-2 flex items-center gap-3 px-1">
            <p className="flex-1 text-footnote text-label-2">{error}</p>
            {draft.trim() ? (
              <button
                type="button"
                onClick={() => send(draft)}
                disabled={pending}
                className="press min-h-9 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-footnote font-semibold text-tint-text disabled:opacity-40"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="m-field flex items-end gap-2 rounded-card bg-fill p-1.5 pl-4">
          <label htmlFor="chat-input" className="sr-only">
            Message Michael
          </label>
          <textarea
            id="chat-input"
            ref={input}
            rows={1}
            value={draft}
            maxLength={2000}
            enterKeyHint="send"
            placeholder={listening ? "Listening. Let go to send" : "Ask Michael"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-body outline-none [field-sizing:content] placeholder:text-label-2"
          />
          <PushToTalk
            disabled={pending}
            onListeningChange={(on) => {
              setListening(on);
              if (on) setError(null);
            }}
            onInterim={setDraft}
            onFinal={(text) => send(text, true)}
            onError={setError}
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
