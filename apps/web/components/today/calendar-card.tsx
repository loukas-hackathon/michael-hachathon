import { isLive } from "@michael/shared";
import { CONNECTION_BUTTON } from "@/components/you/connection-row";
import { isDemoVisitor } from "@/lib/caller";
import { getGoogleCalendar } from "@/lib/integrations";
import { USE_MOCKS } from "@/lib/mode";
import { calendarCardFor } from "./calendar-card-state";

// A calm card on Today when the calendar is missing or broken (#307): the plan is what I measure
// against, so without it the score is guesswork. One line, one tinted button (the screen's filled
// button belongs to the one suggestion, #208). Nothing for sample data, previews or the demo account.

const CONNECT = `/integrations/google/connect?return_to=${encodeURIComponent("/")}`;

export async function CalendarCard({ demo, emptyDay }: { demo?: string; emptyDay: boolean }) {
  if (USE_MOCKS || demo || !isLive("google-calendar")) return null;
  if (await isDemoVisitor()) return null;
  const card = calendarCardFor(await getGoogleCalendar(), { emptyDay });
  if (!card) return null;
  return (
    <section
      aria-label="Calendar"
      className="mt-4 flex items-center gap-3 rounded-group bg-fill py-3 pr-3 pl-4"
    >
      <p className="min-w-0 flex-1 text-subhead">{card.line}</p>
      {/* A plain link: it leaves for Google's consent screen, so nothing may prefetch it. */}
      <a href={CONNECT} className={CONNECTION_BUTTON}>
        {card.cta}
      </a>
    </section>
  );
}
