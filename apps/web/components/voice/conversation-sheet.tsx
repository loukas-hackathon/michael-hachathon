"use client";

import { useEffect, useState } from "react";
import { chatLineCount, useChatSession } from "@/app/chat/chat-session";
import { MiMark } from "@/components/brand";
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

/**
 * Talk: the button left of the Mi button on Chat. One tap opens the conversation and starts
 * listening, inside the same tap so iOS lets Michael's voice play.
 */
export function TalkButton({ elevenlabs }: { elevenlabs: boolean }) {
  const [open, setOpen] = useState(false);
  // Only this conversation's lines are shown as captions: the count when it started.
  const [from, setFrom] = useState(0);
  return (
    <>
      <button
        type="button"
        aria-label="Talk to Michael"
        data-testid="talk"
        onClick={() => {
          setFrom(chatLineCount());
          setOpen(true);
          startConversation({ elevenlabs });
        }}
        className="press -m-[7px] grid size-11 place-items-center rounded-full"
      >
        <span className="grid size-[30px] place-items-center rounded-full bg-fill text-tint-text">
          <WaveIcon className="size-[18px]" />
        </span>
      </button>
      <ConversationSheet open={open} from={from} onClose={() => setOpen(false)} />
    </>
  );
}

function ConversationSheet({ open, from, onClose }: { open: boolean; from: number; onClose: () => void }) {
  const talk = useConversation();
  const session = useChatSession();
  // Leaving Chat ends the conversation; closing the sheet does too (close below).
  useEffect(() => () => endConversation(), []);

  const close = () => {
    endConversation();
    onClose();
  };
  const lines = session.lines.slice(from).slice(-4);
  const live = talk.phase === "listening" && talk.heard ? talk.heard : null;
  const status = talk.phase === "speaking" && talk.bargeIn ? "Speak or tap to cut in" : STATUS[talk.phase];
  const unavailable =
    hasTouchKeyboard() || isIosHomeScreenApp()
      ? `I can't listen in this app. ${DICTATE_COPY}`
      : UNSUPPORTED_COPY;

  return (
    <Sheet open={open} onClose={close} title="Talk to Michael">
      <div className="flex min-h-[60dvh] flex-col items-center pt-6" data-testid="conversation">
        {talk.phase === "unavailable" ? (
          <p role="alert" className="mt-10 max-w-[28ch] text-center text-body text-label-2">
            {unavailable}
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={tapConversation}
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
