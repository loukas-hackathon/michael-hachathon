"use client";

import type { Recommendation } from "@michael/shared";
import { useEffect, useState } from "react";
import { ActionChips } from "@/app/chat/action-chips";
import {
  chatLineCount,
  currentLines,
  currentSteps,
  currentThread,
  useChatSession,
} from "@/app/chat/chat-session";
import { currentStep } from "@/components/chat/steps";
import { markHintSeen } from "@/components/hint";
import { Sheet } from "@/components/sheet";
import {
  endConversation,
  isWakeConversation,
  type Phase,
  setMuted,
  startConversation,
  tapConversation,
  useConversation,
} from "./conversation";
import { LivingVoice, type VoiceMood } from "./living-voice";
import { DICTATE_COPY, hasTouchKeyboard, isIosHomeScreenApp, UNSUPPORTED_COPY } from "./speech";

// Voice mode is a conversation, not a transcript (#458): the centre of the sheet is Michael, the
// living Mi mark, and nothing he or the user says is written on screen. The only words are the
// step he is on while he thinks, one calm line when something goes wrong, and a chip for anything
// he changed, with its Undo. The whole exchange is in the chat thread underneath, and a visually
// hidden live region reads his reply to screen readers.

/** What the orb does on a tap, for its accessible name. */
const STATUS: Record<Phase, string> = {
  off: "Tap to talk again",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Tap to cut in",
  unavailable: "",
};

/** The state in plain words, shown only under reduced motion, where the mark holds still. */
const STILL: Record<Phase, string> = {
  off: "",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  unavailable: "",
};

/** The one time hint's id: gone once Talk or the mic has been used. */
export const TALK_HINT = "talk";

/**
 * Talk with Michael: a hands free conversation in a sheet. `start` runs inside the tap that asks
 * for it, so iOS lets Michael's voice play, and the sheet is listening in the same frame it opens.
 * `show` only opens the sheet (arriving from the You sheet, before any tap on this screen); a tap
 * on Michael then starts it.
 */
export function useTalk(elevenlabs: boolean) {
  const [open, setOpen] = useState(false);
  // Only this conversation's lines count (their actions, the reply read out): the count at the start.
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
  // Woken by his name ("Yo Michael"), he answers in the island at the top of the screen
  // (components/voice/wake-island.tsx), not in this sheet.
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
  // A conversation woken by name lives in the island and carries on across screens.
  useEffect(
    () => () => {
      if (!isWakeConversation()) endConversation();
    },
    [],
  );

  const close = () => {
    endConversation();
    onClose();
  };

  const thread = currentThread(session);
  const lines = currentLines(session).slice(from);
  // What Michael changed in this conversation, oldest first: each a chip with its Undo.
  const actions: Recommendation[] = lines.flatMap((l) =>
    l.role === "assistant" ? (thread.acted[l.id] ?? []) : [],
  );
  // His latest finished reply, for the screen reader only (a reply still streaming is not read).
  const reply = lines.findLast((l) => l.role === "assistant" && l.id !== thread.streamingId)?.content ?? "";
  const ended = talk.phase === "off";
  const spoke = lines.length > 0;

  const name =
    talk.phase === "speaking" && talk.bargeIn
      ? "Speak or tap to cut in"
      : talk.phase === "listening" && talk.muted
        ? "Muted. Tap to unmute"
        : ended && !spoke && !talk.note
          ? "Tap to start"
          : STATUS[talk.phase];
  const step =
    talk.phase === "thinking" ? (currentStep(currentSteps(session))?.label ?? STATUS.thinking) : null;
  // The one visible line: the step he is on, else why it ended, else how to begin.
  const line = step ?? (ended ? (talk.note ?? (spoke ? null : "Tap to start")) : null);
  const unavailable =
    hasTouchKeyboard() || isIosHomeScreenApp()
      ? `I can't listen in this app. ${DICTATE_COPY}`
      : UNSUPPORTED_COPY;

  // His living voice follows his own voice and the microphone; each word heard swells it a little.
  const words = talk.heard.trim() ? talk.heard.trim().split(/\s+/).length : 0;
  const mood: VoiceMood = talk.muted
    ? "muted"
    : talk.phase === "listening" || talk.phase === "thinking" || talk.phase === "speaking"
      ? talk.phase
      : "idle";

  return (
    <Sheet open={open} onClose={close} title="Talk to Michael" closeLabel="Done">
      <div
        className="flex min-h-[calc(92dvh-8rem-env(safe-area-inset-bottom))] flex-col items-center lg:min-h-[60dvh]"
        data-testid="conversation"
      >
        <div className="flex w-full flex-1 flex-col items-center justify-center py-6">
          {talk.phase === "unavailable" ? (
            <p role="alert" className="max-w-[28ch] text-center text-body text-label-2">
              {unavailable}
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={ended ? onStart : tapConversation}
                aria-label={name || "Michael"}
                data-phase={talk.phase}
                data-muted={talk.muted || undefined}
                data-testid="conversation-orb"
                disabled={talk.phase === "thinking"}
                className="press relative grid size-52 place-items-center rounded-full"
              >
                <LivingVoice
                  mood={ended ? "muted" : mood}
                  mi={ended ? "idle" : undefined}
                  level={talk.level}
                  words={words}
                  levelTestId={
                    talk.phase === "listening" && !talk.muted && talk.recorded ? "voice-level" : undefined
                  }
                />
              </button>
              <p
                className="mt-8 flex min-h-5 items-center text-footnote text-label-2"
                data-testid="conversation-line"
              >
                {line ? (
                  <span
                    key={line}
                    className="m-swap max-w-[30ch] text-center"
                    role={ended ? "status" : undefined}
                  >
                    {line}
                  </span>
                ) : STILL[talk.phase] ? (
                  // Reduced motion: the mark is still, so the state is said in words.
                  <span key={talk.phase} className="m-swap hidden motion-reduce:inline">
                    {talk.muted && talk.phase === "listening" ? "Muted" : STILL[talk.phase]}
                  </span>
                ) : null}
              </p>
            </>
          )}
        </div>

        {actions.length ? (
          <div className="w-full pb-4" data-testid="voice-actions">
            <ActionChips actions={actions} quiet />
          </div>
        ) : null}

        {ended && spoke ? (
          <a
            href="/chat"
            onClick={(e) => {
              e.preventDefault();
              close();
            }}
            className="press mb-3 flex min-h-11 items-center px-2 text-subhead font-semibold text-tint-text"
          >
            See it in Chat
          </a>
        ) : null}

        {/* For screen readers: the state as it changes, and Michael's reply once it is in. */}
        <p className="sr-only" aria-live="polite">
          {talk.phase === "unavailable" ? "" : name}
        </p>
        <p className="sr-only" aria-live="polite" data-testid="conversation-reply">
          {reply}
        </p>

        <div className="flex w-full items-center justify-center gap-3">
          {talk.phase !== "off" && talk.phase !== "unavailable" ? (
            <button
              type="button"
              aria-pressed={talk.muted}
              onClick={() => setMuted(!talk.muted)}
              className="press flex min-h-11 items-center gap-1.5 rounded-full bg-fill px-5 text-subhead font-semibold text-label"
            >
              <MicIcon off={talk.muted} className="size-[18px]" />
              {talk.muted ? "Unmute" : "Mute"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={close}
            className="press min-h-11 rounded-full bg-fill px-6 text-subhead font-semibold text-label"
          >
            End
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function MicIcon({ off, className }: { off: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        {off ? <path d="M4 4l16 16" /> : null}
      </g>
    </svg>
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
