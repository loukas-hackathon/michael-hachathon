import { Wordmark } from "@/components/brand";

/**
 * The thank you page, loading: its final layout, so nothing moves when the place lands. The context
 * line is real; bones where the number, its line and the two share buttons will be.
 */
export default function Loading() {
  return (
    <main className="screen m-skeleton" aria-busy="true" aria-label="Loading your place">
      <div className="mx-auto w-full max-w-[440px] lg:relative lg:-left-32 pt-6" aria-hidden="true">
        <Wordmark className="h-7 w-auto text-label" />
        <p className="mt-8 text-footnote font-semibold text-label-2">You're on the list</p>
        <span className="m-bone mt-1 block h-[70px] w-[7rem] rounded-control" />
        <span className="m-bone mt-2 block h-[22px] w-[9rem] rounded-control" />
        <span className="m-bone mt-14 block h-11 w-full rounded-control" />
        <div className="mt-3 flex gap-3">
          <span className="m-bone block h-12 flex-1 rounded-full" />
          <span className="m-bone block h-12 flex-1 rounded-full" />
        </div>
      </div>
    </main>
  );
}
