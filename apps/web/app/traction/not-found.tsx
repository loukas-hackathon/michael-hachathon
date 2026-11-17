import Link from "next/link";

/** Anyone but an admin on /traction: the same calm line as a page that is not there. */
export default function NotFound() {
  return (
    <main className="screen">
      <h1 className="pt-13 text-large-title font-bold tracking-[0.01em]">Not here</h1>
      <p className="mt-2 text-body text-label-2">There is nothing at this address.</p>
      <Link
        href="/"
        className="press mt-4 inline-flex min-h-11 items-center rounded-full bg-[color-mix(in_srgb,var(--m-tint)_14%,transparent)] px-5 text-body font-semibold text-tint-text"
      >
        Back to Today
      </Link>
    </main>
  );
}
