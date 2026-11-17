"use client";

import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { MiMark } from "@/components/brand";
import { hasOnDeviceApi } from "@/components/voice/on-device";
import {
  firstSeen,
  markChatOpened,
  micBlockedLine,
  NO_RECOGNISER_LINE,
  OFFER_HOLD_ON_LINE,
  OFFER_ON_LINE,
  OFFER_WAKE_LINE,
  type OfferKind,
  offerKind,
  readChatOpened,
  readOfferChoice,
  setOfferChoice,
  supportLine,
  useWakeSetting,
} from "@/lib/wake-word";
import {
  askMic,
  CLOUD_LINE,
  MAYBE_LOCAL_LINE,
  NO_LOCAL,
  primeVoiceInTap,
  turnOnWake,
  useWakeSupport,
} from "./wake-enable";

// Michael offers "Yo Michael" once, at the moment it makes sense: the first time Chat opens, or on
// Today once the user has had him for a day and never opened Chat. One line in his voice, one tap
// to turn it on (that tap asks for the microphone and lets his voice play later on iPhone), and a
// quiet Not now. Where saying his name cannot work here, the offer is holding the Mi button
// instead; where the microphone is blocked, it says how to allow it. After any choice, never again.

// Whether the offer is on screen, so the hint under the Mi button waits its turn.
let showing = false;
const listeners = new Set<() => void>();
function setShowing(next: boolean) {
  if (next === showing) return;
  showing = next;
  for (const l of listeners) l();
}
export function useOfferShowing(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => showing,
    () => false,
  );
}

const SUCCESS_MS = 4000;

type Result = { line: string; done: boolean };

export function WakeOffer({
  place,
  children = null,
  className = "",
}: {
  place: "chat" | "today";
  /** What shows in its place when there is no offer (Chat's own hint). */
  children?: ReactNode;
  className?: string;
}) {
  const support = useWakeSupport();
  const setting = useWakeSetting();
  // Read once in the browser: the moment this screen opened decides whether to ask.
  const [ctx, setCtx] = useState<{
    choice: ReturnType<typeof readOfferChoice>;
    chatOpened: boolean;
    seen: number;
  } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const now = Date.now();
    setCtx({ choice: readOfferChoice(), chatOpened: readChatOpened(), seen: firstSeen(now) });
    if (place === "chat") markChatOpened();
  }, [place]);

  const kind: OfferKind | null =
    ctx && support
      ? offerKind({
          place,
          choice: ctx.choice,
          // Already on when this screen opened (turned on from You): nothing to offer.
          wakeOn: setting.mode !== "off" && !result,
          chatOpened: ctx.chatOpened,
          firstSeen: ctx.seen,
          now: Date.now(),
          support,
        })
      : null;
  const visible = !gone && (kind !== null || result !== null);

  useEffect(() => {
    setShowing(visible);
    return () => setShowing(false);
  }, [visible]);

  // A success says what happened, then steps aside.
  useEffect(() => {
    if (!result?.done) return;
    const t = setTimeout(() => setLeaving(true), SUCCESS_MS);
    return () => clearTimeout(t);
  }, [result]);

  // Until the browser has said what it allows, neither: the hint never flashes before the offer.
  if (!ctx || !support) return null;
  if (!visible || (!kind && !result)) return <>{children}</>;

  const ua = navigator.userAgent;
  const line =
    result?.line ??
    (kind === "wake"
      ? OFFER_WAKE_LINE
      : kind === "blocked"
        ? micBlockedLine(ua)
        : (supportLine(support ?? "no-recogniser", ua) ?? NO_RECOGNISER_LINE));
  // Where the audio goes, said before it is on.
  const foot = !result && kind === "wake" ? (hasOnDeviceApi() ? MAYBE_LOCAL_LINE : CLOUD_LINE) : null;

  async function yes() {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === "wake") {
        const res = await turnOnWake();
        if (res.ok) {
          setOfferChoice("on");
          setResult({ line: OFFER_ON_LINE, done: true });
        } else {
          setResult({ line: res.reason === "mic" ? micBlockedLine(ua) : NO_LOCAL, done: false });
        }
      } else {
        // Hold to talk needs only the microphone: ask for it now, at a calm moment.
        primeVoiceInTap();
        const mic = await askMic();
        if (mic === "denied") setResult({ line: micBlockedLine(ua), done: false });
        else {
          setOfferChoice("on");
          setResult({ line: OFFER_HOLD_ON_LINE, done: true });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function no() {
    if (!result?.done) setOfferChoice("no");
    setLeaving(true);
  }

  const action = kind === "wake" ? "Turn on" : kind === "hold" ? "Allow microphone" : null;

  return (
    <section
      data-testid="wake-offer"
      data-kind={kind ?? "done"}
      aria-label="Talk to Michael"
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) setGone(true);
      }}
      className={`${leaving ? "m-leave" : "m-swap"} rounded-card bg-fill px-4 pt-3 pb-1.5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-label text-bg"
        >
          <MiMark className="block h-auto w-[15px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p key={line} className="m-swap text-subhead font-semibold text-label" role="status">
            {line}
          </p>
          {foot ? <p className="mt-0.5 text-footnote text-label-2">{foot}</p> : null}
        </div>
      </div>
      <div className="flex min-h-11 items-center justify-end gap-1">
        {result?.done ? (
          <button
            type="button"
            onClick={() => setLeaving(true)}
            className="press h-11 px-2 text-subhead font-semibold text-tint-text"
          >
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={no} className="press h-11 px-3 text-subhead text-label-2">
              Not now
            </button>
            {action && !result ? (
              <button
                type="button"
                onClick={() => void yes()}
                disabled={busy}
                aria-busy={busy || undefined}
                className="press h-9 min-w-[6.5rem] rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-4 text-subhead font-semibold text-tint-text disabled:opacity-60"
              >
                {busy ? "Asking" : action}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
