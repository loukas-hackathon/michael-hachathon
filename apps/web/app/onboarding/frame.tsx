import type { ReactNode } from "react";
import { MiMark } from "@/components/brand";
import { ProgressBar } from "@/components/progress-bar";

// The frame both onboarding screens share: Michael speaking, one question, the body, and one
// primary action pinned to the bottom. Plain markup, so the server screen and the client screen
// render the same shell and nothing jumps between them.

export const STEPS = 2;

export const primaryButton =
  "press flex h-[50px] w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint transition-opacity duration-200 disabled:opacity-40";

export const quietButton = "press mx-auto mt-1 flex h-11 items-center px-4 text-body text-label-2";

function Progress({ step }: { step: number }) {
  return (
    <div className="flex flex-1 justify-center">
      <ProgressBar
        value={(step + 1) / STEPS}
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
  title,
  line,
  left,
  right,
  children,
  footer,
}: {
  step: number;
  title: ReactNode;
  line?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)] pr-[max(16px,env(safe-area-inset-right))] pb-[calc(16px+env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))]">
      <nav aria-label="Getting started" className="flex min-h-11 items-center gap-2 pt-2">
        <div className="w-16">{left}</div>
        <Progress step={step} />
        <div className="flex w-16 justify-end">{right}</div>
      </nav>

      <div className="flex flex-1 flex-col">
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
        <div className="mt-6">{children}</div>
      </div>

      <div className="sticky bottom-[calc(16px+env(safe-area-inset-bottom))] mt-8 bg-bg pt-3">{footer}</div>
    </main>
  );
}

export const Separator = ({ inset = 16 }: { inset?: number }) => (
  <span className="absolute inset-x-0 top-0 h-[0.5px] bg-separator" style={{ marginLeft: inset }} />
);
