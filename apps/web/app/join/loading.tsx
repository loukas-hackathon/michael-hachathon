import { Wordmark } from "@/components/brand";

/** The waiting list, loading: its own quiet frame (never Today's skeleton), the wordmark in place. */
export default function Loading() {
  return (
    <main className="screen" aria-busy="true" aria-label="Loading">
      <div className="mx-auto w-full max-w-[440px] pt-6">
        <Wordmark className="h-7 w-auto text-label" />
      </div>
    </main>
  );
}
