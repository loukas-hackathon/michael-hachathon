import { getGoals, getProfile } from "@/lib/api";
import { OnboardingFlow, type Saved } from "./flow";

export const metadata = { title: "Getting started · Michael" };

type Search = { step?: string; connected?: string; integration_error?: string };

// The first talk with Michael, one question per screen. Today sends new users here (no goals yet,
// never onboarded); it can be skipped, and You has "Redo setup", which starts from the saved
// answers. Google Calendar's connect comes back to ?step=done, the closing screen.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const [goals, profile] = await Promise.all([getGoals().catch(() => []), getProfile().catch(() => null)]);
  const saved: Saved = {
    goals: goals
      .filter((g) => g.active && g.weekly_budget_minutes !== null)
      .map((g) => ({ category: g.category, weekly_minutes: g.weekly_budget_minutes ?? 0 })),
    profile,
  };
  const resume =
    sp.step === "done"
      ? {
          calendar:
            sp.connected === "google_calendar"
              ? ("connected" as const)
              : sp.integration_error === "google_calendar"
                ? ("failed" as const)
                : null,
        }
      : undefined;
  return <OnboardingFlow saved={saved} resume={resume} />;
}
