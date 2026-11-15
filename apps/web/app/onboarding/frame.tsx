import type { ReactNode } from "react";
import { MiMark } from "@/components/brand";
import { ProgressBar } from "@/components/progress-bar";

// The frame both onboarding screens share: Michael speaking, one question, the body, and one
// primary action pinned to the bottom. Plain markup, so the server screen and the client screen
// render the same shell and nothing jumps between them.

// The talk, what Michael heard, and the connections.
export const STEPS = 3;

export const primaryButton =
  "press flex h-[50px] w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint transition-opacity duration-200 disabled:opacity-40";

export const quietButton = "press mx-auto mt-1 flex h-11 items-center px-4 text-body text-label-2";

function Progress({ step, progress }: { step: number; progress?: number }) {
  // Inside a step (the talk's questions) the bar moves on through that step's share.
  const value = (step + (progress ?? 1)) / STEPS;
  return (
    <div className="flex flex-1 justify-center">
      <ProgressBar
        value={value}
        size="sm"
        label="Getting started"
        valueText={`Step ${step + 1} of ${STEPS}`}
        className="w-16"
      />
    </div>
  );
}

export function OnboardingFrame({
  step,
  progress,
  title,
  line,
  left,
  right,
  children,
  footer,
}: {
  step: number;
  /** How far through this step, 0 to 1; the whole step when left out. */
  progress?: number;
  /** Null when the screen draws its own Michael and heading (the talk). */
  title: ReactNode;
  line?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col pt-[var(--m-safe-top)] pr-[max(16px,env(safe-area-inset-right))] pb-[calc(16px+env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))]">
      <nav aria-label="Getting started" className="flex min-h-11 items-center gap-2 pt-2">
        <div className="w-16">{left}</div>
        <Progress step={step} progress={progress} />
        <div className="flex w-16 justify-end">{right}</div>
      </nav>

      <div className="flex flex-1 flex-col">
        {title === null ? null : (
          <div className="mt-6">
            <div className="flex items-center gap-2">
              <span className="grid size-[30px] place-items-center rounded-full bg-label text-bg">
                <MiMark className="block h-auto w-[17px]" />
              </span>
              <span className="text-footnote font-semibold">Michael</span>
            </div>
            <h1 className="mt-3 text-large-title font-bold tracking-[0.01em]">{title}</h1>
            {line ? <p className="mt-2 text-body text-label-2">{line}</p> : null}
          </div>
        )}
        <div className="mt-6">{children}</div>
      </div>

      <div className="sticky bottom-[calc(16px+env(safe-area-inset-bottom))] mt-8 bg-bg pt-3">{footer}</div>
    </main>
  );
}

export const Separator = ({ inset = 16 }: { inset?: number }) => (
  <span className="absolute inset-x-0 top-0 h-[0.5px] bg-separator" style={{ marginLeft: inset }} />
);
