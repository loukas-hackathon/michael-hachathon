import Link from "next/link";
import { DndHandOver } from "@/components/setup/dnd-hand-over";
import { getDndOffer } from "@/lib/dnd-server";

export const metadata = { title: "Do Not Disturb · Michael" };

const ID = /^[0-9a-f-]{36}$/i;

// Do Not Disturb, asked then done (#447). A nudge's tap lands here (?nudge=<id>): the page asks
// once, in one line, and the tap switches it on until the block ends, or until the night's quiet
// hours end. No app may set a Focus, so on an iPhone the tap hands over to the Michael Focus
// shortcut; a Mac that has the shortcut does it by itself within seconds. ?id=<id> (from "Tap to
// end it") shows the one that is on, with its end.
export default async function DndPage({
  searchParams,
}: {
  searchParams: Promise<{ nudge?: string; id?: string }>;
}) {
  const { nudge } = await searchParams;
  const offer = await getDndOffer(nudge && ID.test(nudge) ? nudge : undefined);
  return (
    <main className="screen">
      <header className="flex min-h-11 items-center pt-2">
        <Link href="/" className="press -ml-2 flex h-11 items-center gap-1 px-2 text-body text-tint-text">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Today
        </Link>
      </header>
      <h1 className="mt-1 text-large-title font-bold tracking-[0.01em]">Do Not Disturb</h1>
      <div className="mt-4">
        <DndHandOver offer={offer} />
      </div>
    </main>
  );
}
