import type { Metadata } from "next";
import { headers } from "next/headers";
import { Wordmark } from "@/components/brand";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Join the waiting list · Michael",
  description: "Michael finds the time you lose every day and gives it back to your goals.",
};

// The public waiting list (docs/api.md, Waiting list): Michael in one screen, then the sign up.
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

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ref = first(params.ref);
  const source = await sourceOf(first(params.utm_source));

  return (
    <main className="screen pb-[calc(32px+env(safe-area-inset-bottom))] lg:pb-16">
      <div className="mx-auto w-full max-w-[440px]">
        <header className="pt-6">
          <Wordmark className="h-7 w-auto text-label" />
          <h1 className="mt-8 text-large-title font-bold tracking-[-0.01em]">On your side.</h1>
          <p className="mt-2 text-insight text-label-2">
            I find the time you lose every day and give it back to your goals.
          </p>
        </header>

        <ul className="mt-6 flex flex-col gap-3" aria-label="What Michael does">
          {LINES.map((line) => (
            <li key={line} className="flex gap-3 text-body">
              <span aria-hidden="true" className="mt-[8px] size-1.5 shrink-0 rounded-full bg-label" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <JoinForm referral={ref && CODE.test(ref) ? ref : null} source={source} />
      </div>
    </main>
  );
}
