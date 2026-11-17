"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import {
  endMeeting,
  forgetActiveMeeting,
  meetingEndsAt,
  startMeeting,
  syncMeetings,
  useMeetings,
} from "@/lib/meetings";
import { useOffTheRecord } from "@/lib/off-the-record";
import { useAction } from "@/lib/use-action";
import { ActionError, PendingButton } from "./action-feedback";
import { Sheet } from "./sheet";

// Meetings mode (#400): conversations are kept only while the user has started it. The consent
// sheet before the first start, the You row, and the pill every screen shows while it runs.

export const CONSENT_LINES = [
  "Only you start this. Tell the people in the room you're recording.",
  "I keep a short summary and your own commitments; the audio and full transcript are never kept.",
];

const failure = (r: true | string | undefined) => (r === true ? null : r || "I could not save that.");

/** Now, ticking every 15 seconds while `on`, so minutes and the auto end stay right. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

/** The running session, or null once it ended or ran out (2 hours, the block's end). */
function useActiveMeeting() {
  const meetings = useMeetings();
  const { on: offTheRecord } = useOffTheRecord();
  const active = meetings?.active ?? null;
  const now = useNow(Boolean(active));
  // Off the record ends it on the server (store.setOffTheRecord); the pill goes at once.
  useEffect(() => {
    if (offTheRecord) forgetActiveMeeting();
  }, [offTheRecord]);
  // Back to the app after a while: the session may have ended elsewhere.
  useEffect(() => {
    const back = () => document.visibilityState === "visible" && syncMeetings();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  if (!active || offTheRecord || now >= meetingEndsAt(active)) return { meetings, active: null, now };
  return { meetings, active, now };
}

export function MeetingConsentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const start = useAction(startMeeting, { failure, onSuccess: () => onClose() });
  return (
    <Sheet open={open} onClose={onClose} title="Meetings mode">
      <div className="px-4 pb-6">
        {CONSENT_LINES.map((line) => (
          <p key={line} className="mt-3 text-body">
            {line}
          </p>
        ))}
        <p className="mt-3 text-footnote text-label-2">
          It ends when you tap End, after 2 hours or when your calendar block ends.
        </p>
        <PendingButton
          pending={start.pending}
          pendingLabel="Starting"
          onClick={() => void start.run(true)}
          className="press mt-6 flex h-12 w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint"
        >
          Start
        </PendingButton>
        <ActionError error={start.error} className="mt-2" />
      </div>
    </Sheet>
  );
}

/** The top of You (the Mi sheet): start or end meetings mode; the first start goes through the consent sheet. */
export function MeetingsRow({ first = false }: { first?: boolean }) {
  const { meetings, active } = useActiveMeeting();
  const [consent, setConsent] = useState(false);
  const { on: offTheRecord } = useOffTheRecord();
  const start = useAction(startMeeting, { failure });
  const end = useAction(endMeeting, { failure });
  const pending = start.pending || end.pending;

  return (
    <>
      <div className="relative flex min-h-14 items-center justify-between gap-4 px-4 py-2">
        {first ? null : <span className="absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator" />}
        <span className="flex min-w-0 flex-col">
          <span className="text-body">Meetings mode</span>
          <span className="text-footnote text-label-2 tnum" aria-live="polite">
            {active
              ? `On since ${formatTime(active.started_at)}. Ends by ${formatTime(new Date(meetingEndsAt(active)).toISOString())}.`
              : offTheRecord
                ? "Off the record is on. Nothing is kept."
                : "Conversations are kept only while it is on."}
          </span>
        </span>
        <PendingButton
          pending={pending}
          pendingLabel={active ? "Ending" : "Starting"}
          disabled={!meetings || (offTheRecord && !active)}
          onClick={() => {
            if (active) void end.run();
            else if (meetings?.consented) void start.run(false);
            else setConsent(true);
          }}
          className="hit press min-h-9 shrink-0 rounded-full bg-bg px-4 text-subhead font-semibold text-tint-text disabled:opacity-40"
        >
          {active ? "End" : "Start"}
        </PendingButton>
      </div>
      <ActionError error={start.error ?? end.error} className="-mt-1 px-4 pb-2.5" />
      <MeetingConsentSheet open={consent} onClose={() => setConsent(false)} />
    </>
  );
}

// Screens without the tab bar, and signed out ones: no pill, and no call to the API either.
const HIDDEN_ON = ["/onboarding", "/connect", "/stage", "/setup", "/login", "/auth", "/join"];

/** "Meeting on · 12 min · End": calm, above the tab bar, on every screen while it runs. */
export function MeetingPill() {
  const pathname = usePathname();
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;
  return <RunningPill />;
}

function RunningPill() {
  const { active, now } = useActiveMeeting();
  const end = useAction(endMeeting, { failure });
  if (!active) return null;
  const minutes = Math.max(0, Math.floor((now - Date.parse(active.started_at)) / 60_000));
  // "0 min" reads like nothing is happening: the first minute says so in words.
  const elapsed = minutes < 1 ? "just started" : `${minutes} min`;

  return (
    <div
      role="status"
      aria-label={`Meeting on, ${elapsed}`}
      className="fixed inset-x-0 bottom-[calc(16px+var(--m-tabbar-h)+10px+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 lg:bottom-6 lg:pl-64"
    >
      <div className="flex h-9 items-center gap-2 rounded-full bg-[var(--m-glass)] pr-1 pl-4 text-subhead shadow-[0_0_0_0.5px_var(--m-separator),0_6px_18px_-8px_rgb(0_0_0/0.25)] backdrop-blur-xl">
        <span className="font-semibold">Meeting on</span>
        <span className="text-label-2 tnum">· {elapsed} ·</span>
        <PendingButton
          pending={end.pending}
          pendingLabel="Ending"
          onClick={() => void end.run()}
          className="press h-7 rounded-full px-3 font-semibold text-tint-text"
        >
          End
        </PendingButton>
      </div>
      {end.error ? <span className="sr-only">{end.error}</span> : null}
    </div>
  );
}
