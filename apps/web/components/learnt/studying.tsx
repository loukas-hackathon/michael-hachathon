import Link from "next/link";
import { type Insights, studyProgress } from "@/lib/insights";

/** Nights as segments: filled for each one studied, to the number needed. */
export function NightsBar({ have, needed }: { have: number; needed: number }) {
  return (
    <span aria-hidden="true" className="flex gap-[3px]">
      {Array.from({ length: needed }, (_, n) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: one segment per night, in order
          key={n}
          className={`h-2 min-w-0 flex-1 rounded-full ${n < have ? "bg-label" : "bg-separator"}`}
        />
      ))}
    </span>
  );
}

/** "Studying. 3 of 14 nights so far." The early state of a new account, never a blank page. */
export function Studying({ studied, href }: { studied: Insights["studied"]; href?: string }) {
  const { have, needed } = studyProgress(studied);
  const body = (
    <>
      <p className="text-title3 font-bold tnum">
        Studying. {have} of {needed} nights so far.
      </p>
      <div className="mt-3">
        <NightsBar have={have} needed={needed} />
      </div>
      <p className="mt-3 text-subhead text-label-2">
        {/* (Brand) */}I need {needed} nights of sleep, phone and calendar before I can say what costs you the
        next day. Anything I see 4 times becomes a pattern.
      </p>
    </>
  );
  return href ? (
    <Link href={href} className="press mt-6 block rounded-card bg-fill px-4 py-4">
      {body}
    </Link>
  ) : (
    <section className="mt-6 rounded-card bg-fill px-4 py-4">{body}</section>
  );
}
