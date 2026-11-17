import Link from "next/link";
import { Wordmark } from "@/components/brand";

/** An invite or place link that matches nobody: one line, one way on. */
export default function NotFound() {
  return (
    <main className="screen">
      <div className="mx-auto w-full max-w-[440px] pt-6">
        <Wordmark className="h-7 w-auto text-label" />
        <h1 className="mt-8 text-large-title font-bold tracking-[-0.01em]">Not on the list</h1>
        <p className="mt-2 text-body text-label-2">That link doesn't open a place.</p>
        <Link
          href="/join"
          className="press mt-6 inline-flex h-12 items-center rounded-full bg-tint px-6 text-body font-semibold text-on-tint"
        >
          Join here
        </Link>
      </div>
    </main>
  );
}
