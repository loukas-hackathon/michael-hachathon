"use client";

import type { ChatMessage, ChatThread, Recommendation } from "@michael/shared";
import { type FormEvent, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ConnectChip, KnowledgeChip } from "@/components/chat/connect-chip";
import { connectIntent } from "@/components/chat/connect-intent";
import { knowledgeIntent } from "@/components/chat/knowledge-intent";
import { LiveStep, WorkedSteps } from "@/components/chat/steps";
import { Hint, markHintSeen } from "@/components/hint";
import { useArrival } from "@/components/motion";
import { ScreenHeader } from "@/components/screen";
import { Bone } from "@/components/skeleton";
import { useWide } from "@/components/use-wide";
import { TALK_HINT, TalkButton, useTalk } from "@/components/voice/conversation-sheet";
import { HoldHint } from "@/components/voice/hold-to-talk";
import { PushToTalk } from "@/components/voice/push-to-talk";
import { speakable } from "@/components/voice/speech";
import { useOfferShowing, WakeOffer } from "@/components/voice/wake-offer";
import { withoutUndoLine } from "@/lib/chat-undo";
import { formatDayLabel, formatStamp, sameAthensDay } from "@/lib/format";
import { ActionChips } from "./action-chips";
import {
  actedFrom,
  EMPTY_THREAD,
  isNewKey,
  mergeLines,
  newThread,
  sendLine,
  setDraft,
  setError,
  setServerKey,
  syncThreads,
  useChatSession,
} from "./chat-session";
import { MessageBubble } from "./message-bubble";
import { warmChat } from "./stream-chat";
import { ThreadPane, ThreadSheet } from "./thread-sheet";
import { useKeyboardInset, useLatest } from "./use-viewport";

/** The key of the thread the server rendered: its id, or a new chat when the user has none. */
const SERVER_NEW = "new:server";
const NO_THREADS: ChatThread[] = [];

