import { WAITLIST_REFERRAL_BOOST } from "@michael/shared/waitlist-labels";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { getStanding } from "@/lib/waitlist";
import { Founding } from "./founding";
import { InviteLink } from "./invite-link";
import { Place } from "./place";

export const metadata: Metadata = { title: "You're on the list · Michael", robots: { index: false } };

// After joining (/join/[code]): the place first, in Score style; their own hours said back as a
// year; the share moment as the primary action; founding member as a reward; what happens next.
// Public, by code: it shows only what this code's holder told us, never an email or a name.

const NEXT = [
  "I let people in by their place on this list.",
  "When it's your turn, I email you the way in.",
  "Setup is one tap per source: calendar, Mac, phone and watch.",
];

/** This site's own origin, as the visitor reached it, for the invite link. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

const places = (n: number) => (n === 1 ? "1 place" : `${n} places`);
const sectionTitle = "mb-2 text-title3 font-bold";

export default async function JoinedPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const standing = await getStanding(code);
  if (!standing) notFound();
  const link = `${await origin()}/join?ref=${encodeURIComponent(standing.referral_code)}`;
  const moved = standing.referrals * WAITLIST_REFERRAL_BOOST;
  const hours = standing.hours_lost_per_week;

  return (
    <main className="screen pb-[calc(32px+env(safe-area-inset-bottom))] lg:pb-16">
      <div className="mx-auto w-full max-w-[440px] lg:relative lg:-left-32">
        <header className="pt-6">
          <Wordmark className="h-7 w-auto text-label" />
          <p className="mt-8 text-footnote font-semibold text-label-2">You're on the list</p>
          <Place
            code={standing.referral_code}
            position={standing.position}
            total={standing.total}
            fresh={query.new === "1"}
          />
          {hours > 0 ? (
            <p className="mt-4 text-body text-label-2">
              You said <span className="tnum font-semibold text-label">{hours} hours</span> a week. That's{" "}
              <span className="tnum font-semibold text-label">
                {(hours * 52).toLocaleString("en-GB")} hours
              </span>{" "}
              a year. I want them back.
            </p>
          ) : null}
        </header>

        <section aria-labelledby="move-up" className="mt-8">
          <h2 id="move-up" className={sectionTitle}>
            Move up
          </h2>
          <p className="mb-3 text-body text-label-2" data-testid="waitlist-referrals">
            {standing.referrals > 0 ? (
              <>
                <span className="tnum font-semibold text-label">{standing.referrals}</span>{" "}
                {standing.referrals === 1 ? "friend" : "friends"} joined. You moved up{" "}
                <span className="tnum font-semibold text-label">{places(moved)}</span>.
              </>
            ) : (
              <>Each friend who joins moves you up {places(WAITLIST_REFERRAL_BOOST)}.</>
            )}
          </p>
          <InviteLink link={link} />
        </section>

        <section aria-labelledby="founding" className="mt-6">
          <h2 id="founding" className="sr-only">
            Founding member
          </h2>
          <Founding code={standing.referral_code} initial={standing.founding_member} />
        </section>

        <section aria-labelledby="next" className="mt-6">
          <h2 id="next" className={sectionTitle}>
            What happens next
          </h2>
          <ol className="flex flex-col gap-3">
            {NEXT.map((line, i) => (
              <li key={line} className="flex gap-3 text-body">
                <span className="tnum w-4 shrink-0 font-semibold text-label-2">{i + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-footnote text-label-2">Keep this page. It updates as friends join.</p>
        </section>
      </div>
    </main>
  );
}
