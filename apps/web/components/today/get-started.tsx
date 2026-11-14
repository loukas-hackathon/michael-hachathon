import type { ReactNode } from "react";
import { Tween } from "@/components/motion-ui";
import { getSetup, getStartedDismissed, type SetupStep } from "@/lib/first-run";
import { dismissGetStarted } from "@/lib/first-run-actions";
import { HideButton } from "./hide-button";

const HIDE_FROM = 3;

/**
 * Get started: the six steps that make Michael useful, at the top of Today until they are done.
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
      <div
        className="mt-2 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={setup.done}
        aria-label={`${setup.done} of ${total} steps done`}
      >
        {setup.steps.map((s) => (
          <span
            key={s.key}
            className={`h-1 rounded-full transition-colors duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] motion-reduce:transition-none ${s.done ? "bg-label" : "bg-context"}`}
          />
        ))}
      </div>

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
        <StepLink
          href={step.href}
          className="press mt-2.5 inline-flex min-h-9 items-center rounded-full bg-tint px-4 text-subhead font-semibold text-on-tint"
        >
          {step.cta}
        </StepLink>
      </div>
    </div>
  );
}
