import { EmptyState } from "@/components/empty-state";
import { getSetup, getStartedDismissed, SETUP_LINKS } from "@/lib/first-run";

const action =
  "hit press inline-flex min-h-9 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-3.5 text-subhead font-semibold text-tint-text";

/**
 * Today with no goal time planned: one sentence from Michael and the one thing that fills it.
 * Goals come first, then the calendar they are measured against, then a plan for today.
 */
export async function TodayEmpty({ demo }: { demo?: string }) {
  // Previews (?demo=empty) keep the sample's line.
  if (demo)
    return (
      <EmptyState title="Nothing yet.">
        Wear the watch tonight. I'll have your first brief ready by breakfast.
      </EmptyState>
    );

  // No setup for the shared demo account: it has goals and a calendar, so it gets the plan line.
  const setup = await getSetup();
  const done = (key: string) => !setup || setup.steps.some((s) => s.key === key && s.done);
  // The Get started card already leads with goals or the calendar: one action, not two.
  if (setup && (!done("goals") || !done("calendar")) && !(await getStartedDismissed())) return null;
  const [title, line, label, href] = !done("goals")
    ? [
        "No goals yet.",
        "Tell me what you're working towards and I'll plan your week around it.",
        "Set your first goal",
        SETUP_LINKS.goals,
      ]
    : !done("calendar")
      ? [
          "Nothing planned today.",
          "Connect your calendar and I'll measure your day against your goals.",
          "Connect your calendar",
          SETUP_LINKS.calendar,
        ]
      : [
          "Nothing for your goals today yet.",
          "Say the word and I'll find a block and put it in your calendar.",
          "Plan today with Michael",
          "/chat",
        ];

  return (
    <EmptyState
      title={title}
      action={
        <a href={href} className={action}>
          {label}
        </a>
      }
    >
      {line}
    </EmptyState>
  );
}