export function Chat({
  thread,
  initial,
  initialActions = [],
  threads: serverThreads = NO_THREADS,
  starters,
  intro,
  elevenlabs = false,
  checkIn,
  talk: talkOnArrival = false,
}: {
  /** Arrived from "Talk to Michael" on the You sheet: open the conversation, ready for a tap. */
  talk?: boolean;
  /** The thread the server rendered (the latest), or null when the user has none yet. */
  thread: ChatThread | null;
  initial: ChatMessage[];
  /** The recommendations named in the history's action_ids, as they stand now. */
  initialActions?: Recommendation[];
  /** The user's threads as the server listed them, pinned first. */
  threads?: ChatThread[];
  /** Questions from the user's real day, shown on an empty thread. */
  starters: string[];
  /** Michael's opening line on an empty chat; "Ask me about your day." by default. */
  intro?: string;
  elevenlabs?: boolean;
  /** Today's check in: its own card above every conversation. */
  checkIn?: ReactNode;
}) {
  // The conversations live in a module store, not a transition, so a tab tap is never held back
  // by a streaming answer and leaving the tab keeps every draft and reply (chat-session.ts).
  const session = useChatSession();
  const serverKey = thread?.id ?? SERVER_NEW;
  const key = session.key ?? serverKey;
  const current = session.byKey[key] ?? EMPTY_THREAD;
  const { draft, error, pending, streamingId } = current;
  const fromServer = key === serverKey;
  const base = useMemo(
    () => (fromServer ? initial : (current.loaded ?? [])),
    [fromServer, initial, current.loaded],
  );
  const lines = mergeLines(base, current.lines);
  const threads = (session.threads ?? serverThreads).filter((t) => !session.deleting.includes(t.id));
  const open = isNewKey(key) ? null : (threads.find((t) => t.id === key) ?? (fromServer ? thread : null));
  const opening = session.opening === key && !current.loaded;
  // What VoiceOver hears: the whole reply once it is written, never the stream token by token.
  // Only lines added since the page loaded, so the history is not read out on arrival.
  const last = current.lines.at(-1);
  const announce = pending
    ? "Looking at your day"
    : last?.role === "assistant" && !streamingId
      ? `Michael: ${speakable(last.content)}`
      : "";

  const input = useRef<HTMLTextAreaElement>(null);
  // What Michael did while answering, by reply id: shown as "Done. Undo" chips under that reply.
  const stored = useMemo(() => actedFrom(initial, initialActions), [initial, initialActions]);
  const acted = fromServer ? { ...stored, ...current.acted } : current.acted;
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // A laptop 1280 px and up: the conversations are a pane on the left, not a sheet (#285).
  const wide = useWide();
  // New bubbles grow from their own corner, as in Messages; the history already there stays still.
  const arriving = useArrival();
  const { atEnd, atEndRef, toEnd } = useLatest();
  const keyboard = useKeyboardInset();
  const talk = useTalk(elevenlabs);
  // After his first answer here, once: "Hold me to talk." under the Mi button (not while Michael's
  // offer to listen for his name is still on screen: one thing at a time).
  const offerShowing = useOfferShowing();
  const answered = current.lines.some((l) => l.role === "assistant" && l.id !== streamingId);

  // From the You sheet: the conversation opens at once and starts on the first tap (iOS only lets
  // Michael's voice play from a tap on this page). The address drops ?talk so a reload does not reopen it.
  const arrivedToTalk = useRef(talkOnArrival);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival.
  useEffect(() => {
    if (!arrivedToTalk.current) return;
    arrivedToTalk.current = false;
    talk.show();
    window.history.replaceState(window.history.state, "", "/chat");
  }, []);

  // A fresh server list (coming back to the tab) replaces the one kept here.
  useEffect(() => {
    syncThreads(serverThreads);
  }, [serverThreads]);
  // The voice conversation sends from outside this screen: it writes in the thread open here.
  useEffect(() => {
    setServerKey(serverKey);
  }, [serverKey]);

  // Michael reads the day while the question is typed, not after it is sent (#364).
  const warmKey = isNewKey(key) ? "new" : key;
  useEffect(() => {
    warmChat(warmKey);
  }, [warmKey]);

  // Open on the latest line, as Messages does, and again on switching threads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the thread switch is the trigger.
  useEffect(() => {
    if (base.length) toEnd(false);
  }, [key, base.length, toEnd]);

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
    void sendLine(text, {
      fallback: serverKey,
      threads,
      viaVoice,
      elevenlabs,
      onFailed: () => input.current?.focus(),
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  function startNew() {
    newThread(serverKey);
    setListOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      input.current?.focus();
    });
  }

  // Above the keyboard when it is open; above the floating tab bar otherwise.
  const lifted = keyboard > 0 ? { bottom: `${keyboard + 8}px` } : undefined;
  const title = open?.title ?? "New chat";

  const list = {
    threads: session.threads ?? serverThreads,
    currentKey: key,
    serverKey,
    onNew: startNew,
  };

  return (
    // A phone: these wrappers are not boxes (contents), so the screen is exactly as before. A laptop:
    // the conversations pane on the left (space kept from the first paint, filled once the width is
    // known) and the conversation beside it.
    <div className="contents xl:grid xl:flex-1 xl:grid-cols-[18rem_minmax(0,1fr)] xl:gap-8">
      {/* 67px puts the Conversations heading on the Chat title's baseline. */}
      <aside className="hidden xl:sticky xl:top-0 xl:block xl:max-h-dvh xl:self-start xl:overflow-y-auto xl:pt-[67px] xl:pb-8">
        {wide ? <ThreadPane {...list} /> : null}
      </aside>
      <div className="contents xl:flex xl:min-w-0 xl:flex-col">
        <ScreenHeader
          context={
            wide ? (
              <span className="block truncate">{title}</span>
            ) : (
              <button
                type="button"
                onClick={() => setListOpen(true)}
                aria-label={`${title}. Show all conversations`}
                className="press -mx-2 flex min-h-11 max-w-[52vw] items-center gap-1 px-2 text-left"
              >
                <span className="truncate">{title}</span>
                <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0">
                  <path
                    d="m3 4.5 3 3 3-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )
          }
          title="Chat"
          pinned
          miHint={answered && !offerShowing ? <HoldHint /> : null}
          actions={
            <HeaderButton label="New chat" onClick={startNew}>
              <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </HeaderButton>
          }
        />
        {checkIn}
        <div className="flex flex-1 flex-col">
          <p role="status" className="sr-only">
            {announce}
          </p>
          <div className="flex-1 pt-4" aria-busy={pending || opening}>
            {opening ? (
              <div aria-hidden="true" className="m-skeleton flex flex-col gap-2 pt-2">
                <Bone className="h-10 w-2/3 self-end rounded-card" />
                <Bone className="h-16 w-4/5 rounded-card" />
                <Bone className="h-10 w-1/2 self-end rounded-card" />
              </div>
            ) : lines.length === 0 ? (
              <div className="pt-6">
                <p className="text-insight font-semibold">
                  {isNewKey(key) && threads.length > 0
                    ? "New conversation. What is on your mind?"
                    : (intro ?? "Ask me about your day.")}
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
              <ol aria-label="Conversation" className="flex flex-col gap-2">
                {lines.map((m, i) => {
                  // "Connect my calendar": the one tap button under the answer, once it has finished (#307).
                  const asked = m.role === "assistant" && m.id !== streamingId ? lines[i - 1] : undefined;
                  const connect = asked?.role === "user" ? connectIntent(asked.content) : null;
                  const knows = asked?.role === "user" && knowledgeIntent(asked.content);
                  // A thread picked up on another day gets a quiet day line between the two (#483).
                  const prev = lines[i - 1]?.created_at;
                  const newDay = prev && m.created_at && !sameAthensDay(prev, m.created_at);
                  return (
                    <Fragment key={m.key ?? m.id}>
                      {newDay ? (
                        <li className="pt-3 pb-1 text-center text-caption font-semibold text-label-2">
                          {formatDayLabel(m.created_at as string)}
                        </li>
                      ) : null}
                      <MessageBubble
                        role={m.role}
                        content={
                          acted[m.id]?.some((a) => a.status !== "proposed")
                            ? withoutUndoLine(m.content)
                            : m.content
                        }
                        streaming={m.id === streamingId}
                        arriving={arriving(m.key ?? m.id)}
                      >
                        {m.id === streamingId && current.steps.some((s) => s.status === "running") ? (
                          <span className="mt-0.5 px-1">
                            <LiveStep steps={current.steps} />
                          </span>
                        ) : null}
                        {m.role === "assistant" && m.id !== streamingId ? (
                          <WorkedSteps replyId={m.id} steps={current.worked[m.id]} />
                        ) : null}
                        {acted[m.id] ? <ActionChips actions={acted[m.id] ?? []} /> : null}
                        {connect ? <ConnectChip id={connect} /> : null}
                        {knows ? <KnowledgeChip /> : null}
                        {m.role === "assistant" && m.created_at ? (
                          <span className="mt-0.5 px-1 text-caption text-label-2 tnum">
                            {formatStamp(m.created_at)}
                          </span>
                        ) : null}
                      </MessageBubble>
                    </Fragment>
                  );
                })}
                {pending && lines.at(-1)?.role === "user" ? (
                  <li className="flex items-start">
                    <p className="m-pop-in rounded-card bg-fill px-3.5 py-2 text-body text-label-2 [--m-origin:0_100%]">
                      <LiveStep steps={current.steps} className="text-body text-label-2" />
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
            ) : (
              // The first visit: Michael offers to listen for his name, once. Then, also once, the
              // two voice buttons do different things, said once.
              <WakeOffer place="chat" className="mb-2">
                <Hint id={TALK_HINT} className="mb-1 px-1">
                  <span className="lg:hidden">Tap Talk to speak with me.</span>
                  <span className="hidden lg:inline">Click Talk to speak with me.</span> Hold the mic to
                  dictate a message.
                </Hint>
              </WakeOffer>
            )}
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
                placeholder={
                  transcribing
                    ? "Got it. Writing it down"
                    : listening
                      ? "Listening. Let go to send"
                      : "Ask Michael"
                }
                onFocus={() => warmChat(warmKey)}
                onChange={(e) => setDraft(key, e.target.value)}
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
                  if (on) {
                    setError(key, null);
                    markHintSeen(TALK_HINT);
                  }
                }}
                onTranscribingChange={setTranscribing}
                onInterim={(text) => setDraft(key, text)}
                onFinal={(text) => send(text, true)}
                onError={(message) => setError(key, message)}
                onDictate={() => input.current?.focus()}
              />
              {/* An empty field offers the conversation, a written one sends: one pink button, as in the phone apps. */}
              {draft.trim() || listening || transcribing ? (
                <button
                  type="submit"
                  disabled={pending || !draft.trim()}
                  className="hit press h-9 min-w-[4.75rem] shrink-0 rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint disabled:opacity-40"
                >
                  Send
                </button>
              ) : (
                <TalkButton onTalk={talk.start} disabled={pending} />
              )}
            </div>
          </form>
        </div>
      </div>
      {talk.sheet}
      <ThreadSheet open={listOpen && !wide} onClose={() => setListOpen(false)} {...list} />
    </div>
  );
}

/** A round header button, as New goal on Goals. */
function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="press -m-[7px] grid size-11 place-items-center rounded-full"
    >
      <span className="grid size-[30px] place-items-center rounded-full bg-fill text-tint-text">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]">
          {children}
        </svg>
      </span>
    </button>
  );
}
