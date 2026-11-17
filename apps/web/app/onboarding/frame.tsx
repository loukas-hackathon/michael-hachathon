import type { ReactNode, Ref } from "react";
import { MiMark } from "@/components/brand";
import { Michael } from "@/components/michael";
import { ProgressBar } from "@/components/progress-bar";
import { FrameFooter } from "./frame-footer";

// The frame both onboarding screens share: Michael speaking, one question, the body, and one
// primary action pinned to the bottom. Plain markup, so the server screen and the client screen
// render the same shell and nothing jumps between them.

// The talk, what Michael heard, and the connections.
export const STEPS = 3;

export const primaryButton =
  "press flex h-[50px] w-full items-center justify-center rounded-full bg-tint text-body font-semibold text-on-tint transition-opacity duration-200 disabled:opacity-40";

export const quietButton =
  "press mx-auto mt-1 flex h-11 items-center px-4 text-body text-label-2 transition-opacity duration-[var(--m-dur-ui)] disabled:opacity-40";

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
  screen,
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
  /**
   * Names the screen when the user's tap brought it in: it then arrives in one orchestrated moment
   * (globals.css, .m-step-in), and a new name replays it. Left out on a cold load: nothing moves.
   */
  screen?: string;
}) {
  return (
    // A phone column everywhere: on a laptop the screen sits centred, about 520px wide, and the body
    // with its action is centred vertically instead of pinned to the bottom edge. The layout keeps
    // room for the sidebar, which onboarding hides, so the column moves back by half of it; the `!`
    // beats the laptop reading width every other screen's main gets in globals.css. On a phone the
    // pinned action keeps the bottom safe area itself (frame-footer.tsx), so nothing shows below it.
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px]! flex-col lg:-translate-x-32 pt-[var(--m-safe-top)] pr-[max(16px,env(safe-area-inset-right))] pl-[max(16px,env(safe-area-inset-left))] lg:pb-10">
      <nav aria-label="Getting started" className="flex min-h-11 items-center gap-2 pt-2 lg:pt-6">
        <div className="flex h-11 w-16 items-center">{left}</div>
        <Progress step={step} progress={progress} />
        <div className="flex h-11 w-16 items-center justify-end">{right}</div>
      </nav>

      <div key={screen} className={`flex flex-1 flex-col lg:justify-center ${screen ? "m-step-in" : ""}`}>
        <div className="flex flex-1 flex-col lg:flex-none">
          {title === null ? null : (
            <div className="m-step-part mt-6">
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
          <div className="m-step-part mt-6">{children}</div>
        </div>

        <FrameFooter>{footer}</FrameFooter>
      </div>
    </main>
  );
}

export const Separator = ({ inset = 16 }: { inset?: number }) => (
  <span className="absolute inset-x-0 top-0 h-[0.5px] bg-separator" style={{ marginLeft: inset }} />
);

/**
 * Michael at work between two screens: his mark thinking, one plain heading, and a status line that
 * moves on while the wait lasts (michael-feedback, rule 12). The same place and size as the talk's
 * Michael, so the screen that follows lands where the eye already is.
 */
export function MichaelWaits({
  title,
  status,
  headingRef,
}: {
  title: ReactNode;
  status: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-col">
      <Michael state="thinking" className="h-auto w-[52px] text-label" />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-6 text-large-title font-bold tracking-[0.01em] outline-none"
      >
        {title}
      </h1>
      <p className="mt-2 text-body text-label-2">{status}</p>
    </div>
  );
}
