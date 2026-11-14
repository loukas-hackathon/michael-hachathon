import { goalKind } from "@michael/shared";
import { getGoals, getProfile } from "@/lib/api";
import { getFirstInsight, SAMPLE_INSIGHT } from "@/lib/first-insight";
import { getGoogleCalendar } from "@/lib/integrations";
import { type CalendarState, OnboardingFlow, type Resume, type Saved } from "./flow";

export const metadata = { title: "Getting started · Michael" };

type Search = { step?: string; connected?: string; integration_error?: string; demo?: string };

// The first talk with Michael, one question per screen. Today sends new users here (no goals yet,
// never onboarded); it can be skipped, and You has "Redo setup", which starts from the saved
// answers. Google Calendar's connect comes back to ?step=connect, the connect step, which then shows
// the first number about the week from the calendar alone (docs/ux-audit.md, first minute).
// ?demo=connected previews that state with sample numbers, marked as such.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const preview = sp.demo === "connected";
  const [goals, profile, integration] = await Promise.all([
    getGoals().catch(() => []),
    getProfile().catch(() => null),
    preview ? null : getGoogleCalendar(),
  ]);
  const saved: Saved = {
    goals: goals
      // Only time goals answer "how many hours a week"; checklist and count goals have none (#238).
      .filter((g) => g.active && g.weekly_budget_minutes !== null && goalKind(g) === "time")
      .map((g) => ({ category: g.category, weekly_minutes: g.weekly_budget_minutes ?? 0 })),
    profile,
  };

  const connected = preview || integration?.status === "connected" || sp.connected === "google_calendar";
  const calendar: CalendarState = {
    connected,
    insight: preview ? SAMPLE_INSIGHT : connected ? await getFirstInsight() : null,
  };

  const back = sp.step === "connect" || sp.step === "done" ? sp.step : undefined;
  const resume: Resume | undefined = back
    ? {
        step: back,
        calendar:
          sp.connected === "google_calendar"
            ? "connected"
            : sp.integration_error === "google_calendar"
              ? "failed"
              : null,
      }
    : undefined;
  return <OnboardingFlow saved={saved} resume={resume} calendar={calendar} />;
}
