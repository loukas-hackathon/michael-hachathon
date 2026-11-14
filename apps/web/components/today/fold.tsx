import type { ReactNode } from "react";

// Today's supporting detail ("More from Michael"): one inset group of quiet rows. Each row shows a
// title and one line, and opens in place. No client JS: native <details>, so it works in server and
// client components alike.

/**
 * The "More from Michael" section. Hides itself when no row inside rendered anything, so an empty
 * group never leaves a lonely heading behind.
 */
export function MoreFromMichael({ children }: { children: ReactNode }) {
  return (
    <section aria-label="More from Michael" className="m-reveal mt-8 has-[>div:empty]:hidden">
      <h2 className="mb-2 text-title3 font-bold">More from Michael</h2>
      <div className="overflow-hidden rounded-group bg-fill">{children}</div>
    </section>
  );
}

/** One row: title, optional time on the right, one line of preview; the body opens under it. */
export function Fold({
  title,
  preview,
  meta,
  label,
  children,
}: {
  title: string;
  preview?: ReactNode;
  meta?: ReactNode;
  /** Accessible name when the title alone is not enough. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <details
      aria-label={label}
      className="group relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-[0.5px] not-first:before:bg-separator not-first:before:content-['']"
    >
      <summary className="press flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="text-body font-semibold">{title}</span>
            {meta ? <span className="ml-auto text-footnote text-label-2 tnum">{meta}</span> : null}
          </span>
          {preview ? (
            <span className="line-clamp-2 text-footnote text-label-2 group-open:hidden">{preview}</span>
          ) : null}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 shrink-0 text-label-2 transition-transform duration-[var(--m-dur-ui)] ease-[var(--m-ease-out)] group-open:rotate-90 motion-reduce:transition-none"
        >
          <path
            d="m9 5 7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}
