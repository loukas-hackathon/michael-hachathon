"use client";

import { useSearchParams } from "next/navigation";
import { MichaelWaits, OnboardingFrame } from "./frame";
import { ReadingStatus } from "./reading-status";

// What Michael says while the next onboarding screen loads (loading.tsx). It reads the address the
// tap went to, so the wait matches what comes: the talk, the usual goals, the four week calendar
// read straight back from Google, or the week with its connections.

export type WaitKind = "talk" | "calendar" | "goals" | "connect";
type Kind = WaitKind;

const WAITS: Record<Kind, { step: number; title: string; steps: string[] }> = {
  talk: { step: 0, title: "One moment.", steps: ["Getting ready to talk"] },
  calendar: {
    step: 0,
    title: "Reading your calendar.",
    steps: ["Looking back four weeks", "Finding what your week is for", "Nearly there"],
  },
  goals: { step: 1, title: "The usual goals.", steps: ["Laying them out"] },
  connect: {
    step: 2,
    title: "Setting up your week.",
    steps: ["Putting your goals in place", "Adding up what you've booked", "Nearly there"],
  },
};

export function WaitFor() {
  const sp = useSearchParams();
  const step = sp.get("step");
  const kind: Kind =
    sp.get("demo") === "connected" || step === "connect" || step === "done"
      ? "connect"
      : sp.get("sync") === "pending"
        ? "calendar"
        : step === "goals"
          ? "goals"
          : "talk";
  return <WaitScreen kind={kind} />;
}

/**
 * Also drawn by a screen itself when its tap moves to another step of onboarding: a change of
 * address within /onboarding keeps the old screen up until the new one is ready (loading.tsx only
 * covers arrivals from elsewhere), so the screen hands over to Michael thinking on its own.
 */
export function WaitScreen({ kind, screen }: { kind: Kind; screen?: string }) {
  const wait = WAITS[kind];
  return (
    <OnboardingFrame
      step={wait.step}
      progress={kind === "calendar" ? 0.1 : kind === "talk" ? 0 : undefined}
      title={null}
      screen={screen}
      // The action of the screen that comes lands here: its room is kept, so nothing jumps.
      footer={<div aria-hidden="true" className="h-[50px]" />}
    >
      <MichaelWaits title={wait.title} status={<ReadingStatus steps={wait.steps} every={2200} />} />
    </OnboardingFrame>
  );
}
