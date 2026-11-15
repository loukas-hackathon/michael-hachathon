import type { ReactNode } from "react";
import { Tween } from "@/components/motion-ui";
import { SkipMacButton } from "@/components/setup/skip-mac-button";
import { getSetup, getStartedDismissed, type SetupStep } from "@/lib/first-run";
import { dismissGetStarted } from "@/lib/first-run-actions";
import { ProgressBar } from "../progress-bar";
import { HideButton } from "./hide-button";

const HIDE_FROM = 3;

/**
 * Get started: the steps that make Michael useful (only connections proven on production, #295), at the top of Today until they are done.
 * Each step's tick comes from the person's real data. The next step carries the one big action.
 * Nothing for sample data, previews or the shared demo account.
 */
export async function GetStarted({ demo }: { demo?: string }) {
  const setup = await getSetup(demo);
  if (!setup?.next) return null;
  if (setup.done >= HIDE_FROM && (await getStartedDismissed())) return null;
  const total = setup.steps.length;

  return (
    <section aria-label="Get started" className="mt-4 rounded-card bg-fill px-4 pt-3.5 pb-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title3 font-bold">Get started</h2>
        <p className="text-footnote font-semibold text-label-2 tnum">
          <Tween value={setup.done} /> of {total}
        </p>
      </div>
      <ProgressBar
        value={setup.done / total}
        size="sm"
        label="Get started"
        valueText={`${setup.done} of ${total} steps done`}
        className="mt-2.5"
      />

      <ol className="mt-1.5">
        {setup.steps.map((s, i) => (
          <li key={s.key} className="relative">
            {i > 0 ? <span className="absolute inset-x-0 top-0 ml-9 h-[0.5px] bg-separator" /> : null}
            {s.key === setup.next?.key ? <NextStep step={s} /> : <Step step={s} />}
          </li>
        ))}
      </ol>

      {setup.done >= HIDE_FROM ? (
        <form action={dismissGetStarted} className="relative flex justify-end">
          <span className="absolute inset-x-0 top-0 ml-9 h-[0.5px] bg-separator" />
          <HideButton />
        </form>
      ) : null}
    </section>
  );
}

function Mark({ done, next }: { done: boolean; next?: boolean }) {
  if (done)
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-label text-bg" aria-hidden>
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  return (
    <span
      className={`size-6 shrink-0 rounded-full border-[1.5px] ${next ? "border-label" : "border-label-2"}`}
      aria-hidden
    />
  );
}

/**
 * A plain link, not next/link: some steps are route handlers that leave the app (Google's consent
 * screen) and must not be prefetched.
 */
function StepLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

function Step({ step }: { step: SetupStep }) {
  const row = "flex min-h-11 items-center gap-3 py-2";
  if (step.done)
    return (
      <div className={row}>
        <Mark done />
        <span className="text-body text-label-2">{step.title}</span>
        <span className="sr-only">, done</span>
      </div>
    );
  if (step.skippable)
    return (
      <div className="flex items-center gap-3">
        <StepLink href={step.href} className={`press ${row} min-w-0 flex-1`}>
          <Mark done={false} />
          <span className="min-w-0 flex-1 text-body">{step.title}</span>
        </StepLink>
        <SkipMacButton short />
      </div>
    );
  return (
    <StepLink href={step.href} className={`press ${row}`}>
      <Mark done={false} />
      <span className="min-w-0 flex-1 text-body">{step.title}</span>
      <span className="text-label-2" aria-hidden>
        ›
      </span>
    </StepLink>
  );
}

function NextStep({ step }: { step: SetupStep }) {
  return (
    <div className="flex gap-3 py-3">
      <Mark done={false} next />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">{step.title}</p>
        <p className="text-subhead text-label-2">{step.why}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4">
          <StepLink
            href={step.href}
            className="press inline-flex min-h-9 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
          >
            {step.cta}
          </StepLink>
          {step.skippable ? <SkipMacButton /> : null}
        </div>
      </div>
    </div>
  );
}
