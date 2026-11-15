import Link from "next/link";
import { ConnectionRow } from "@/components/you/connection-row";
import { ConnectionsLive } from "@/components/you/connections-live";
import { getGoalSuggestions, getGoals, getVoiceEnabled } from "@/lib/api";
import type { ConnectionId } from "@/lib/connections";
import { type ConnectionStatus, getConnections } from "@/lib/connections-status";
import { getFirstInsight, SAMPLE_INSIGHT } from "@/lib/first-insight";
import { getGoogleCalendar, syncGoogleCalendar } from "@/lib/integrations";
import { arrivedFrom } from "@/lib/live-connections";
import { FirstInsightCard } from "./first-insight";
import { OnboardingFrame, primaryButton, Separator } from "./frame";
import { GoalsStep } from "./goals-step";
import { Talk } from "./talk";

export const metadata = { title: "Getting started · Michael" };

type Search = {
  step?: string;
  connected?: string;
  integration_error?: string;
  demo?: string;
  sync?: string;
};

// Getting started is a talk with Michael (Loukas, Sun 15 Nov):
//   0. Sign in (/login).
//   1. The talk (talk.tsx): Michael introduces himself, then asks three questions out loud. The
//      user answers by voice or text, skips any; the API reads the answers into goals.
//   2. What he heard: the goals with hours, edited and kept with one tap. "Pick from the usual"
//      (?step=goals) is the old list, with calendar suggestions when the calendar is in.
//   3. The week in one number, and the connections, the calendar first. Each optional, one tap.
// Then Today. Nudges are asked later, when a buzz obviously helps (#207). You has "Redo setup".
// ?demo=connected previews screen 3 with sample numbers, marked as such.

export const GOALS_PATH = "/onboarding?step=goals";
const CONNECT_PATH = "/onboarding?step=connect";
const calendarHref = (back: string) => `/integrations/google/connect?return_to=${encodeURIComponent(back)}`;

/**
 * What screen 2 offers, in order of value: everything that adds to the day (#295, all live now).
 * Nudges and Telegram wait for a moment that needs them (#207); You lists all eight.
 */
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
  const step =
    preview || sp.step === "connect" || sp.step === "done"
      ? "connect"
      : sp.step === "goals"
        ? "goals"
        : "talk";
  const failed = sp.integration_error === "google_calendar";

  // First, the talk. The calendar no longer comes first: it is the first connection on screen 3.
  if (step === "talk") return <Talk elevenlabs={await getVoiceEnabled().catch(() => false)} />;

  const [integration, goals] = await Promise.all([
    preview ? null : getGoogleCalendar(),
    getGoals().catch(() => []),
  ]);
  const calendarOn = preview || integration?.status === "connected" || sp.connected === "google_calendar";

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
    return row?.live ? [fromOnboarding(row)] : [];
  });

  return (
    <OnboardingFrame
      step={2}
      title={insight ? "Here's your week." : "Now, your days."}
      line={
        insight
          ? undefined
          : failed
            ? "Google Calendar didn't connect. Try once more below."
            : "All optional, one tap each. The more I see, the better I coach."
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
          {/* Live (#466): a connection made from here flips its row without a reload. */}
          <ConnectionsLive initial={preview ? [] : rows.map((r) => ({ id: r.id, state: r.state }))}>
            <div className="overflow-hidden rounded-group bg-fill">
              {rows.map((row, i) => (
                <div key={row.id} className="relative">
                  {i > 0 ? <Separator inset={52} /> : null}
                  <ConnectionRow row={row} arrived={row.id === arrivedFrom(sp.connected)} />
                </div>
              ))}
            </div>
          </ConnectionsLive>
        </section>
      ) : null}
    </OnboardingFrame>
  );
}
