"use client";

import type { ChatMessage, Recommendation } from "@michael/shared";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useArrival } from "@/components/motion";
import { PushToTalk } from "@/components/voice/push-to-talk";
import { formatTime } from "@/lib/format";
import { ActionChips } from "./action-chips";
import { mergeLines, sendLine, setDraft, setError, useChatSession } from "./chat-session";
import { MessageBubble } from "./message-bubble";
import { useKeyboardInset, useLatest } from "./use-viewport";

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
  // The conversation lives in a module store, not a transition, so a tab tap is never held back
  // by a streaming answer and leaving the tab keeps the draft and the reply (chat-session.ts).
  const session = useChatSession();
  const { draft, error, pending, streamingId } = session;
  const lines = mergeLines(initial, session.lines);
  // What VoiceOver hears: the whole reply once it is written, never the stream token by token.
  // Only lines added since the page loaded, so the history is not read out on arrival.
  const last = session.lines.at(-1);
  const announce = pending
    ? "Looking at your day"
    : last?.role === "assistant" && !streamingId
      ? `Michael: ${last.content}`
      : "";
  const input = useRef<HTMLTextAreaElement>(null);
  // What Michael did while answering, by reply id: shown as "Done. Undo" chips under that reply.
  const stored = useMemo(() => actedFrom(initial, initialActions), [initial, initialActions]);
  const acted = { ...stored, ...session.acted };
  const [listening, setListening] = useState(false);
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
    if (!text.trim() || pending) return;
    // Sending is a choice to read the answer: go to the end even if scrolled up.
    atEndRef.current = true;
    requestAnimationFrame(() => toEnd());
    void sendLine(text, { viaVoice, elevenlabs, onFailed: () => input.current?.focus() });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  // Above the keyboard when it is open; above the floating tab bar otherwise.
  const lifted = keyboard > 0 ? { bottom: `${keyboard + 8}px` } : undefined;

  return (
    <div className="flex flex-1 flex-col">
      <p role="status" className="sr-only">
        {announce}
      </p>
      <div className="flex-1 pt-4" aria-busy={pending}>
        {lines.length === 0 ? (
          <div className="pt-6">
            <p className="text-insight font-semibold">Ask me about your day.</p>
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
          <ol aria-label="Conversation" className="flex flex-col gap-2">
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
              className="hit press m-pop-in pointer-events-auto min-h-9 rounded-full bg-bg px-3.5 text-footnote font-semibold text-label shadow-[0_0_0_0.5px_var(--m-separator),0_4px_12px_-6px_rgb(0_0_0/0.3)]"
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
                className="hit press min-h-9 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-footnote font-semibold text-tint-text disabled:opacity-40"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {/* At 200% text the field keeps a usable width and the buttons wrap under it. */}
        <div className="m-field flex flex-wrap items-end justify-end gap-2 rounded-card bg-fill p-1.5 pl-4">
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
            className="max-h-32 min-h-9 min-w-32 flex-1 resize-none bg-transparent py-1.5 text-body outline-none [field-sizing:content] placeholder:text-label-2"
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
            className="hit press h-9 shrink-0 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
