import type { CSSProperties, ReactNode } from "react";
import { SkeletonMark } from "./skeleton-client";

/*
 * Loading states in the final layout of each screen (docs/design-guide.md, "Screens"). Rules:
 * - Same boxes as the real thing: the real section margins, card paddings and radii, and text
 *   lines exactly one line-height tall (`Lines`), so when content lands nothing moves (CLS 0).
 * - One skeleton per section, not one per page: a Suspense fallback is the section's skeleton.
 * - Blank for the first 200ms (fast loads never flash), then a slow breath. React holds a shown
 *   fallback for at least 300ms (FALLBACK_THROTTLE_MS), so a skeleton never flickers.
 * - Content that replaces a skeleton the user saw cross-fades in (`Reveal`, opacity only).
 * - Never a spinner, never a shimmer gradient. Reduced motion holds the bones still.
 * Sections per screen live in components/skeletons.tsx.
 */

type Header =
  /** A tab: context line, optional buttons, the Mi button, then the large title. */
  | { kind: "tab"; title?: string; actions?: number; context?: boolean }
  /** A pushed screen: back link top left, then the large title. */
  | { kind: "back"; back: string; title?: string }
  /** A sheet-like screen: Done top right, then the large title. */
  | { kind: "done"; title: string };

/** A route's loading screen: the real header, then the sections' skeletons. */
export function Skeleton({
  header = { kind: "tab" },
  label,
  className = "",
  children,
}: {
  header?: Header;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={`screen m-skeleton ${className}`} aria-busy="true" aria-label={label}>
      <SkeletonMark />
      <SkeletonHeader header={header} />
      {children}
    </main>
  );
}

function SkeletonHeader({ header }: { header: Header }) {
  if (header.kind === "back") {
    return (
      <>
        <header className="flex min-h-11 items-center pt-2">
          <span className="-ml-2 flex h-11 items-center gap-1 px-2 text-body font-semibold text-tint-text">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
              <path
                d="m15 5-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {header.back}
          </span>
        </header>
        {header.title ? (
          <h1 className="text-large-title font-bold tracking-[0.01em]">{header.title}</h1>
        ) : null}
      </>
    );
  }
  if (header.kind === "done") {
    return (
      <>
        <header className="flex min-h-11 items-center justify-end pt-2">
          <span className="-mr-2 flex h-11 items-center px-2 text-body font-semibold text-tint-text">
            Done
          </span>
        </header>
        <h1 className="text-large-title font-bold tracking-[0.01em]">{header.title}</h1>
      </>
    );
  }
  return (
    <header className="pt-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        {header.context === false ? <span /> : <Lines text="footnote" widths={["9rem"]} />}
        <div className="flex items-center gap-3.5">
          {Array.from({ length: header.actions ?? 0 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder buttons
            <span key={i} className="m-bone block size-[30px] rounded-full" />
          ))}
          <span className="m-bone block size-[30px] rounded-full" />
        </div>
      </div>
      {header.title ? (
        <h1 className="text-large-title font-bold tracking-[0.01em]">{header.title}</h1>
      ) : (
        <Lines text="large-title" widths={["6rem"]} />
      )}
    </header>
  );
}

/**
 * A section's skeleton, for a Suspense fallback or a client load (`useSkeleton`): blank for
 * 200ms, then breathing; the content that replaces it cross-fades in. Pass the real section's
 * outer classes (its margin) as `className`, so the skeleton sits exactly where the section will.
 *
 *   <Suspense fallback={<Pending label="Loading suggestions" className="mt-6"><ActionSkeleton /></Pending>}>
 */
export function Pending({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={`m-skeleton ${className}`}>
      <SkeletonMark />
      {children}
    </div>
  );
}

/** One grey shape. Width and height come from utility classes or `style`. */
export function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  const radius = className.includes("rounded-") ? "" : "rounded-block";
  return <span aria-hidden="true" className={`m-bone block ${radius} ${className}`} style={style} />;
}

const TEXT = {
  score: "text-score",
  "large-title": "text-large-title",
  insight: "text-insight",
  title3: "text-title3",
  body: "text-body",
  subhead: "text-subhead",
  footnote: "text-footnote",
  caption: "text-caption",
} as const;

/**
 * Lines of text as bones: each line is exactly the style's line-height tall, with a bone the
 * height of its capitals in the middle, so a paragraph of N lines takes the same room as N bones.
 * `widths` sets each line (the last line of a paragraph is usually shorter).
 */
export function Lines({
  text,
  widths,
  className = "",
}: {
  text: keyof typeof TEXT;
  widths: string[];
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`block ${TEXT[text]} ${className}`}>
      {widths.map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder lines
        <span key={i} className="flex h-[1lh] max-w-full items-center" style={{ width: w }}>
          <span className="m-bone block h-[0.66em] w-full rounded-[0.2em]" />
        </span>
      ))}
    </span>
  );
}

/** A grey inset group (rows) or card, as the real one: the fill does not breathe, its bones do. */
export function Group({
  className = "",
  rounded = "group",
  children,
}: {
  className?: string;
  rounded?: "group" | "card";
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden bg-fill ${rounded === "card" ? "rounded-card" : "rounded-group"} ${className}`}
    >
      {children}
    </div>
  );
}

/** The hairline between rows of a group, inset like the real one. */
export function RowRule({ inset = 16 }: { inset?: number }) {
  return <span className="absolute inset-x-0 top-0 h-[0.5px] bg-separator" style={{ marginLeft: inset }} />;
}

/** A section heading ("Allowed", "Business") with an optional footnote on the right. */
export function SectionTitle({ width = "6rem", right }: { width?: string; right?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <Lines text="title3" widths={[width]} />
      {right ? <Lines text="footnote" widths={[right]} /> : null}
    </div>
  );
}

/**
 * The old row group, kept for callers that still use it: rows of a title and a line.
 * Prefer `Group` with real row paddings so heights match.
 */
export function BoneGroup({ rows, rowHeight = 64 }: { rows: number; rowHeight?: number }) {
  return (
    <Group>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
        <div key={i} className="relative px-4 py-3" style={{ height: rowHeight }}>
          {i > 0 ? <RowRule /> : null}
          <Lines text="body" widths={["50%"]} />
          <Lines text="footnote" widths={["75%"]} />
        </div>
      ))}
    </Group>
  );
}

export { Reveal, useSkeleton } from "./skeleton-client";
