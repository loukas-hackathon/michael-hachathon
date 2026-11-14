import Link from "next/link";
import { redirect } from "next/navigation";
import { ConnectionRow } from "@/components/you/connection-row";
import { getGoalSuggestions, getGoals, getProfile } from "@/lib/api";
import type { ConnectionId } from "@/lib/connections";
import { type ConnectionStatus, getConnections } from "@/lib/connections-status";
import { getFirstInsight, SAMPLE_INSIGHT } from "@/lib/first-insight";
import { getGoogleCalendar, googleConnectUrl, syncGoogleCalendar } from "@/lib/integrations";
import { FirstInsightCard } from "./first-insight";
import { OnboardingFrame, primaryButton, Separator } from "./frame";
import { GoalsStep } from "./goals-step";

export const metadata = { title: "Getting started · Michael" };

type Search = {
  step?: string;
  connected?: string;
  integration_error?: string;
  demo?: string;
  sync?: string;
};

// Getting started, in two screens and under a minute (#270):
//   0. Sign in (/login). A brand new account goes straight on to Google's calendar consent from
//      here, so the calendar is in before the first screen: one tap on "Continue with Google".
//   1. Goals: found in the calendar, ticked, hours filled in. One tap keeps them.
//   2. The week in one number, and the other connections, each optional, one tap each.
// Then Today. Nudges are asked later, when a buzz obviously helps (#207). You has "Redo setup".
// ?demo=connected previews screen 2 with sample numbers, marked as such.

export const GOALS_PATH = "/onboarding?step=goals";
const CONNECT_PATH = "/onboarding?step=connect";
const calendarHref = (back: string) => `/integrations/google/connect?return_to=${encodeURIComponent(back)}`;

/** What screen 2 offers, in order of value. Nudges and Telegram wait for a moment that needs them. */
const OFFER: ConnectionId[] = ["google-calendar", "apple-watch", "mac", "iphone", "travel", "claude"];

/** Setup pages opened from here come back here (components/you/connection-page.tsx). */
function fromOnboarding(row: ConnectionStatus): ConnectionStatus {
  const tag = (href: string) =>
    href.startsWith("/you/connections/") ? `${href}${href.includes("?") ? "&" : "?"}from=onboarding` : href;
  const action =
    row.action.kind === "link"
      ? {
          ...row.action,
          href:
            row.id === "google-calendar" && row.state === "none"
              ? calendarHref(CONNECT_PATH)
              : tag(row.action.href),
        }
      : row.action;
  return { ...row, href: tag(row.href), action };
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const preview = sp.demo === "connected";
  const step = preview || sp.step === "connect" || sp.step === "done" ? "connect" : "goals";
  const failed = sp.integration_error === "google_calendar";

  const [integration, goals, profile] = await Promise.all([
    preview ? null : getGoogleCalendar(),
    getGoals().catch(() => []),
    getProfile().catch(() => null),
  ]);
  const calendarOn = preview || integration?.status === "connected" || sp.connected === "google_calendar";

  // A brand new account with no calendar yet: straight to Google's consent, which comes back to the
  // goals screen with four weeks read. Only when Google is set up here (the URL resolves), never
  // after a refusal, and never on Redo setup. The login page says the calendar comes next.
  if (
    step === "goals" &&
    !sp.step &&
    !calendarOn &&
    !failed &&
    goals.length === 0 &&
    !profile?.onboarded_at
  ) {
    const url = await googleConnectUrl(GOALS_PATH).catch(() => null);
    if (url) redirect(url);
  }

  if (step === "goals") {
    // Straight back from Google: read the last four weeks here, behind loading.tsx's "Reading your
    // calendar", rather than on Google's page. A failed read still shows the starters.
    if (calendarOn && sp.sync === "pending") await syncGoogleCalendar(28).catch(() => null);
    const suggestions = calendarOn ? await getGoalSuggestions() : [];
    return (
      <GoalsStep
        suggestions={suggestions}
        saved={goals
          .filter((g) => g.active)
          .map((g) => ({ title: g.title, category: g.category, weekly_minutes: g.weekly_budget_minutes }))}
        calendar={calendarOn ? "on" : failed ? "failed" : "off"}
        calendarHref={calendarHref(GOALS_PATH)}
      />
    );
  }

  const [insight, view] = await Promise.all([
    preview ? SAMPLE_INSIGHT : calendarOn ? getFirstInsight() : null,
    getConnections().catch(() => null),
  ]);
  const rows = OFFER.flatMap((id) => {
    const row = view?.rows.find((r) => r.id === id);
    return row ? [fromOnboarding(row)] : [];
  });

  return (
    <OnboardingFrame
      step={1}
      title={insight ? "Here's your week." : "Now, your days."}
      line={
        insight
          ? undefined
          : failed
            ? "Google Calendar did not connect. Try once more below."
            : "Each one is optional. One tap, then open it on that device."
      }
      left={
        <Link
          href={GOALS_PATH}
          className="press -ml-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text"
        >
          Goals
        </Link>
      }
      footer={
        <Link href="/" className={primaryButton}>
          Go to Today
        </Link>
      }
    >
      {insight ? <FirstInsightCard insight={insight} /> : null}
      {rows.length > 0 ? (
        <section aria-label="Connections" className={insight ? "mt-8" : ""}>
          {insight ? (
            <h2 className="mb-2 text-subhead text-label-2">Add what really happened. Each is optional.</h2>
          ) : null}
          <div className="overflow-hidden rounded-group bg-fill">
            {rows.map((row, i) => (
              <div key={row.id} className="relative">
                {i > 0 ? <Separator inset={52} /> : null}
                <ConnectionRow row={row} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </OnboardingFrame>
  );
}
