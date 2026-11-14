"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { MiMark } from "@/components/brand";
import { formatTime } from "@/lib/format";
import { sendTestNudge } from "@/lib/push-actions";
import type { StageFeed, StageNudge } from "@/lib/stage";

const POLL_MS = 3000;
// The score is computed on request; once a minute keeps the tape's now marker honest.
const REFRESH_MS = 60_000;

/**
 * The live half of the stage: polls today's latest nudge and the agents' questions, and gives the
 * presenter N (or the hidden top right button) to send a test nudge, so the watch buzzes and this
 * screen shows the same line at the same moment.
 */
export function StageLive({
  initial,
  header,
  hero,
  tape,
}: {
  initial: StageFeed;
  header: ReactNode;
  hero: ReactNode;
  tape: ReactNode;
}) {
  const router = useRouter();
  const [feed, setFeed] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const sending = useRef(false);
  // Only nudges that arrive while the screen is up get the entrance; the first one is just there.
  const firstNudge = useRef(initial.nudge?.id ?? null);
  const firstQueries = useRef(new Set((initial.queries ?? []).map((q) => q.id)));

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/stage/feed", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as StageFeed;
      setFeed((prev) => ({
        // Never step back to an older nudge than the one on screen (a test result can beat the poll).
        nudge:
          prev.nudge && next.nudge && next.nudge.created_at < prev.nudge.created_at ? prev.nudge : next.nudge,
        queries: next.queries,
      }));
    } catch {
      // Keep what is on screen; the next poll tries again.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    return () => {
      clearInterval(id);
      clearInterval(refresh);
    };
  }, [poll, router]);

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(id);
  }, [status]);

  const fire = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    setStatus("Sending");
    try {
      const result = await sendTestNudge();
      setFeed((prev) => ({ ...prev, nudge: toStage(result.nudge) }));
      setStatus(
        result.devices === 0
          ? "Shown here. No device has nudges on."
          : `Sent to ${result.delivered} of ${result.devices} ${result.devices === 1 ? "device" : "devices"}.`,
      );
    } catch {
      setStatus("Could not send. Check the API.");
    } finally {
      sending.current = false;
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void fire();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fire]);

  const nudge = feed.nudge;
  const fresh = nudge != null && nudge.id !== firstNudge.current;

  return (
    <div className="stage-frame">
      {header}

      <div className="stage-main">
        {hero}
        <section aria-label="Latest nudge" aria-live="polite">
          {nudge ? (
            <div key={nudge.id} className={`stage-nudge${fresh ? " stage-enter" : ""}`}>
              <p className="stage-nudge-head">
                <span className="stage-mi">
                  <MiMark />
                </span>
                <span>
                  <b>Michael</b> <span className="tnum">{formatTime(nudge.created_at)}</span>
                </span>
              </p>
              <p className="stage-nudge-text">{nudge.text}</p>
              {nudge.reason ? <p className="stage-nudge-reason">{nudge.reason}</p> : null}
            </div>
          ) : (
            <div className="stage-nudge stage-nudge-empty">
              <p className="stage-nudge-head">
                <span className="stage-mi">
                  <MiMark />
                </span>
                <b>Michael</b>
              </p>
              <p className="stage-nudge-text">No nudges yet today.</p>
              <p className="stage-nudge-reason">At most five a day, only when it matters.</p>
            </div>
          )}
        </section>
      </div>

      {tape}

      <section className="stage-ticker" aria-label="Agents asking about me">
        {feed.queries && feed.queries.length > 0 ? (
          <>
            <b>Agents asking about me</b>
            <ul>
              {feed.queries.map((q) => (
                <li key={q.id} className={firstQueries.current.has(q.id) ? undefined : "stage-ticker-new"}>
                  <span className="tnum">{formatTime(q.at)}</span> <b>{q.agent}</b> {q.summary}
                  {q.allowed ? "" : " Not shared."}
                </li>
              ))}
            </ul>
          </>
        ) : feed.queries ? (
          <>
            <b>Agents asking about me</b>
            <span>Nobody yet today.</span>
          </>
        ) : null}
      </section>

      <button
        type="button"
        className="stage-trigger"
        aria-label="Send a test nudge (N)"
        onClick={() => fire()}
      />
      <p className="stage-status" style={{ opacity: status ? 1 : 0 }} aria-live="polite">
        {status ?? ""}
      </p>
    </div>
  );
}

function toStage(n: StageNudge): StageNudge {
  return { id: n.id, text: n.text, reason: n.reason, status: n.status, created_at: n.created_at };
}
