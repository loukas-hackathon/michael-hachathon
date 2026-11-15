"use client";

import { useEffect, useState } from "react";
import { chatLineCount, currentLines, useChatSession } from "@/app/chat/chat-session";
import { MiMark } from "@/components/brand";
import { markHintSeen } from "@/components/hint";
import { Sheet } from "@/components/sheet";
import {
  endConversation,
  type Phase,
  startConversation,
  tapConversation,
  useConversation,
} from "./conversation";
import { DICTATE_COPY, hasTouchKeyboard, isIosHomeScreenApp, UNSUPPORTED_COPY } from "./speech";

const STATUS: Record<Phase, string> = {
  off: "Tap to talk again",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Tap to cut in",
  unavailable: "",
};

/** The one time hint's id: gone once Talk or the mic has been used. */
export const TALK_HINT = "talk";

/**
 * Talk with Michael: a hands free conversation in a sheet. `start` runs inside the tap that asks
 * for it, so iOS lets Michael's voice play. `show` only opens the sheet (arriving from the You
 * sheet, before any tap on this screen); a tap on the orb then starts it.
 */
export function useTalk(elevenlabs: boolean) {
  const [open, setOpen] = useState(false);
  // Only this conversation's lines are shown as captions: the count when it started.
  const [from, setFrom] = useState(0);
  const begin = () => {
    setFrom(chatLineCount());
    markHintSeen(TALK_HINT);
    startConversation({ elevenlabs });
  };
  const start = () => {
    setOpen(true);
    begin();
  };
  const show = () => {
    setFrom(chatLineCount());
    setOpen(true);
  };
  const sheet = <ConversationSheet open={open} from={from} onStart={begin} onClose={() => setOpen(false)} />;
  return { start, show, sheet };
}

/**
 * Talk, in the chat composer where the phone apps put voice mode: the waveform and the word, in
 * place of Send while the field is empty. The mic beside it is hold to dictate.
 */
export function TalkButton({ onTalk, disabled }: { onTalk: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Talk to Michael"
      data-testid="talk"
      disabled={disabled}
      onClick={onTalk}
      className="hit press flex h-9 min-w-[4.75rem] shrink-0 items-center justify-center gap-1.5 rounded-full bg-tint px-3.5 text-subhead font-semibold text-on-tint disabled:opacity-40"
    >
      <WaveIcon className="size-[18px]" />
      Talk
    </button>
  );
}

function ConversationSheet({
  open,
  from,
  onStart,
  onClose,
}: {
  open: boolean;
  from: number;
  onStart: () => void;
  onClose: () => void;
}) {
  const talk = useConversation();
  const session = useChatSession();
  // Leaving Chat ends the conversation; closing the sheet does too (close below).
  useEffect(() => () => endConversation(), []);

  const close = () => {
    endConversation();
    onClose();
  };
  const lines = currentLines(session).slice(from).slice(-4);
  const live = talk.phase === "listening" && talk.heard ? talk.heard : null;
  const status =
    talk.phase === "speaking" && talk.bargeIn
      ? "Speak or tap to cut in"
      : talk.phase === "off" && lines.length === 0 && !talk.note
        ? "Tap to start"
        : STATUS[talk.phase];
  const unavailable =
    hasTouchKeyboard() || isIosHomeScreenApp()
      ? `I can't listen in this app. ${DICTATE_COPY}`
      : UNSUPPORTED_COPY;

  return (
    <Sheet open={open} onClose={close} title="Talk to Michael" closeLabel="Done">
      <div className="flex min-h-[60dvh] flex-col items-center pt-6" data-testid="conversation">
        {talk.phase === "unavailable" ? (
          <p role="alert" className="mt-10 max-w-[28ch] text-center text-body text-label-2">
            {unavailable}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={talk.phase === "off" ? onStart : tapConversation}
              aria-label={status || "Michael"}
              data-phase={talk.phase}
              data-testid="conversation-orb"
              disabled={talk.phase === "thinking"}
              className="press relative grid size-36 place-items-center rounded-full"
            >
              {talk.phase === "listening" ? (
                <span
                  aria-hidden="true"
                  className="m-listen-ring pointer-events-none absolute inset-0 rounded-full bg-tint"
                />
              ) : null}
              {talk.phase === "listening" && talk.recorded ? (
                // A recorded turn shows the live level instead of live words.
                <span
                  aria-hidden="true"
                  data-testid="voice-level"
                  className="pointer-events-none absolute inset-2 rounded-full bg-tint opacity-25 transition-transform duration-75"
                  style={{ transform: `scale(${1 + Math.min(talk.level * 3, 0.35)})` }}
                />
              ) : null}
              <span
                className={`relative grid size-28 place-items-center rounded-full bg-label text-bg transition-opacity duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] ${
                  talk.phase === "speaking" ? "m-speak-breath" : ""
                } ${talk.phase === "thinking" || talk.phase === "off" ? "opacity-60" : ""}`}
              >
                <MiMark className="block h-auto w-14" />
              </span>
            </button>
            <p aria-live="polite" className="mt-9 min-h-6 text-subhead font-semibold text-label-2">
              {status}
            </p>
            {talk.note ? <p className="mt-1 text-footnote text-label-2">{talk.note}</p> : null}
          </>
        )}

        <ol className="mt-8 flex w-full flex-col gap-3" aria-live="polite">
          {lines.map((l) => (
            <li
              key={l.key ?? l.id}
              className={l.role === "user" ? "text-subhead text-label-2" : "text-body text-label"}
            >
              {l.content}
            </li>
          ))}
          {live ? <li className="text-subhead text-label-2">{live}</li> : null}
        </ol>

        <button
          type="button"
          onClick={close}
          className="press mt-auto min-h-11 rounded-full bg-fill px-6 text-subhead font-semibold text-label"
        >
          End
        </button>
      </div>
    </Sheet>
  );
}

function WaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
