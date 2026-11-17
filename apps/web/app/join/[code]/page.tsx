import { WAITLIST_REFERRAL_BOOST } from "@michael/shared/waitlist-labels";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { getStanding } from "@/lib/waitlist";
import { InviteLink } from "./invite-link";

export const metadata: Metadata = { title: "You're on the list · Michael", robots: { index: false } };

// After joining (/join/[code]): where you stand, your invite link, what happens next. Public, by
// code: the code is all it shows, never an email or a name.

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

export default async function JoinedPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const standing = await getStanding(code);
  if (!standing) notFound();
  const link = `${await origin()}/join?ref=${encodeURIComponent(standing.referral_code)}`;
  const moved = standing.referrals * WAITLIST_REFERRAL_BOOST;

  return (
    <main className="screen pb-[calc(32px+env(safe-area-inset-bottom))] lg:pb-16">
      <div className="mx-auto w-full max-w-[440px]">
        <header className="pt-6">
          <Wordmark className="h-7 w-auto text-label" />
          <p className="mt-8 text-footnote font-semibold text-label-2">You're on the list</p>
          <h1
            className="mt-1 text-balance text-large-title font-bold tracking-[-0.01em]"
            data-testid="waitlist-position"
          >
            You are number <span className="tnum">{standing.position}</span> of{" "}
            <span className="tnum">{standing.total}</span>.
          </h1>
          <p className="mt-3 text-body text-label-2">
            {standing.referrals > 0 ? (
              <>
                <span className="tnum font-semibold text-label">{standing.referrals}</span>{" "}
                {standing.referrals === 1 ? "friend has" : "friends have"} joined with your link. That moved
                you up {places(moved)}.
              </>
            ) : (
              <>Each friend who joins with your link moves you up {places(WAITLIST_REFERRAL_BOOST)}.</>
            )}
          </p>
        </header>

        <section aria-labelledby="invite" className="mt-8">
          <h2 id="invite" className="mb-2 text-title3 font-bold">
            Your invite link
          </h2>
          <InviteLink link={link} />
        </section>

        <section aria-labelledby="next" className="mt-8">
          <h2 id="next" className="mb-2 text-title3 font-bold">
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
        </section>
      </div>
    </main>
  );
}
