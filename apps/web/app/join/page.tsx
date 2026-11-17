import type { Metadata } from "next";
import { headers } from "next/headers";
import { Wordmark } from "@/components/brand";
import { getWaitlistTotal } from "@/lib/waitlist";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Join the waiting list · Michael",
  description: "Michael finds the time you lose every day and gives it back to your goals.",
};

// The public waiting list (docs/api.md, Waiting list): one headline, one product image, one
// question, one pink button. On a 390x844 phone the button sits above the fold; the rest (what he
// does, the privacy promises, the demo week) is below it. On a laptop: the story left, the form
// right, as on /login. Nothing animates on load: the headline is the largest paint, system font.
// `?ref=CODE` (a friend's invite link) and `utm_source` (or the referring site) ride along.

const CODE = /^[A-Za-z0-9_-]{4,32}$/;

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Where the visitor came from: utm_source, else the referring site's host (never our own). */
async function sourceOf(utm: string | undefined): Promise<string | null> {
  if (utm?.trim()) return utm.trim().slice(0, 200);
  const h = await headers();
  const referer = h.get("referer");
  if (!referer) return null;
  try {
    const from = new URL(referer).host;
    return from && from !== h.get("host") ? from.slice(0, 200) : null;
  } catch {
    return null;
  }
}

const LINES = [
  "One timeline of your day, from your calendar, Mac, phone and watch.",
  "The time you lose, with the maths. Minutes, not feelings.",
  "I book the time back and protect it. Every move has an undo.",
];

const TRUST = ["Your data stays in the EU.", "Off the record stops everything.", "Deletion really deletes."];

/** The total is said only once it is worth saying: never an invented or a tiny number. */
const SHOW_TOTAL_FROM = 100;

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ref = first(params.ref);
  const [source, total] = await Promise.all([sourceOf(first(params.utm_source)), getWaitlistTotal()]);

  return (
    <main className="screen screen-wide pb-[calc(32px+env(safe-area-inset-bottom))] lg:flex lg:min-h-dvh lg:items-center lg:pb-16">
      <div className="mx-auto w-full max-w-[440px] lg:grid lg:max-w-[1000px] lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center lg:gap-x-24">
        <header className="pt-6 lg:pt-0">
          <Wordmark className="h-7 w-auto text-label" />
          <h1 className="mt-6 text-large-title font-bold tracking-[-0.01em] lg:mt-10 lg:text-display lg:tracking-[-0.02em]">
            On your side.
          </h1>
          <p className="mt-2 max-w-[32ch] text-insight text-label-2">
            I find the time you lose every day and give it back to your goals.
          </p>
          <SampleDay />
          <ul className="mt-10 hidden flex-col gap-3 lg:flex" aria-label="What Michael does">
            {LINES.map((line) => (
              <Line key={line} text={line} />
            ))}
          </ul>
        </header>

        <div className="lg:row-span-2">
          <JoinForm referral={ref && CODE.test(ref) ? ref : null} source={source} />
        </div>

        <footer className="mt-12 lg:col-start-1 lg:mt-10">
          <ul className="flex flex-col gap-3 lg:hidden" aria-label="What Michael does">
            {LINES.map((line) => (
              <Line key={line} text={line} />
            ))}
          </ul>
          {total !== null && total >= SHOW_TOTAL_FROM ? (
            <p className="mt-8 text-body text-label-2 lg:mt-0" data-testid="join-total">
              <span className="tnum font-semibold text-label">{total.toLocaleString("en-GB")}</span> founders
              and executives are waiting.
            </p>
          ) : null}
          <ul className="mt-8 flex flex-col gap-1 text-footnote text-label-2" aria-label="Your data">
            {TRUST.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <a
            href="/auth/demo"
            className="press -ml-2 mt-6 inline-flex h-11 items-center gap-1 rounded-control px-2 text-body font-semibold text-label"
          >
            See the demo week
            <span aria-hidden="true" className="text-label-2">
              ›
            </span>
          </a>
          <p className="mt-6 text-footnote text-label-2">Built in Athens.</p>
        </footer>
      </div>
    </main>
  );
}

function Line({ text }: { text: string }) {
  return (
    <li className="flex gap-3 text-body">
      <span aria-hidden="true" className="mt-[8px] size-1.5 shrink-0 rounded-full bg-label" />
      <span>{text}</span>
    </li>
  );
}

/**
 * The product image, at Michael's scale: a sample day's tape (docs/design-guide.md), marked as a
 * sample. Goal time spent in pink, lost time hatched. 82 spent and 18 lost, so the pink run is 82%
 * of the bar, as the number says. The only pink on the page besides the button. Still: no motion.
 */
function SampleDay() {
  return (
    <figure className="mt-6 max-w-[300px]">
      <div
        aria-hidden="true"
        className="relative h-2 overflow-hidden rounded-full shadow-[inset_0_0_0_1px_var(--m-label-2)]"
      >
        <span className="absolute inset-y-0 left-0 w-[82%] bg-spark" />
        <span className="hatch absolute inset-y-0 left-[82%] w-[18%] bg-bg shadow-[inset_0_1px_0_var(--m-label-2),inset_0_-1px_0_var(--m-label-2)]" />
      </div>
      <figcaption className="mt-2 text-footnote text-label-2">
        Sample day: <span className="tnum font-semibold text-label">82%</span> of goal time.{" "}
        <span className="tnum">47 min</span> lost.
      </figcaption>
    </figure>
  );
}
