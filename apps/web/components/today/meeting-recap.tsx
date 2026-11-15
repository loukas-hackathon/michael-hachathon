"use client";

import type { MeetingRecap } from "@michael/shared";
import { useState } from "react";
import { ActionError, PendingButton } from "@/components/action-feedback";
import { formatTime } from "@/lib/format";
import { useMeetings } from "@/lib/meetings";
import { addMeetingCommitmentAction, draftMeetingFollowUpAction } from "@/lib/meetings-actions";
import { useAction } from "@/lib/use-action";

// The after-meeting card on Today (#422): the meeting that just ended, its commitments one tap from
// today's outcomes, its lesson, and a follow up draft. Nothing to show, no card.

const separator = "absolute inset-x-0 top-0 ml-4 h-[0.5px] bg-separator";
const KEY = "michael.meeting-recap";
// MEETING_RECAP_HOURS in @michael/shared (a value import from the index would ship zod here).
const RECAP_HOURS = 12;

type Seen = { session: string; added: string[]; dismissed: boolean };

// What this device already did with the recap: browser storage may be missing, so it only helps.
function readSeen(session: string): Seen {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Seen | null;
    if (s && s.session === session) return s;
  } catch {}
  return { session, added: [], dismissed: false };
}
function writeSeen(s: Seen) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

/** The recap when it ended within RECAP_HOURS and carries a commitment or a lesson. */
export function recapToShow(last: MeetingRecap | null, now = Date.now()): MeetingRecap | null {
  if (!last) return null;
  if (now - Date.parse(last.ended_at) > RECAP_HOURS * 3600_000) return null;
  return last.commitments.length > 0 || last.lesson ? last : null;
}

export function MeetingRecapCard({ className = "" }: { className?: string }) {
  const recap = recapToShow(useMeetings()?.last ?? null);
  if (!recap) return null;
  return <Recap key={recap.session_id} recap={recap} className={className} />;
}

function Recap({ recap, className }: { recap: MeetingRecap; className: string }) {
  const [seen, setSeenState] = useState(() => readSeen(recap.session_id));
  const [leaving, setLeaving] = useState(false);
  const setSeen = (change: (s: Seen) => Seen) =>
    setSeenState((s) => {
      const next = change(s);
      writeSeen(next);
      return next;
    });
  const n = recap.commitments.length;
  const conversation = recap.conversation_ids[0] ?? recap.commitments[0]?.event_id ?? null;
  const draft = useAction(draftMeetingFollowUpAction);

  if (seen.dismissed) return null;
  return (
    <section
      aria-label="After the meeting"
      className={`mt-6 ${leaving ? "m-leave" : ""} ${className}`}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) setSeen((s) => ({ ...s, dismissed: true }));
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-title3 font-bold tnum">
          Meeting at {formatTime(recap.started_at)}
          {n > 0 ? `: ${n} ${n === 1 ? "commitment" : "commitments"}` : ""}
        </h2>
        <button
          type="button"
          onClick={() => setLeaving(true)}
          className="press -mr-2 h-11 shrink-0 px-2 text-subhead font-semibold text-tint-text"
        >
          Dismiss
        </button>
      </div>
      <div className="overflow-hidden rounded-group bg-fill">
        {recap.commitments.map((c, i) => (
          <Commitment
            key={c.text}
            text={c.text}
            first={i === 0}
            added={seen.added.includes(c.text)}
            onAdded={(on) =>
              setSeen((s) => ({
                ...s,
                added: on ? [...s.added, c.text] : s.added.filter((t) => t !== c.text),
              }))
            }
          />
        ))}
        {recap.lesson ? (
          <p className="relative px-4 py-3 text-subhead">
            {n > 0 ? <span className={separator} /> : null}
            <span className="font-semibold">Lesson: </span>
            {recap.lesson}
          </p>
        ) : null}
        {conversation ? (
          <div className="relative flex min-h-12 items-center px-4 py-1">
            <span className={separator} />
            {draft.done ? (
              <p role="status" className="m-swap text-subhead text-label-2">
                Drafted. It is in Follow ups below.
              </p>
            ) : (
              <PendingButton
                pending={draft.pending}
                pendingLabel="Drafting"
                align="start"
                onClick={() => void draft.run(conversation)}
                className="press -ml-2 h-11 px-2 text-body font-semibold text-tint-text"
              >
                Draft a follow up
              </PendingButton>
            )}
          </div>
        ) : null}
      </div>
      <ActionError error={draft.error} onRetry={draft.retry} className="mt-2 px-4" />
    </section>
  );
}

function Commitment({
  text,
  first,
  added,
  onAdded,
}: {
  text: string;
  first: boolean;
  added: boolean;
  onAdded: (on: boolean) => void;
}) {
  // Optimistic: Added at once, back to the button with Michael's line if the API says no.
  const add = useAction(addMeetingCommitmentAction, {
    optimistic: () => {
      onAdded(true);
      return () => onAdded(false);
    },
  });
  return (
    <div className="relative px-4 py-2">
      {first ? null : <span className={separator} />}
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span className="min-w-0 text-body">{text}</span>
        {added ? (
          <span role="status" className="m-swap shrink-0 text-subhead font-semibold text-label-2">
            Added
          </span>
        ) : (
          <button
            type="button"
            disabled={add.pending}
            aria-busy={add.pending || undefined}
            onClick={() => void add.run(text)}
            className="press min-h-9 shrink-0 rounded-full bg-bg px-4 text-subhead font-semibold text-tint-text"
          >
            Add to today
          </button>
        )}
      </div>
      <ActionError error={add.error} className="pb-1" />
    </div>
  );
}
